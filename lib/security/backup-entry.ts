import path from "node:path";

import { isSafeArticleId } from "@/lib/security/article-id";

/**
 * 备份/恢复条目的**纯字符串**闸门（阶段 7）。
 *
 * 为什么单独一层：zip 里的条目名是外部输入，而恢复会拿它拼出「写到哪个文件」。
 * 一条 `../../.env.local` 或一条带盘符的绝对路径，就够把恢复变成任意文件写入。
 * 所以先在这里做**白名单**（只认 content/ 下我们真正拥有的那几类文件），
 * 再由 lib/content/restore-store.ts 做物理校验（目录不能是 junction/symlink）。
 *
 * 这里不碰文件系统，也不 import node:fs —— 源码闸门允许 lib/security/paths.ts 碰 fs，
 * 这个文件只做字符串判断，测试可以完全脱离磁盘跑。
 */

/** 条目名上限：远小于 Windows 的 255，也给 manifest 留余量 */
export const MAX_ENTRY_NAME_LENGTH = 200;

/** 一个备份最多多少条（防「几百万个空条目」把内存/页面拖死） */
export const MAX_ENTRY_COUNT = 5000;

/** 单个文件解压后上限（笔记正文目前几十 KB；16MB 已经非常宽松） */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** 整个备份解压后上限（64MB；真实数据通常 < 1MB） */
export const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

/** 压缩比上限：超过它按压缩炸弹处理（正常 Markdown/JSON 远达不到 200:1） */
export const MAX_COMPRESSION_RATIO = 200;

export const CONTENT_DIR_NAME = "content";
export const CONTENT_PREFIX = `${CONTENT_DIR_NAME}/`;

/** 固定名字的四个数据文件（resources / tasks / 两个删除留档） */
const SIMPLE_ENTRIES = new Set([
  "content/resources.json",
  "content/tasks.json",
  "content/.trash/resources-deleted.jsonl",
  "content/.trash/tasks-deleted.jsonl",
]);

/**
 * Windows 文件名里不能出现的字符，外加路径分隔符。
 * 冒号单独列出来：`content/articles/a:b.md` 在 Windows 上是 NTFS 数据流（ADS），
 * 写进去的文件在资源管理器里看不见，恢复完却「占了位置」。
 */
// 整个条目名用这一份（/ 是合法分隔符，单独判）
const BAD_PATH_CHARS = /[\u0000-\u001f\u007f<>:"|?*\\]/;
// 单个文件名再严一点：/ 也不能出现
const BAD_NAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*\\/]/;

const NORMAL_ARTICLE = /^content\/articles\/([^/]+)\.md$/u;
const HIDDEN_ARTICLE = /^content\/articles\/(_[^/]+\.md)$/u;
const ARTICLE_TRASH_FILE = /^content\/articles\/\.trash\/([^/]+\.md)$/u;

export type EntryValidation = { ok: true; path: string } | { ok: false; error: string };

function bad(error: string): EntryValidation {
  return { ok: false, error };
}

/** 一个普通文件名（不含目录）：长度、点号、非法字符、`.md` 结尾 */
function isSafeFileName(name: string): boolean {
  if (!name || name.length > MAX_ENTRY_NAME_LENGTH) return false;
  if (name.startsWith(".") || name.includes("..")) return false;
  if (!name.toLowerCase().endsWith(".md")) return false;
  return !BAD_NAME_CHARS.test(name);
}

/**
 * 校验一个 zip 条目名。
 *
 * 拒绝的形态（都有测试，先用假样本证明抓得到）：
 *   - 绝对路径 / 盘符 / 反斜杠 / `..` / 空段 / 目录条目
 *   - `content/` 之外的任何文件（package.json、.env.local、backups/*.zip…）
 *   - `content/` 下不在白名单里的文件（未知文件不会被恢复，也不会被备份）
 *   - 文章 id 不符合 D7 的字符集；回收站文件名带点号/分隔符
 *   - Windows 非法字符（`:` 会变成 NTFS 数据流）
 */
export function validateBackupEntryName(value: unknown): EntryValidation {
  if (typeof value !== "string") return bad("条目名不是字符串");
  const name = value;

  if (name.length === 0) return bad("条目名是空的");
  if (name.length > MAX_ENTRY_NAME_LENGTH)
    return bad(`条目名太长（上限 ${MAX_ENTRY_NAME_LENGTH}）`);
  if (name !== name.normalize("NFC"))
    return bad("条目名不是 NFC 规范形式（同一名字可能有两种写法）");
  if (name.startsWith("/") || name.startsWith("\\")) return bad("条目名不能是绝对路径");
  if (/^[A-Za-z]:/.test(name)) return bad("条目名不能带盘符");
  if (name.includes("\\")) return bad("条目名只能用 / 作分隔符");
  if (name.endsWith("/")) return bad("不收目录条目，只收文件");
  if (BAD_PATH_CHARS.test(name)) return bad("条目名里有 Windows 不允许的字符");

  const segments = name.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return bad("条目名里有空段、. 或 ..");
  }
  if (!name.startsWith(CONTENT_PREFIX)) return bad("只备份 content/ 下的文件");

  if (SIMPLE_ENTRIES.has(name)) return { ok: true, path: name };

  // `_` 开头的模板/草稿不在列表里，但仍是用户数据，备份要带上（先判，别被普通 id 规则抢先）
  const hidden = HIDDEN_ARTICLE.exec(name);
  if (hidden) {
    if (!isSafeFileName(hidden[1])) return bad(`草稿文件名不安全：${hidden[1]}`);
    return { ok: true, path: name };
  }

  const article = NORMAL_ARTICLE.exec(name);
  if (article) {
    if (!isSafeArticleId(article[1])) return bad(`文章 id 不安全：${article[1]}`);
    return { ok: true, path: name };
  }

  const trash = ARTICLE_TRASH_FILE.exec(name);
  if (trash) {
    if (!isSafeFileName(trash[1])) return bad(`回收站文件名不安全：${trash[1]}`);
    return { ok: true, path: name };
  }

  return bad("不在允许备份的文件范围内");
}

/**
 * 条目名 → 绝对路径（纯字符串层面）。
 *
 * 调用方仍必须做物理校验（父目录不能是链接）；这里只保证「拼出来的路径确实在 content/ 下」。
 * 之所以还查一遍 path.relative：防止以后有人绕过 validateBackupEntryName 直接调用。
 */
export function contentPathForEntry(contentRoot: string, entry: string): string {
  const checked = validateBackupEntryName(entry);
  if (!checked.ok) throw new Error(checked.error);

  const root = path.resolve(contentRoot);
  const segments = checked.path.slice(CONTENT_PREFIX.length).split("/");
  const full = path.resolve(root, ...segments);
  const relative = path.relative(root, full);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length === 0) {
    throw new Error(`条目路径跑出了 content/：${entry}`);
  }
  return full;
}

/**
 * 一组条目：数量、重复（Windows 大小写不敏感）、逐个白名单。
 * manifest 校验与恢复前的整体检查共用这一份，避免两处规则漂移。
 */
export type ListValidation = { ok: true } | { ok: false; error: string };

export function validateEntryList(entries: readonly string[]): ListValidation {
  if (entries.length > MAX_ENTRY_COUNT) {
    return { ok: false, error: `条目太多（上限 ${MAX_ENTRY_COUNT}）` };
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    const checked = validateBackupEntryName(entry);
    if (!checked.ok) return { ok: false, error: `${entry}：${checked.error}` };
    const key = checked.path.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `条目重复（Windows 大小写不敏感）：${entry}` };
    }
    seen.add(key);
  }
  return { ok: true };
}
