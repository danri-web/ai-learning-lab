"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ResourceFormState } from "@/features/resources/form-state";
import {
  createResourceFromFields,
  deleteResourceById,
  updateResourceFromFields,
} from "@/features/resources/service";

/**
 * 资源收藏的 Server Action 层：只做 FormData → 普通对象 + 刷新/跳转。
 * 规则在 `features/resources/service.ts`，文件在 `lib/content/resources-store.ts`。
 *
 * `base` / `force` 与笔记一致（D8）：编辑器带指纹回来，对不上就拒绝；用户点「仍然覆盖」才带 force=1。
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readFields(formData: FormData) {
  return {
    title: text(formData, "title"),
    url: text(formData, "url"),
    type: text(formData, "type"),
    category: text(formData, "category"),
    tags: text(formData, "tags"),
    description: text(formData, "description"),
    articleId: text(formData, "articleId"),
  };
}

function toErrorState(
  error: string,
  fieldErrors?: Record<string, string>,
  code?: "stale",
): ResourceFormState {
  return {
    status: "error",
    error,
    ...(fieldErrors ? { fieldErrors } : {}),
    ...(code ? { code } : {}),
  };
}

export async function createResourceAction(
  _prev: ResourceFormState,
  formData: FormData,
): Promise<ResourceFormState> {
  const result = await createResourceFromFields(readFields(formData));
  if (!result.ok) return toErrorState(result.error, result.fieldErrors);

  revalidatePath("/resources");
  redirect("/resources");
}

export async function updateResourceAction(
  _prev: ResourceFormState,
  formData: FormData,
): Promise<ResourceFormState> {
  const id = text(formData, "id");
  const result = await updateResourceFromFields(id, readFields(formData), {
    base: text(formData, "base") || undefined,
    force: text(formData, "force") === "1",
  });
  if (!result.ok) return toErrorState(result.error, result.fieldErrors, result.code);

  revalidatePath("/resources");
  redirect("/resources");
}

export async function deleteResourceAction(
  _prev: ResourceFormState,
  formData: FormData,
): Promise<ResourceFormState> {
  const result = await deleteResourceById(text(formData, "id"));
  if (!result.ok) return toErrorState(result.error);

  revalidatePath("/resources");
  redirect("/resources");
}
