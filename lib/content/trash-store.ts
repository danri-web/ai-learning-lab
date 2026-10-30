import { promises as fs } from "node:fs";
import path from "node:path";

import { revisionOf } from "@/lib/content/revision";
import { contentRoot } from "@/lib/content/resources";
import { pendingRestoreMessage } from "@/lib/content/restore-gate";
import {
  isExpiredAt,
  parseTrashStamp,
  pruneJsonlText,
  trashCutoff,
  trashPlanHash,
  TRASH_PRUNE_CONFIRM_TEXT,
  TRASH_RETENTION_DAYS,
  type TrashPlanEntry,
} from "@/lib/content/trash-plan";
import { writeFileAtomic } from "@/lib/fs/atomic-write";
import { serialize } from "@/lib/fs/mutex";

/**
 * `content/.trash/` 的**扫描与删除**（P1）。这里可以 import `node:fs`。
 *
 * 源码闸门规定：只有 `features/backup/service.ts` 能 import 本文件
 * （页面/组件直接用不进来；类型从 service 再导出）。
 *
 * 三块内容（用户 2026-10-30 拍板）：
 *   1. `content/articles/.trash/*.md`：按文件名前缀 `YYYYMMDD-HHmmss-` 算时间
 *   2. `content/.trash/resources-deleted.jsonl` / `tasks-deleted.jsonl`：按行里的 `deletedAt` 裁行
 *   3. `content/.trash/restore-*`：按目录 mtime
 * 默认保留 90 天；解析不出时间的、白名单外的、不是普通文件的，**一个字节都不动**，只在预览里列出。
 */

const ARTICLE_TRASH_REL = "articles/.trash";
const CONTENT_TRASH_REL = ".trash";
const JSONL_WHITELIST = new Set(["resources-deleted.jsonl", "tasks-deleted.jsonl"]);

export type TrashCleanupFailure = {
  ok: false;
  reason: "blocked" | "stale" | "confirm" | "io";
  error: string;
};

export type TrashSkip = { path: string; reason: string };

export type TrashPreview = {
  ok: true;
  now: Date;
  days: number;
  cutoff: Date;
  /** 可删的笔记回收站文件（旧的在前） */
  articles: { path: string; deletedAt: Date }[];
  /** 可删的恢复副本目录（旧的在前） */
  restoreDirs: { path: string; deletedAt: Date }[];
  /** 需要裁行的 JSONL */
  jsonl: {
    file: string;
    dropped: number;
    kept: number;
    skipped: { line: number; reason: string }[];
  }[];
  /** 没动的东西（解析失败 / 白名单外 / 不是普通文件） */
  skipped: TrashSkip[];
  planHash: string;
};

export type TrashCleanupResult =
  | {
      ok: true;
      removed: string[];
      failed: { path: string; error: string }[];
      preview: TrashPreview;
    }
  | TrashCleanupFailure;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return CASE_INSENSITIVE_FS ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/** 不存在 = false；存在但不是普通目录（链接 / 文件）= 抛错（fail closed） */
