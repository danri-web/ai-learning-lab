import { z } from "zod";

import { formatLocalDateTime, formatLocalStamp } from "@/lib/content/clock";
import { revisionOf } from "@/lib/content/revision";
import {
  MAX_ENTRY_COUNT,
  MAX_ENTRY_NAME_LENGTH,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  validateBackupEntryName,
  validateEntryList,
} from "@/lib/security/backup-entry";

/**
 * 备份的**格式**（纯函数，不碰磁盘）。
 *
 * 一个备份 = 一个 zip：
 *   manifest.json                     ← 清单（版本、时间、每个文件的 sha256）
 *   content/articles/*.md             ← 笔记
 *   content/articles/_*.md            ← 下划线开头的草稿/模板（列表不显示，但属于用户数据）
 *   content/articles/.trash/*.md      ← 笔记回收站
 *   content/resources.json
 *   content/tasks.json
 *   content/.trash/*.jsonl            ← 资源/任务的删除留档
 *
 * 不包含：`.env.local`（口令哈希与会话密钥不进备份）、`backups/` 自己、`node_modules`、
 * `content/.trash/restore-*`（恢复时挪进去的二级副本，另有快照兜底）。
 *
 * 恢复前的「预览」就是拿 manifest.files 与当前磁盘扫出来的文件做 diff：
 * 新增 / 覆盖 / 相同 / 删除。diff 与 planHash 都在这里，纯函数，测试脱离磁盘。
 */

export const BACKUP_FORMAT = "ai-learning-lab-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const MANIFEST_NAME = "manifest.json";

/** 恢复确认文字（界面输入框、服务层、测试共用一份） */
export const RESTORE_CONFIRM_TEXT = "恢复";

/** 与 package.json 的 version 对齐（有测试钉住；改版本时两处一起改） */
export const APP_VERSION = "0.1.0";

/** 单个备份文件名上限（远小于文件系统限制，也够放下时间戳与冲突后缀） */
export const MAX_BACKUP_NAME_LENGTH = 80;

export type BackupKind = "manual" | "pre-restore";

export type BackupFileMeta = {
  path: string;
  size: number;
  sha256: string;
};

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  appVersion: string;
  kind: BackupKind;
  /** ISO 8601（UTC），给机器排序 */
  createdAt: string;
  /** `YYYY-MM-DD HH:mm:ss`（本机时区），给人看 */
  createdAtLocal: string;
  files: BackupFileMeta[];
  totalBytes: number;
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const fileSchema = z.object({
  path: z.string().min(1).max(MAX_ENTRY_NAME_LENGTH),
  size: z.number().int().min(0).max(MAX_FILE_BYTES),
  sha256: z.string().regex(SHA256_HEX),
});

const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  appVersion: z.string().min(1).max(40),
  kind: z.enum(["manual", "pre-restore"]),
  createdAt: z.string().regex(ISO_UTC),
  createdAtLocal: z.string().regex(LOCAL_DATE_TIME),
  files: z.array(fileSchema).max(MAX_ENTRY_COUNT),
  totalBytes: z.number().int().min(0).max(MAX_TOTAL_BYTES),
});

/** 按路径的码元顺序排（不用 localeCompare：同一条目在不同机器上必须得到同一个顺序） */ export function sortByPath<
  T extends { path: string },
>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** 生成 manifest（调用方负责先算好每个文件的 size/sha256） */
export function buildManifest(
  files: BackupFileMeta[],
  options: { kind: BackupKind; now: Date; appVersion?: string },
): BackupManifest {
  const sorted = sortByPath(files);
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: options.appVersion ?? APP_VERSION,
    kind: options.kind,
    createdAt: options.now.toISOString(),
    createdAtLocal: formatLocalDateTime(options.now),
    files: sorted,
    totalBytes: sorted.reduce((sum, file) => sum + file.size, 0),
  };
}

export type ManifestParse = { ok: true; manifest: BackupManifest } | { ok: false; error: string };

/**
 * 解析并**交叉校验** manifest。manifest 本身也是外部输入（zip 可以被替换）。
 * 除了结构，还验：条目白名单、重复、大小/总量、totalBytes 与逐项之和一致。
 */
