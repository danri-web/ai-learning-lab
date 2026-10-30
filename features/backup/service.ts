import {
  backupsRoot,
  contentFilesRoot,
  createBackup,
  listBackups,
  previewBackupPrune,
  previewRestore,
  pruneBackups,
  readBackupBytes,
  resolveBackupFile,
  scanContent,
  verifyBackupByName,
  type BackupListItem,
  type BackupPruneFailure,
  type BackupPrunePreview,
  type BackupPruneResult,
  type CreateBackupResult,
} from "@/lib/content/backup-store";
import { isBackupFileName, type RestorePlan } from "@/lib/content/backup-format";
import { countByKind } from "@/lib/content/backup-validate";
import { restoreJournalPath } from "@/lib/content/restore-journal";
import { startupRecovery } from "@/lib/content/restore-startup";
import {
  applyRestore,
  discardPendingRestore,
  recoverPendingRestore,
  type RestoreFailure,
  type RestoreRecovery,
  type RestoreSuccess,
} from "@/lib/content/restore-store";
import {
  applyTrashCleanup,
  previewTrashCleanup,
  type TrashCleanupFailure,
  type TrashCleanupResult,
  type TrashPreview,
} from "@/lib/content/trash-store";
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
        : `上次恢复没有完成，自动回滚也失败（快照 ${result.snapshot}）`,
    detail: result.error,
  };
}

/**
 * 恢复检查（v2/v3b/v3c 复核）。
 *
 * 正常路径是 `instrumentation.ts` 在进程启动时先收尾（Next 自己跳过 build 阶段）；
 * 这里每次打开 /backup、建备份、预览、恢复都**现读一次 journal** —— 只缓存“正在进行的检查”，
 * 不缓存结果。v3c 复核给的反例：先检查到“没有日志”（成功），之后恢复失败留下 `applying`，
 * 如果成功被缓存，页面会一直报 null、放弃入口不出现。现在结果不缓存，下一次请求就能看到。
 *
 * 启动提示单独存：instrumentation 收尾后日志已经没了，现读只能是 none，
 * 所以“已自动回滚”那条提示要保留，直到本次进程里又发生一次真实的收尾或用户放弃日志。
 *
 * 所有路径都走 `serialize`，不会和正文写入交错。
 */
let recoveryInFlight: Promise<void> | null = null;
let startupNotice: BackupRecoveryNotice | null = null;
let startupNoticeRead = false;
let currentNotice: BackupRecoveryNotice | null = null;

function readStartupNotice(): BackupRecoveryNotice | null {
  if (!startupNoticeRead) {
    startupNoticeRead = true;
    const startup = startupRecovery();
    if (startup && (startup.state === "recovered" || startup.state === "already-complete")) {
      startupNotice = describeRecovery(startup);
    }
  }
  return startupNotice;
}

/**
 * 让启动提示永久失效（v3d 复核：只把 startupNotice 置 null 不够）。
 * 必须同时把 startupNoticeRead 置真，否则下一次 readStartupNotice 会从 globalThis
 * 把旧的启动结果重新读回来 —— 旧提示在“新恢复成功后”又冒出来。
 */
function clearStartupNotice(): void {
  startupNotice = null;
  startupNoticeRead = true;
}

async function refreshRecovery(): Promise<void> {
  // 只合并“同时发生的检查”：并发请求共用一次 IO，检查完就清掉，下一次重新读日志
  if (recoveryInFlight) return recoveryInFlight;

  recoveryInFlight = (async () => {
    try {
      const result = await recoverPendingRestore({});
      currentNotice = describeRecovery(result);
      // 本次真的收尾了，启动提示就过期
      if (result.state === "recovered" || result.state === "already-complete") {
        clearStartupNotice();
      }
    } catch (error) {
      // 读日志/回滚本身抛异常：保留错误提示，下一次请求会重新检查
      currentNotice = {
        tone: "error",
        message: "检查上次恢复有没有收尾时出错，先不要执行恢复",
        detail: message(error),
      };
    } finally {
      recoveryInFlight = null;
    }
  })();

  return recoveryInFlight;
}

/** 恢复没收尾时，建备份/预览/恢复都先拒绝（v2 审计：以前会顺着混合状态继续做） */
function recoveryBlocked(): string | null {
  if (currentNotice?.tone !== "error") return null;
  return `上次恢复没有收尾，先处理它再继续：${currentNotice.message}`;
}

