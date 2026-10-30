import { promises as fs } from "node:fs";
import path from "node:path";

import {
  RESTORE_CONFIRM_TEXT,
  computeRestorePlan,
  type BackupManifest,
  type RestoreCounts,
  type RestorePlan,
} from "@/lib/content/backup-format";
import {
  backupsRoot,
  contentFilesRoot,
  createBackupUnlocked,
  loadVerifiedBackup,
  resolveBackupFile,
  scanContent,
  verifyContentMatchesBackup,
  type VerifiedBackup,
} from "@/lib/content/backup-store";
import { checkBackupPayload } from "@/lib/content/backup-validate";
import { formatLocalStamp } from "@/lib/content/clock";
import {
  RESTORE_JOURNAL_VERSION,
  clearRestoreJournal,
  readRestoreJournal,
  restoreJournalPath,
  writeRestoreJournal,
  type RestoreJournal,
} from "@/lib/content/restore-journal";
import type { RestoreRecovery } from "@/lib/content/restore-types";
import { writeFileAtomic } from "@/lib/fs/atomic-write";
import { serialize } from "@/lib/fs/mutex";
import { contentPathForEntry } from "@/lib/security/backup-entry";

/**
 * 恢复（阶段 7）—— 本项目最危险的一段代码，顺序不能改：
 *
 *   1. 校验备份（manifest + 每个 sha256 + JSON 能不能读）
 *   2. 重新算 diff，与用户确认时的 `planHash` 比对（防「预览 A、确认 B」）
 *   3. **先把当前 content/ 另存成 pre-restore-*.zip 并自检**
 *   4. 预检所有目标（父目录不能是链接、目标不能是链接/目录）
 *   5. 原子写入新增/覆盖；需要删除的移进 `content/.trash/restore-<时间>/`（不是真删）
 *   6. 写完重扫，与备份逐文件比 sha256；不一致 / 中途出错 → 用第 3 步的快照自动回滚
 *
 * 「坏备份不该毁掉现有数据」在这里落成三条可验证的承诺：
 *   - 备份本身坏（哈希/zip/JSON）→ 在写任何文件之前就拒绝
 *   - 写了一半失败 → 自动回滚，且回滚也失败时明确告诉用户快照在哪
 *   - 删除不勾选时，备份里没有的文件一个都不动
 *
 * 并发：整个恢复过程走 `serialize`（D8 的同一把锁），不会和笔记/资源/任务的写入交错。
 */

export { RESTORE_CONFIRM_TEXT };

export type RestoreFailureReason = "invalid" | "verify" | "stale" | "confirm" | "io";

export type RestoreFailure = {
  ok: false;
  reason: RestoreFailureReason;
  error: string;
  /** stale 时带上新算出来的计划，界面可以直接重新展示 */
  plan?: RestorePlan;
};

export type RestoreSuccess = {
  ok: true;
  snapshotName: string;
  snapshotPath: string;
  /** 删除的文件被挪到了哪个目录（没删除时是 null） */
  deletedTo: string | null;
  plan: RestorePlan;
  warnings: string[];
  manifest: BackupManifest;
};

/**
 * 上一次恢复留下的日志（DATA-01）。启动时/下一次恢复前用它决定：
 * 自动回滚、只清日志，还是 fail closed。
 * 类型放在 restore-types.ts：源码闸门不允许其它模块 import 本文件（连类型也算）。
 */
export type { RestoreRecovery } from "@/lib/content/restore-types";

class PreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreflightError";
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function ensureSafeDirectory(dir: string): Promise<void> {
  const stat = await fs.lstat(/*turbopackIgnore: true*/ dir).catch(() => null);
  if (!stat) {
    await fs.mkdir(dir, { recursive: true });
    return;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PreflightError(`目录不是普通目录（可能是 junction/symlink）：${dir}`);
  }
}

