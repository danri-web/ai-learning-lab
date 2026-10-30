"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createArticleFromFields,
  deleteArticleById,
  saveArticleFromFields,
} from "@/features/articles/service";
import type { FormState } from "@/features/articles/form-state";

/**
 * Server Action 层（docs/架构决策.md D4）：**只做三件事** ——
 * 把 FormData 取成普通字段、调 service、跳转/刷新。
 *
 * 不在这里写业务规则，也不在这里碰文件系统：
 *   - 规则在 features/articles/service.ts
 *   - 文件在 lib/content/write.ts
 * 这样将来加 CLI 或 Route Handler，换的只是这一层。
 *
 * CSRF：Next 的 Server Action 内建 Origin/Host 校验（需求书 §8 的要求），不需要自己写 token。
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readFields(formData: FormData) {
  return {
    title: text(formData, "title"),
    category: text(formData, "category"),
    tags: text(formData, "tags"),
    body: text(formData, "body"),
  };
}

function toErrorState(error: string, fieldErrors?: Record<string, string>): FormState {
  return { status: "error", error, ...(fieldErrors ? { fieldErrors } : {}) };
}

/** 新建 → 成功后直接进详情页（保存失败则留在编辑器，字段不丢） */
export async function createArticleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await createArticleFromFields(readFields(formData));
  if (!result.ok) return toErrorState(result.error, result.fieldErrors);

  revalidatePath("/knowledge");
  redirect(`/knowledge/${encodeURIComponent(result.data.id)}`);
}

/** 保存 → 成功后回详情页看渲染结果 */
export async function saveArticleAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = text(formData, "id");
  const result = await saveArticleFromFields(id, readFields(formData));
  if (!result.ok) return toErrorState(result.error, result.fieldErrors);

  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${id}`);
  redirect(`/knowledge/${encodeURIComponent(id)}`);
}

/** 删除 → 文件进 `.trash/`（可恢复），列表页刷新 */
export async function deleteArticleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = text(formData, "id");
  const result = await deleteArticleById(id);
  if (!result.ok) return toErrorState(result.error);

  revalidatePath("/knowledge");
  redirect("/knowledge");
}
