import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyRestore, RESTORE_CONFIRM_TEXT } from "@/lib/content/restore-store";
import {
  createBackup,
  listBackups,
  loadVerifiedBackup,
  previewRestore,
} from "@/lib/content/backup-store";

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const NOW = new Date(2026, 9, 30, 10, 15, 0);

let root: string;
let contentRoot: string;
let backupsDir: string;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function note(id: string, title = id): string {
  return `---\nid: ${id}\ntitle: "${title}"\ncategory: 测试\ntags: []\ncreatedAt: "2026-10-01"\nupdatedAt: "2026-10-02"\n---\n\n${title} 正文\n`;
}

async function write(relative: string, text: string): Promise<void> {
  const full = path.join(contentRoot, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text, "utf8");
}

async function read(relative: string): Promise<string> {
  return fs.readFile(path.join(contentRoot, relative), "utf8");
}

async function exists(relative: string): Promise<boolean> {
  return Boolean(await fs.stat(path.join(contentRoot, relative)).catch(() => null));
}

async function baseContent(): Promise<void> {
  await write("articles/alpha.md", note("alpha", "Alpha"));
  await write("articles/beta.md", note("beta", "Beta"));
  await write("resources.json", '{"version":1,"resources":[]}\n');
  await write("tasks.json", '{"version":1,"tasks":[]}\n');
}

/** 整个 content/ 的字节指纹：用于证明「坏备份/失败恢复没有改动现有数据」 */
async function digestContent(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        out.set(
          path.relative(contentRoot, full).split(path.sep).join("/"),
          sha256(await fs.readFile(full)),
        );
      }
    }
  }
  await walk(contentRoot);
  return out;
}

async function makeBackup(): Promise<{ name: string; path: string }> {
  const created = await createBackup({ contentRoot, backupsDir, now: NOW });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("夹具备份没建出来");
  return { name: created.name, path: created.path };
}

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "restore-"));
  contentRoot = path.join(root, "content");
  backupsDir = path.join(root, "backups");
  await baseContent();
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("恢复：预览 + 确认 + 回滚", () => {
  it("预览列出新增/覆盖/删除，默认不删除当前多出来的文件", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    await fs.rm(path.join(contentRoot, "articles", "beta.md"));
    await write("articles/gamma.md", note("gamma", "Gamma"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.plan.counts).toEqual({ added: 1, overwritten: 1, unchanged: 2, deleted: 1 });

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await read("articles/alpha.md")).toContain("Alpha 正文");
    expect(await exists("articles/beta.md")).toBe(true);
    expect(await exists("articles/gamma.md")).toBe(true);
    expect(result.deletedTo).toBeNull();
    expect(result.snapshotName).toMatch(/^pre-restore-/);
  });

  it("勾选删除：多出来的文件被移进 content/.trash/restore-*，不是真删", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    await fs.rm(path.join(contentRoot, "articles", "beta.md"));
    await write("articles/gamma.md", note("gamma", "Gamma"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: true,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: true,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(await exists("articles/gamma.md")).toBe(false);
    expect(result.deletedTo).toContain("restore-");
    const moved = await fs.readdir(result.deletedTo ?? "");
    expect(moved.join("\n")).toContain("gamma.md");
  });

  it("恢复前快照保存的是恢复前的现状", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    await write("articles/gamma.md", note("gamma", "Gamma"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const snapshot = await loadVerifiedBackup(result.snapshotPath);
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.backup.files.get("content/articles/alpha.md")?.toString("utf8")).toContain(
      "Alpha v2",
    );
    expect(snapshot.backup.files.has("content/articles/gamma.md")).toBe(true);
  });

  it("回滚：把恢复前快照再恢复一次，能回到恢复前", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    await fs.rm(path.join(contentRoot, "articles", "beta.md"));
    await write("articles/gamma.md", note("gamma", "Gamma"));

    const firstPreview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: true,
    });
    expect(firstPreview.ok).toBe(true);
    if (!firstPreview.ok) return;

    const first = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: firstPreview.plan.planHash,
      includeDeletes: true,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const snapshotPreview = await previewRestore({
      contentRoot,
      backupsDir,
      name: first.snapshotName,
      includeDeletes: true,
    });
    expect(snapshotPreview.ok).toBe(true);
    if (!snapshotPreview.ok) return;

    const rollback = await applyRestore({
      contentRoot,
      backupsDir,
      name: first.snapshotName,
      planHash: snapshotPreview.plan.planHash,
      includeDeletes: true,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(rollback.ok).toBe(true);
    if (!rollback.ok) return;

    expect(await read("articles/alpha.md")).toContain("Alpha v2");
    expect(await exists("articles/gamma.md")).toBe(true);
    expect(await exists("articles/beta.md")).toBe(false);
  });

  it("预览之后内容又变了：拒绝（stale），一个文件都不动", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    await write("articles/alpha.md", note("alpha", "Alpha v3"));
    const before = await digestContent();

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
    expect(await digestContent()).toEqual(before);
    expect((await listBackups(backupsDir)).length).toBe(1);
  });

  it("确认文字不对：拒绝，不动数据", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    const before = await digestContent();

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: "覆盖",
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("confirm");
    expect(await digestContent()).toEqual(before);
  });

  it("坏 zip：在写任何文件之前拒绝，content/ 字节不变", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    const before = await digestContent();

    const bytes = await fs.readFile(backup.path);
    await fs.writeFile(backup.path, bytes.subarray(0, 80));

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: "whatever",
      includeDeletes: true,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("verify");
    expect(await digestContent()).toEqual(before);
  });

  it("与当前完全一致：拒绝并说明没有可恢复的文件", async () => {
    const backup = await makeBackup();
    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("一致");
  });

  it("只有「当前多出来的文件」时，不勾删除会明确提示", async () => {
    const backup = await makeBackup();
    await write("articles/gamma.md", note("gamma", "Gamma"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.plan.counts).toMatchObject({ added: 0, overwritten: 0, deleted: 1 });

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("同时删除");
    expect(await exists("articles/gamma.md")).toBe(true);
  });
});
