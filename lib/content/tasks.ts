import { promises as fs } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { revisionOf } from "@/lib/content/revision";
import { stripBom } from "@/lib/content/encoding";
import {
  TASK_STATUSES,
  isTaskStatus,
  type TaskStatus,
} from "@/lib/content/task-types";
import { ARTICLE_ID_MESSAGE, ARTICLE_ID_REGEX_SOURCE } from "@/lib/security/article-id";

export { TASK_STATUSES, isTaskStatus, type TaskStatus };

/**
 * 学习任务的**读**与数据结构（阶段 6）。
 *
 * 存储决定见 ADR D11（D9 的同款）：所有任务放一个 `content/tasks.json`，
 * `{ version: 1, tasks: [...] }`。文件是真相（D1），主仓库 gitignore，跟笔记一起进那个私有仓库。
 *
 * 一条任务长这样：
 *   { id, title, status, dueDate?, note, articleIds[], resourceIds[], createdAt, updatedAt }
 *
 * 为什么关联是**数组**：一个任务常常要看好几篇笔记 + 几份资料（"学 Transformer Attention"
 * 就是论文 + 教程 + 自己那篇笔记）。需求书 §7 阶段 6 的原话是"文章和资源关联"。
 * 关联是**逻辑关联**（只存 id，不校验对方还在不在）—— 同 D9，断了就是列表上一条提示。
 */

export const TASKS_FILE_NAME = "tasks.json";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 排除 `2026-02-30` 这种"格式对但不存在"的日期 */
export function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const ID = new RegExp(ARTICLE_ID_REGEX_SOURCE, "u");
const ID_MESSAGE = `文章/资源文件名规则：${ARTICLE_ID_MESSAGE}`;

export const taskSchema = z.object({
  id: z.string().regex(ID, ID_MESSAGE),
  title: z.string().trim().min(1, "标题不能为空").max(200, "标题最长 200 字"),
  status: z.string().refine(isTaskStatus, "状态只能是待办 / 进行中 / 已完成"),
  /** 截止日期可选：没有截止日期的任务不是坏任务 */
  dueDate: z
    .string()
    .refine(isRealDate, "截止日期要写成 YYYY-MM-DD，而且是真实存在的日期")
    .optional(),
  note: z.string().max(500, "备注最长 500 字").default(""),
  articleIds: z.array(z.string().regex(ID, ID_MESSAGE)).max(20, "最多关联 20 篇笔记").default([]),
  resourceIds: z.array(z.string().regex(ID, ID_MESSAGE)).max(20, "最多关联 20 条资源").default([]),
  createdAt: z.string().regex(DATE, "createdAt 必须是 YYYY-MM-DD"),
  updatedAt: z.string().regex(DATE, "updatedAt 必须是 YYYY-MM-DD"),
}).refine((value) => value.updatedAt >= value.createdAt, {
  message: "updatedAt 不能早于 createdAt",
  path: ["updatedAt"],
});

export type Task = z.infer<typeof taskSchema>;

export const taskFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema),
});

/** 单条任务的指纹：编辑页带着它回来，保存前比对（同笔记/资源的 D8） */
export function taskRevision(task: Task): string {
  return revisionOf(JSON.stringify(task));
}

/** 内容目录（`content/`）。字面量写死：Turbopack 不吃"用变量拼路径" */
export function contentRoot(): string {
  return path.join(process.cwd(), "content");
}

export function tasksFile(root = contentRoot()): string {
  return path.join(root, TASKS_FILE_NAME);
}

export type TaskList = {
  tasks: Task[];
  /** 文件读不出来时的原因（不是 null 就说明现在不能写入） */
  problem: string | null;
  missing: boolean;
  fileRevision: string;
};

