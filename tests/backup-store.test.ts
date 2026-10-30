import { createHash } from "node:crypto";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import yazl from "yazl";

import { MANIFEST_NAME, buildManifest, type BackupManifest } from "@/lib/content/backup-format";
import {
  createBackup,
  listBackups,
  loadVerifiedBackup,
  previewRestore,
  readBackupManifest,
  scanContent,
  verifyBackupByName,
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

async function baseContent(): Promise<void> {
  await write("articles/alpha.md", note("alpha", "Alpha"));
  await write("articles/中文笔记.md", note("中文笔记", "中文笔记"));
  await write("articles/_draft.md", "草稿：还没有 frontmatter\n");
  await write("articles/.trash/20261030-101500-old.md", note("old", "Old"));
  await write("resources.json", '{"version":1,"resources":[]}\n');
  await write("tasks.json", '{"version":1,"tasks":[]}\n');
  await write(".trash/resources-deleted.jsonl", '{"deletedAt":"2026-10-30 10:00:00"}\n');
}

type RawEntry = { name: string; bytes: Buffer } | { path: string; bytes: Buffer };

async function rawZip(target: string, entries: RawEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    const name = "name" in entry ? entry.name : entry.path;
    zip.addBuffer(entry.bytes, name);
  }
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(target, { flags: "wx" });
    out.on("close", resolve);
    out.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(out);
    zip.end();
  });
}

function manifestFor(
  files: { path: string; bytes: Buffer }[],
  options: { kind?: "manual" | "pre-restore"; now?: Date } = {},
): BackupManifest {
  return buildManifest(
    files.map((file) => ({ path: file.path, size: file.bytes.length, sha256: sha256(file.bytes) })),
    { kind: options.kind ?? "manual", now: options.now ?? NOW },
  );
}

async function backupWith(
  name: string,
  files: { path: string; bytes: Buffer }[],
  mutate?: (manifest: BackupManifest) => BackupManifest,
): Promise<void> {
  const manifest = manifestFor(files);
  const next = mutate ? mutate(manifest) : manifest;
  await rawZip(path.join(backupsDir, name), [
    { name: MANIFEST_NAME, bytes: Buffer.from(`${JSON.stringify(next, null, 2)}\n`) },
    ...files,
  ]);
}

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "backup-"));
  contentRoot = path.join(root, "content");
  backupsDir = path.join(root, "backups");
  await baseContent();
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("创建备份", () => {
  it("创建 → 自检 → 列表 → 读回 manifest", async () => {
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.name).toBe("ai-lab-20261030-101500.zip");
    expect(created.verified).toBe(true);
    expect(await fs.stat(created.path)).toBeTruthy();

    const listed = await listBackups(backupsDir);
    expect(listed).toHaveLength(1);
    expect(listed[0].error).toBeNull();
    expect(listed[0].manifest?.files.length).toBe(created.manifest.files.length);

    const read = await readBackupManifest(created.path);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.manifest.files).toEqual(created.manifest.files);
  });

  it("中文文件名原样往返（不靠系统编码猜）", async () => {
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const loaded = await loadVerifiedBackup(created.path);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.backup.files.has("content/articles/中文笔记.md")).toBe(true);
    expect(loaded.backup.files.get("content/articles/中文笔记.md")?.toString("utf8")).toContain(
      "中文笔记 正文",
    );
  });

  it("同一秒里建两次不会互相覆盖", async () => {
    const first = await createBackup({ contentRoot, backupsDir, now: NOW });
    const second = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.name).not.toBe(first.name);
    expect((await listBackups(backupsDir)).length).toBe(2);
  });

  it("空 content/ 也能备份（0 个文件）", async () => {
    const empty = path.join(root, "empty-content");
    await fs.mkdir(empty, { recursive: true });
    const created = await createBackup({ contentRoot: empty, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.manifest.files).toEqual([]);
  });

  it("白名单外的文件跳过并在结果里报出来", async () => {
    await write("articles/foo.txt", "附件");
    await write(".trash/unknown.jsonl", "{}\n");
    await write(".trash/restore-1/old.md", "恢复副本\n");

    const scanned = await scanContent(contentRoot);
    expect(scanned.files.some((file) => file.meta.path.endsWith("foo.txt"))).toBe(false);
    expect(scanned.skipped.join("\n")).toContain("foo.txt");
    expect(scanned.skipped.join("\n")).toContain("restore-1");

    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
  });

  it("verifyBackupByName 能完整校验", async () => {
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const verified = await verifyBackupByName({ backupsDir, name: created.name });
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.fileCount).toBe(created.manifest.files.length);
  });
});

