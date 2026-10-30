import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";

import matter from "gray-matter";

import { formatLocalDate, formatLocalStamp } from "@/lib/content/clock";
import { normalizeArticleBody } from "@/lib/content/body-text";
import { parseArticle, readFrontmatter } from "@/lib/content/frontmatter";
import { revisionOf } from "@/lib/content/revision";
import { fallbackNoteId, slugifyTitle } from "@/lib/content/id";
import { writeFileAtomic } from "@/lib/fs/atomic-write";
import { serialize } from "@/lib/fs/mutex";
import { UnsafePathError, resolveArticleFile, resolveTrashFile } from "@/lib/security/paths";
import { MAX_ID_LENGTH } from "@/lib/security/article-id";

/**
 * 写笔记。**唯一允许写正文文件的地方**（docs/架构决策.md D4）。
 *
 * 四条不变式，每条都有测试：
 *   1. 只走 `resolveArticleFile`（物理校验路径）和 `writeFileAtomic`（临时文件 + rename）
 *   2. **写之前先证明写出来的东西读得回来** —— 生成 source 后过一遍 `parseArticle`，
 *      而且要求**正文一字不差**；过不了就根本不落盘（审计 v3 F3 补的等式检查）
 *   3. 删除 = 移到 `.trash/`，不是真删（用户数据，误删要能捞回来）
 *   4. **写操作进程内串行**（`lib/fs/mutex.ts` 的 `serialize`）：分配 id 与落盘之间如果插进
 *      另一个请求，两边都会以为自己是第一个 —— 审计 v3 F1 实测 8 个并发创建只活下来 1 个 id
 *
 * 这里不做「用户输入是否友好」的判断（字段长度、标签数量在 service 层做），
 * 只做「这个文件/这次写入是否安全、是否自洽」。
 */

export type ArticleInput = {
  title: string;
  category: string;
  tags: string[];
  body: string;
};

export type WriteFailureReason = "invalid" | "not-found" | "unsafe" | "conflict" | "stale" | "io";

export type WriteFailure = { ok: false; reason: WriteFailureReason; error: string };

export type CreateResult = { ok: true; id: string } | WriteFailure;

export type SaveResult =
  { ok: true; id: string; createdAt: string; updatedAt: string; revision: string } | WriteFailure;

export type TrashResult = { ok: true; id: string; trashedTo: string } | WriteFailure;

export type WriteOptions = {
  /** 正文目录的绝对路径（生产环境用 `articlesRoot()`；测试传临时目录） */
  root: string;
  /** 注入"现在"，测试里固定日期；不传就是本机当前时间 */
  now?: Date;
};

export type SaveOptions = WriteOptions & {
  /**
   * 编辑器打开时那份正文的指纹（`revisionOf`）。给了就做「过期保存」检查：
   * 磁盘上的正文已经变了 → 拒绝，让用户自己决定是覆盖还是刷新（审计 v3 F2）。
   */
  expectRevision?: string;
  /** 用户明确选择「覆盖」时置真：跳过过期检查 */
  force?: boolean;
};

