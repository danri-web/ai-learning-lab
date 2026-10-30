import type { SearchOutcome } from "@/lib/search/query";

/**
 * 搜索的**接口契约**（阶段 5）：Server Action 来回传的这个信封。
 *
 * 单独一个文件是为了「客户端能安全地 import 类型」：
 * `lib/search/sources.ts` 往下会碰 `lib/content`（里面有 `node:fs`），
 * 客户端组件 import 它会直接把 Turbopack 构建搞挂（阶段 4 踩过一模一样的坑）。
 * 这个文件只有类型，编译后一条 import 都不剩。
 */

export type SearchProblem = { file: string; error: string };

export type SearchCounts = { articles: number; resources: number };

export type SearchResponse = {
  outcome: SearchOutcome;
  counts: SearchCounts;
  /** 扫盘 + 解析 + 匹配的总耗时（毫秒，界面底部写着给用户看） */
  tookMs: number;
  /** 读不出来/坏掉的文件（诚实报出来，不假装一切都好） */
  problems: SearchProblem[];
};
