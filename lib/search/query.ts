/**
 * 搜索的**纯函数层**（阶段 5）。
 *
 * 这一层不知道数据从哪来：输入是已经归一好的 `SearchDocument`，输出是排好序的结果 + 摘要 + 高亮区间。
 * 好处是它可以完全脱离文件系统测（`tests/search-query.test.ts`），而"从哪读"由 `lib/search/sources.ts` 决定。
 *
 * 为什么不建索引（ADR D6）：个人库规模下，子串匹配本来就对中文友好 ——
 * FTS5 的 unicode61 对中文 0 命中，trigram 搜不到「模型」这类 2 字词。
 *
 * 三条实现上的克意选择：
 * 1. **匹配用正则的 `i` 标志，不把两边都 `toLowerCase()`** —— 大小写转换会改变字符串长度
 *    （`İ` → 两个码元），长度一变，高亮区间的下标就全错了。正则的大小写折叠不移动下标。
 * 2. **高亮只出区间，不出 HTML** —— 源码闸门禁止把 HTML 字符串直接塞进 DOM，
 *    界面上用「切片 + `<mark>`」拼出来，用户正文里的 `<script>` 永远只是文字。
 * 3. **摘要按码点切**，不按码元硬切 —— 否则窗口边界正好落在 emoji 中间时，
 *    页面上会出现半个代理对（乱码方块）。
 */

/** 查询长度上限：再长就不是"找东西"而是"贴了一篇文章进来"，直接告诉用户，不假装搜 */
export const MAX_QUERY_LENGTH = 100;

/** 最多同时匹配几个词（空格分词后）。超过就只认前几个，避免一个查询把 CPU 拖住 */
export const MAX_TOKENS = 8;

/** 最多返回几条。结果再多也没人往下翻，界面上写明"只显示前 N 条" */
export const MAX_RESULTS = 50;

/** 摘要窗口：命中点前 40 / 后 80 个码元 */
const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;

/** 摘要断行时允许往前/往后挪的最大距离（尽量切在空白处，不把词拦腰砍断） */
const SNAP_DISTANCE = 12;

export type SearchKind = "article" | "resource";

export type SearchDocument = {
  kind: SearchKind;
  id: string;
  title: string;
  category: string;
  tags: string[];
  /** 资源的链接（笔记没有）。给"搜 github 找到那个仓库"用，权重最低 */
  url?: string;
  /** 笔记正文 / 资源描述。摘要只从这里面切 */
  text: string;
  updatedAt: string;
};

/** 命中的字段（界面上写「命中：标题 / 标签」用） */
export type SearchField = "title" | "category" | "tags" | "url" | "text";

/** 高亮区间：`[start, end)`，下标指向**结果里那个字符串**（标题或摘要），不是原文 */
export type Range = { start: number; end: number };

export type SearchResult = {
  kind: SearchKind;
  id: string;
  title: string;
  titleRanges: Range[];
  excerpt: string;
  excerptRanges: Range[];
  /** 资源的原始链接（笔记没有）。界面拿它开新标签，不用再查一次文件 */
  url?: string;
  matched: SearchField[];
  score: number;
  updatedAt: string;
};

export type SearchOutcome =
  | { state: "empty" }
  | { state: "too-long"; limit: number }
  | { state: "done"; results: SearchResult[]; truncated: boolean };

export type NormalizedQuery =
  | { state: "empty" }
  | { state: "too-long"; limit: number }
  | { state: "ok"; tokens: string[] };

/**
 * 归一化查询：NFKC（全角 `ＡＩ` → `AI`）→ 连续空白折成一个空格 → 去两端 →
 * 按空格切词 → 按小写去重（`AI ai` 只算一个词，否则同一个词会被计两次分）。
 *
 * 空查询和纯空格都是 `empty`：**不返回全部内容**（那不是搜索，是列表）。
 */
export function normalizeQuery(raw: string): NormalizedQuery {
  const collapsed = raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (collapsed.length === 0) return { state: "empty" };
  if (collapsed.length > MAX_QUERY_LENGTH) return { state: "too-long", limit: MAX_QUERY_LENGTH };

  const seen = new Map<string, string>();
  for (const token of collapsed.split(" ")) {
    if (token.length === 0) continue;
    const key = token.toLowerCase();
    if (!seen.has(key)) seen.set(key, token);
    if (seen.size >= MAX_TOKENS) break;
  }
  return { state: "ok", tokens: [...seen.values()] };
}

/** 把用户输入变成字面量正则（`a+b`、`(`、`.*` 都按字符本身匹配，不是元字符） */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 在 haystack 里找出**所有**出现位置。
 * 用 `gu` + 每次新建正则：全局正则有 `lastIndex` 状态，复用会让同一个词在第二篇里找不到。
 */
function findAll(haystack: string, source: string): Range[] {
  if (haystack.length === 0) return [];
  const ranges: Range[] = [];
  const re = new RegExp(source, "giu");
  let match = re.exec(haystack);
  while (match !== null) {
    if (match[0].length > 0) ranges.push({ start: match.index, end: match.index + match[0].length });
    match = re.exec(haystack);
  }
  return ranges;
}

/** 合并重叠/相接的区间，避免出现两个叠在一起的 `<mark>` */
export function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [{ ...sorted[0] }];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** 起点别落在代理对的后半个上 */
function safeStart(text: string, start: number): number {
  if (start <= 0) return 0;
  return isLowSurrogate(text.charCodeAt(start)) ? start - 1 : start;
}

/** 终点别把代理对劈开（最后一个码元是高代理，说明配对的那个被切掉了） */
function safeEnd(text: string, end: number): number {
  if (end >= text.length) return text.length;
  return isHighSurrogate(text.charCodeAt(end - 1)) ? end + 1 : end;
}

