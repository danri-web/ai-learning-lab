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

  for (const entry of writes) {
    const bytes = backup.files.get(entry.path);
    if (!bytes) throw new Error(`备份里缺少 ${entry.path} 的内容`);
    await writeFileAtomic(contentPathForEntry(root, entry.path), bytes);
  }

  let deletedTo: string | null = null;
  if (deletes.length > 0) {
    const trashRoot = path.join(root, ".trash", options.trashLabel);
    await ensureSafeDirectory(path.join(root, ".trash"));
    await ensureSafeDirectory(trashRoot);
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

    return {
      ok: true,
      snapshotName: snapshot.name,
      snapshotPath: snapshot.path,
      deletedTo: applied.deletedTo,
      plan,
      warnings: payload.warnings,
      manifest: loaded.backup.manifest,
    };
  } catch (error) {
    if (error instanceof PreflightError) {
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
        error: `恢复失败（${message(error)}）；自动回滚也失败（${rolledBack.error}）。恢复前快照：${snapshot.name}，请手动恢复。`,
      };
    }
    return {
      ok: false,
      reason: "io",
      error: `恢复失败（${message(error)}），已自动回滚到恢复前状态（快照 ${snapshot.name}）。`,
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

/** 给界面显示的统计（失败时也能拿到计划） */
export function planCounts(plan: RestorePlan): RestoreCounts {
  return plan.counts;
}