export function parseManifest(input: unknown): ManifestParse {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `manifest 结构不对：${issue ? `${issue.path.join(".") || "根"} ${issue.message}` : "未知原因"}`,
    };
  }

  const manifest = parsed.data;
  if (manifest.files.length > MAX_ENTRY_COUNT) {
    return { ok: false, error: `manifest 条目太多（上限 ${MAX_ENTRY_COUNT}）` };
  }

  const names = manifest.files.map((file) => file.path);
  const list = validateEntryList(names);
  if (!list.ok) return { ok: false, error: `manifest 条目不合格：${list.error}` };

  if (names.includes(MANIFEST_NAME)) {
    return { ok: false, error: "manifest 不能把自己列进文件清单" };
  }

  let total = 0;
  for (const file of manifest.files) {
    const checked = validateBackupEntryName(file.path);
    if (!checked.ok) return { ok: false, error: `${file.path}：${checked.error}` };
    if (file.size > MAX_FILE_BYTES) {
      return { ok: false, error: `${file.path} 超过单文件上限` };
    }
    total += file.size;
    if (total > MAX_TOTAL_BYTES) return { ok: false, error: "manifest 总大小超过上限" };
  }

  if (total !== manifest.totalBytes) {
    return {
      ok: false,
      error: `manifest 的 totalBytes（${manifest.totalBytes}）与逐项之和（${total}）不一致`,
    };
  }

  const created = new Date(manifest.createdAt);
  if (Number.isNaN(created.getTime())) {
    return { ok: false, error: "manifest 的 createdAt 不是合法时间" };
  }

  return { ok: true, manifest };
}

export type RestoreStatus = "added" | "overwritten" | "unchanged" | "deleted";

export type RestorePlanEntry = {
  path: string;
  status: RestoreStatus;
  /** 备份里的版本（deleted 时没有） */
  backup?: BackupFileMeta;
  /** 当前磁盘上的版本（added 时没有） */
  current?: BackupFileMeta;
};

export type RestoreCounts = {
  added: number;
  overwritten: number;
  unchanged: number;
  deleted: number;
};

export type RestorePlan = {
  /** 用户是否勾了「同时删除备份里没有的文件」 */
  includeDeletes: boolean;
  entries: RestorePlanEntry[];
  counts: RestoreCounts;
  /** 备份里的文件总字节 */
  backupTotalBytes: number;
  /** 当前 content/ 的总字节 */
  currentTotalBytes: number;
  /**
   * 预览指纹：用户确认的是哪一份计划。恢复前重新算一遍，不一致就拒绝，
   * 防止「预览时是 A，点确认时磁盘已经被改成了 B」。
   */
  planHash: string;
};

/**
 * 当前文件 vs 备份文件的 diff。
 *
 * - 同路径、同 sha256、同大小 → unchanged（不写）
 * - 同路径但内容不同 → overwritten
 * - 只在备份里 → added
 * - 只在当前 → deleted（**是否真的删由 includeDeletes 决定**；预览永远列出来）
 */
export function computeRestorePlan(
  currentFiles: BackupFileMeta[],
  backupFiles: BackupFileMeta[],
  includeDeletes: boolean,
): RestorePlan {
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]));
  const backupByPath = new Map(backupFiles.map((file) => [file.path, file]));

  const entries: RestorePlanEntry[] = [];

  for (const backup of backupByPath.values()) {
    const current = currentByPath.get(backup.path);
    if (!current) {
      entries.push({ path: backup.path, status: "added", backup });
      continue;
    }
    if (current.size === backup.size && current.sha256 === backup.sha256) {
      entries.push({ path: backup.path, status: "unchanged", backup, current });
    } else {
      entries.push({ path: backup.path, status: "overwritten", backup, current });
    }
  }

  for (const current of currentByPath.values()) {
    if (!backupByPath.has(current.path)) {
      entries.push({ path: current.path, status: "deleted", current });
    }
  }

  const ordered = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const counts: RestoreCounts = { added: 0, overwritten: 0, unchanged: 0, deleted: 0 };
  for (const entry of ordered) counts[entry.status] += 1;

  const planHash = revisionOf(
    JSON.stringify({
      v: 1,
      includeDeletes,
      entries: ordered.map((entry) => [
        entry.path,
        entry.status,
        entry.backup?.sha256 ?? null,
        entry.current?.sha256 ?? null,
      ]),
    }),
  );

  return {
    includeDeletes,
    entries: ordered,
    counts,
    backupTotalBytes: backupFiles.reduce((sum, file) => sum + file.size, 0),
    currentTotalBytes: currentFiles.reduce((sum, file) => sum + file.size, 0),
    planHash,
  };
}

/** 备份文件名（不含后缀冲突处理）。本地时间，人一眼能看出是哪天。 */
export function backupBaseName(now: Date, kind: BackupKind): string {
  const prefix = kind === "pre-restore" ? "pre-restore" : "ai-lab";
  return `${prefix}-${formatLocalStamp(now)}`;
}

const BACKUP_NAME = /^(?:ai-lab|pre-restore)-\d{8}-\d{6}(?:-\d{1,2})?\.zip$/;

/** 只认我们自己生成的名字；恢复/下载都只接受这一种（顺带挡住路径分隔符） */
export function isBackupFileName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_BACKUP_NAME_LENGTH) return false;
  if (value.includes("/") || value.includes("\\") || value.includes("..")) return false;
  return BACKUP_NAME.test(value);
}

/** `1234` → `1.2 KB`；给界面用（不参与任何判断） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}
