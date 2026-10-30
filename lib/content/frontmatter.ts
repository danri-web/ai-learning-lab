import matter from "gray-matter";
import { z } from "zod";

import { ARTICLE_ID_MESSAGE, ARTICLE_ID_REGEX_SOURCE } from "@/lib/security/article-id";

/**
 * frontmatter 的唯一真相 + 唯一校验入口。
 *
 * 字段来自需求书 §5（`docs/需求书.md`）：id / title / category / tags / createdAt / updatedAt。
 * 设计原则：**宁可拒绝保存，也不要写坏文件** —— 所以这里只做校验，不偷偷补默认值，
 * 除了 tags 允许缺省（缺省 = 空数组）。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const articleFrontmatterSchema = z
  .object({
    // 与 lib/security/article-id.ts 共用同一份规则：id 同时是文件名（D3/D7），
    // 中文标题现在可以直接当文件名，但仍然不许出现点号/分隔符/保留名。
    id: z.string().regex(new RegExp(ARTICLE_ID_REGEX_SOURCE, "u"), ARTICLE_ID_MESSAGE),
    title: z.string().trim().min(1, "标题不能为空").max(200, "标题最长 200 字"),
    category: z.string().trim().min(1, "分类不能为空").max(60, "分类最长 60 字"),
    tags: z.array(z.string().trim().min(1).max(40)).max(20, "标签最多 20 个").default([]),
    createdAt: z.string().regex(DATE, "createdAt 必须是 YYYY-MM-DD"),
    updatedAt: z.string().regex(DATE, "updatedAt 必须是 YYYY-MM-DD"),
  })
  .refine((value) => value.updatedAt >= value.createdAt, {
    message: "updatedAt 不能早于 createdAt",
    path: ["updatedAt"],
  });

export type ArticleFrontmatter = z.infer<typeof articleFrontmatterSchema>;

export type ParsedArticle = ArticleFrontmatter & {
  /** 正文（不含 frontmatter） */
  body: string;
};

export type ParseFailure = {
  ok: false;
  /** 人能看懂的失败原因；列表页会直接显示它，不让整页崩掉 */
  error: string;
};

export type ParseSuccess = { ok: true; article: ParsedArticle };

/**
 * 解析一篇笔记。
 *
 * @param source  文件原文
 * @param fileId  由文件名推出的 id（文件名就是 id，见 docs/架构决策.md D3）
 *
 * 额外强制一条不变式：**frontmatter 里的 id 必须和文件名一致**。
 * 不一致意味着"两个人抢同一个身份"，早失败比晚失败便宜。
 */
export function parseArticle(source: string, fileId: string): ParseSuccess | ParseFailure {
  let raw: unknown;
  let body: string;
  try {
    const parsed = matter(source);
    raw = parsed.data;
    body = parsed.content;
  } catch (error) {
    return { ok: false, error: `frontmatter 解析失败：${(error as Error).message}` };
  }

  const result = articleFrontmatterSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "frontmatter"}：${issue.message}`)
      .join("；");
    return { ok: false, error: detail };
  }

  if (result.data.id !== fileId) {
    return {
      ok: false,
      error: `frontmatter 的 id（${result.data.id}）与文件名（${fileId}.md）不一致`,
    };
  }

  return { ok: true, article: { ...result.data, body: body.trim() } };
}
