import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { restoreJournalPath } from "@/lib/content/restore-journal";
import { applyTrashCleanup, previewTrashCleanup } from "@/lib/content/trash-store";
import { serialize } from "@/lib/fs/mutex";

/**
 * P1 `.trash` 清理的执行层（真 `content/` 副本）。
 *
 * 三块：笔记回收站（文件名前缀）、资源/任务删除留档（JSONL 裁行）、恢复副本目录（mtime）。
 * 默认 90 天；解析不出时间的、白名单外的、不是普通文件的，一个字节都不动。
 * 预览只读；执行重算候选 + 比对 planHash；JSONL 原子写，写失败原文件不动。
 */

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const CONFIRM = "清理";
const NOW = new Date(2026, 0, 31, 12, 0, 0);
const OLD = new Date(2025, 0, 1, 0, 0, 0);
const FRESH = new Date(2026, 0, 30, 12, 0, 0);

let root: string;
let contentRoot: string;
let backupsDir: string;

const itWindows = it.skipIf(process.platform !== "win32");

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "trash-cleanup-"));
  contentRoot = path.join(root, "content");
  backupsDir = path.join(root, "backups");
  await fs.mkdir(backupsDir, { recursive: true });
  await write("articles/active.md", "active note\n");
  await write("resources.json", '{"version":1,"resources":[]}\n');
  await write("tasks.json", '{"version":1,"tasks":[]}\n');
});

afterEach(async () => {
  if (contentRoot) {
    // 只读用例会把文件改成 0444；先恢复可写，避免清不掉临时目录
    await restoreWritable(contentRoot);
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function restoreWritable(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await restoreWritable(full);
    await fs.chmod(full, 0o666).catch(() => {});
  }
}

async function write(relative: string, text: string): Promise<void> {
  const full = path.join(contentRoot, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text, "utf8");
}

async function trashNote(name: string, body = "trash body\n"): Promise<string> {
  const relative = `articles/.trash/${name}`;
  await write(relative, body);
  return relative;
}

async function jsonl(name: string, lines: string[]): Promise<string> {
  const relative = `.trash/${name}`;
  await write(relative, lines.join("\n") + "\n");
  return relative;
}

async function restoreDir(name: string, mtime: Date): Promise<string> {
  const relative = `.trash/${name}`;
  await write(`${relative}/copy.txt`, "copy\n");
  await fs.utimes(path.join(contentRoot, relative), mtime, mtime);
  return relative;
}

async function fingerprint(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  async function walk(current: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        out[rel] = "<dir>";
        await walk(full, rel);
      } else if (entry.isFile()) {
        out[rel] = JSON.stringify(await fs.readFile(full));
      } else {
        out[rel] = "<other>";
      }
    }
  }

  await walk(dir, "");
  return out;
}

