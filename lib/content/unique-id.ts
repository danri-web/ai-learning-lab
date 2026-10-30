import { slugifyTitle } from "@/lib/content/id";
import { MAX_ID_LENGTH } from "@/lib/security/article-id";

/**
 * 「按标题生成 id，重名加 `-2`」这段逻辑笔记（D3/D7）、资源（D9）、任务（D11）三处都要用。
 * 抽出来一份，免得三处各写一遍 —— 那种重复最坏的结果是"只有两处修了 bug"。
 */
export function nextFreeId(base: string, taken: Set<string>): string | null {
  const room = MAX_ID_LENGTH - 4;
  const stem = base.length > room ? base.slice(0, room).replace(/-+$/, "") : base;
  for (let n = 1; n <= 100; n += 1) {
    const candidate = n === 1 ? stem : `${stem}-${n}`;
    if (candidate.length > MAX_ID_LENGTH) continue;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

/** 从标题直接拿到一个没被占用的 id；同名太多时返回 null（调用方给"换个标题"） */
export function uniqueIdForTitle(title: string, taken: Set<string>): string | null {
  return nextFreeId(slugifyTitle(title), taken);
}