describe("坏备份（先看着它失败）", () => {
  async function validBackupName(): Promise<string> {
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("夹具没建出来");
    return created.name;
  }

  it("截断的 zip 被拒绝", async () => {
    const name = await validBackupName();
    const full = path.join(backupsDir, name);
    const bytes = await fs.readFile(full);
    await fs.writeFile(full, bytes.subarray(0, 100));

    const loaded = await loadVerifiedBackup(full);
    expect(loaded.ok).toBe(false);
  });

  it("不是 zip 的文件被拒绝", async () => {
    const name = "ai-lab-20261030-101500.zip";
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(path.join(backupsDir, name), "这不是 zip", "utf8");
    const loaded = await loadVerifiedBackup(path.join(backupsDir, name));
    expect(loaded.ok).toBe(false);
  });

  it("压缩炸弹（高压缩比）被拒绝", async () => {
    const name = "ai-lab-20261030-101500.zip";
    const bomb = Buffer.alloc(2 * 1024 * 1024, 0);
    await rawZip(path.join(backupsDir, name), [
      { name: MANIFEST_NAME, bytes: Buffer.from("{}") },
      { name: "content/articles/bomb.md", bytes: bomb },
    ]);
    const loaded = await loadVerifiedBackup(path.join(backupsDir, name));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error).toMatch(/压缩比|炸弹|太大/);
  });

  it("条目大小与 manifest 不一致被拒绝", async () => {
    const name = "ai-lab-20261030-101500.zip";
    const bytes = Buffer.from("短内容");
    await backupWith(name, [{ path: "content/articles/alpha.md", bytes }], (manifest) => ({
      ...manifest,
      files: manifest.files.map((file) => ({ ...file, size: file.size + 10 })),
      totalBytes: manifest.totalBytes + 10,
    }));
    const loaded = await loadVerifiedBackup(path.join(backupsDir, name));
    expect(loaded.ok).toBe(false);
  });

  it("sha256 不一致被拒绝", async () => {
    const name = "ai-lab-20261030-101500.zip";
    const bytes = Buffer.from("内容");
    await backupWith(name, [{ path: "content/articles/alpha.md", bytes }], (manifest) => ({
      ...manifest,
      files: manifest.files.map((file) => ({ ...file, sha256: "b".repeat(64) })),
    }));
    const loaded = await loadVerifiedBackup(path.join(backupsDir, name));
    expect(loaded.ok).toBe(false);
  });

  it("清单外的条目被拒绝", async () => {
    const name = "ai-lab-20261030-101500.zip";
    const bytes = Buffer.from("内容");
    const manifest = manifestFor([{ path: "content/articles/alpha.md", bytes }]);
    await rawZip(path.join(backupsDir, name), [
      { name: MANIFEST_NAME, bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "content/articles/alpha.md", bytes },
      { name: "content/articles/evil.md", bytes: Buffer.from("多出来的") },
    ]);
    const loaded = await loadVerifiedBackup(path.join(backupsDir, name));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error).toContain("清单外");
  });

  it("清单里的文件缺失被拒绝", async () => {
    const name = "ai-lab-20261030-101500.zip";
    const bytes = Buffer.from("内容");
    const manifest = manifestFor([
      { path: "content/articles/alpha.md", bytes },
      { path: "content/articles/beta.md", bytes },
    ]);
    await rawZip(path.join(backupsDir, name), [
      { name: MANIFEST_NAME, bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: "content/articles/alpha.md", bytes },
    ]);
    const loaded = await loadVerifiedBackup(path.join(backupsDir, name));
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error).toContain("缺少");
  });

  it("路径穿越的条目名被拒绝（同长度字节替换，模拟恶意 zip）", async () => {
    const traversalContent = path.join(root, "traversal-content");
    await fs.mkdir(path.join(traversalContent, "articles"), { recursive: true });
    await fs.writeFile(
      path.join(traversalContent, "articles", "aaaa.md"),
      note("aaaa", "Aaaa"),
      "utf8",
    );

    const created = await createBackup({
      contentRoot: traversalContent,
      backupsDir,
      now: NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const valid = Buffer.from("content/articles/aaaa.md", "utf8");
    const evil = Buffer.from("content/articles/../a.md", "utf8");
    expect(valid.length).toBe(evil.length);

    const bytes = await fs.readFile(created.path);
    for (let index = bytes.indexOf(valid); index !== -1; index = bytes.indexOf(valid, index + 1)) {
      evil.copy(bytes, index);
    }
    await fs.writeFile(created.path, bytes);

    const loaded = await loadVerifiedBackup(created.path);
    expect(loaded.ok).toBe(false);
    // 没有在 content/ 外面写出任何东西
    expect(await fs.stat(path.join(root, "a.md")).catch(() => null)).toBeNull();
  });

  it("备份里的 resources.json 坏了：能创建，但预览/恢复拒绝", async () => {
    await write("resources.json", "{ 坏 JSON");
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const preview = await previewRestore({ contentRoot, backupsDir, name: created.name });
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.error).toContain("resources.json");
  });

  it("备份里的笔记坏了：只给 warning，不阻止预览", async () => {
    await write("articles/broken.md", "没有 frontmatter 的正文\n");
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const preview = await previewRestore({ contentRoot, backupsDir, name: created.name });
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.warnings.join("\n")).toContain("broken.md");
  });
});
