"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { applyRestoreFromForm, createBackupNow, verifyBackup } from "@/features/backup/service";
import { requireAuth } from "@/lib/security/auth";

/**
 * 备份页的 Server Action：只做 FormData → 普通对象 + 跳转。
 * 顺序（校验 → 快照 → 预检 → 写 → 回滚）在 lib/content/restore-store.ts。
 *
 * 每个 action 开头都再 `requireAuth()` 一次：proxy 是第一道，这里是第三道。
 */

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function errorPath(base: string, error: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.slice(0, 300))}`;
}

export async function createBackupAction(): Promise<void> {
  await requireAuth();
  const result = await createBackupNow();
  if (!result.ok) redirect(errorPath("/backup", result.error));

  revalidatePath("/backup");
  revalidatePath("/settings");
  redirect(`/backup?created=${encodeURIComponent(result.name)}`);
}

export async function verifyBackupAction(formData: FormData): Promise<void> {
  await requireAuth();
  const name = text(formData, "name");
  const result = await verifyBackup(name);
  if (!result.ok) redirect(errorPath(`/backup?restore=${encodeURIComponent(name)}`, result.error));

  revalidatePath("/backup");
  redirect(`/backup?verified=${encodeURIComponent(name)}`);
}

export async function applyRestoreAction(formData: FormData): Promise<void> {
  await requireAuth();

  const name = text(formData, "name");
  const planHash = text(formData, "planHash");
  const includeDeletes = text(formData, "includeDeletes") === "1";
  const confirm = text(formData, "confirm");

  const result = await applyRestoreFromForm({ name, planHash, includeDeletes, confirm });
  if (!result.ok) {
    const base = `/backup?restore=${encodeURIComponent(name)}&includeDeletes=${
      includeDeletes ? "1" : "0"
    }`;
    redirect(errorPath(base, result.error));
  }

  // 恢复动的是整个 content/：所有读它的页面都要刷新
  revalidatePath("/", "layout");
  redirect(
    `/backup?restored=${encodeURIComponent(result.snapshotName)}&deleted=${result.plan.counts.deleted}`,
  );
}