/**
 * 目标路径的物理预检：从 content/ 往下逐段确认目录是普通目录，目标本身不能是链接/目录。
 * 只做检查与建目录，不写文件内容。
 */
async function ensureSafeTarget(root: string, target: string): Promise<void> {
  const rootAbs = path.resolve(root);
  await ensureSafeDirectory(rootAbs);

  const relative = path.relative(rootAbs, path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.length === 0) {
    throw new PreflightError(`目标路径跑出了 content/：${target}`);
  }

  let current = rootAbs;
  const segments = relative.split(path.sep);
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    await ensureSafeDirectory(current);
  }

  const stat = await fs.lstat(/*turbopackIgnore: true*/ target).catch(() => null);
  if (stat?.isSymbolicLink()) throw new PreflightError(`目标是链接，拒绝覆盖：${target}`);
  if (stat?.isDirectory()) throw new PreflightError(`目标是目录，拒绝覆盖：${target}`);
}

/** 删除 = 挪进恢复自己的回收站；同卷 rename 失败时退回复制 + 删除 */
async function moveToTrash(target: string, dest: string): Promise<void> {
  try {
    await fs.rename(target, dest);
    return;
  } catch {
    await fs.copyFile(target, dest);
    await fs.unlink(target);
  }
}

async function uniqueTrashPath(trashRoot: string, relative: string): Promise<string> {
  const stem = relative.split(path.sep).join("__");
  let dest = path.join(trashRoot, stem);
  for (let suffix = 2; await fs.lstat(dest).catch(() => null); suffix += 1) {
    dest = path.join(trashRoot, `${stem}-${suffix}`);
  }
  return dest;
}

/** 应用一份已经算好的计划；预检失败抛 PreflightError（此时一个文件都没写） */
async function applyPlan(options: {
  root: string;
  backup: VerifiedBackup;
  plan: RestorePlan;
  trashLabel: string;
}): Promise<{ deletedTo: string | null; moved: number }> {
  const { root, backup, plan } = options;

  const writes = plan.entries.filter(
    (entry) => entry.status === "added" || entry.status === "overwritten",
  );
  const deletes = plan.includeDeletes
    ? plan.entries.filter((entry) => entry.status === "deleted")
    : [];

  // 先预检全部目标，再动第一个文件：避免「写到第三个才发现目录是 junction」
  for (const entry of [...writes, ...deletes]) {
    const target = contentPathForEntry(root, entry.path);
    await ensureSafeTarget(root, target);
  }
  for (const entry of deletes) {
    const target = contentPathForEntry(root, entry.path);
    const stat = await fs.lstat(/*turbopackIgnore: true*/ target).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      throw new PreflightError(`要删除的文件不存在或不是普通文件：${entry.path}`);
    }
  }

  // 删除目的地也必须在写第一个字节之前确认：否则文章已经写完，才发现
  // `content/.trash/restore-<时间>` 是普通文件；外层会把 PreflightError 当成
  // 「一个文件都没写」而跳过回滚（审计 v4 F1）。
  const trashRoot = deletes.length > 0 ? path.join(root, ".trash", options.trashLabel) : null;
  if (trashRoot) {
    await ensureSafeDirectory(path.join(root, ".trash"));
    await ensureSafeDirectory(trashRoot);
  }

  for (const entry of writes) {
    const bytes = backup.files.get(entry.path);
    if (!bytes) throw new Error(`备份里缺少 ${entry.path} 的内容`);
    await writeFileAtomic(contentPathForEntry(root, entry.path), bytes);
  }

  let deletedTo: string | null = null;
  if (trashRoot) {
    for (const entry of deletes) {
      const target = contentPathForEntry(root, entry.path);
      const relative = path.relative(root, target);
      const dest = await uniqueTrashPath(trashRoot, relative);
      await moveToTrash(target, dest);
    }
    deletedTo = trashRoot;
  }

  return { deletedTo, moved: deletes.length };
}

