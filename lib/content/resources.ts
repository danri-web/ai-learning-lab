import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { revisionOf } from "@/lib/content/revision";
import { stripBom } from "@/lib/content/encoding";
import {
  RESOURCE_SORT_LABELS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
  isResourceSort,
  isResourceType,
  type ResourceSort,
  type ResourceType,
} from "@/lib/content/resource-types";
import { ARTICLE_ID_MESSAGE, ARTICLE_ID_REGEX_SOURCE } from "@/lib/security/article-id";
import { MAX_RESOURCE_URL_LENGTH, isSafeResourceUrl } from "@/lib/security/resource-url";

export {
  RESOURCE_SORT_LABELS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
  isResourceSort,
  isResourceType,
  type ResourceSort,
  type ResourceType,
};

/**
 * 资源收藏的**读**与数据结构（阶段 4）。
 *
 * 存储决定见 ADR D9：所有资源放一个 `content/resources.json`（文件是真相，D1 的直接推论）。
 * 这个文件属于那个私有仓库（和笔记一起备份），主仓库 gitignore 掉。
 *
 * 一条资源长这样：
 *   { id, title, url, type, category, tags[], description, articleId?, createdAt, updatedAt }
 *
 * `id` 沿用笔记那套规则（`lib/security/article-id.ts`）：它同时是编辑页 URL 的一段，
 * 所以照样不许点号/分隔符/保留名。
 */

export const RESOURCES_FILE_NAME = "resources.json";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const resourceSchema = z
  .object({
    id: z
      .string()
      .regex(
        new RegExp(ARTICLE_ID_REGEX_SOURCE, "u"),
        `文章/资源文件名规则：${ARTICLE_ID_MESSAGE}`,
      ),
    title: z.string().trim().min(1, "标题不能为空").max(200, "标题最长 200 字"),
    url: z
      .string()
      .trim()
      .min(1, "链接不能为空")
      .max(MAX_RESOURCE_URL_LENGTH, `链接最长 ${MAX_RESOURCE_URL_LENGTH} 字符`)
      .refine(isSafeResourceUrl, "只接受 http / https 链接（不接受 file:、javascript:、相对路径）"),
    type: z.string().refine(isResourceType, "未知的资源类型"),
    category: z.string().trim().min(1, "分类不能为空").max(60, "分类最长 60 字"),
    tags: z.array(z.string().trim().min(1).max(40)).max(20, "标签最多 20 个").default([]),
    description: z.string().max(500, "描述最长 500 字").default(""),
    /** 关联的笔记（逻辑关联，不校验对方是否还存在 —— 笔记可以改文件名之外的任何东西） */
    articleId: z.string().regex(new RegExp(ARTICLE_ID_REGEX_SOURCE, "u")).optional(),
    createdAt: z.string().regex(DATE, "createdAt 必须是 YYYY-MM-DD"),
    updatedAt: z.string().regex(DATE, "updatedAt 必须是 YYYY-MM-DD"),
  })
  .refine((value) => value.updatedAt >= value.createdAt, {
    message: "updatedAt 不能早于 createdAt",
    path: ["updatedAt"],
  });

export type Resource = z.infer<typeof resourceSchema>;

/** 文件整体结构（带版本号，将来要迁移时有地方下手） */
export const resourceFileSchema = z.object({
  version: z.literal(1),
  resources: z.array(resourceSchema),
});

/**
 * 单条资源的指纹：编辑页带着它回来，保存前比对（同笔记的 D8）。
 * 用记录本身的规范化 JSON 算，不碰文件 —— 别的资源被改了不算这条冲突。
 */
export function resourceRevision(resource: Resource): string {
  return revisionOf(JSON.stringify(resource));
}

/** 内容目录（`content/`）。字面量写死：Turbopack 不吃"用变量拼路径"（同 articlesRoot） */
export function contentRoot(): string {
  return path.join(process.cwd(), "content");
}

export function resourcesFile(root = contentRoot()): string {
  return path.join(root, RESOURCES_FILE_NAME);
}

export type ResourceList = {
  resources: Resource[];
  /** 文件读不出来时的原因（不是 null 就说明这个文件现在不能用来写入） */
  problem: string | null;
  /** 文件还不存在（第一次用） */
  missing: boolean;
  /** 整个文件的指纹（不是单条；给"整文件级别"的操作留着） */
  fileRevision: string;
};

export async function readResources(root = contentRoot()): Promise<ResourceList> {
  let source: string;
  try {
    source = await fs.readFile(/*turbopackIgnore: true*/ resourcesFile(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { resources: [], problem: null, missing: true, fileRevision: revisionOf("") };
    }
    // 读不了（权限 / 不是文件）也算"现在不能写"，而不是假装空列表
    return {
      resources: [],
      problem: `resources.json 读取失败：${(error as Error).message}`,
      missing: false,
      fileRevision: revisionOf(""),
    };
  }

  try {
    const parsed = resourceFileSchema.safeParse(JSON.parse(stripBom(source)));
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "根"}：${issue.message}`)
        .join("；");
      return {
        resources: [],
        problem: `resources.json 结构不对：${detail}`,
        missing: false,
        fileRevision: revisionOf(source),
      };
    }
    return {
      resources: parsed.data.resources,
      problem: null,
      missing: false,
      fileRevision: revisionOf(source),
    };
  } catch (error) {
    return {
      resources: [],
      problem: `resources.json 不是合法 JSON：${(error as Error).message}`,
      missing: false,
      fileRevision: revisionOf(source),
    };
  }
}

/* ────────────────────────── 纯函数：筛选 / 排序 ────────────────────────── */

export type ResourceFilter = { type?: ResourceType; category?: string; tag?: string };

export function filterResources(list: Resource[], filter: ResourceFilter): Resource[] {
  return list.filter((item) => {
    if (filter.type && item.type !== filter.type) return false;
    if (filter.category && item.category !== filter.category) return false;
    if (filter.tag && !item.tags.includes(filter.tag)) return false;
    return true;
  });
}

export function sortResources(list: Resource[], sort: ResourceSort): Resource[] {
  const copy = [...list];
  if (sort === "title") return copy.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  if (sort === "created") {
    return copy.sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || a.title.localeCompare(b.title, "zh-CN"),
    );
  }
  return copy.sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, "zh-CN"),
  );
}

/** 筛选栏要用的候选值（带计数），按数量排序 */
export function resourceFacets(list: Resource[]): {
  types: { value: ResourceType; count: number }[];
  categories: { value: string; count: number }[];
  tags: { value: string; count: number }[];
} {
  const typeCounts = new Map<ResourceType, number>();
  const categoryCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  for (const item of list) {
    typeCounts.set(item.type, (typeCounts.get(item.type) ?? 0) + 1);
    categoryCounts.set(item.category, (categoryCounts.get(item.category) ?? 0) + 1);
    for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  const byCount = <T>(map: Map<T, number>) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), "zh-CN"));

  return {
    types: byCount(typeCounts),
    categories: byCount(categoryCounts),
    tags: byCount(tagCounts).slice(0, 12),
  };
}
