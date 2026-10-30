import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

import yauzl, { type Entry, type ZipFile as ReadZipFile } from "yauzl";
import yazl from "yazl";

import {
  MANIFEST_NAME,
  backupBaseName,
  buildManifest,
  computeRestorePlan,
  formatBytes,
  isBackupFileName,
  parseManifest,
  type BackupFileMeta,
  type BackupKind,
  type BackupManifest,
  type RestorePlan,
} from "@/lib/content/backup-format";
import {
  BACKUP_KEEP_COUNT,
  BACKUP_PRUNE_CONFIRM_TEXT,
  selectExpiredBackups,
} from "@/lib/content/backup-retention";
import { contentRoot } from "@/lib/content/resources";
import { checkBackupPayload } from "@/lib/content/backup-validate";
import { pendingRestoreMessage } from "@/lib/content/restore-gate";
import { RESTORE_JOURNAL_NAME } from "@/lib/content/restore-journal";
import { writeFileAtomic } from "@/lib/fs/atomic-write";
import { serialize } from "@/lib/fs/mutex";
import {
  MAX_COMPRESSION_RATIO,
  MAX_ENTRY_COUNT,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  validateBackupEntryName,
} from "@/lib/security/backup-entry";

/**
 * 备份的**读写**（阶段 7）。这里是唯一碰 `backups/` 与 zip 的地方。
 *
 * 设计要点：
 *   1. 备份 = content/ 下白名单文件的 zip + 根目录 manifest.json（每文件 sha256）
 *   2. 建完**立刻重读校验**：条目名、大小、哈希、压缩比、重复条目，一项不对就删掉这份新备份
 *   3. 恢复只从 backups/ 里选（不接受上传），名称必须匹配我们自己生成的时间戳格式
 *   4. 读取 zip 时把条目名按 UTF-8 解（decodeStrings=false + fileNameRaw），中文文件名不会乱码
 *
 * 已知边界（ADR D12）：
 *   - `content/.trash/restore-*` 是恢复时挪进去的二级副本，不纳入备份（pre-restore 快照兜底）
 *   - `.env.local` 不进备份（口令哈希与会话密钥不跟着 zip 到处跑）
 *   - `backups/` 是明文 zip，别放公开同步盘
 */

const MANIFEST_CAP_BYTES = 2 * 1024 * 1024;

export type BackupFailure = { ok: false; error: string };

export type ScannedFile = { meta: BackupFileMeta; bytes: Buffer };

export type ScanResult = {
  files: ScannedFile[];
  /** 不在白名单 / 是链接 / 不是普通文件：跳过并报出来（不静默丢） */
  skipped: string[];
};

export type CreateBackupResult =
  | { ok: true; name: string; path: string; manifest: BackupManifest; verified: true }
  | BackupFailure;

export type VerifiedBackup = {
  manifest: BackupManifest;
  files: Map<string, Buffer>;
};

export type LoadBackupResult = { ok: true; backup: VerifiedBackup } | BackupFailure;

export type BackupListItem = {
  name: string;
  sizeBytes: number;
  modifiedAt: Date;
  manifest: BackupManifest | null;
  error: string | null;
};

