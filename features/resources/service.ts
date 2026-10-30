import { z } from "zod";

import { contentRoot, isResourceType, type ResourceType } from "@/lib/content/resources";
import { pendingRestoreMessage } from "@/lib/content/restore-gate";
import {
  createResource,
  deleteResource,
  updateResource,
  type StoreFailure,
} from "@/lib/content/resources-store";
import { isSafeArticleId } from "@/lib/security/article-id";
import { MAX_RESOURCE_URL_LENGTH, isSafeResourceUrl } from "@/lib/security/resource-url";

/**
 * 资源收藏的业务规则层（同笔记：service 是**唯一决定"能不能写"**的地方，D4）。
 *
 * 分工：这一层管用户输入是否合格 + 错误话术；写入层管文件是否安全、生成的内容是否自洽。
 */

export type ResourceFields = {
  title: string;
  url: string;
  type: string;
  category: string;
  tags: string;
  description: string;
  articleId: string;
};

export type ServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      code?: "stale";
    };

const FIELDS = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(200, "标题最长 200 字"),
  url: z
    .string()
    .trim()
    .min(1, "链接不能为空")
    .max(MAX_RESOURCE_URL_LENGTH, `链接最长 ${MAX_RESOURCE_URL_LENGTH} 字符`)
    .refine(isSafeResourceUrl, "只接受 http / https 链接"),
  type: z.string().refine(isResourceType, "选一个资源类型"),
  category: z.string().trim().min(1, "分类不能为空").max(60, "分类最长 60 字"),
  tags: z.string().max(1000, "标签太长了").default(""),
  description: z.string().max(500, "描述最长 500 字").default(""),
  articleId: z.string().optional().default(""),
});

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

type ValidInput = {
  title: string;
  url: string;
  type: ResourceType;
  category: string;
  tags: string[];
  description: string;
  articleId?: string;
};

function validate(fields: ResourceFields): ServiceResult<ValidInput> {
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

  const articleId = parsed.data.articleId.trim();
  // 关联笔记是可选的；给了就必须是一个合法的笔记 id（不校验它是否还存在，那是阶段 6 的活）
  if (articleId && !isSafeArticleId(articleId)) {
    return {
      ok: false,
      error: "关联的笔记 id 不合法",
      fieldErrors: { articleId: "关联的笔记 id 不合法" },
    };
  }

  return {
    ok: true,
    data: {
      title: parsed.data.title,
      url: parsed.data.url,
      type: parsed.data.type,
      category: parsed.data.category,
      tags,
      description: parsed.data.description,
      ...(articleId ? { articleId } : {}),
    },
  };
}

function describeFailure(failure: StoreFailure): string {
  switch (failure.reason) {
    case "not-found":
      return "这条资源不存在（可能已经被删了）";
    case "stale":
      return failure.error;
    case "invalid":
      return failure.error;
    case "io":
      return `磁盘写入失败：${failure.error}`;
  }
}

export type ResourceControls = { base?: string; force?: boolean };

export async function createResourceFromFields(
  fields: ResourceFields,
): Promise<ServiceResult<{ id: string }>> {
  const blocked = await pendingRestoreMessage();
  if (blocked) return { ok: false, error: blocked };

  const valid = validate(fields);
  if (!valid.ok) return valid;

  const result = await createResource(valid.data, { root: contentRoot() });
  if (!result.ok) return { ok: false, error: describeFailure(result) };
  return { ok: true, data: { id: result.id } };
}

export async function updateResourceFromFields(
  id: string,
  fields: ResourceFields,
  controls: ResourceControls = {},
): Promise<ServiceResult<{ id: string }>> {
  if (!isSafeArticleId(id)) return { ok: false, error: "这个资源 id 不被接受" };

  const blocked = await pendingRestoreMessage();
  if (blocked) return { ok: false, error: blocked };

  const valid = validate(fields);
  if (!valid.ok) return valid;

  const result = await updateResource(id, valid.data, {
    root: contentRoot(),
    expectRevision: controls.base || undefined,
    force: controls.force,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: describeFailure(result),
      ...(result.reason === "stale" ? { code: "stale" as const } : {}),
    };
  }
  return { ok: true, data: { id: result.id } };
}

export async function deleteResourceById(id: string): Promise<ServiceResult<{ id: string }>> {
  if (!isSafeArticleId(id)) return { ok: false, error: "这个资源 id 不被接受" };

  const blocked = await pendingRestoreMessage();
  if (blocked) return { ok: false, error: blocked };

  const result = await deleteResource(id, { root: contentRoot() });
  if (!result.ok) return { ok: false, error: describeFailure(result) };
  return { ok: true, data: { id: result.id } };
}
