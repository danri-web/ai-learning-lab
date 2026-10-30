import { promises as fs } from "node:fs";
import path from "node:path";

import { parseArticle, type ParsedArticle } from "@/lib/content/frontmatter";
import { revisionOf } from "@/lib/content/revision";
import { UnsafePathError, resolveArticleFile } from "@/lib/security/paths";

/**
 * 读笔记。**只有这里能读正文**（docs/架构决策.md D4：页面不直接碰文件系统）。
 *
 * 真相来源是文件（D1）：每次调用都扫目录，不做缓存。几百篇也就几十毫秒。
 * 将来真慢了，加 mtime 缓存 —— 但"谁是真相"不变。
 */

/**
 * 正文目录的绝对路径（相对仓库根）。
 *
 * 这里**故意把字面量写死**，而不是用 `ARTICLES_DIR` 拼：
 * Turbopack 的静态分析看到"用变量拼出来的路径"会认为要把整个项目打进产物里
 * （构建直接报 Warning 并失败）。字面量能让它看清"只碰 content/articles 这个子目录"。
 * 与 `ARTICLES_DIR` 的一致性由 tests/content.test.ts 断言。
 */
export function articlesRoot(): string {
  return path.join(process.cwd(), "content", "articles");
}

export type ArticleSummary = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

/** 读不出来的文件也要露出来，而不是悄悄消失 */
export type ArticleProblem = {
  /** 文件名推出来的 id（可能不合法，所以是 string 而不是断言过的 id） */
  id: string;
  file: string;
  error: string;
};

export type ArticleList = {
  articles: ArticleSummary[];
  problems: ArticleProblem[];
  /** 目录本身不存在（第一次用、还没建） */
  missingRoot: boolean;
};

/** 跳过以 `_` 开头的文件：模板、草稿、示例约定（不会出现在列表里） */
function isHiddenName(name: string): boolean {
  return name.startsWith("_") || name.startsWith(".");
}

/** 搜索用的文章源：摘要字段 + 正文（阶段 5） */
export type ArticleSource = ArticleSummary & { body: string };

export type ArticleSourceList = {
  articles: ArticleSource[];
  problems: ArticleProblem[];
  missingRoot: boolean;
};

/**
 * 扫一遍目录，拿到**含正文**的文章。
 *
 * `listArticles`（列表页）与 `listArticleSources`（搜索）共用这一个循环：
 * 两处各写一遍，迟早会漂（比如只在一处跳过 `_` 前缀）。
 */
async function scanArticles(root: string): Promise<{
  articles: ParsedArticle[];
  problems: ArticleProblem[];
  missingRoot: boolean;
}> {
  // turbopackIgnore：正文在运行时从磁盘读（用户数据，不进产物）。
  // 不加这个注释，Turbopack 会认为"要追踪整个项目"并给出构建警告。
  let names: string[];
  try {
    names = await fs.readdir(/*turbopackIgnore: true*/ root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { articles: [], problems: [], missingRoot: true };
    }
    throw error;
  }

  const articles: ParsedArticle[] = [];
  const problems: ArticleProblem[] = [];

  for (const name of names) {
    if (!name.toLowerCase().endsWith(".md") || isHiddenName(name)) continue;

    const fileId = name.slice(0, -3);
    try {
      // 走 resolveArticleFile：顺手挡住"文件名不合法"和"文件被换成了链接"
      const full = await resolveArticleFile(root, fileId);
      const source = await fs.readFile(/*turbopackIgnore: true*/ full, "utf8");
      const parsed = parseArticle(source, fileId);
      if (!parsed.ok) {
        problems.push({ id: fileId, file: name, error: parsed.error });
        continue;
      }
      articles.push(parsed.article);
    } catch (error) {
      const message =
        error instanceof UnsafePathError ? error.message : `读取失败：${(error as Error).message}`;
      problems.push({ id: fileId, file: name, error: message });
    }
  }

  articles.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, "zh-CN"),
  );

  return { articles, problems, missingRoot: false };
}

/**
 * 显式挑字段（不用 ...rest），这样以后给 ParsedArticle 加字段时不会**悄悄**漏进列表：
 * 正文（body）就不该跟着列表页飞一遍。
 */
function toSummary(article: ParsedArticle): ArticleSummary {
  return {
    id: article.id,
    title: article.title,
    category: article.category,
    tags: article.tags,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

export async function listArticles(root = articlesRoot()): Promise<ArticleList> {
  const scanned = await scanArticles(root);
  return {
    articles: scanned.articles.map(toSummary),
    problems: scanned.problems,
    missingRoot: scanned.missingRoot,
  };
}

/**
 * 搜索要正文，但不该因此复制一份扫描逻辑。
 * 注意：跳过的规则（`_` / `.` 开头、`.trash`）在 scanArticles 里，这里是同一套 ——
 * 不存在"搜索能搜到回收站里的东西"这种独立实现。
 */
export async function listArticleSources(root = articlesRoot()): Promise<ArticleSourceList> {
  const scanned = await scanArticles(root);
  return {
    articles: scanned.articles.map((article) => ({ ...toSummary(article), body: article.body })),
    problems: scanned.problems,
    missingRoot: scanned.missingRoot,
  };
}

export type ReadResult =
  | {
      ok: true;
      article: ParsedArticle;
      /** 正文文件的指纹（保存时带回去做"过期保存"检查，见 lib/content/revision.ts） */
      sourceHash: string;
    }
  | { ok: false; reason: "not-found" | "invalid" | "unreadable"; error: string };

export async function readArticle(id: string, root = articlesRoot()): Promise<ReadResult> {
  let full: string;
  try {
    full = await resolveArticleFile(root, id);
  } catch (error) {
    if (error instanceof UnsafePathError) {
      return { ok: false, reason: "invalid", error: error.message };
    }
    return { ok: false, reason: "unreadable", error: (error as Error).message };
  }

  let source: string;
  try {
    source = await fs.readFile(/*turbopackIgnore: true*/ full, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, reason: "not-found", error: `没有这篇笔记：${id}` };
    }
    return { ok: false, reason: "unreadable", error: `读取失败：${(error as Error).message}` };
  }

  const parsed = parseArticle(source, id);
  if (!parsed.ok) return { ok: false, reason: "invalid", error: parsed.error };

  return { ok: true, article: parsed.article, sourceHash: revisionOf(source) };
}