function fail(error: string): BackupFailure {
  return { ok: false, error };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** `backups/` 在项目根；字面量写死，理由同 articlesRoot（Turbopack 静态分析） */
export function backupsRoot(): string {
  return path.join(process.cwd(), "backups");
}

export function contentFilesRoot(): string {
  return contentRoot();
}

/** 目录必须存在、是真目录、不是链接；不存在时返回 false */
async function assertPlainDir(dir: string, label: string): Promise<boolean> {
  const stat = await fs.lstat(/*turbopackIgnore: true*/ dir).catch(() => null);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label}不是普通目录（可能是 junction/symlink）：${dir}`);
  }
  return true;
}

async function readFileMeta(entry: string, absPath: string): Promise<ScannedFile> {
  const stat = await fs.lstat(/*turbopackIgnore: true*/ absPath);
  if (stat.isSymbolicLink()) throw new Error(`${entry} 是链接，拒绝备份`);
  if (!stat.isFile()) throw new Error(`${entry} 不是普通文件，拒绝备份`);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(
      `${entry} 有 ${formatBytes(stat.size)}，超过单文件上限 ${formatBytes(MAX_FILE_BYTES)}`,
    );
  }

  const bytes = await fs.readFile(/*turbopackIgnore: true*/ absPath);
  return { meta: { path: entry, size: bytes.length, sha256: sha256(bytes) }, bytes };
}

/**
 * 扫一遍 content/，只收白名单文件。
 *
 * 返回的 `skipped` 会显示在备份页上 —— 宁可让用户看到「有 2 个文件没进备份」，
 * 也不要悄悄漏掉。未知文件不会让备份失败（用户可能手工放了附件）。
 */
export async function scanContent(root = contentFilesRoot()): Promise<ScanResult> {
  const skipped: string[] = [];
  const files: ScannedFile[] = [];

  const rootExists = await assertPlainDir(root, "content/");
  if (!rootExists) return { files, skipped };

  const add = async (entry: string, absPath: string) => {
    const checked = validateBackupEntryName(entry);
    if (!checked.ok) {
      skipped.push(`${entry}（${checked.error}）`);
      return;
    }
    files.push(await readFileMeta(entry, absPath));
  };

  const listSafe = async (dir: string, label: string): Promise<string[]> => {
    if (!(await assertPlainDir(dir, label))) return [];
    return fs.readdir(/*turbopackIgnore: true*/ dir);
  };

  const articlesDir = path.join(root, "articles");
  const articleNames = await listSafe(articlesDir, "content/articles/");
  for (const name of articleNames) {
    if (name === ".trash") continue;
    if (!name.toLowerCase().endsWith(".md")) {
      skipped.push(`content/articles/${name}（不是 .md）`);
      continue;
    }
    if (name.startsWith(".")) {
      skipped.push(`content/articles/${name}（以 . 开头的系统文件）`);
      continue;
    }
    await add(`content/articles/${name}`, path.join(articlesDir, name));
  }

  const articleTrashDir = path.join(articlesDir, ".trash");
  for (const name of await listSafe(articleTrashDir, "content/articles/.trash/")) {
    if (!name.toLowerCase().endsWith(".md")) {
      skipped.push(`content/articles/.trash/${name}（不是 .md）`);
      continue;
    }
    if (name.startsWith(".")) {
      skipped.push(`content/articles/.trash/${name}（以 . 开头的系统文件）`);
      continue;
    }
    await add(`content/articles/.trash/${name}`, path.join(articleTrashDir, name));
  }

  const contentTrashDir = path.join(root, ".trash");
  for (const name of await listSafe(contentTrashDir, "content/.trash/")) {
    if (name === "resources-deleted.jsonl" || name === "tasks-deleted.jsonl") {
      await add(`content/.trash/${name}`, path.join(contentTrashDir, name));
    } else if (name.startsWith("restore-")) {
      skipped.push(`content/.trash/${name}（恢复时的二级副本，不纳入备份）`);
    } else {
      skipped.push(`content/.trash/${name}（不在白名单）`);
    }
  }

  for (const name of ["resources.json", "tasks.json"] as const) {
    const absPath = path.join(/*turbopackIgnore: true*/ root, name);
    const stat = await fs.lstat(/*turbopackIgnore: true*/ absPath).catch(() => null);
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isFile()) {
      skipped.push(`content/${name}（不是普通文件，跳过）`);
      continue;
    }
    await add(`content/${name}`, absPath);
  }

  const ordered = [...files].sort((a, b) =>
    a.meta.path < b.meta.path ? -1 : a.meta.path > b.meta.path ? 1 : 0,
  );
  const totalBytes = ordered.reduce((sum, file) => sum + file.meta.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error(
      `content/ 总共 ${formatBytes(totalBytes)}，超过备份上限 ${formatBytes(MAX_TOTAL_BYTES)}`,
    );
  }
  if (ordered.length > MAX_ENTRY_COUNT) {
    throw new Error(`文件太多（${ordered.length} 个），超过上限 ${MAX_ENTRY_COUNT}`);
  }

  return { files: ordered, skipped };
}

/** 校验一个备份文件路径：只接受 backups/ 下的普通 zip，不是链接 */
export async function resolveBackupFile(
  backupsDir: string,
  name: string,
): Promise<{ ok: true; path: string } | BackupFailure> {
  if (!isBackupFileName(name))
    return fail("备份文件名不合法（只接受 ai-lab-…zip / pre-restore-…zip）");

  const dirExists = await assertPlainDir(backupsDir, "backups/");
  if (!dirExists) return fail("backups/ 目录不存在");

  const full = path.resolve(backupsDir, name);
  const relative = path.relative(path.resolve(backupsDir), full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return fail("备份路径跑出了 backups/");
  }

  const stat = await fs.lstat(/*turbopackIgnore: true*/ full).catch(() => null);
  if (!stat) return fail(`没有这个备份：${name}`);
  if (stat.isSymbolicLink() || !stat.isFile()) return fail(`这个备份不是普通文件：${name}`);
  if (stat.size === 0) return fail(`这个备份是空文件：${name}`);
  return { ok: true, path: full };
}

/* ────────────────────────── 写 zip ────────────────────────── */

async function writeZip(
  targetPath: string,
  manifest: BackupManifest,
  files: ScannedFile[],
): Promise<void> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), MANIFEST_NAME);
  for (const file of files) zip.addBuffer(file.bytes, file.meta.path);

  // 先在内存里收完 zip（真实数据通常 < 1MB），再交给 writeFileAtomic：
  // 临时文件 + fsync + rename 全走同一条地基，备份文件也不会出现「半截 zip」。
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("end", resolve);
    zip.outputStream.on("error", reject);
    zip.end();
  });

  await writeFileAtomic(targetPath, Buffer.concat(chunks));
}

/* ────────────────────────── 读 zip ────────────────────────── */

function decodeEntryName(entry: Entry): string {
  // 统一按 UTF-8 解（yazl 会写 UTF-8 标志位；我们不接受别的编码的备份）
  return new TextDecoder("utf-8", { fatal: true }).decode(entry.fileNameRaw);
}

function isSymlinkEntry(entry: Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
}

function isDirectoryEntry(entry: Entry): boolean {
  if (entry.fileNameRaw.length > 0 && entry.fileNameRaw[entry.fileNameRaw.length - 1] === 0x2f) {
    return true;
  }
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o040000;
}

function readEntryBuffer(zip: ReadZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream: Readable) => {
      if (error) return reject(error);
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy();
          reject(new Error(`条目解压后超过上限：${maxBytes} 字节`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

async function openZip(zipPath: string): Promise<ReadZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      zipPath,
      {
        lazyEntries: true,
        autoClose: false,
        decodeStrings: false,
        validateEntrySizes: true,
        strictFileNames: true,
      },
      (error, zip) => {
        if (error || !zip) return reject(error ?? new Error("打不开 zip"));
        resolve(zip);
      },
    );
  });
}

/** 读出全部条目元数据（不读内容），并做「还没看 manifest 就能做」的限制检查 */
function collectEntries(zip: ReadZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    let totalBytes = 0;

    zip.on("entry", (entry: Entry) => {
      try {
        if (entry.isEncrypted()) throw new Error("备份里有加密条目，不支持");
        if (!entry.canDecodeFileData()) throw new Error("备份里有不支持的压缩方式");
        if (isSymlinkEntry(entry)) throw new Error("备份里有符号链接条目，拒绝");
        if (isDirectoryEntry(entry)) throw new Error("备份里有目录条目，拒绝");
        if (entry.uncompressedSize > MAX_FILE_BYTES) {
          throw new Error(`条目太大：${formatBytes(entry.uncompressedSize)}`);
        }
        if (entries.length >= MAX_ENTRY_COUNT + 1) throw new Error("条目太多");
        totalBytes += entry.uncompressedSize;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error("解压后总大小超过上限");
        if (
          entry.uncompressedSize > 1024 &&
          entry.compressedSize > 0 &&
          entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO
        ) {
          throw new Error("压缩比异常（疑似压缩炸弹）");
        }
        entries.push(entry);
        zip.readEntry();
      } catch (error) {
        reject(error);
      }
    });
    zip.on("end", () => resolve(entries));
    zip.on("error", reject);
    zip.readEntry();
  });
}

function closeZip(zip: ReadZipFile): void {
  try {
    zip.close();
  } catch {
    // 已经关了 / 底层已释放：不需要再做什么
  }
}

/** 读 manifest（列表页用；不读文件内容，也不验每个文件的哈希） */
export async function readBackupManifest(
  zipPath: string,
): Promise<{ ok: true; manifest: BackupManifest } | BackupFailure> {
  let zip: ReadZipFile | undefined;
  try {
    zip = await openZip(zipPath);
    const entries = await collectEntries(zip);
    const names = entries.map((entry) => {
      try {
        return decodeEntryName(entry);
      } catch {
        return "（条目名不是 UTF-8）";
      }
    });
    const index = names.indexOf(MANIFEST_NAME);
    if (index === -1) return fail("备份里没有 manifest.json");

    const raw = await readEntryBuffer(zip, entries[index], MANIFEST_CAP_BYTES);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw.toString("utf8"));
    } catch {
      return fail("manifest.json 不是合法 JSON");
    }
    const parsed = parseManifest(parsedJson);
    if (!parsed.ok) return fail(parsed.error);
    return { ok: true, manifest: parsed.manifest };
  } catch (error) {
    return fail(`读备份失败：${message(error)}`);
  } finally {
    if (zip) closeZip(zip);
  }
}

/** 下载用：读完整个 zip 再交给 Route Handler（备份通常 < 1MB，不值得流式） */
export async function readBackupBytes(filePath: string): Promise<Buffer> {
  return fs.readFile(/*turbopackIgnore: true*/ filePath);
}

/**
 * 完整校验并读出所有文件内容（恢复/校验按钮用）。
 *
 * 顺序很重要：先看 manifest（条目白名单、重复、总量），再逐个条目验大小与 sha256。
 * 任何一步不对都返回错误，**不会**把半份内容交给恢复流程。
 */
export async function loadVerifiedBackup(zipPath: string): Promise<LoadBackupResult> {
  let zip: ReadZipFile | undefined;
  try {
    zip = await openZip(zipPath);
    const entries = await collectEntries(zip);

    const named = new Map<string, Entry>();
    for (const entry of entries) {
      let name: string;
      try {
        name = decodeEntryName(entry);
      } catch {
        return fail("备份里有条目名不是 UTF-8，拒绝恢复");
      }
      const key = name.toLowerCase();
      if (named.has(key)) return fail(`备份里有重复条目：${name}`);
      named.set(key, entry);
    }

    const manifestEntry = named.get(MANIFEST_NAME.toLowerCase());
    if (!manifestEntry) return fail("备份里没有 manifest.json");

    const manifestRaw = await readEntryBuffer(zip, manifestEntry, MANIFEST_CAP_BYTES);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(manifestRaw.toString("utf8"));
    } catch {
      return fail("manifest.json 不是合法 JSON");
    }
    const parsed = parseManifest(parsedJson);
    if (!parsed.ok) return fail(parsed.error);
    const manifest = parsed.manifest;

    const expected = new Set(manifest.files.map((file) => file.path.toLowerCase()));
    expected.add(MANIFEST_NAME.toLowerCase());

    for (const meta of manifest.files) {
      if (!named.has(meta.path.toLowerCase())) return fail(`备份里缺少：${meta.path}`);
    }
    if (named.size !== expected.size) {
      const extra = [...named.keys()].filter((name) => !expected.has(name));
      return fail(`备份里有清单外的条目：${extra.slice(0, 3).join("、")}`);
    }

    const files = new Map<string, Buffer>();
    for (const meta of manifest.files) {
      const entry = named.get(meta.path.toLowerCase());
      if (!entry) return fail(`备份里缺少：${meta.path}`);
      if (entry.uncompressedSize !== meta.size) {
        return fail(`${meta.path} 的大小与 manifest 不一致`);
      }
      const bytes = await readEntryBuffer(zip, entry, meta.size);
      if (bytes.length !== meta.size) return fail(`${meta.path} 读到的大小不对`);
      if (sha256(bytes) !== meta.sha256) return fail(`${meta.path} 的 sha256 不一致`);
      files.set(meta.path, bytes);
    }

    return { ok: true, backup: { manifest, files } };
  } catch (error) {
    return fail(`校验备份失败：${message(error)}`);
  } finally {
    if (zip) closeZip(zip);
  }
}

/* ────────────────────────── 创建 / 列表 ────────────────────────── */

/**
 * 内部入口：调用方必须已经持有 `serialize` 锁（恢复流程会先拿锁再建快照）。
 * 这里只写 backups/，不碰 content/。
 */
export async function createBackupUnlocked(options: {
  contentRoot?: string;
  backupsDir?: string;
  now?: Date;
  kind?: BackupKind;
}): Promise<CreateBackupResult> {
  const now = options.now ?? new Date();
  const kind = options.kind ?? "manual";
  const content = options.contentRoot ?? contentFilesRoot();
  const backupsDir = options.backupsDir ?? backupsRoot();

  try {
    const scanned = await scanContent(content);
    const manifest = buildManifest(
      scanned.files.map((file) => file.meta),
      { kind, now },
    );

    await fs.mkdir(/*turbopackIgnore: true*/ backupsDir, { recursive: true });
    const base = backupBaseName(now, kind);
    let name = `${base}.zip`;
    for (
      let suffix = 2;
      await fs.lstat(path.join(/*turbopackIgnore: true*/ backupsDir, name)).catch(() => null);
      suffix += 1
    ) {
      if (suffix > 99) return fail("同一秒内的备份太多，稍后再试");
      name = `${base}-${suffix}.zip`;
    }

    const target = path.join(/*turbopackIgnore: true*/ backupsDir, name);
    await writeZip(target, manifest, scanned.files);

    const verified = await loadVerifiedBackup(target);
    if (!verified.ok) {
      await fs.rm(target, { force: true }).catch(() => {});
      return fail(`新备份自检失败，已删除：${verified.error}`);
    }

    return { ok: true, name, path: target, manifest, verified: true };
  } catch (error) {
    return fail(`创建备份失败：${message(error)}`);
  }
}

/** 公开入口：与笔记/任务写入共用同一把进程内锁，避免扫到「写了一半」的多文件状态 */
export function createBackup(options: {
  contentRoot?: string;
  backupsDir?: string;
  now?: Date;
  kind?: BackupKind;
}): Promise<CreateBackupResult> {
  return serialize(() => createBackupUnlocked(options));
}

/** 列出 backups/ 下的备份（新的在前）。manifest 读不出来的也列出来，标成损坏。 */
export async function listBackups(backupsDir = backupsRoot()): Promise<BackupListItem[]> {
  if (!(await assertPlainDir(backupsDir, "backups/").catch(() => false))) return [];

  const names = (await fs.readdir(/*turbopackIgnore: true*/ backupsDir))
    .filter((name) => isBackupFileName(name))
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, 100);

  const items: BackupListItem[] = [];
  for (const name of names) {
    const full = path.join(/*turbopackIgnore: true*/ backupsDir, name);
    try {
      const stat = await fs.lstat(/*turbopackIgnore: true*/ full);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const manifest = await readBackupManifest(full);
      items.push({
        name,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime,
        manifest: manifest.ok ? manifest.manifest : null,
        error: manifest.ok ? null : manifest.error,
      });
    } catch (error) {
      items.push({
        name,
        sizeBytes: 0,
        modifiedAt: new Date(0),
        manifest: null,
        error: message(error),
      });
    }
  }
  return items;
}

/** 给「恢复预览」用：读 manifest + 校验全部哈希，再拿当前 content/ 做 diff */
export async function previewRestore(options: {
  contentRoot?: string;
  backupsDir?: string;
  name: string;
  includeDeletes?: boolean;
}): Promise<
  { ok: true; plan: RestorePlan; manifest: BackupManifest; warnings: string[] } | BackupFailure
> {
  const content = options.contentRoot ?? contentFilesRoot();
  const backupsDir = options.backupsDir ?? backupsRoot();
  const resolved = await resolveBackupFile(backupsDir, options.name);
  if (!resolved.ok) return resolved;

  const loaded = await loadVerifiedBackup(resolved.path);
  if (!loaded.ok) return loaded;

  const payload = checkBackupPayload(loaded.backup.manifest, loaded.backup.files);
  if (!payload.ok) return fail(payload.error);

  const scanned = await scanContent(content);
  const plan = computeRestorePlan(
    scanned.files.map((file) => file.meta),
    loaded.backup.manifest.files,
    options.includeDeletes ?? false,
  );
  return { ok: true, plan, manifest: loaded.backup.manifest, warnings: payload.warnings };
}

/** 备份页的「校验」按钮：完整读一遍并在页面上报告文件数与总量 */
export async function verifyBackupByName(options: {
  backupsDir?: string;
  name: string;
}): Promise<{ ok: true; manifest: BackupManifest; fileCount: number } | BackupFailure> {
  const backupsDir = options.backupsDir ?? backupsRoot();
  const resolved = await resolveBackupFile(backupsDir, options.name);
  if (!resolved.ok) return resolved;

  const loaded = await loadVerifiedBackup(resolved.path);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    manifest: loaded.backup.manifest,
    fileCount: loaded.backup.manifest.files.length,
  };
}

/* ────────────────────────── P1：清理旧备份 ────────────────────────── */

export type BackupPruneFailure = {
  ok: false;
  reason: "blocked" | "stale" | "confirm" | "io";
  error: string;
};

export type BackupPrunePreview = {
  ok: true;
  /** 保留的（新的在前） */
  keep: string[];
  /** 可删的（旧的在前） */
  expired: { name: string; sizeBytes: number; modifiedAt: Date }[];
  /** 超期但损坏，只列出不删 */
  damaged: { name: string; sizeBytes: number; modifiedAt: Date; error: string }[];
  /** 没动的：恢复前快照、恢复日志、白名单外名字、不是普通文件 */
  ignored: { name: string; reason: string }[];
  planHash: string;
  /** 可删备份的总字节 */
  totalBytes: number;
};

export type BackupPruneResult =
  | {
      ok: true;
      removed: string[];
      failed: { name: string; error: string }[];
      preview: BackupPrunePreview;
    }
  | BackupPruneFailure;

type BackupDirFile = { name: string; sizeBytes: number; modifiedAt: Date };

/**
 * 扫 `backups/`：只把「普通文件 + 名字像手动备份」的收进 manual，
 * 其余（快照、恢复日志、未知名字、目录/链接）进 ignored，让预览能说清楚为什么没动。
 */
async function scanBackupDir(dir: string): Promise<{
  manual: BackupDirFile[];
  ignored: { name: string; reason: string }[];
}> {
  const stat = await fs.lstat(/*turbopackIgnore: true*/ dir).catch(() => null);
  if (!stat) return { manual: [], ignored: [] };
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("backups/ 不是普通目录（可能是链接/文件）");
  }

  const manual: BackupDirFile[] = [];
  const ignored: { name: string; reason: string }[] = [];

  for (const name of await fs.readdir(/*turbopackIgnore: true*/ dir)) {
    const full = path.join(/*turbopackIgnore: true*/ dir, name);
    const entry = await fs.lstat(/*turbopackIgnore: true*/ full).catch(() => null);
    if (!entry) {
      ignored.push({ name, reason: "读不到（可能刚被删）" });
      continue;
    }

    if (isBackupFileName(name) && name.startsWith("pre-restore-")) {
      ignored.push({ name, reason: "恢复前快照，不参与清理" });
      continue;
    }
    if (isBackupFileName(name)) {
      if (entry.isSymbolicLink() || !entry.isFile()) {
        ignored.push({ name, reason: "不是普通文件（目录/链接）" });
        continue;
      }
      manual.push({ name, sizeBytes: entry.size, modifiedAt: entry.mtime });
      continue;
    }
    if (name === RESTORE_JOURNAL_NAME) {
      ignored.push({ name, reason: "恢复日志，不动" });
      continue;
    }
    ignored.push({ name, reason: "不是本应用生成的备份名" });
  }

  return { manual, ignored };
}

export async function previewBackupPrune(
  options: { backupsDir?: string; keep?: number } = {},
): Promise<BackupPrunePreview | BackupPruneFailure> {
  const backupsDir = options.backupsDir ?? backupsRoot();
  const keep = options.keep ?? BACKUP_KEEP_COUNT;

  // 有待收尾的恢复时整条拒绝：清理不动备份，但也不该在混合状态里继续做任何事
  const blocked = await pendingRestoreMessage(backupsDir);
  if (blocked) return { ok: false, reason: "blocked", error: blocked };

  try {
    const scan = await scanBackupDir(backupsDir);
    const byName = new Map(scan.manual.map((item) => [item.name, item]));

    // 先按「全都健康」算一遍候选，只给超期项读 manifest：
    // 100+ 份备份时不需要为了预览把每一份 zip 都打开。
    const first = selectExpiredBackups(
      scan.manual.map((item) => ({ name: item.name, damaged: false })),
      keep,
    );
    const damagedErrors = new Map<string, string>();
    for (const name of first.expired) {
      const checked = await readBackupManifest(
        path.join(/*turbopackIgnore: true*/ backupsDir, name),
      );
      if (!checked.ok) damagedErrors.set(name, checked.error);
    }

    const final = selectExpiredBackups(
      scan.manual.map((item) => ({ name: item.name, damaged: damagedErrors.has(item.name) })),
      keep,
    );

    const expired = final.expired.flatMap((name) => {
      const item = byName.get(name);
      return item ? [{ ...item }] : [];
    });
    const damaged = final.damaged.flatMap((name) => {
      const item = byName.get(name);
      return item ? [{ ...item, error: damagedErrors.get(name) ?? "manifest 读不出来" }] : [];
    });

    return {
      ok: true,
      keep: final.keep,
      expired,
      damaged,
      ignored: scan.ignored,
      planHash: final.planHash,
      totalBytes: expired.reduce((sum, item) => sum + item.sizeBytes, 0),
    };
  } catch (error) {
    return { ok: false, reason: "io", error: `读取备份目录失败：${message(error)}` };
  }
}

export function pruneBackups(options: {
  planHash: string;
  confirm: string;
  backupsDir?: string;
  keep?: number;
}): Promise<BackupPruneResult> {
  return serialize(() => pruneBackupsUnlocked(options));
}

async function pruneBackupsUnlocked(options: {
  planHash: string;
  confirm: string;
  backupsDir?: string;
  keep?: number;
}): Promise<BackupPruneResult> {
  if (options.confirm !== BACKUP_PRUNE_CONFIRM_TEXT) {
    return {
      ok: false,
      reason: "confirm",
      error: `输入「${BACKUP_PRUNE_CONFIRM_TEXT}」两个字再确认`,
    };
  }

  const preview = await previewBackupPrune({
    backupsDir: options.backupsDir,
    keep: options.keep,
  });
  if (!preview.ok) return preview;
  if (preview.planHash !== options.planHash) {
    return {
      ok: false,
      reason: "stale",
      error: "备份列表在预览之后变了，请重新预览再清理",
    };
  }

  const backupsDir = options.backupsDir ?? backupsRoot();
  const removed: string[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const item of preview.expired) {
    try {
      // 再走一遍 resolveBackupFile：名字、目录、普通文件、非空，全部重新确认
      const resolved = await resolveBackupFile(backupsDir, item.name);
      if (!resolved.ok) throw new Error(resolved.error);
      await fs.unlink(/*turbopackIgnore: true*/ resolved.path);
      removed.push(item.name);
    } catch (error) {
      failed.push({ name: item.name, error: message(error) });
    }
  }

  return { ok: true, removed, failed, preview };
}

/** 恢复后重新扫 content/ 与备份比对（失败就回滚） */
export async function verifyContentMatchesBackup(
  contentRoot: string,
  backup: VerifiedBackup,
): Promise<{ ok: true } | BackupFailure> {
  const scanned = await scanContent(contentRoot);
  const current = new Map(scanned.files.map((file) => [file.meta.path, file.meta]));
  for (const expected of backup.manifest.files) {
    const actual = current.get(expected.path);
    if (!actual) return fail(`恢复后缺少文件：${expected.path}`);
    if (actual.sha256 !== expected.sha256) return fail(`恢复后内容不一致：${expected.path}`);
  }
  return { ok: true };
}