async function rollbackToSnapshot(options: {
  root: string;
  backupsDir: string;
  snapshotName: string;
  now: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const resolved = await resolveBackupFile(options.backupsDir, options.snapshotName);
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const loaded = await loadVerifiedBackup(resolved.path);
  if (!loaded.ok) return { ok: false, error: loaded.error };

  const scanned = await scanContent(options.root);
  const plan = computeRestorePlan(
    scanned.files.map((file) => file.meta),
    loaded.backup.manifest.files,
    true,
  );

  try {
    await applyPlan({
      root: options.root,
      backup: loaded.backup,
      plan,
      trashLabel: `restore-rollback-${formatLocalStamp(options.now)}`,
    });
  } catch (error) {
    return { ok: false, error: message(error) };
  }

  const verified = await verifyContentMatchesBackup(options.root, loaded.backup);
  return verified.ok ? { ok: true } : { ok: false, error: verified.error };
}

/**
 * 启动恢复（DATA-01）：读 `backups/restore-journal.json`，判断上次恢复有没有收尾。
 *
 * 规则（任务卡 §2.3）：
 *   - `applying`  → 用日志里的 snapshot 回滚；成功后删日志
 *   - `verified`  → 上次其实已成功，只删日志，不动数据
 *   - 读不出 / 快照缺失 / 回滚失败 → 保留日志，fail closed，错误里给快照名与手动入口
 *
 * 调用方必须已经持有 `serialize` 锁（applyRestore 内部，或公开入口 recoverPendingRestore）。
 */
async function recoverPendingRestoreUnlocked(options: {
  contentRoot?: string;
  backupsDir?: string;
  now?: Date;
}): Promise<RestoreRecovery> {
  const now = options.now ?? new Date();
  const root = options.contentRoot ?? contentFilesRoot();
  const backupsDir = options.backupsDir ?? backupsRoot();

  const read = await readRestoreJournal(backupsDir);
  if (!read.ok) {
    return {
      state: "failed",
      snapshot: null,
      error: `${read.error}；已保留该文件，不猜、不修、不删。先确认它写的是什么，再决定手动处理。`,
    };
  }

  const journal = read.journal;
  if (!journal) return { state: "none" };

  if (journal.phase === "verified") {
    const cleared = await clearRestoreJournal(backupsDir);
    if (!cleared.ok) {
      return {
        state: "failed",
        snapshot: journal.snapshot,
        error: `上次恢复已经完成并通过校验，但恢复日志删不掉（${cleared.error}）；数据没有被改动，下次启动会再试。`,
      };
    }
    return { state: "already-complete", snapshot: journal.snapshot };
  }

  const rolledBack = await rollbackToSnapshot({
    root,
    backupsDir,
    snapshotName: journal.snapshot,
    now,
  });
  if (!rolledBack.ok) {
    return {
      state: "failed",
      snapshot: journal.snapshot,
      error: `上次恢复没有完成，自动回滚也失败（${rolledBack.error}）。快照 ${journal.snapshot} 还在 backups/：把它放回去后刷新 /backup 会重试；确认找不回来，就在 /backup 点「放弃这次恢复日志」（写入会暂停到处理完为止）。`,
    };
  }

  // 数据已经回到快照，但日志删不掉时不能报「已收尾」：下一次启动会把这条 applying
  // 日志再回滚一次，把用户在中间做的编辑顶掉（v2 审计 V2-DATA-01）。所以保持 failed：
  // 写入闸门会继续挡住写入，直到日志被删掉（页面上有「放弃这次恢复日志」）。
  const cleared = await clearRestoreJournal(backupsDir);
  if (!cleared.ok) {
    return {
      state: "failed",
      snapshot: journal.snapshot,
      error: `数据已经回到快照 ${journal.snapshot}，但恢复日志删不掉（${cleared.error}）。写入已暂停；请手动删除 ${restoreJournalPath(backupsDir)}，或到 /backup 点「放弃这次恢复日志」。`,
    };
  }
  return { state: "recovered", snapshot: journal.snapshot };
}

async function applyRestoreUnlocked(options: {
  contentRoot?: string;
  backupsDir?: string;
  name: string;
  planHash: string;
  includeDeletes?: boolean;
  confirm: string;
  now?: Date;
}): Promise<RestoreSuccess | RestoreFailure> {
  const now = options.now ?? new Date();
  const root = options.contentRoot ?? contentFilesRoot();
  const backupsDir = options.backupsDir ?? backupsRoot();

  if (options.confirm !== RESTORE_CONFIRM_TEXT) {
    return {
      ok: false,
      reason: "confirm",
      error: `请输入「${RESTORE_CONFIRM_TEXT}」两个字再确认（防止手滑）`,
    };
  }

  // 第 0 步：先把上一次没收尾的恢复处理掉。content/ 可能停在混合状态，
  // 这时继续按旧的 planHash 往下写只会更乱（DATA-01）。
  const pending = await recoverPendingRestoreUnlocked({ contentRoot: root, backupsDir, now });
  if (pending.state === "failed") {
    return {
      ok: false,
      reason: "io",
      error: `上一次恢复还没有收尾，先处理它才能再恢复：${pending.error}`,
    };
  }
  if (pending.state === "recovered") {
    return {
      ok: false,
      reason: "stale",
      error: "检测到上次恢复没有完成，已先自动回滚到恢复前；content/ 已经变了，请重新预览再确认。",
    };
  }

  const resolved = await resolveBackupFile(backupsDir, options.name);
  if (!resolved.ok) return { ok: false, reason: "invalid", error: resolved.error };

  const loaded = await loadVerifiedBackup(resolved.path);
  if (!loaded.ok) return { ok: false, reason: "verify", error: loaded.error };

  const payload = checkBackupPayload(loaded.backup.manifest, loaded.backup.files);
  if (!payload.ok) return { ok: false, reason: "verify", error: payload.error };

  const scanned = await scanContent(root);
  const plan = computeRestorePlan(
    scanned.files.map((file) => file.meta),
    loaded.backup.manifest.files,
    options.includeDeletes ?? false,
  );

  if (plan.planHash !== options.planHash) {
    return {
      ok: false,
      reason: "stale",
      error: "你确认的是另一份预览：预览之后 content/ 或选项又变了。请重新预览再确认。",
      plan,
    };
  }

  const writes = plan.counts.added + plan.counts.overwritten;
  if (writes === 0 && (!plan.includeDeletes || plan.counts.deleted === 0)) {
    return {
      ok: false,
      reason: "invalid",
      error:
        plan.counts.deleted > 0
          ? `除了 ${plan.counts.deleted} 个只在当前存在的文件，其余已经一致；要删除它们请勾选「同时删除」后重新预览。`
          : "这份备份与当前 content/ 已经一致，没有需要恢复的文件。",
    };
  }

  // 第 3 步：先给现状留一份。快照建不出来，就绝不往下走。
  const snapshot = await createBackupUnlocked({
    contentRoot: root,
    backupsDir,
    kind: "pre-restore",
    now,
  });
  if (!snapshot.ok) {
    return {
      ok: false,
      reason: "io",
      error: `无法创建恢复前快照，已取消恢复（content/ 没有改动）：${snapshot.error}`,
    };
  }

  // 第 3.5 步：留下「我正在改 content/」的耐久证据。日志写不下去就绝不往下走。
  const journal: RestoreJournal = {
    version: RESTORE_JOURNAL_VERSION,
    snapshot: snapshot.name,
    planHash: plan.planHash,
    startedAt: now.toISOString(),
    phase: "applying",
  };
  const journalWritten = await writeRestoreJournal(backupsDir, journal);
  if (!journalWritten.ok) {
    return {
      ok: false,
      reason: "io",
      error: `无法写恢复日志，已取消恢复（content/ 没有改动）：${journalWritten.error}`,
    };
  }

  try {
    const applied = await applyPlan({
      root,
      backup: loaded.backup,
      plan,
      trashLabel: `restore-${formatLocalStamp(now)}`,
    });

    const verified = await verifyContentMatchesBackup(root, loaded.backup);
    if (!verified.ok) throw new Error(verified.error);

    if (plan.includeDeletes) {
      for (const entry of plan.entries.filter((item) => item.status === "deleted")) {
        const target = contentPathForEntry(root, entry.path);
        const stat = await fs.lstat(/*turbopackIgnore: true*/ target).catch(() => null);
        if (stat) throw new Error(`恢复后仍存在应删除的文件：${entry.path}`);
      }
    }

    // 校验通过才把日志标成 verified，再删。顺序反了会在「成功但没删掉」时
    // 让下次启动误以为没写完、把一次成功的恢复回滚掉。
    const marked = await writeRestoreJournal(backupsDir, { ...journal, phase: "verified" });
    const cleared = await clearRestoreJournal(backupsDir);
    const journalWarnings: string[] = [];
    if (!cleared.ok) {
      journalWarnings.push(
        marked.ok
          ? `恢复日志没能删除（${cleared.error}）；下次启动只会清掉它，不会再动数据。`
          : `恢复日志既没能标记完成、也没能删除（${cleared.error}）；下次启动可能会把这次恢复回滚掉。`,
      );
    }

    return {
      ok: true,
      snapshotName: snapshot.name,
      snapshotPath: snapshot.path,
      deletedTo: applied.deletedTo,
      plan,
      warnings: [...payload.warnings, ...journalWarnings],
      manifest: loaded.backup.manifest,
    };
  } catch (error) {
    if (error instanceof PreflightError) {
      // 一个文件都没写：日志没有继续存在的理由
      await clearRestoreJournal(backupsDir);
      return {
        ok: false,
        reason: "io",
        error: `恢复前检查失败，content/ 没有改动：${error.message}（恢复前快照：${snapshot.name}）`,
      };
    }

    const rolledBack = await rollbackToSnapshot({
      root,
      backupsDir,
      snapshotName: snapshot.name,
      now,
    });
    if (!rolledBack.ok) {
      return {
        ok: false,
        reason: "io",
        error: `恢复失败（${message(error)}）；自动回滚也失败（${rolledBack.error}）。恢复前快照：${snapshot.name}，请手动恢复；恢复日志已保留，下次启动会再试一次自动回滚。`,
      };
    }
    const cleared = await clearRestoreJournal(backupsDir);
    return {
      ok: false,
      reason: "io",
      error: `恢复失败（${message(error)}），已自动回滚到恢复前状态（快照 ${snapshot.name}）。${
        cleared.ok ? "" : "（恢复日志没能删除，下次启动会再核对一次）"
      }`,
    };
  }
}

/** 公开入口：整个恢复进程内串行 */
export function applyRestore(options: {
  contentRoot?: string;
  backupsDir?: string;
  name: string;
  planHash: string;
  includeDeletes?: boolean;
  confirm: string;
  now?: Date;
}): Promise<RestoreSuccess | RestoreFailure> {
  return serialize(() => applyRestoreUnlocked(options));
}

/**
 * 启动恢复的公开入口（DATA-01）：与恢复共用同一把 `serialize` 锁。
 * 不要在拿锁的代码里调用它（会死等自己）；`applyRestore` 内部走的是 unlocked 版本。
 */
export function recoverPendingRestore(
  options: {
    contentRoot?: string;
    backupsDir?: string;
    now?: Date;
  } = {},
): Promise<RestoreRecovery> {
  return serialize(() => recoverPendingRestoreUnlocked(options));
}

/** 给界面显示的统计（失败时也能拿到计划） */
export function planCounts(plan: RestorePlan): RestoreCounts {
  return plan.counts;
}
