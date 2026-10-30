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
  recoverPendingRestore,
  type RestoreFailure,
  type RestoreRecovery,
  type RestoreSuccess,
} from "@/lib/content/restore-store";
import { requireAuth } from "@/lib/security/auth";

/**
 * 备份/恢复的业务层（D4：页面与 action 不直接碰 backup-store/restore-store）。
 *
 * 这一层只做三件事：鉴权、参数形状、把底层的失败话术交给界面。
 * 真正的顺序（校验 → 快照 → 预检 → 写 → 回滚 → 恢复日志）在 lib/content/restore-store.ts，
 * 不在这里重新实现一遍。
 */

/** `/backup` 顶部那条「上次恢复没收尾」的提示（DATA-01） */
export type BackupRecoveryNotice = {
  tone: "ok" | "warn" | "error";
  message: string;
  detail: string | null;
};

export type BackupOverview = {
  backups: BackupListItem[];
  files: { total: number; notes: number; resources: number; tasks: number; trash: number };
  skipped: string[];
  contentRoot: string;
  backupsRoot: string;
  error: string | null;
  /** 本次进程里自动收尾的结果；没有待收尾的恢复时为 null */
  recovery: BackupRecoveryNotice | null;
};

export type BackupServiceFailure = { ok: false; error: string };

function fail(error: string): BackupServiceFailure {
  return { ok: false, error };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeRecovery(result: RestoreRecovery): BackupRecoveryNotice | null {
  if (result.state === "none") return null;

  if (result.state === "recovered") {
    return {
      tone: "warn",
      message: `上次恢复没有完成，已自动回到恢复前（快照 ${result.snapshot}）`,
      detail: "这是根据 backups/restore-journal.json 自动收尾的；那份快照仍在下面的列表里。",
    };
  }

  if (result.state === "already-complete") {
    return {
      tone: "ok",
      message: `上次恢复其实已经完成并通过校验，恢复日志已清理（快照 ${result.snapshot}）`,
      detail: "没有改动任何文件。",
    };
  }

  return {
    tone: "error",
    message:
      result.snapshot === null
        ? "恢复日志读不出来，已停下不动数据"
        : `上次恢复没有完成，自动回滚也失败；请在下面列表对 ${result.snapshot} 点「回滚」`,
    detail: result.error,
  };
}

/**
 * 每个进程只跑一次的启动恢复（DATA-01）。
 *
 * 为什么不放在 instrumentation.ts 的 register()：Next 16.4.3 的 register 在非 dev 的
 * server 实例上都会执行（构建期的静态生成 worker 也会），那等于在 build 里做文件回滚。
 * 任务卡允许的退路是「每进程第一次调用 loadBackupOverview / applyRestore 时执行一次」，
 * 这里就用模块级 Promise 做单次守卫。
 */
let recoveryOnce: Promise<void> | null = null;
let recoveryNotice: BackupRecoveryNotice | null = null;

async function recoverOnce(): Promise<void> {
  if (!recoveryOnce) {
    recoveryOnce = (async () => {
      try {
        recoveryNotice = describeRecovery(await recoverPendingRestore({}));
      } catch (error) {
        // 读日志/回滚本身抛异常（不是「返回失败」）：保留提示，允许下次请求再试一次
        recoveryOnce = null;
        recoveryNotice = {
          tone: "error",
          message: "检查上次恢复有没有收尾时出错，先不要执行恢复",
          detail: message(error),
        };
      }
    })();
  }
  await recoveryOnce;
}

export async function loadBackupOverview(): Promise<BackupOverview> {
  await requireAuth();
  // 先收尾，再扫描：这样页面上的「content 文件」看到的是回滚之后的状态
  await recoverOnce();

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
    recovery: recoveryNotice,
  };
}

export async function createBackupNow(): Promise<CreateBackupResult> {
  await requireAuth();
  await recoverOnce();
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
  await recoverOnce();
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
