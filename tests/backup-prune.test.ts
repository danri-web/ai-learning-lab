import { createHash } from "node:crypto";
import { promises as fs, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createBackup,
  previewBackupPrune,
  pruneBackups,
} from "@/lib/content/backup-store";
import { restoreJournalPath } from "@/lib/content/restore-journal";
import { serialize } from "@/lib/fs/mutex";

/**
 * P1 备份清理的执行层（真 `backups/` 临时目录）。
 *
 * 这一层只做四件事：加锁 → 现读 journal 闸门 → 重算候选并与预览指纹比对 → 逐项删。
 * 下面每条都对应一个「不能破」的边界；先看它红，再实现。
 */

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const CONFIRM = "清理";

let root: string;
let contentRoot: string;
let backupsDir: string;

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "backup-prune-"));
  contentRoot = path.join(root, "content");
  backupsDir = path.join(root, "backups");
  await fs.mkdir(path.join(contentRoot, "articles"), { recursive: true });
  await fs.writeFile(
    path.join(contentRoot, "articles", "note.md"),
    '---\nid: "note"\ntitle: "Note"\ncategory: "测试"\ntags: []\ncreatedAt: "2026-10-01"\nupdatedAt: "2026-10-02"\n---\n\n正文\n',
    "utf8",
  );
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

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
        out[rel] = createHash("sha256").update(await fs.readFile(full)).digest("hex");
      } else {
        out[rel] = "<other>";
      }
    }
  }

  await walk(dir, "");
  return out;
}

function zipNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".zip"))
    .sort();
}

async function seedBackups(count: number): Promise<string[]> {
  const names: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await createBackup({
      contentRoot,
      backupsDir,
      now: new Date(2026, 9, 30, 10, 0, index),
    });
    if (!result.ok) throw new Error(result.error);
    names.push(result.name);
  }
  return names;
}

async function makeSnapshot(at: Date): Promise<string> {
  const result = await createBackup({ contentRoot, backupsDir, now: at, kind: "pre-restore" });
  if (!result.ok) throw new Error(result.error);
  return result.name;
}

async function writeJournal(phase: "applying" | "verified", snapshot: string): Promise<void> {
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.writeFile(
    restoreJournalPath(backupsDir),
    JSON.stringify({
      version: 1,
      snapshot,
      planHash: "plan-hash",
      startedAt: new Date(2026, 9, 30, 9, 0, 0).toISOString(),
      phase,
    }),
    "utf8",
  );
}