describe(".trash 清理：只动白名单里、确实超期的条目", () => {
  it("过期笔记删除；未过期 / 解析失败 / 非 .md / 子目录 / 点文件一字节不动", async () => {
    const expired = await trashNote("20250101-000000-old.md");
    const fresh = await trashNote("20260130-000000-fresh.md");
    const noPrefix = await trashNote("old.md");
    const notMd = "articles/.trash/20250101-000000-x.txt";
    await write(notMd, "txt\n");
    const asDir = "articles/.trash/20250101-000000-dir.md";
    await fs.mkdir(path.join(contentRoot, asDir), { recursive: true });
    const dot = "articles/.trash/.keep";
    await write(dot, "");

    const before = await fingerprint(contentRoot);
    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.articles.map((item) => item.path)).toEqual([expired]);
    const skipped = preview.skipped.map((item) => item.path);
    expect(skipped).toEqual(expect.arrayContaining([noPrefix, notMd, asDir, dot]));
    expect(skipped).not.toContain(fresh);

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.planHash,
      confirm: CONFIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.removed).toEqual([expired]);
    await expect(fs.lstat(path.join(contentRoot, expired))).rejects.toMatchObject({
      code: "ENOENT",
    });
    for (const kept of [fresh, noPrefix, notMd, asDir, dot]) {
      await expect(fs.lstat(path.join(contentRoot, kept))).resolves.toBeTruthy();
    }

    const after = await fingerprint(contentRoot);
    for (const key of [fresh, noPrefix, notMd, dot, "articles/active.md", "resources.json", "tasks.json"]) {
      expect(after[key]).toBe(before[key]);
    }
  });

  it("JSONL 只裁超期行、文件保留；未知 jsonl 一个字节不动", async () => {
    const file = await jsonl("resources-deleted.jsonl", [
      '{"deletedAt":"20250101-000000","resource":{"id":"old"}}',
      '{"deletedAt":"20261001-000000","resource":{"id":"fresh"}}',
      "{bad json",
      '{"resource":{"id":"missing"}}',
      "",
    ]);
    const tasks = await jsonl("tasks-deleted.jsonl", [
      '{"deletedAt":"20250101-000000","task":{"id":"old"}}',
    ]);
    const unknown = ".trash/unknown.jsonl";
    await write(unknown, '{"deletedAt":"20250101-000000"}\n');

    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.jsonl.find((item) => item.file === file)?.dropped).toBe(1);
    expect(preview.jsonl.find((item) => item.file === tasks)?.dropped).toBe(1);
    expect(preview.skipped.map((item) => item.path)).toContain(unknown);

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.planHash,
      confirm: CONFIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await fs.readFile(path.join(contentRoot, file), "utf8")).toBe(
      [
        '{"deletedAt":"20261001-000000","resource":{"id":"fresh"}}',
        "{bad json",
        '{"resource":{"id":"missing"}}',
        "",
      ].join("\n") + "\n",
    );

    // 全部超期：文件还在，只是变成空文件
    await expect(fs.lstat(path.join(contentRoot, tasks))).resolves.toBeTruthy();
    expect(await fs.readFile(path.join(contentRoot, tasks), "utf8")).toBe("");
    expect(await fs.readFile(path.join(contentRoot, unknown), "utf8")).toBe(
      '{"deletedAt":"20250101-000000"}\n',
    );
  });

  it("restore-* 按 mtime 整目录删；非目录、非 restore 名字不动", async () => {
    const oldDir = await restoreDir("restore-20250101-000000", OLD);
    const oldRollback = await restoreDir("restore-rollback-20250102-000000", OLD);
    const freshDir = await restoreDir("restore-20260130-000000", FRESH);
    const asFile = ".trash/restore-20250103-000000";
    await write(asFile, "not a dir\n");
    await write(".trash/keep-me/inside.txt", "keep\n");

    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.restoreDirs.map((item) => item.path)).toEqual([oldDir, oldRollback]);

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.planHash,
      confirm: CONFIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const gone of [oldDir, oldRollback]) {
      await expect(fs.lstat(path.join(contentRoot, gone))).rejects.toMatchObject({
        code: "ENOENT",
      });
    }
    await expect(fs.lstat(path.join(contentRoot, freshDir))).resolves.toBeTruthy();
    await expect(fs.lstat(path.join(contentRoot, asFile))).resolves.toBeTruthy();
    await expect(fs.lstat(path.join(contentRoot, ".trash/keep-me/inside.txt"))).resolves.toBeTruthy();
  });

  it("预览不改盘；执行只动 .trash，活动内容字节不变", async () => {
    const note = await trashNote("20250101-000000-a.md");
    const file = await jsonl("resources-deleted.jsonl", [
      '{"deletedAt":"20250101-000000"}',
      '{"deletedAt":"20261001-000000"}',
    ]);
    const oldDir = await restoreDir("restore-20250101-000000", OLD);

    const before = await fingerprint(contentRoot);
    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    expect(await fingerprint(contentRoot)).toEqual(before);

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.ok ? preview.planHash : "",
      confirm: CONFIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = await fingerprint(contentRoot);
    expect(after[note]).toBeUndefined();
    expect(after[oldDir]).toBeUndefined();
    expect(after["articles/active.md"]).toBe(before["articles/active.md"]);
    expect(after["resources.json"]).toBe(before["resources.json"]);
    expect(after["tasks.json"]).toBe(before["tasks.json"]);
    expect(after[file]).not.toBe(before[file]);
  });

  it("预览后新增过期笔记：stale 拒绝，零改动", async () => {
    const first = await trashNote("20250101-000000-a.md");
    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const added = await trashNote("20250102-000000-b.md");
    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.planHash,
      confirm: CONFIRM,
    });

    expect(result).toMatchObject({ ok: false, reason: "stale" });
    await expect(fs.lstat(path.join(contentRoot, first))).resolves.toBeTruthy();
    await expect(fs.lstat(path.join(contentRoot, added))).resolves.toBeTruthy();
  });

  it("预览后 JSONL 多了一行：stale 拒绝，连新行也原样保留", async () => {
    const file = await jsonl("resources-deleted.jsonl", ['{"deletedAt":"20250101-000000"}']);
    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    await fs.appendFile(path.join(contentRoot, file), '{"deletedAt":"20261001-000000"}\n', "utf8");
    const afterAppend = await fs.readFile(path.join(contentRoot, file), "utf8");

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.planHash,
      confirm: CONFIRM,
    });

    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(await fs.readFile(path.join(contentRoot, file), "utf8")).toBe(afterAppend);
  });

  it("journal 还是 applying：预览与执行都拒绝，零改动", async () => {
    const note = await trashNote("20250101-000000-a.md");
    await fs.writeFile(
      restoreJournalPath(backupsDir),
      JSON.stringify({
        version: 1,
        snapshot: "pre-restore-20261030-100000.zip",
        planHash: "plan-hash",
        startedAt: NOW.toISOString(),
        phase: "applying",
      }),
      "utf8",
    );

    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview).toMatchObject({ ok: false, reason: "blocked" });

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: "whatever",
      confirm: CONFIRM,
    });
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    await expect(fs.lstat(path.join(contentRoot, note))).resolves.toBeTruthy();
  });

  it("content/.trash 不是普通目录：整体拒绝，零改动", async () => {
    const note = await trashNote("20250101-000000-a.md");
    await fs.rm(path.join(contentRoot, ".trash"), { recursive: true, force: true });
    await fs.writeFile(path.join(contentRoot, ".trash"), "not a directory", "utf8");

    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview).toMatchObject({ ok: false, reason: "io" });

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: "whatever",
      confirm: CONFIRM,
    });
    expect(result).toMatchObject({ ok: false, reason: "io" });
    await expect(fs.lstat(path.join(contentRoot, note))).resolves.toBeTruthy();
  });

  itWindows("JSONL 只读：原子写失败、原文件字节不变；其余项照删且失败逐项报", async () => {
    const note = await trashNote("20250101-000000-a.md");
    const file = await jsonl("resources-deleted.jsonl", [
      '{"deletedAt":"20250101-000000"}',
      '{"deletedAt":"20261001-000000"}',
    ]);
    const before = await fs.readFile(path.join(contentRoot, file), "utf8");
    await fs.chmod(path.join(contentRoot, file), 0o444);

    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.planHash,
      confirm: CONFIRM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.removed).toContain(note);
    expect(result.failed.map((item) => item.path)).toContain(file);
    expect(await fs.readFile(path.join(contentRoot, file), "utf8")).toBe(before);
  });

  it("与恢复串行：cleanup 不会插到正在进行的 serialize 任务前面", async () => {
    await trashNote("20250101-000000-a.md");
    const preview = await previewTrashCleanup({ contentRoot, backupsDir, now: NOW });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const order: string[] = [];
    const holding = serialize(async () => {
      order.push("restore-start");
      await new Promise((resolve) => setTimeout(resolve, 60));
      order.push("restore-end");
    });
    const pruning = applyTrashCleanup({
      contentRoot,
      backupsDir,
      now: NOW,
      planHash: preview.planHash,
      confirm: CONFIRM,
    }).then((result) => {
      order.push(`prune:${result.ok}`);
    });

    await Promise.all([holding, pruning]);

    expect(order).toEqual(["restore-start", "restore-end", "prune:true"]);
  });
});
