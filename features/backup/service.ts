import {
  backupsRoot,
  contentFilesRoot,
  createBackup,
  listBackups,
  previewRestore,
  readBackupBytes,
  resolveBackupFile,
  scanContent,
  verifyBackupByName,
  type BackupListItem,
  type CreateBackupResult,
} from "@/lib/content/backup-store";
import { isBackupFileName, type RestorePlan } from "@/lib/content/backup-format";
import { countByKind } from "@/lib/content/backup-validate";
import {
  applyRestore,
  type RestoreFailure,
  type RestoreSuccess,
} from "@/lib/content/restore-store";
import { requireAuth } from "@/lib/security/auth";

/**
 * 备份/恢复的业务层（D4：页面与 action 不直接碰 backup-store/restore-store）。
 *
 * 这一层只做三件事：鉴权、参数形状、把底层的失败话术交给界面。
 * 真正的顺序（校验 → 快照 → 预检 → 写 → 回滚）在 lib/content/restore-store.ts，
 * 不在这里重新实现一遍。
 */

export type BackupOverview = {
  backups: BackupListItem[];
  files: { total: number; notes: number; resources: number; tasks: number; trash: number };
  skipped: string[];
  contentRoot: string;
  backupsRoot: string;
  error: string | null;
};

export type BackupServiceFailure = { ok: false; error: string };

function fail(error: string): BackupServiceFailure {
  return { ok: false, error };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadBackupOverview(): Promise<BackupOverview> {
  await requireAuth();

  let backups: BackupListItem[] = [];
  let files = { total: 0, notes: 0, resources: 0, tasks: 0, trash: 0 };
  let skipped: string[] = [];
  let error: string | null = null;

  try {
    backups = await listBackups();
  } catch (caught) {
    error = `读取备份列表失败：${message(caught)}`;
  }

  try {
    const scanned = await scanContent();
    const counts = countByKind(scanned.files.map((file) => file.meta));
    files = { total: scanned.files.length, ...counts };
    skipped = scanned.skipped;
  } catch (caught) {
    error = error ?? `扫描 content/ 失败：${message(caught)}`;
  }

  return {
    backups,
    files,
    skipped,
    contentRoot: contentFilesRoot(),
    backupsRoot: backupsRoot(),
    error,
  };
}

export async function createBackupNow(): Promise<CreateBackupResult> {
  await requireAuth();
  return createBackup({});
}

export async function verifyBackup(name: string) {
  await requireAuth();
  if (!isBackupFileName(name)) return fail("备份文件名不合法");
  return verifyBackupByName({ name });
}

export async function previewRestoreByName(
  name: string,
  includeDeletes: boolean,
): Promise<
  { ok: true; plan: RestorePlan; warnings: string[]; fileCount: number } | BackupServiceFailure
> {
  await requireAuth();
  if (!isBackupFileName(name)) return fail("备份文件名不合法");

  const preview = await previewRestore({ name, includeDeletes });
  if (!preview.ok) return preview;
  return {
    ok: true,
    plan: preview.plan,
    warnings: preview.warnings,
    fileCount: preview.manifest.files.length,
  };
}

export async function applyRestoreFromForm(input: {
  name: string;
  planHash: string;
  includeDeletes: boolean;
  confirm: string;
}): Promise<RestoreSuccess | RestoreFailure> {
  await requireAuth();
  if (!isBackupFileName(input.name)) {
    return { ok: false, reason: "invalid", error: "备份文件名不合法" };
  }
  return applyRestore(input);
}

/** 下载：只允许 backups/ 下、名字符合格式、不是链接的 zip */
export async function backupDownloadTarget(
  name: string,
): Promise<{ ok: true; path: string; name: string } | BackupServiceFailure> {
  await requireAuth();
  if (!isBackupFileName(name)) return fail("备份文件名不合法");

  const resolved = await resolveBackupFile(backupsRoot(), name);
  if (!resolved.ok) return resolved;
  return { ok: true, path: resolved.path, name };
}

/** Route Handler 用：鉴权 + 路径校验 + 读字节，三件事一次做完 */
export async function downloadBackup(
  name: string,
): Promise<{ ok: true; name: string; bytes: Buffer } | BackupServiceFailure> {
  const target = await backupDownloadTarget(name);
  if (!target.ok) return target;
  try {
    return { ok: true, name: target.name, bytes: await readBackupBytes(target.path) };
  } catch (error) {
    return fail(`读取备份失败：${message(error)}`);
  }
}
