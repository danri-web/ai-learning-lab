import { promises as fs } from "node:fs";
import path from "node:path";

import { isBackupFileName } from "@/lib/content/backup-format";
import { stripBom } from "@/lib/content/encoding";
import { writeFileAtomic } from "@/lib/fs/atomic-write";

/**
 * 恢复日志（DATA-01）：`backups/restore-journal.json`。
 *
 * 为什么需要它：`applyRestore` 的顺序是「建 pre-restore 快照 → 逐文件原子写 → 重扫校验」，
 * 正常失败会走 catch 回滚。但**进程/系统在逐文件写的中途被杀，catch 根本不会执行**，
 * content/ 可能停在混合状态。快照已经存在，缺的只是「应用自己知道上次没恢复完」。
 *
 * 约定：
 *   1. 放在 `backups/`（不在 content/ 里，不会被备份/恢复/回收站卷进去）
 *   2. 动 content/ 之前先原子写 `phase: "applying"`；校验通过后写 `phase: "verified"` 再删
 *   3. 解析失败 / 版本不认识 / 字段缺失 → **fail closed**：不猜、不修、不删，报出路径与原因
 *   4. `snapshot` 必须是合法的备份文件名（防手改日志把回滚指到 backups/ 之外）
 */

export const RESTORE_JOURNAL_NAME = "restore-journal.json";
export const RESTORE_JOURNAL_VERSION = 1;

export type RestorePhase = "applying" | "verified";

export type RestoreJournal = {
  version: typeof RESTORE_JOURNAL_VERSION;
  snapshot: string;
  planHash: string;
  startedAt: string;
  phase: RestorePhase;
};

export type RestoreJournalRead =
  { ok: true; journal: RestoreJournal | null } | { ok: false; error: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function restoreJournalPath(backupsDir: string): string {
  return path.join(/*turbopackIgnore: true*/ backupsDir, RESTORE_JOURNAL_NAME);
}

/** 纯校验：顶层对象、版本、快照名、planHash、startedAt、phase，缺一项都拒绝 */
export function parseRestoreJournal(
  raw: unknown,
): { ok: true; journal: RestoreJournal } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "顶层不是 JSON 对象" };
  }
  const record = raw as Record<string, unknown>;

  if (record.version !== RESTORE_JOURNAL_VERSION) {
    return {
      ok: false,
      error: `version 不认识：${JSON.stringify(record.version)}（只认 ${RESTORE_JOURNAL_VERSION}）`,
    };
  }
  if (typeof record.snapshot !== "string" || !isBackupFileName(record.snapshot)) {
    return { ok: false, error: "snapshot 缺失，或不是本项目生成的备份文件名" };
  }
  if (typeof record.planHash !== "string" || record.planHash.length === 0) {
    return { ok: false, error: "planHash 缺失" };
  }
  if (typeof record.startedAt !== "string" || Number.isNaN(Date.parse(record.startedAt))) {
    return { ok: false, error: "startedAt 缺失，或不是可解析的时间" };
  }
  if (record.phase !== "applying" && record.phase !== "verified") {
    return { ok: false, error: `phase 不认识：${JSON.stringify(record.phase)}` };
  }

  return {
    ok: true,
    journal: {
      version: RESTORE_JOURNAL_VERSION,
      snapshot: record.snapshot,
      planHash: record.planHash,
      startedAt: record.startedAt,
      phase: record.phase,
    },
  };
}

/** 读日志：不存在 = 没有待收尾的恢复（不是错误）；存在但读不出来 = 解析错误 */
export async function readRestoreJournal(backupsDir: string): Promise<RestoreJournalRead> {
  const file = restoreJournalPath(backupsDir);

  const stat = await fs.lstat(/*turbopackIgnore: true*/ file).catch(() => null);
  if (!stat) return { ok: true, journal: null };
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { ok: false, error: `恢复日志不是普通文件（可能是链接/目录）：${file}` };
  }

  let text: string;
  try {
    text = await fs.readFile(/*turbopackIgnore: true*/ file, "utf8");
  } catch (error) {
    return { ok: false, error: `读不了恢复日志（${file}）：${message(error)}` };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripBom(text));
  } catch (error) {
    return { ok: false, error: `恢复日志不是合法 JSON（${file}）：${message(error)}` };
  }

  const parsed = parseRestoreJournal(parsedJson);
  if (!parsed.ok) {
    return { ok: false, error: `恢复日志字段不对（${file}）：${parsed.error}` };
  }
  return parsed;
}

export async function writeRestoreJournal(
  backupsDir: string,
  journal: RestoreJournal,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.mkdir(/*turbopackIgnore: true*/ backupsDir, { recursive: true });
    await writeFileAtomic(restoreJournalPath(backupsDir), `${JSON.stringify(journal, null, 2)}\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

export async function clearRestoreJournal(
  backupsDir: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fs.rm(restoreJournalPath(backupsDir), { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}
