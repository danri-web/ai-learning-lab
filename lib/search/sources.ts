import { listArticleSources } from "@/lib/content/articles";
import { readResources } from "@/lib/content/resources";
import { toSearchText } from "@/lib/search/plain-text";
import type { SearchCounts, SearchProblem, SearchResponse } from "@/lib/search/contract";
import { MAX_QUERY_LENGTH, searchDocuments, type SearchDocument } from "@/lib/search/query";

export type { SearchCounts, SearchProblem, SearchResponse };

/**
 * 搜索的**取数层**（阶段 5）：把笔记与资源归一成同一形状的 `SearchDocument`。
 *
 * 索引策略见 ADR D6：**不建索引**，每次搜都扫一遍（D1 的直接推论 —— 文件是真相，
 * 没有"索引与文件不一致"这个问题）。几百篇几十毫秒；真要慢了，
 * 这一层的下面加一层 mtime+size 缓存即可，上层（query / 界面）一行都不用改。
 *
 * 安全上只有一条入口：笔记走 `listArticleSources`（内部是 `resolveArticleFile`，
 * 拒 junction/symlink，跳过 `_` / `.` 开头的文件，所以 `.trash/` 天然搜不到），
 * 资源走 `readResources`（Zod 校验过的 JSON）。这一层**不自己拼路径**。
 */

export type SearchCorpus = {
  documents: SearchDocument[];
  counts: SearchCounts;
  problems: SearchProblem[];
};

export type SearchRoots = {
  /** 笔记目录（测试用；线上用默认的 content/articles） */
  articlesRoot?: string;
  /** 资源文件所在目录（同上） */
  contentRoot?: string;
};

/** 扫一遍笔记与资源，归一成搜索用的文档（每次搜索都调，不缓存 —— D6） */
export async function loadSearchCorpus(roots: SearchRoots = {}): Promise<SearchCorpus> {
  const [articleList, resourceList] = await Promise.all([
    listArticleSources(roots.articlesRoot),
    readResources(roots.contentRoot),
  ]);

  const documents: SearchDocument[] = articleList.articles.map((article) => ({
    kind: "article",
    id: article.id,
    title: article.title,
    category: article.category,
    tags: article.tags,
    text: toSearchText(article.body),
    updatedAt: article.updatedAt,
  }));

  for (const resource of resourceList.resources) {
    documents.push({
      kind: "resource",
      id: resource.id,
      title: resource.title,
      category: resource.category,
      tags: resource.tags,
      url: resource.url,
      text: toSearchText(resource.description),
      updatedAt: resource.updatedAt,
    });
  }

  const problems: SearchProblem[] = articleList.problems.map((problem) => ({
    file: problem.file,
    error: problem.error,
  }));
  // 资源文件整体坏掉时只报一条 —— 这时候列表是空的，搜不到也算"诚实"
  if (resourceList.problem) problems.push({ file: "resources.json", error: resourceList.problem });

  return {
    documents,
    counts: { articles: articleList.articles.length, resources: resourceList.resources.length },
    problems,
  };
}

/**
 * 搜一次。查询再长也不截断成"看起来搜了" —— 超长由 query 层返回 `too-long`，界面照实说。
 */
export async function searchLibrary(
  rawQuery: string,
  roots: SearchRoots = {},
): Promise<SearchResponse> {
  const startedAt = performance.now();
  const corpus = await loadSearchCorpus(roots);
  const outcome = searchDocuments(corpus.documents, rawQuery);
  return {
    outcome,
    counts: corpus.counts,
    tookMs: Math.round((performance.now() - startedAt) * 10) / 10,
    problems: corpus.problems,
  };
}

export { MAX_QUERY_LENGTH };