async function isPlainDirectory(dir: string, label: string): Promise<boolean> {
  const stat = await fs.lstat(/*turbopackIgnore: true*/ dir).catch(() => null);
  if (!stat) return false;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label}不是普通目录（可能是链接/文件）：${dir}`);
  }
  const real = await fs.realpath(dir).catch(() => null);
  if (!real || !samePath(real, dir)) {
    throw new Error(`${label}解析后与预期不一致（可能是链接）：${dir}`);
  }
  return true;
}

/** 把相对 content/ 的路径拼回绝对路径，并确认没有跑出 content/ */
function absoluteInside(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, relative);
  const rel = path.relative(resolvedRoot, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`路径跑出了 content/：${relative}`);
  }
  return absolute;
}

function byPath<T extends { path: string }>(a: T, b: T): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export async function previewTrashCleanup(
  options: {
    contentRoot?: string;
    backupsDir?: string;
    now?: Date;
    days?: number;
  } = {},
): Promise<TrashPreview | TrashCleanupFailure> {
  const root = options.contentRoot ?? contentRoot();
  const blocked = await pendingRestoreMessage(options.backupsDir);
  if (blocked) return { ok: false, reason: "blocked", error: blocked };

  const now = options.now ?? new Date();
  const days = options.days ?? TRASH_RETENTION_DAYS;
  const cutoff = trashCutoff(now, days);

  const articles: TrashPreview["articles"] = [];
  const restoreDirs: TrashPreview["restoreDirs"] = [];
  const jsonl: TrashPreview["jsonl"] = [];
  const skipped: TrashSkip[] = [];
  const plan: TrashPlanEntry[] = [];

  try {
    const articlesTrash = path.join(root, ARTICLE_TRASH_REL);
    if (await isPlainDirectory(articlesTrash, "content/articles/.trash/")) {
      for (const name of await fs.readdir(/*turbopackIgnore: true*/ articlesTrash)) {
        const rel = `${ARTICLE_TRASH_REL}/${name}`;
        const absolute = path.join(articlesTrash, name);
        const stat = await fs.lstat(/*turbopackIgnore: true*/ absolute).catch(() => null);

        if (!stat) {
          skipped.push({ path: rel, reason: "读不到（可能刚被删）" });
          continue;
        }
        if (stat.isSymbolicLink() || !stat.isFile()) {
          skipped.push({ path: rel, reason: "不是普通文件" });
          continue;
        }
        if (name.startsWith(".")) {
          skipped.push({ path: rel, reason: "以 . 开头的系统文件" });
          continue;
        }
        if (!name.endsWith(".md")) {
          skipped.push({ path: rel, reason: "不是 .md" });
          continue;
        }

        const match = /^(\d{8}-\d{6})-(.+)\.md$/.exec(name);
        if (!match) {
          skipped.push({ path: rel, reason: "文件名没有 YYYYMMDD-HHmmss- 前缀" });
          continue;
        }
        const stamp = parseTrashStamp(match[1]);
        if (!stamp) {
          skipped.push({ path: rel, reason: "时间前缀不是合法日期" });
          continue;
        }
        if (!isExpiredAt(stamp.date, cutoff)) continue;

        articles.push({ path: rel, deletedAt: stamp.date });
        plan.push({ kind: "article", path: rel, deletedAt: stamp.date.toISOString() });
      }
    }

    const contentTrash = path.join(root, CONTENT_TRASH_REL);
    if (await isPlainDirectory(contentTrash, "content/.trash/")) {
      for (const name of await fs.readdir(/*turbopackIgnore: true*/ contentTrash)) {
        const rel = `${CONTENT_TRASH_REL}/${name}`;
        const absolute = path.join(contentTrash, name);
        const stat = await fs.lstat(/*turbopackIgnore: true*/ absolute).catch(() => null);

        if (!stat) {
          skipped.push({ path: rel, reason: "读不到（可能刚被删）" });
          continue;
        }

        if (JSONL_WHITELIST.has(name)) {
          if (stat.isSymbolicLink() || !stat.isFile()) {
            skipped.push({ path: rel, reason: "不是普通文件" });
            continue;
          }
          const text = await fs.readFile(/*turbopackIgnore: true*/ absolute, "utf8");
          const pruned = pruneJsonlText(text, cutoff);
          for (const item of pruned.skipped) {
            skipped.push({ path: `${rel}:${item.line}`, reason: item.reason });
          }
          if (pruned.dropped > 0) {
            jsonl.push({
              file: rel,
              dropped: pruned.dropped,
              kept: pruned.kept,
              skipped: pruned.skipped,
            });
            plan.push({
              kind: "jsonl",
              path: rel,
              deletedAt: "",
              fileHash: revisionOf(text),
              dropped: pruned.dropped,
            });
          }
          continue;
        }

        if (name.startsWith("restore-")) {
          if (stat.isSymbolicLink() || !stat.isDirectory()) {
            skipped.push({ path: rel, reason: "不是目录" });
            continue;
          }
          const real = await fs.realpath(absolute).catch(() => null);
          if (!real || !samePath(real, absolute)) {
            skipped.push({ path: rel, reason: "是链接/目录联接" });
            continue;
          }
          if (!isExpiredAt(stat.mtime, cutoff)) continue;

          restoreDirs.push({ path: rel, deletedAt: stat.mtime });
          plan.push({ kind: "restore-dir", path: rel, deletedAt: stat.mtime.toISOString() });
          continue;
        }

        skipped.push({ path: rel, reason: "不在白名单" });
      }
    }

    articles.sort(byPath);
    restoreDirs.sort(byPath);
    jsonl.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    skipped.sort(byPath);

    return {
      ok: true,
      now,
      days,
      cutoff,
      articles,
      restoreDirs,
      jsonl,
      skipped,
      planHash: trashPlanHash(plan),
    };
  } catch (error) {
    return { ok: false, reason: "io", error: `读回收站失败：${message(error)}` };
  }
}

async function removePlainFile(root: string, relative: string): Promise<void> {
  const absolute = absoluteInside(root, relative);
  const stat = await fs.lstat(/*turbopackIgnore: true*/ absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("不是普通文件，没删");
  await fs.unlink(absolute);
}

async function removePlainDirectory(root: string, relative: string): Promise<void> {
  const absolute = absoluteInside(root, relative);
  const stat = await fs.lstat(/*turbopackIgnore: true*/ absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("不是普通目录，没删");
  const real = await fs.realpath(absolute).catch(() => null);
  if (!real || !samePath(real, absolute)) throw new Error("是链接/目录联接，没删");
  await fs.rm(absolute, { recursive: true });
}

export function applyTrashCleanup(options: {
  planHash: string;
  confirm: string;
  contentRoot?: string;
  backupsDir?: string;
  now?: Date;
  days?: number;
}): Promise<TrashCleanupResult> {
  return serialize(() => applyTrashCleanupUnlocked(options));
}

async function applyTrashCleanupUnlocked(options: {
  planHash: string;
  confirm: string;
  contentRoot?: string;
  backupsDir?: string;
  now?: Date;
  days?: number;
}): Promise<TrashCleanupResult> {
  if (options.confirm !== TRASH_PRUNE_CONFIRM_TEXT) {
    return {
      ok: false,
      reason: "confirm",
      error: `输入「${TRASH_PRUNE_CONFIRM_TEXT}」两个字再确认`,
    };
  }

  const preview = await previewTrashCleanup(options);
  if (!preview.ok) return preview;
  if (preview.planHash !== options.planHash) {
    return {
      ok: false,
      reason: "stale",
      error: "预览之后回收站发生了变化，请重新预览再清理",
    };
  }

  const root = options.contentRoot ?? contentRoot();
  const removed: string[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const item of preview.articles) {
    try {
      await removePlainFile(root, item.path);
      removed.push(item.path);
    } catch (error) {
      failed.push({ path: item.path, error: message(error) });
    }
  }

  for (const item of preview.restoreDirs) {
    try {
      await removePlainDirectory(root, item.path);
      removed.push(item.path);
    } catch (error) {
      failed.push({ path: item.path, error: message(error) });
    }
  }

  for (const item of preview.jsonl) {
    const absolute = absoluteInside(root, item.file);
    try {
      // 锁内重新读一遍：即使有人绕过进程内锁改了文件，也不会拿预览时的旧文本覆盖
      const text = await fs.readFile(/*turbopackIgnore: true*/ absolute, "utf8");
      const pruned = pruneJsonlText(text, preview.cutoff);
      if (pruned.dropped !== item.dropped) {
        throw new Error("文件内容在清理过程中变了，没有写入");
      }
      await writeFileAtomic(absolute, pruned.text);
      removed.push(`${item.file}（删 ${pruned.dropped} 行，留 ${pruned.kept} 行）`);
    } catch (error) {
      failed.push({ path: item.file, error: message(error) });
    }
  }

  return { ok: true, removed, failed, preview };
}
