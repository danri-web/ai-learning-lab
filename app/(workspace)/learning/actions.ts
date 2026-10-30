"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { TaskFormState } from "@/features/tasks/form-state";
import {
  createTaskFromFields,
  deleteTaskById,
  setTaskStatus,
  updateTaskFromFields,
  type TaskFields,
} from "@/features/tasks/service";

/**
 * 学习任务的 Server Action 层：只做 FormData → 普通对象 + 刷新/跳转。
 * 规则在 `features/tasks/service.ts`，文件在 `lib/content/tasks-store.ts`。
 *
 * `base` / `force` 与笔记、资源一致（D8）：编辑页带指纹回来，对不上就拒绝；
 * 用户点「仍然覆盖」才带 force=1。
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readFields(formData: FormData): TaskFields {
  return {
    title: text(formData, "title"),
    status: text(formData, "status"),
    dueDate: text(formData, "dueDate"),
    note: text(formData, "note"),
    articleIds: formData.getAll("articleIds").filter((value): value is string => typeof value === "string"),
    resourceIds: formData
      .getAll("resourceIds")
      .filter((value): value is string => typeof value === "string"),
  };
}

function toErrorState(
  error: string,
  fieldErrors?: Record<string, string>,
  code?: "stale",
): TaskFormState {
  return {
    status: "error",
    error,
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(code ? { code } : {}),
  };
}

export async function createTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const result = await createTaskFromFields(readFields(formData));
  if (!result.ok) return toErrorState(result.error, result.fieldErrors);

  revalidatePath("/learning");
  revalidatePath("/");
  redirect("/learning");
}

export async function updateTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const id = text(formData, "id");
  const result = await updateTaskFromFields(id, readFields(formData), {
    base: text(formData, "base") || undefined,
    force: text(formData, "force") === "1",
  });
  if (!result.ok) return toErrorState(result.error, result.fieldErrors, result.code);

  revalidatePath("/learning");
  revalidatePath("/");
  redirect("/learning");
}

export async function deleteTaskAction(
  _prev: TaskFormState,
  formData: FormData,
): Promise<TaskFormState> {
  const result = await deleteTaskById(text(formData, "id"));
  if (!result.ok) return toErrorState(result.error);

  revalidatePath("/learning");
  revalidatePath("/");
  redirect("/learning");
}

/**
 * 列表上点状态圆点就能改状态（不用进编辑页）。
 * 返回结果而不是 redirect：用户在列表上连点几下时，页面不该跳走。
 */
export async function setTaskStatusAction(
  id: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await setTaskStatus(id, status);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath("/learning");
  revalidatePath("/");
  return { ok: true };
}