/** 往前挪到空白之后（最多挪 SNAP_DISTANCE），避免摘要从半个词开始 */
function snapStart(text: string, start: number): number {
  if (start <= 0) return 0;
  const floor = Math.max(0, start - SNAP_DISTANCE);
  for (let i = start; i > floor; i -= 1) {
    if (/\s/u.test(text[i - 1])) return i;
  }
  return start;
}

/** 往后挪到空白之前，避免摘要停在半个词上 */
function snapEnd(text: string, end: number): number {
  if (end >= text.length) return text.length;
  const ceiling = Math.min(text.length, end + SNAP_DISTANCE);
  for (let i = end; i < ceiling; i += 1) {
    if (/\s/u.test(text[i])) return i;
  }
  return end;
}

const ELLIPSIS = "…";

/**
 * 生成摘要：以第一处正文命中为锚点，切前 40 后 80。
 * 没有正文命中（只命中标题/标签）时给正文开头，让结果不是光秃秃一行标题。
 */
export function buildExcerpt(
  text: string,
  hits: Range[],
): { excerpt: string; ranges: Range[] } {
  const source = text;
  const merged = mergeRanges(hits);

  if (merged.length === 0) {
    const end = safeEnd(source, Math.min(source.length, EXCERPT_AFTER));
    const body = source.slice(0, end);
    return { excerpt: end < source.length ? body + ELLIPSIS : body, ranges: [] };
  }

  const anchor = merged[0].start;
  let start = snapStart(source, Math.max(0, anchor - EXCERPT_BEFORE));
  let end = snapEnd(source, Math.min(source.length, anchor + EXCERPT_AFTER));
  start = safeStart(source, start);
  end = safeEnd(source, end);

  const prefix = start > 0 ? ELLIPSIS : "";
  const suffix = end < source.length ? ELLIPSIS : "";
  const body = source.slice(start, end);

  const ranges = mergeRanges(
    merged
      .filter((hit) => hit.start >= start && hit.end <= end)
      .map((hit) => ({ start: hit.start - start + prefix.length, end: hit.end - start + prefix.length })),
  );

  return { excerpt: prefix + body + suffix, ranges };
}

type FieldHits = Record<SearchField, number>;

/**
 * 权重（都是"命中哪个字段"的常数，不是玄学调参）：
 * 标题里有的东西，比正文里提一句重要 —— 这是唯一的相关度，不做 TF-IDF。
 */
const FIELD_WEIGHT: Record<SearchField, number> = {
  title: 1000,
  tags: 300,
  category: 200,
  url: 100,
  text: 50,
};

function scoreOf(hits: FieldHits): number {
  let score = 0;
  for (const field of Object.keys(FIELD_WEIGHT) as SearchField[]) {
    if (hits[field] > 0) score += FIELD_WEIGHT[field];
  }
  // 正文里反复出现，稍微加分，但有上限（不然一篇长文能把所有结果压在下面）
  score += Math.min(hits.text, 10) * 5;
  return score;
}

/**
 * 搜索。多个词是 **AND** 语义（每个词都得在文档某处出现），和人的直觉一致：
 * 搜「Transformer 注意力」是要两者都有的那篇，不是有一堆只含一个词的结果。
 *
 * 排序：命中字段权重 → 更新时间新在前 → 标题 → id（最后两级只是为了让结果**稳定**，不然每次顺序都变）。
 */
export function searchDocuments(docs: SearchDocument[], rawQuery: string): SearchOutcome {
  const query = normalizeQuery(rawQuery);
  if (query.state !== "ok") {
    return query.state === "empty" ? { state: "empty" } : { state: "too-long", limit: query.limit };
  }

  const sources = query.tokens.map((token) => escapeRegExp(token));
  const results: SearchResult[] = [];

  for (const doc of docs) {
    const hits: FieldHits = { title: 0, category: 0, tags: 0, url: 0, text: 0 };
    const titleRanges: Range[] = [];
    const textRanges: Range[] = [];
    let everyTokenFound = true;

    for (const source of sources) {
      const inTitle = findAll(doc.title, source);
      const inText = findAll(doc.text, source);
      const inCategory = findAll(doc.category, source);
      const inTags = doc.tags.some((tag) => findAll(tag, source).length > 0);
      const inUrl = doc.url ? findAll(doc.url, source).length > 0 : false;

      if (
        inTitle.length === 0 &&
        inText.length === 0 &&
        inCategory.length === 0 &&
        !inTags &&
        !inUrl
      ) {
        everyTokenFound = false;
        break;
      }

      if (inTitle.length > 0) hits.title += inTitle.length;
      if (inText.length > 0) hits.text += inText.length;
      if (inCategory.length > 0) hits.category += inCategory.length;
      if (inTags) hits.tags += 1;
      if (inUrl) hits.url += 1;

      titleRanges.push(...inTitle);
      textRanges.push(...inText);
    }

    if (!everyTokenFound) continue;

    const excerpt = buildExcerpt(doc.text, textRanges);
    const matched = (Object.keys(FIELD_WEIGHT) as SearchField[]).filter((field) => hits[field] > 0);

    results.push({
      kind: doc.kind,
      id: doc.id,
      title: doc.title,
      titleRanges: mergeRanges(titleRanges),
      excerpt: excerpt.excerpt,
      excerptRanges: excerpt.ranges,
      url: doc.url,
      matched,
      score: scoreOf(hits),
      updatedAt: doc.updatedAt,
    });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      b.updatedAt.localeCompare(a.updatedAt) ||
      a.title.localeCompare(b.title, "zh-CN") ||
      a.id.localeCompare(b.id),
  );

  return {
    state: "done",
    results: results.slice(0, MAX_RESULTS),
    truncated: results.length > MAX_RESULTS,
  };
}
