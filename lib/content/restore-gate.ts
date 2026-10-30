import path from "node:path";

import { readRestoreJournal } from "@/lib/content/restore-journal";

/**
 * 写入闸门（v2 审计 V2-DATA-01 / ADR D18）。
 *
 * 背景：恢复日志的自动收尾原来只在打开 `/backup`、`/settings` 或执行恢复时才跑。
 * 如果进程重启后用户先编辑了笔记，后来才打开备份页，回滚就会把**重启后的新编辑**
 * 一起顶掉（审计给的具体序列）。修法有两层：
 *
 *   1. `instrumentation.ts` 在进程启动时先收尾（正常情况日志已经没了）；
 *   2. 这一层给所有正常写入兜底：只要 `applying` 状态的日志还在，就**拒绝写入**，
 *      把快照名和处理入口告诉用户 —— 宁可暂时写不了，也不静默覆盖。
 *
 * `verified` 放行：数据已经和快照一致，只差删日志，不会再回滚。
 */

/**
 * 与 `backup-store.backupsRoot()` 是同一个位置。
 * 写入层不能 import backup-store（源码闸门只允许 backup service），所以这里保留一份字面量；
 * 改目录时两处一起改。
 */
export function backupsDirFromCwd(): string {
  return path.join(process.cwd(), "backups");
}

/** 有待收尾的恢复时返回给用户看的一句话；可以写时返回 null */
export async function pendingRestoreMessage(
  backupsDir: string = backupsDirFromCwd(),
): Promise<string | null> {
  const read = await readRestoreJournal(backupsDir);
  if (!read.ok) {
    return `${read.error}。为避免把数据写进混合状态，写入已暂停；请打开 /backup 检查，或手动处理这份日志后再写。`;
  }
  if (!read.journal) return null;
  if (read.journal.phase === "verified") return null;

  return `上次恢复没有完成（快照 ${read.journal.snapshot}）。写入已暂停；请打开 /backup，应用会先自动回滚到恢复前，然后恢复写入。`;
}
