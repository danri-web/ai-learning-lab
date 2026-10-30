import { searchLibrary, type SearchResponse } from "@/lib/search/sources";

/**
 * 搜索的业务层（阶段 5）。
 *
 * 这一层比写入那两个 service 薄得多 —— 搜索**不做任何写操作**，
 * 所以它没有"能不能写"的规则要守，只做两件事：
 * 1. 把客户端传来的东西当不可信输入（不是字符串就当空查询，不让它崩）；
 * 2. 超长查询**不截断**成"看起来搜了"：交给 query 层返回 `too-long`，界面照实说。
 */
export async function runSearch(rawQuery: unknown): Promise<SearchResponse> {
  const query = typeof rawQuery === "string" ? rawQuery : "";
  return searchLibrary(query);
}
