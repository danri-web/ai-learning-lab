import matter from "gray-matter";
import { z } from "zod";

import { normalizeArticleBody } from "@/lib/content/body-text";
import { stripBom } from "@/lib/content/encoding";
import { ARTICLE_ID_MESSAGE, ARTICLE_ID_REGEX_SOURCE } from "@/lib/security/article-id";

/**
 * frontmatter 的唯一真相 + 唯一校验入口。
 *
 * 字段来自需求书 §5（`docs/需求书.md`）：id / title / category / tags / createdAt / updatedAt。
 * 设计原则：**宁可拒绝保存，也不要写坏文件** —— 所以这里只做校验，不偷偷补默认值，
 * 除了 tags 允许缺省（缺省 = 空数组）。
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * frontmatter 的开头只允许这几种写法：
 *
 *   `---` / `---yaml` / `---yml` / `---json`（后面可以跟 ASCII 空格/制表符）
 *
 * 注意这里**故意不用 `\s`**：`\s` 在 JS 里包含 NBSP、EM SPACE、BOM、垂直制表符……
 * 而 gray-matter 判断语言时用的是 `String.trim()`，它会把同样的字符全部 trim 掉。
 * 一旦我们的正则和它“trim 的集合”不一致，`---javascript\u00a0` 就会从缺口里钻过去
 * （v2 外部审计 V2-SEC-01 实测：旧守卫直接放行，payload 真的执行了）。
 *
 * 所以策略改成「不认识就拒绝」，而不是「认识可执行语言才拒绝」。
 */
const SAFE_OPENING = /^---[ \t]*(?:(?:yaml|yml|json)[ \t]*)?(?:\r?\n|$)/i;

/**
 * 把开头规范成纯 `---`，交给 gray-matter 之前先把「语言」抹掉：
 * 解析器没有任何引擎可选，`javascript` / `js` 再也没有被选中的机会。
 *
 * 没有 frontmatter 的文件原样返回（gray-matter 只在开头是分隔符时才做语言检测）。
 */
function normalizeFrontmatterSource(source: string): string {
  const text = stripBom(source);
  if (!text.startsWith("---")) return text;

  const opening = SAFE_OPENING.exec(text);
  if (!opening) {
    throw new Error(
      "frontmatter 开头只支持 `---`（可带 yaml/yml/json）；检测到可执行语言或不可见空白（NBSP/BOM/垂直制表符等），已拒绝解析",
    );
  }

  const newline = opening[0].endsWith("\r\n") ? "\r\n" : opening[0].endsWith("\n") ? "\n" : "";
  return `---${newline}${text.slice(opening[0].length)}`;
}

/**
 * 唯一允许的解析入口：先拒绝一切非 YAML/JSON 的开头，再把语言标记抹掉，
 * 固定用 YAML 引擎。不要在这里传用户可控的 `language` / `engines`。
 */
function parseSource(source: string): { data: unknown; content: string } {
  const parsed = matter(normalizeFrontmatterSource(source), { language: "yaml" });
  return { data: parsed.data, content: parsed.content };
}

/** 读原始 frontmatter（保存时保留用户自己加的字段用；失败由调用方决定怎么处理） */
export function readFrontmatter(source: string): Record<string, unknown> {
  const { data } = parseSource(source);
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

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
    const parsed = parseSource(source);
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

  // 正文只归一两端空行：行首缩进（缩进代码块）与行尾空格（硬换行）是 Markdown 的语义，不能 trim
  return { ok: true, article: { ...result.data, body: normalizeArticleBody(body) } };
}