describe("备份清理：预览 + 确认 + 重算", () => {
  it("预览不改盘；执行只删最老 2 份，保留的 10 份字节不变", async () => {
    const names = await seedBackups(12);
    const before = await fingerprint(backupsDir);

    const preview = await previewBackupPrune({ backupsDir });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.expired.map((item) => item.name)).toEqual([names[0], names[1]]);
    expect(preview.keep).toHaveLength(10);
    expect(preview.totalBytes).toBeGreaterThan(0);
    expect(await fingerprint(backupsDir)).toEqual(before);

    const result = await pruneBackups({ backupsDir, planHash: preview.planHash, confirm: CONFIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.removed).toEqual([names[0], names[1]]);
    expect(result.failed).toEqual([]);
    expect(zipNames(backupsDir)).toEqual(names.slice(2).sort());

    const after = await fingerprint(backupsDir);
    for (const name of names.slice(2)) expect(after[name]).toBe(before[name]);
  });

  it("pre-restore、恢复日志、白名单外名字、目录一个都不动", async () => {
    const names = await seedBackups(12);
    const snapshot = await makeSnapshot(new Date(2026, 9, 30, 9, 0, 0));
    await writeJournal("verified", snapshot);
    await fs.writeFile(path.join(backupsDir, "notes.txt"), "keep\n", "utf8");
    await fs.mkdir(path.join(backupsDir, "ai-lab-20200101-000000.zip"));

    const preview = await previewBackupPrune({ backupsDir });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.expired.map((item) => item.name)).toEqual([names[0], names[1]]);
    const ignored = preview.ignored.map((item) => item.name);
    expect(ignored).toEqual(
      expect.arrayContaining([
        snapshot,
        "restore-journal.json",
        "notes.txt",
        "ai-lab-20200101-000000.zip",
      ]),
    );

    const result = await pruneBackups({ backupsDir, planHash: preview.planHash, confirm: CONFIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const name of [
      snapshot,
      "restore-journal.json",
      "notes.txt",
      "ai-lab-20200101-000000.zip",
    ]) {
      await expect(fs.lstat(path.join(backupsDir, name))).resolves.toBeTruthy();
    }
  });

  it("确认文字不对：拒绝且零删除", async () => {
    await seedBackups(12);
    const preview = await previewBackupPrune({ backupsDir });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await pruneBackups({
      backupsDir,
      planHash: preview.planHash,
      confirm: "清理备份",
    });

    expect(result).toMatchObject({ ok: false, reason: "confirm" });
    expect(zipNames(backupsDir)).toHaveLength(12);
  });

  it("预览后新建了一份备份：stale 拒绝，零删除", async () => {
    await seedBackups(12);
    const preview = await previewBackupPrune({ backupsDir });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    await createBackup({
      contentRoot,
      backupsDir,
      now: new Date(2026, 9, 30, 11, 0, 0),
    });

    const result = await pruneBackups({ backupsDir, planHash: preview.planHash, confirm: CONFIRM });
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(zipNames(backupsDir)).toHaveLength(13);
  });

  it("预览后候选被换成坏 zip：stale 拒绝，零删除", async () => {
    const names = await seedBackups(12);
    const preview = await previewBackupPrune({ backupsDir });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    await fs.writeFile(path.join(backupsDir, names[0]), "not a zip", "utf8");

    const result = await pruneBackups({ backupsDir, planHash: preview.planHash, confirm: CONFIRM });
    expect(result).toMatchObject({ ok: false, reason: "stale" });
    expect(zipNames(backupsDir)).toHaveLength(12);
  });

  it("journal 还是 applying：预览与执行都拒绝，零删除", async () => {
    await seedBackups(12);
    const snapshot = await makeSnapshot(new Date(2026, 9, 30, 9, 0, 0));
    await writeJournal("applying", snapshot);

    const preview = await previewBackupPrune({ backupsDir });
    expect(preview).toMatchObject({ ok: false, reason: "blocked" });

    const result = await pruneBackups({ backupsDir, planHash: "whatever", confirm: CONFIRM });
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
    expect(zipNames(backupsDir)).toHaveLength(13);
  });

  it("与恢复串行：cleanup 不会插到正在进行的 serialize 任务前面", async () => {
    const names = await seedBackups(12);
    const preview = await previewBackupPrune({ backupsDir });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const order: string[] = [];
    const holding = serialize(async () => {
      order.push("restore-start");
      await new Promise((resolve) => setTimeout(resolve, 60));
      order.push("restore-end");
    });
    const pruning = pruneBackups({
      backupsDir,
      planHash: preview.planHash,
      confirm: CONFIRM,
    }).then((result) => {
      order.push(`prune:${result.ok}`);
    });

    await Promise.all([holding, pruning]);

    expect(order).toEqual(["restore-start", "restore-end", "prune:true"]);
    expect(zipNames(backupsDir)).toEqual(names.slice(2).sort());
  });

  it("超期但损坏的备份：只标记、不删，保留的份数照旧", async () => {
    const names = await seedBackups(12);
    await fs.writeFile(path.join(backupsDir, names[0]), "not a zip", "utf8");

    const preview = await previewBackupPrune({ backupsDir });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    expect(preview.damaged.map((item) => item.name)).toEqual([names[0]]);
    expect(preview.expired.map((item) => item.name)).toEqual([names[1]]);

    const result = await pruneBackups({ backupsDir, planHash: preview.planHash, confirm: CONFIRM });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.removed).toEqual([names[1]]);
    await expect(fs.lstat(path.join(backupsDir, names[0]))).resolves.toBeTruthy();
    expect(zipNames(backupsDir)).toHaveLength(11);
  });
});
