import { z } from "zod";

import { articlesRoot } from "@/lib/content/articles";
import { createArticle, saveArticle, trashArticle, type WriteFailure } from "@/lib/content/write";
import { isSafeArticleId } from "@/lib/security/article-id";

/**
 * 笔记的业务规则层（docs/架构决策.md D4）：**唯一决定"能不能写"的地方**。
 *
 * 分工：
 *   - 这一层：用户输入是否合格（长度、标签数量、正文上限）、错误话术、把输入映射成写入参数
 *   - lib/content/write：文件是否安全、生成的内容是否自洽
 *   - Server Action：只做 FormData ↔ 普通对象 的转换，以及跳转/刷新
 *
 * 页面组件不许碰文件和这层之外的写入口（源码闸门锁着）。
 */

/** 正文上限（需求书 §8「限制请求体大小」）。20 万字约 600KB，个人笔记够用，也不会把请求撑爆 */
export const MAX_BODY_CHARS = 200_000;

/** 表单里的原始字段（都是字符串，标签还没切） */
export type ArticleFields = {
  title: string;
  category: string;
  tags: string;
  body: string;
};

export type ServiceResult<T> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const FIELDS = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(200, "标题最长 200 字"),
  category: z.string().trim().min(1, "分类不能为空").max(60, "分类最长 60 字"),
  tags: z.string().max(1000, "标签太长了").default(""),
  body: z.string().max(MAX_BODY_CHARS, `正文最多 ${MAX_BODY_CHARS / 10000} 万字`),
});

/** 标签的切分：英文逗号、中文逗号、中英文分号、顿号、换行都算分隔符 */
const TAG_SPLIT = /[,，;；、\n]/;

const TAGS_LIMIT = { max: 20, tagMax: 40 };

function splitTags(raw: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const piece of raw.split(TAG_SPLIT)) {
    const tag = piece.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

type ValidFields = { title: string; category: string; tags: string[]; body: string };

function validate(fields: ArticleFields): ServiceResult<ValidFields> {
  const parsed = FIELDS.safeParse(fields);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".") || "form";
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, error: "表单里有不合规的内容（下面标出来了）", fieldErrors };
  }

  const tags = splitTags(parsed.data.tags);
  if (tags.length > TAGS_LIMIT.max) {
    return {
      ok: false,
      error: `标签最多 ${TAGS_LIMIT.max} 个`,
      fieldErrors: { tags: `标签最多 ${TAGS_LIMIT.max} 个` },
    };
  }
  const tooLong = tags.find((tag) => tag.length > TAGS_LIMIT.tagMax);
  if (tooLong) {
    return {
      ok: false,
      error: `标签最长 ${TAGS_LIMIT.tagMax} 字`,
      fieldErrors: { tags: `「${tooLong}」太长了（上限 ${TAGS_LIMIT.tagMax} 字）` },
    };
  }

  return {
    ok: true,
    data: {
      title: parsed.data.title,
      category: parsed.data.category,
      tags,
      body: parsed.data.body,
    },
  };
}

/** 写入层失败 → 用户能看懂的一句话 */
function describeFailure(failure: WriteFailure): string {
  switch (failure.reason) {
    case "not-found":
      return "这篇笔记不存在（可能已经被删除或改了文件名）";
    case "conflict":
      return `写不进去：${failure.error}`;
    case "unsafe":
      return `这个文件名不被接受：${failure.error}`;
    case "invalid":
      return failure.error;
    case "io":
      return `磁盘写入失败：${failure.error}`;
  }
}

export async function createArticleFromFields(
  fields: ArticleFields,
): Promise<ServiceResult<{ id: string }>> {
  const valid = validate(fields);
  if (!valid.ok) return valid;

  const result = await createArticle(valid.data, { root: articlesRoot() });
  if (!result.ok) return { ok: false, error: describeFailure(result) };
  return { ok: true, data: { id: result.id } };
}

export async function saveArticleFromFields(
  id: string,
  fields: ArticleFields,
): Promise<ServiceResult<{ id: string; createdAt: string; updatedAt: string }>> {
  if (!isSafeArticleId(id)) return { ok: false, error: "这个文件名不被接受" };

  const valid = validate(fields);
  if (!valid.ok) return valid;

  const result = await saveArticle(id, valid.data, { root: articlesRoot() });
  if (!result.ok) return { ok: false, error: describeFailure(result) };
  return {
    ok: true,
    data: { id: result.id, createdAt: result.createdAt, updatedAt: result.updatedAt },
  };
}

export async function deleteArticleById(id: string): Promise<ServiceResult<{ id: string }>> {
  if (!isSafeArticleId(id)) return { ok: false, error: "这个文件名不被接受" };

  const result = await trashArticle(id, { root: articlesRoot() });
  if (!result.ok) return { ok: false, error: describeFailure(result) };
  return { ok: true, data: { id: result.id } };
}
