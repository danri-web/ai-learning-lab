import { revisionOf } from "@/lib/content/revision";

/**
 * 手动备份的保留策略（P1，纯函数，不碰磁盘）。
 *
 * 用户 2026-10-30 拍板：**保留最近 10 份** `ai-lab-*.zip`。
 * 这里只回答「哪些能删」，不回答「怎么删」——删除、加锁、写失败处理在 backup-store。
 *
 * 几条不能破的边界（都有测试钉着）：
 *   - 最新一份永远不删（即使 keep 传 0 / 负数 / NaN）
 *   - `pre-restore-*.zip` 是恢复兜底，永远不进候选，也不占 10 份名额
 *   - 名字不是本项目生成的（`restore-journal.json`、未知 zip、大小写不符）一律不碰
 *   - 超期但损坏的只列出来，不删；它仍占一个保留位（宁可多留，不多删）
 *   - 同一秒的 `-2` / `-3` 后缀按创建顺序排（后缀越大越新），不能按字符串倒序
 */

export const BACKUP_KEEP_COUNT = 10;

/** 与恢复的「恢复」、放弃日志的「删除」一样，确认文字只留一份 */
export const BACKUP_PRUNE_CONFIRM_TEXT = "清理";

export type BackupRetentionItem = {
  name: string;
  /** manifest 读不出来 = 损坏；损坏的不删 */
  damaged: boolean;
};

export type BackupRetention = {
  /** 保留的备份名（新的在前） */
  keep: string[];
  /** 可清理的（旧的在前，顺序稳定） */
  expired: string[];
  /** 已超期但损坏，只列出不删（旧的在前） */
  damaged: string[];
  /** 预览指纹：执行前重算，不一致就要求重开预览 */
  planHash: string;
};

const MANUAL_BACKUP = /^ai-lab-(\d{8})-(\d{6})(?:-(\d{1,2}))?\.zip$/;

type ParsedName = { name: string; damaged: boolean; stamp: string; suffix: number };

function parseManualName(name: string): ParsedName | null {
  const match = MANUAL_BACKUP.exec(name);
  if (!match) return null;
  return {
    name,
    damaged: false,
    stamp: `${match[1]}-${match[2]}`,
    suffix: match[3] ? Number(match[3]) : 1,
  };
}

/**
 * 新的在前。同秒冲突时 `-2` 比不带后缀的新（createBackup 先建 base，再建 -2）。
 * 直接按字符串倒序会把 `-2` 排在 base 前面，从而把**新的**当成第 11 份删掉。
 */
function newestFirst(a: ParsedName, b: ParsedName): number {
  if (a.stamp !== b.stamp) return a.stamp < b.stamp ? 1 : -1;
  if (a.suffix !== b.suffix) return b.suffix - a.suffix;
  return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
}

export function selectExpiredBackups(
  items: readonly BackupRetentionItem[],
  keep: number = BACKUP_KEEP_COUNT,
): BackupRetention {
  // 最少保留 1 份：keep 传 0 / 负数 / NaN 都不能把最新一份删掉
  const limit = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 1;

  const manual: ParsedName[] = [];
  for (const item of items) {
    const parsed = parseManualName(item.name);
    if (parsed) manual.push({ ...parsed, damaged: item.damaged });
  }
  manual.sort(newestFirst);

  const kept = manual.slice(0, limit);
  const older = manual.slice(limit);

  const expired = older
    .filter((item) => !item.damaged)
    .map((item) => item.name)
    .reverse();
  const damaged = older
    .filter((item) => item.damaged)
    .map((item) => item.name)
    .reverse();

  return {
    keep: kept.map((item) => item.name),
    expired,
    damaged,
    // 只覆盖「这次要动的名单」：候选变了就要求重开预览
    planHash: revisionOf(JSON.stringify({ v: 1, expired, damaged })),
  };
}
