import { revisionOf } from "@/lib/content/revision";

/**
 * `.trash` 清理的**纯函数**部分（P1）：时间解析、90 天判定、JSONL 裁行、预览指纹。
 *
 * 不碰磁盘，测试可以脱离文件系统跑；真正的扫描与删除在 `trash-store.ts`。
 *
 * 时间格式统一用本项目自己写的 `YYYYMMDD-HHmmss`（本地时间，`formatLocalStamp`）：
 *   - 笔记回收站：`content/articles/.trash/20261030-153012-标题.md` 的文件名前缀
 *   - 资源/任务删除留档：`content/.trash/*.jsonl` 每行的 `deletedAt`
 * 解析不出来的一律**不删**，只在预览里单列。
 */

export const TRASH_RETENTION_DAYS = 90;
export const TRASH_PRUNE_CONFIRM_TEXT = "清理";
export const TRASH_DAY_MS = 24 * 60 * 60 * 1000;

export type TrashStamp = { text: string; date: Date };

export type JsonlPrune = {
  /** 裁掉超期行之后的新文本（BOM / CRLF / 末尾换行都尽量原样保留） */
  text: string;
  /** 删掉了几行记录 */
  dropped: number;
  /** 保留了几行非空记录 */
  kept: number;
  /** 没删但需要让人看到的行（解析失败 / 缺字段） */
  skipped: { line: number; reason: string }[];
};

export type TrashPlanEntry = {
  kind: "article" | "restore-dir" | "jsonl";
  /** 相对 content/ 的路径 */
  path: string;
  deletedAt: string;
  /** JSONL 用：原始文本指纹（任何一行变化都要重开预览） */
  fileHash?: string;
  /** JSONL 用：这次要删几行 */
  dropped?: number;
};

const STAMP = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/;

/**
 * 只认 `YYYYMMDD-HHmmss`（15 个字符，本地时间）。
 * 用逐段回读校验，拒绝 2 月 30、24 时、60 秒这类「正则过得去、日期不成立」的值。
 */
export function parseTrashStamp(value: unknown): TrashStamp | null {
  if (typeof value !== "string" || value.length !== 15) return null;
  const match = STAMP.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }

  return { text: value, date };
}

export function trashCutoff(now: Date, days: number = TRASH_RETENTION_DAYS): Date {
  const span = Number.isFinite(days) && days >= 0 ? days : TRASH_RETENTION_DAYS;
  return new Date(now.getTime() - span * TRASH_DAY_MS);
}

/** 严格早于 cutoff 才算超期：正好 90 天整保留 */
export function isExpiredAt(date: Date, cutoff: Date): boolean {
  return date.getTime() < cutoff.getTime();
}

/**
 * JSONL 只裁「确实超期」的行。
 *
 * 保留行的字节不能被顺手规范化：BOM、CRLF、末尾有没有换行都按原样留着。
 * 解析失败 / 缺 deletedAt / 不是对象的行**不删**，记进 skipped 让人看到。
 */
export function pruneJsonlText(text: string, cutoff: Date): JsonlPrune {
  const hasBom = text.charCodeAt(0) === 0xfeff;
  const body = hasBom ? text.slice(1) : text;
  const endsWithNewline = body.endsWith("\n");

  const lines = body.split("\n");
  if (endsWithNewline) lines.pop();

  const keptLines: string[] = [];
  const skipped: { line: number; reason: string }[] = [];
  let dropped = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (line.trim() === "") {
      keptLines.push(line);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      keptLines.push(line);
      skipped.push({ line: lineNumber, reason: "不是合法 JSON" });
      return;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      keptLines.push(line);
      skipped.push({ line: lineNumber, reason: "不是 JSON 对象" });
      return;
    }

    const record = parsed as Record<string, unknown>;
    if (typeof record.deletedAt !== "string") {
      keptLines.push(line);
      skipped.push({ line: lineNumber, reason: "缺少 deletedAt" });
      return;
    }

    const stamp = parseTrashStamp(record.deletedAt);
    if (!stamp) {
      keptLines.push(line);
      skipped.push({ line: lineNumber, reason: "deletedAt 不是 YYYYMMDD-HHmmss" });
      return;
    }

    if (isExpiredAt(stamp.date, cutoff)) {
      dropped += 1;
      return;
    }

    keptLines.push(line);
  });

  const bodyOut = keptLines.join("\n") + (keptLines.length > 0 && endsWithNewline ? "\n" : "");
  return {
    text: `${hasBom ? "\uFEFF" : ""}${bodyOut}`,
    dropped,
    kept: keptLines.filter((line) => line.trim() !== "").length,
    skipped,
  };
}

export function trashPlanHash(entries: readonly TrashPlanEntry[]): string {
  const normalized = [...entries]
    .sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    })
    .map((entry) => [
      entry.kind,
      entry.path,
      entry.deletedAt,
      entry.fileHash ?? null,
      entry.dropped ?? null,
    ]);

  return revisionOf(JSON.stringify({ v: 1, entries: normalized }));
}