export async function readTasks(root = contentRoot()): Promise<TaskList> {
  let source: string;
  try {
    source = await fs.readFile(/*turbopackIgnore: true*/ tasksFile(root), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { tasks: [], problem: null, missing: true, fileRevision: revisionOf("") };
    }
    return {
      tasks: [],
      problem: `tasks.json 读取失败：${(error as Error).message}`,
      missing: false,
      fileRevision: revisionOf(""),
    };
  }

  try {
    const parsed = taskFileSchema.safeParse(JSON.parse(stripBom(source)));
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "根"}：${issue.message}`)
        .join("；");
      return {
        tasks: [],
        problem: `tasks.json 结构不对：${detail}`,
        missing: false,
        fileRevision: revisionOf(source),
      };
    }
    return {
      tasks: parsed.data.tasks,
      problem: null,
      missing: false,
      fileRevision: revisionOf(source),
    };
  } catch (error) {
    return {
      tasks: [],
      problem: `tasks.json 不是合法 JSON：${(error as Error).message}`,
      missing: false,
      fileRevision: revisionOf(source),
    };
  }
}

/* ────────────────────────── 纯函数：筛选 / 排序 / 逾期 ────────────────────────── */

export type TaskSort = "due" | "updated" | "created";

export const TASK_SORT_LABELS: Record<TaskSort, string> = {
  due: "按截止日期",
  updated: "最近更新",
  created: "最近添加",
};

export function isTaskSort(value: unknown): value is TaskSort {
  return value === "due" || value === "updated" || value === "created";
}

export function filterTasks(tasks: Task[], filter: { status?: TaskStatus }): Task[] {
  return filter.status ? tasks.filter((task) => task.status === filter.status) : tasks;
}

/** 两个 `YYYY-MM-DD` 相差几天（用 UTC 算，避免夏令时把"差一天"算成"差 0.96 天"） */
export function daysBetween(from: string, to: string): number {
  const parse = (value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

export type DueTone = "none" | "normal" | "soon" | "overdue";

/**
 * 截止日期怎么说人话。
 * **已完成的任务不喊逾期** —— 一件已经做完的事，日期过了不是问题。
 */
export function dueInfo(
  task: Pick<Task, "dueDate" | "status">,
  today: string,
): { text: string; tone: DueTone } {
  if (!task.dueDate) return { text: "没有截止日期", tone: "none" };
  if (task.status === "done") return { text: `截止 ${task.dueDate}`, tone: "normal" };

  const left = daysBetween(today, task.dueDate);
  if (left < 0) return { text: `逾期 ${-left} 天`, tone: "overdue" };
  if (left === 0) return { text: "今天到期", tone: "soon" };
  if (left <= 3) return { text: `还剩 ${left} 天`, tone: "soon" };
  return { text: `截止 ${task.dueDate}`, tone: "normal" };
}

export function isOverdue(task: Pick<Task, "dueDate" | "status">, today: string): boolean {
  return dueInfo(task, today).tone === "overdue";
}

/**
 * 排序。
 * - `due`：**没截止日期的排在有日期的后面**（有期限的先看），已完成的沉底；
 * - 其余按对应字段倒序。
 * 任何排序都用 id 兜底，保证同样的数据每次顺序一样（否则列表会在两次渲染间"跳"）。
 */
export function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  const byId = (a: Task, b: Task) => a.id.localeCompare(b.id);
  const copy = [...tasks];

  if (sort === "created") {
    return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byId(a, b));
  }
  if (sort === "updated") {
    return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || byId(a, b));
  }
  return copy.sort((a, b) => {
    const doneA = a.status === "done" ? 1 : 0;
    const doneB = b.status === "done" ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate) || byId(a, b);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.updatedAt.localeCompare(a.updatedAt) || byId(a, b);
  });
}

export type TaskSummary = {
  total: number;
  todo: number;
  doing: number;
  done: number;
  overdue: number;
};

/** 统计口径写在一处：总览页和任务页的 chips 用同一份数字，不各算各的 */
export function summarizeTasks(tasks: Task[], today: string): TaskSummary {
  const summary: TaskSummary = { total: tasks.length, todo: 0, doing: 0, done: 0, overdue: 0 };
  for (const task of tasks) {
    summary[task.status] += 1;
    if (isOverdue(task, today)) summary.overdue += 1;
  }
  return summary;
}