export async function loadBackupOverview(): Promise<BackupOverview> {
  await requireAuth();
  // 先收尾，再扫描：这样页面上的「content 文件」看到的是回滚之后的状态
  await refreshRecovery();

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
    recovery: currentNotice ?? readStartupNotice(),
  };
}

export async function createBackupNow(): Promise<CreateBackupResult> {
  await requireAuth();
  await refreshRecovery();
  const blocked = recoveryBlocked();
  if (blocked) return { ok: false, error: blocked };
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
  await refreshRecovery();
  const blocked = recoveryBlocked();
  if (blocked) return fail(blocked);
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
  await refreshRecovery();
  const blocked = recoveryBlocked();
  if (blocked) return { ok: false, reason: "io", error: blocked };

  const result = await applyRestore(input);
  // 这次恢复自己写了一份新日志并收尾：启动提示不再成立（clearStartupNotice 会标记“已消费”，
  // 防止下一次 overview 从 globalThis 把旧提示读回来）。
  // 失败时保留（下一次 overview 会现读日志，把真实状态显示出来）。
  if (result.ok) {
    clearStartupNotice();
    currentNotice = null;
  }
  return result;
}

/**
 * 放弃恢复日志（v2 审计 V2-DATA-01 的出口）。
 *
 * 只在「自动回滚失败 / 日志读不出来」时需要：快照找不回来时，按正常流程永远收不了尾，
 * 写入闸门会一直挡着。这里让用户显式确认后删掉日志，接受当前 content/ 的状态。
 * 删除本身失败就如实报错 —— 不要假装放弃成功。
 *
 * 走 `discardPendingRestore()`：它和恢复共用 `serialize`，不会在恢复进行到一半时插队删日志
 * （v3b 复核指出旧实现没有排队）。
 */
export async function discardRestoreJournal(): Promise<{ ok: true } | BackupServiceFailure> {
  await requireAuth();
  const backupsDir = backupsRoot();
  const cleared = await discardPendingRestore(backupsDir);
  if (!cleared.ok) {
    return fail(
      `删不掉恢复日志（${cleared.error}）。请手动删除 ${restoreJournalPath(backupsDir)} 后再试。`,
    );
  }

  // 日志已经删掉：当前提示与启动提示都清掉，页面回到正常状态；
  // 下一次 refresh 会重新读日志（应该得到 none）
  currentNotice = null;
  clearStartupNotice();
  recoveryInFlight = null;
  return { ok: true };
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

/* ────────────────────────── P1：清理（备份保留 + 回收站） ────────────────────────── */

/**
 * 清理旧备份：预览只读；执行在 backup-store 里走 `serialize` + journal 闸门 + 重算 + planHash。
 * 这两层都再检查一次 `requireAuth()` / `refreshRecovery()`，和建备份、恢复保持同一套顺序。
 */
export async function loadBackupPrunePreview(): Promise<
  BackupPrunePreview | BackupPruneFailure
> {
  await requireAuth();
  await refreshRecovery();
  const blocked = recoveryBlocked();
  if (blocked) return { ok: false, reason: "blocked", error: blocked };
  return previewBackupPrune({});
}

export async function pruneBackupsNow(input: {
  planHash: string;
  confirm: string;
}): Promise<BackupPruneResult> {
  await requireAuth();
  await refreshRecovery();
  const blocked = recoveryBlocked();
  if (blocked) return { ok: false, reason: "blocked", error: blocked };
  return pruneBackups(input);
}

export async function loadTrashCleanupPreview(): Promise<TrashPreview | TrashCleanupFailure> {
  await requireAuth();
  await refreshRecovery();
  const blocked = recoveryBlocked();
  if (blocked) return { ok: false, reason: "blocked", error: blocked };
  return previewTrashCleanup({});
}

export async function pruneTrashNow(input: {
  planHash: string;
  confirm: string;
}): Promise<TrashCleanupResult> {
  await requireAuth();
  await refreshRecovery();
  const blocked = recoveryBlocked();
  if (blocked) return { ok: false, reason: "blocked", error: blocked };
  return applyTrashCleanup(input);
}

// 页面/组件只从 service 拿类型，不直接 import 带 fs 的模块（源码闸门守着）
export type {
  BackupPruneFailure,
  BackupPrunePreview,
  BackupPruneResult,
  TrashCleanupFailure,
  TrashCleanupResult,
  TrashPreview,
};
