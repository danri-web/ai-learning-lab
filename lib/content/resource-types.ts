/**
 * 资源的「类型目录」——**纯常量，不碰文件系统**。
 *
 * 为什么单独一个文件：客户端组件（收藏表单里的类型下拉）也要用这些标签，
 * 而 `lib/content/resources.ts` 里有 `node:fs`（读 resources.json）。
 * 客户端一旦从那个模块 import，Turbopack 会把 `node:fs` 拉进浏览器 chunk，
 * 构建直接报 "does not support external modules (request: node:fs)"（实测踩到过）。
 *
 * 规则：**能在界面上出现的常量放这里；碰盘的东西留在 resources.ts。**
 */

export const RESOURCE_TYPES = [
  "paper",
  "tutorial",
  "docs",
  "repo",
  "video",
  "tool",
  "other",
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  paper: "论文",
  tutorial: "教程",
  docs: "文档",
  repo: "GitHub 仓库",
  video: "视频",
  tool: "工具",
  other: "其它",
};

export function isResourceType(value: unknown): value is ResourceType {
  return typeof value === "string" && (RESOURCE_TYPES as readonly string[]).includes(value);
}

export type ResourceSort = "updated" | "created" | "title";

export const RESOURCE_SORT_LABELS: Record<ResourceSort, string> = {
  updated: "最近更新",
  created: "最近添加",
  title: "按标题",
};

export function isResourceSort(value: unknown): value is ResourceSort {
  return value === "updated" || value === "created" || value === "title";
}
