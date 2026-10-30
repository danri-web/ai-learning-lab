"use server";

import { runSearch } from "@/features/search/service";
import { requireAuth } from "@/lib/security/auth";
import type { SearchResponse } from "@/lib/search/sources";

/**
 * 搜索的 Server Action（阶段 5）。**只读**：跑完不改任何文件。
 *
 * 为什么走 Server Action 而不是 `/api/search` 路由：
 * - 与既有写入链路同一条规范（D4：入口在 app/，规则在 features/*，碰数据的在 lib/*）；
 * - Next 内建的 Origin/Host 校验顺手覆盖了"别的网页偷偷调本地 3000 端口"这一类；
 * - 不需要再加一个 HTTP 面去考虑限流/鉴权（阶段 7 的事）。
 *
 * 客户端只看到摘要片段，看不到全文 —— 摘要的长度上限在 lib/search/query.ts 里钉着。
 */
export async function searchAction(query: string): Promise<SearchResponse> {
  await requireAuth();
  return runSearch(query);
}
