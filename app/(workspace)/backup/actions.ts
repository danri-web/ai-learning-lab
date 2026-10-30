"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  applyRestoreFromForm,
  createBackupNow,
  discardRestoreJournal,
  pruneBackupsNow,
  pruneTrashNow,
  verifyBackup,
} from "@/features/backup/service";
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

/**
 * 「放弃这次恢复日志」：只在自动回滚失败、快照找不回来时用。
 * 删除后不再自动回滚，写入闸门解除（v2 审计 V2-DATA-01）。
 */
export async function discardRestoreJournalAction(formData: FormData): Promise<void> {
  await requireAuth();
  if (text(formData, "confirmDiscard") !== "删除") {
    redirect(errorPath("/backup", "输入「删除」两个字再确认"));
  }

  const result = await discardRestoreJournal();
  if (!result.ok) redirect(errorPath("/backup", result.error));

  revalidatePath("/backup");
  revalidatePath("/settings");
  redirect("/backup?journal=discarded");
}

/**
 * 清理旧备份（P1）：只删 `ai-lab-*.zip` 里第 11 份及更老的。
 * 失败逐项报：部分成功时回到预览页，把删了几份、哪几份没删掉写进红字提示。
 */
export async function pruneBackupsAction(formData: FormData): Promise<void> {
  await requireAuth();
  const result = await pruneBackupsNow({
    planHash: text(formData, "planHash"),
    confirm: text(formData, "confirm"),
  });
  if (!result.ok) redirect(errorPath("/backup?prune=backups", result.error));

  revalidatePath("/backup");
  revalidatePath("/settings");

  if (result.failed.length > 0) {
    const summary = `已删 ${result.removed.length} 份；没删掉 ${result.failed.length} 份：${result.failed
      .slice(0, 5)
      .map((item) => `${item.name}（${item.error}）`)
      .join("；")}`;
    redirect(
      errorPath(
        `/backup?prune=backups&pruned=backups&removed=${result.removed.length}&failed=${result.failed.length}`,
        summary,
      ),
    );
  }

  redirect(`/backup?pruned=backups&removed=${result.removed.length}&failed=0`);
}

/** 清理回收站（P1）：90 天前的笔记 / JSONL 行 / restore-* 副本；确认与预览同一条链路 */
export async function pruneTrashAction(formData: FormData): Promise<void> {
  await requireAuth();
  const result = await pruneTrashNow({
    planHash: text(formData, "planHash"),
    confirm: text(formData, "confirm"),
  });
  if (!result.ok) redirect(errorPath("/backup?prune=trash", result.error));

  revalidatePath("/", "layout");

  if (result.failed.length > 0) {
    const summary = `已删 ${result.removed.length} 项；没删掉 ${result.failed.length} 项：${result.failed
      .slice(0, 5)
      .map((item) => `${item.path}（${item.error}）`)
      .join("；")}`;
    redirect(
      errorPath(
        `/backup?prune=trash&pruned=trash&removed=${result.removed.length}&failed=${result.failed.length}`,
        summary,
      ),
    );
  }

  redirect(`/backup?pruned=trash&removed=${result.removed.length}&failed=0`);
}