function fail(reason: WriteFailureReason, error: string): WriteFailure {
  return { ok: false, reason, error };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把「路径闸门拒绝」与「磁盘出错」分开报：前者是输入问题，不该重试 */
function fromException(error: unknown): WriteFailure {
  return error instanceof UnsafePathError
    ? fail("unsafe", errorMessage(error))
    : fail("io", errorMessage(error));
}

/**
 * 拼出文件内容（frontmatter + 正文）。
 *
 * 用 gray-matter 的 stringify（内部是 js-yaml）：中文、冒号、`#` 这些会由它决定要不要加引号，
 * 手拼字符串迟早撞上一个需要引号的标题。是否**读得回来**由 `roundTrip` 再验一遍。
 *
 * 正文只归一两端空行（`normalizeArticleBody`），不 trim —— 缩进代码块是语义（审计 v3 F3）。
 */
function renderSource(frontmatter: Record<string, unknown>, body: string): string {
  const normalized = normalizeArticleBody(body);
  // 传对象而不是字符串：gray-matter 对字符串会先 `matter(file)`，正文里若有
  // `---javascript` 就会在写盘前执行。对象形式只做 YAML stringify，不解析正文。
  const text = matter.stringify({ content: normalized ? `${normalized}\n` : "" }, frontmatter);
  return text.endsWith("\n") ? text : `${text}\n`;
}

/**
 * 写之前的自检：生成的内容必须能被自己的解析器读回来，**而且正文一字不差**。
 *
 * 审计 v3 的 F3 指出：原来只验"能解析"，trim 掉的缩进照样算通过。
 * 现在验的是等式 —— 写进去什么，读回来就得是什么（两端空行按契约定，其余逐字比）。
 */
function roundTrip(source: string, id: string, expectedBody: string): WriteFailure | null {
  const parsed = parseArticle(source, id);
  if (!parsed.ok) return fail("invalid", `生成的内容不合法：${parsed.error}`);
  if (parsed.article.body !== normalizeArticleBody(expectedBody)) {
    return fail("invalid", "生成的内容读回来与提交的正文不一致（换行/缩进会被改变），拒绝保存");
  }
  return null;
}

/** 目录里已经被占用的 id（小写集合：Windows 文件系统大小写不敏感，"Model" 和 "model" 是同一个文件） */
async function listTakenIds(root: string): Promise<Set<string>> {
  const taken = new Set<string>();
  let names: string[];
  try {
    names = await fs.readdir(/*turbopackIgnore: true*/ root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return taken;
    throw error;
  }
  for (const name of names) {
    if (name.toLowerCase().endsWith(".md")) taken.add(name.slice(0, -3).toLowerCase());
  }
  return taken;
}

/** 重名就加 `-2`、`-3`（D3）；加满 100 个还没位置就放弃，交给兜底 id */
function nextFreeId(base: string, taken: Set<string>): string | null {
  const room = MAX_ID_LENGTH - 4; // 给 "-99" 留位置
  const stem = base.length > room ? base.slice(0, room).replace(/-+$/, "") : base;
  for (let n = 1; n <= 100; n += 1) {
    const candidate = n === 1 ? stem : `${stem}-${n}`;
    if (candidate.length > MAX_ID_LENGTH) continue;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

export function createArticle(input: ArticleInput, options: WriteOptions): Promise<CreateResult> {
  // 分配 id 与落盘必须在同一把锁里，否则两个同标题请求会算出同一个 id（审计 v3 F1）
  return serialize(() => createArticleUnlocked(input, options));
}

async function createArticleUnlocked(
  input: ArticleInput,
  options: WriteOptions,
): Promise<CreateResult> {
  const { root } = options;
  const now = options.now ?? new Date();
  const today = formatLocalDate(now);

  if (!input.title.trim()) return fail("invalid", "标题不能为空");

  try {
    await fs.mkdir(root, { recursive: true });
    const taken = await listTakenIds(root);

    const id =
      nextFreeId(slugifyTitle(input.title), taken) ??
      nextFreeId(fallbackNoteId(now), taken) ??
      null;
    if (!id) return fail("conflict", "同名笔记太多，换个标题再建");

    const source = renderSource(
      {
        id,
        title: input.title.trim(),
        category: input.category.trim(),
        tags: input.tags,
        createdAt: today,
        updatedAt: today,
      },
      input.body,
    );
    const invalid = roundTrip(source, id, input.body);
    if (invalid) return invalid;

    const full = await resolveArticleFile(root, id);
    // 目录扫描到这里之间可能有别人建了同名文件：宁可报冲突，也不覆盖
    const exists = await fs.lstat(/*turbopackIgnore: true*/ full).catch(() => null);
    if (exists) return fail("conflict", `已经有同名文件：${id}.md`);
    await writeFileAtomic(full, source);
    return { ok: true, id };
  } catch (error) {
    return fromException(error);
  }
}

/** 读出原有 frontmatter 的原始键值（用于保留我们不认识的字段，比如用户自己加的 `reviewed: true`） */
function readRawFrontmatter(source: string): Record<string, unknown> {
  try {
    return readFrontmatter(source);
  } catch {
    // 原有 frontmatter 坏到连 YAML 都解析不了 —— 那就以这次保存的内容为准（至少救回正文）
    return {};
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function saveArticle(
  id: string,
  input: ArticleInput,
  options: SaveOptions,
): Promise<SaveResult> {
  return serialize(() => saveArticleUnlocked(id, input, options));
}

async function saveArticleUnlocked(
  id: string,
  input: ArticleInput,
  options: SaveOptions,
): Promise<SaveResult> {
  const { root } = options;
  const now = options.now ?? new Date();
  const today = formatLocalDate(now);

  if (!input.title.trim()) return fail("invalid", "标题不能为空");

  let full: string;
  try {
    full = await resolveArticleFile(root, id);
  } catch (error) {
    return fromException(error);
  }

  let existing: string;
  try {
    existing = await fs.readFile(/*turbopackIgnore: true*/ full, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fail("not-found", `没有这篇笔记：${id}`);
    }
    return fail("io", `读取失败：${errorMessage(error)}`);
  }

  // 过期保存检查（审计 v3 F2）：编辑器带回来的指纹对不上 → 磁盘上的正文已经被别人改过，
  // 此时直接写会把那次改动**静默**顶掉。拒绝并把选择权交回给用户（覆盖 / 刷新重来）。
  if (options.expectRevision && !options.force) {
    const current = revisionOf(existing);
    if (current !== options.expectRevision) {
      return fail(
        "stale",
        "这篇笔记在你打开之后被改过（另一个标签页、或别的编辑器）。为避免覆盖别人的修改，这次没有保存。",
      );
    }
  }

  const raw = readRawFrontmatter(existing);
  // createdAt 是这篇笔记的"出生证明"，保存时不能改；原值坏了才退回今天（否则整篇永远存不进去）
  const createdAt =
    typeof raw.createdAt === "string" && DATE_ONLY.test(raw.createdAt) ? raw.createdAt : today;

  const source = renderSource(
    {
      // 先铺原有字段，再用本次编辑的字段覆盖：用户手写的额外 frontmatter 不会被我们悄悄删掉
      ...raw,
      id,
      title: input.title.trim(),
      category: input.category.trim(),
      tags: input.tags,
      createdAt,
      updatedAt: today,
    },
    input.body,
  );
  const invalid = roundTrip(source, id, input.body);
  if (invalid) return invalid;

  try {
    await writeFileAtomic(full, source);
  } catch (error) {
    return fromException(error);
  }
  return { ok: true, id, createdAt, updatedAt: today, revision: revisionOf(source) };
}

/** 删除 = 移到 `.trash/`。文件名带时间戳，同一个 id 删两次也不会互相覆盖 */
export function trashArticle(id: string, options: WriteOptions): Promise<TrashResult> {
  return serialize(() => trashArticleUnlocked(id, options));
}

async function trashArticleUnlocked(id: string, options: WriteOptions): Promise<TrashResult> {
  const { root } = options;
  const now = options.now ?? new Date();

  let full: string;
  try {
    full = await resolveArticleFile(root, id);
  } catch (error) {
    return fromException(error);
  }

  const stat = await fs.lstat(/*turbopackIgnore: true*/ full).catch(() => null);
  if (!stat) return fail("not-found", `没有这篇笔记：${id}`);
  if (!stat.isFile()) return fail("invalid", `这不是一个普通文件：${id}.md`);

  try {
    let fileName = `${formatLocalStamp(now)}-${id}.md`;
    let target = await resolveTrashFile(root, fileName);
    if (await fs.lstat(/*turbopackIgnore: true*/ target).catch(() => null)) {
      fileName = `${formatLocalStamp(now)}-${id}-${randomBytes(2).toString("hex")}.md`;
      target = await resolveTrashFile(root, fileName);
      if (await fs.lstat(/*turbopackIgnore: true*/ target).catch(() => null)) {
        return fail("conflict", "回收站里已有同名文件，稍后再试");
      }
    }
    await fs.rename(full, target);
    return { ok: true, id, trashedTo: target };
  } catch (error) {
    return fromException(error);
  }
}
