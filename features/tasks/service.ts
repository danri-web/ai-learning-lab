import { z } from "zod";

import { isTaskStatus, type TaskStatus } from "@/lib/content/task-types";
import { isRealDate, summarizeTasks, type TaskSummary } from "@/lib/content/tasks";
import {
  createTask,
  deleteTask,
  updateTask,
  updateTaskStatus,
  type TaskInput,
  type StoreFailure,
} from "@/lib/content/tasks-store";
import { contentRoot, readTasks } from "@/lib/content/tasks";
import { isSafeArticleId } from "@/lib/security/article-id";

/**
 * 学习任务的业务规则层（阶段 6，同 D4：service 是**唯一决定"能不能写"**的地方）。
 *
 * 分工与笔记/资源一致：这一层管"用户填的东西合不合格 + 错误话术"，
 * 写入层（`lib/content/tasks-store.ts`）管文件安全、原子写、指纹冲突。
 */

export type TaskFields = {
  title: string;
  status: string;
  dueDate: string;
  note: string;
  articleIds: string[];
  resourceIds: string[];
};

export type ServiceResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      fieldErrors?: Record<string, string>;
      code?: "stale";
    };

const ID_LIST = z.array(z.string()).max(20);

const FIELDS = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(200, "标题最长 200 字"),
  status: z.string().refine(isTaskStatus, "状态只能是待办 / 进行中 / 已完成"),
  // 空字符串 = 没有截止日期（表单里不填就是空）
  dueDate: z
    .string()
    .trim()
    .refine((value) => value === "" || isRealDate(value), "截止日期要写成 YYYY-MM-DD 的真实日期"),
  note: z.string().max(500, "备注最长 500 字"),
  articleIds: ID_LIST.refine(
    (ids) => ids.every(isSafeArticleId),
    "关联笔记的 id 不合法（是不是被别的程序改过表单？）",
  ),
  resourceIds: ID_LIST.refine(
    (ids) => ids.every(isSafeArticleId),
    "关联资源的 id 不合法（是不是被别的程序改过表单？）",
  ),
});

/** 把校验通过的字段变成写入层要的形状 */
function toInput(fields: TaskFields): TaskInput {
  const parsed = FIELDS.parse(fields);
  return {
    title: parsed.title,
    status: parsed.status as TaskStatus,
    dueDate: parsed.dueDate === "" ? undefined : parsed.dueDate,
    note: parsed.note,
    articleIds: parsed.articleIds,
    resourceIds: parsed.resourceIds,
  };
}

function fromStoreError(failure: StoreFailure): ServiceResult<never> {
  return {
    ok: false,
    error: failure.error,
    ...(failure.reason === "stale" ? { code: "stale" as const } : {}),
  };
}

/** zod 的 issues → 字段名 ↔ 错误话术（表单里那句红字就靠它） */
function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export async function createTaskFromFields(fields: TaskFields): Promise<ServiceResult<{ id: string }>> {
  const checked = FIELDS.safeParse(fields);
  if (!checked.success) {
    return {
      ok: false,
      error: "表单里有不合规的内容（下面标出来了）",
      fieldErrors: fieldErrorsOf(checked.error),
    };
  }

  const result = await createTask(toInput(fields), { root: contentRoot() });
  if (!result.ok) return fromStoreError(result);
  return { ok: true, data: { id: result.id } };
}

export async function updateTaskFromFields(
  id: string,
  fields: TaskFields,
  options: { base?: string; force?: boolean } = {},
): Promise<ServiceResult<{ id: string }>> {
  if (!isSafeArticleId(id)) return { ok: false, error: `任务 id 不合法：${id}` };

  const checked = FIELDS.safeParse(fields);
  if (!checked.success) {
    return {
      ok: false,
      error: "表单里有不合规的内容（下面标出来了）",
      fieldErrors: fieldErrorsOf(checked.error),
    };
  }

  const result = await updateTask(id, toInput(fields), {
    root: contentRoot(),
    expectRevision: options.base,
    force: options.force,
  });
  if (!result.ok) return fromStoreError(result);
  return { ok: true, data: { id: result.id } };
}

export async function deleteTaskById(id: string): Promise<ServiceResult<{ id: string }>> {
  if (!isSafeArticleId(id)) return { ok: false, error: `任务 id 不合法：${id}` };
  const result = await deleteTask(id, { root: contentRoot() });
  if (!result.ok) return fromStoreError(result);
  return { ok: true, data: { id: result.id } };
}

export async function setTaskStatus(id: string, status: string): Promise<ServiceResult<{ id: string }>> {
  if (!isSafeArticleId(id)) return { ok: false, error: `任务 id 不合法：${id}` };
  if (!isTaskStatus(status)) return { ok: false, error: "状态只能是待办 / 进行中 / 已完成" };

  const result = await updateTaskStatus(id, status, { root: contentRoot() });
  if (!result.ok) return fromStoreError(result);
  return { ok: true, data: { id: result.id } };
}

/** 总览页与任务页共用一份统计口径（纯函数在 lib/content/tasks.ts） */
export async function loadTaskSummary(today: string): Promise<ServiceResult<TaskSummary>> {
  const { tasks, problem } = await readTasks();
  if (problem) return { ok: false, error: problem };
  return { ok: true, data: summarizeTasks(tasks, today) };
}
