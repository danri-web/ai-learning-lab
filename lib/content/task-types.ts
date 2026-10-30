/**
 * 学习任务的三档状态（阶段 6）。**纯常量，客户端也能 import** ——
 * 别把常量和碰 `node:fs` 的模块放一起（阶段 4 踩过：客户端 import 到 fs，Turbopack 直接构建失败）。
 *
 * 只有三档，是需求书 §7 明确写的"不要做：甘特图、复杂项目管理、AI 排课"。
 */

export const TASK_STATUSES = ["todo", "doing", "done"] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

/** 列表上的状态圆点（用设计令牌，不写死颜色） */
export const TASK_STATUS_DOTS: Record<TaskStatus, string> = {
  todo: "bg-muted-foreground",
  doing: "bg-warning",
  done: "bg-success",
};

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}
