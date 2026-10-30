import { describe, expect, it } from "vitest";

import {
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  buildExcerpt,
  mergeRanges,
  normalizeQuery,
  searchDocuments,
  type SearchDocument,
  type SearchOutcome,
} from "@/lib/search/query";

/**
 * 搜索纯函数层的闸门（阶段 5）。
 *
 * 这里**只碰内存里的文档**，不读文件 —— "从哪读"由 sources.ts 负责，那份单独测。
 * 断言尽量断"关系"而不是快照：高亮区间必须能从摘要里切出查询词、三篇文档的相对顺序、
 * 摘要长度上限……这些东西实现怎么改都不该变。
 */

const docs: SearchDocument[] = [
  {
    kind: "article",
    id: "Transformer-的注意力机制-上",
    title: "Transformer 的注意力机制（上）",
    category: "Deep Learning",
    tags: ["Transformer", "Attention", "注意力"],
    text: "RNN 顺序处理，长距离依赖会衰减；注意力一次看全序列。缩放点积除以根号 d_k。",
    updatedAt: "2026-10-30",
  },
  {
    kind: "article",
    id: "Agent-最小闭环",
    title: "Agent 最小闭环",
    category: "Agent",
    tags: ["Agent", "工具调用"],
    text: "一个 Agent 至少要有循环、工具和停止条件。模型负责决策，工具负责执行。",
    updatedAt: "2026-10-29",
  },
  {
    kind: "resource",
    id: "attention-is-all-you-need",
    title: "Attention Is All You Need",
    category: "论文",
    tags: ["Transformer"],
    url: "https://arxiv.org/abs/1706.03762",
    text: "提出 Transformer，完全基于注意力。",
    updatedAt: "2026-10-28",
  },
];

function done(query: string, corpus: SearchDocument[] = docs) {
  const outcome = searchDocuments(corpus, query);
  if (outcome.state !== "done") {
    throw new Error(`期望 done，实际是 ${outcome.state}`);
  }
  return outcome;
}

function ids(query: string, corpus: SearchDocument[] = docs): string[] {
  return done(query, corpus).results.map((item) => item.id);
}

/** 孤立代理项：出现就说明摘要把 emoji 劈开了 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

describe("查询归一化", () => {
  it("空查询与纯空白都是 empty（不返回全部内容 —— 那是列表不是搜索）", () => {
    for (const raw of ["", "   ", "\n\n", "\t \n"]) {
      expect(searchDocuments(docs, raw), JSON.stringify(raw)).toEqual({ state: "empty" });
    }
  });

  it("超长查询给出明确状态，而不是假装「搜到 0 条」", () => {
    const outcome = searchDocuments(docs, "x".repeat(MAX_QUERY_LENGTH + 1));
    expect(outcome).toEqual({ state: "too-long", limit: MAX_QUERY_LENGTH });
  });

  it("正好等于上限仍然照搜（边界是 > 不是 >=）", () => {
    expect(searchDocuments(docs, "x".repeat(MAX_QUERY_LENGTH)).state).toBe("done");
  });

  it("NFKC 归一：全角字母也能搜到（Ａｇｅｎｔ → Agent）", () => {
    expect(ids("Ａｇｅｎｔ")).toContain("Agent-最小闭环");
  });

  it("连续空白折成一个空格，大小写不同的重复词只算一个（否则同一个词被计两次分）", () => {
    const query = normalizeQuery("  AI   ai  ");
    expect(query).toEqual({ state: "ok", tokens: ["AI"] });
  });

  it("词数有上限，超出的只认前几个", () => {
    const query = normalizeQuery(Array.from({ length: 12 }, (_, i) => `w${i}`).join(" "));
    if (query.state !== "ok") throw new Error("期望 ok");
    expect(query.tokens).toHaveLength(8);
  });
});

describe("匹配（中文优先）", () => {
  it("中文 2 字词能命中 —— 这正是 FTS5 做不到的那一类", () => {
    for (const query of ["模型", "机制"]) {
      expect(ids(query), query).not.toEqual([]);
    }
  });

  it("大小写不敏感：三种写法结果完全相同（关系断言，不是快照）", () => {
    const lower = ids("transformer");
    expect(ids("TRANSFORMER")).toEqual(lower);
    expect(ids("Transformer")).toEqual(lower);
    expect(lower).not.toEqual([]);
  });

  it("跨笔记与资源：同一个词两类都能命中", () => {
    const found = done("Transformer").results;
    expect(new Set(found.map((item) => item.kind))).toEqual(new Set(["article", "resource"]));
  });

  it("多个词是 AND：都要出现才算命中", () => {
    expect(ids("注意力 RNN")).toEqual(["Transformer-的注意力机制-上"]);
    expect(ids("注意力 Agent")).toEqual([]);
  });

  it("词序不影响结果（人不会按顺序想事）", () => {
    expect(ids("RNN 注意力")).toEqual(ids("注意力 RNN"));
  });

  it("正则元字符按字面匹配，不会当成通配符或直接抛异常", () => {
    const tricky: SearchDocument[] = [
      {
        kind: "article",
        id: "math",
        title: "括号与加号",
        category: "杂项",
        tags: [],
        text: "函数签名 foo(a+b)，不是正则的 a+b。",
        updatedAt: "2026-10-30",
      },
    ];
    // `.*` 如果能当正则，会匹配任何字符串 —— 这里必须 0 条
    expect(searchDocuments(tricky, ".*").state).toBe("done");
    expect(ids(".*", tricky)).toEqual([]);
    expect(ids("(a+b)", tricky)).toEqual(["math"]);
  });

  it("标签与链接也算命中，并写进 matched（界面上要写「命中：标签」）", () => {
    const byTag = done("工具调用").results[0];
    expect(byTag.id).toBe("Agent-最小闭环");
    expect(byTag.matched).toContain("tags");

    const byUrl = done("arxiv").results[0];
    expect(byUrl.id).toBe("attention-is-all-you-need");
    expect(byUrl.matched).toContain("url");
    // 资源结果要把原始链接带出去（界面直接开新标签，不用再查一次文件）
    expect(byUrl.url).toBe("https://arxiv.org/abs/1706.03762");
    // 笔记没有链接，就不该凭空造一个
    expect(done("机制").results[0].url).toBeUndefined();
  });
});

describe("排序", () => {
  it("标题命中排在只有正文命中的前面（同一个词，标题里有关键信息）", () => {
    const found = done("注意力").results;
    expect(found[0].id).toBe("Transformer-的注意力机制-上");
    expect(found[0].matched).toContain("title");
  });

  it("分数相同时按更新时间新在前，且顺序稳定（重复调用完全一致）", () => {
    const corpus: SearchDocument[] = [
      {
        kind: "article",
        id: "old",
        title: "同题",
        category: "c",
        tags: [],
        text: "关键词在这里",
        updatedAt: "2026-01-01",
      },
      {
        kind: "article",
        id: "new",
        title: "同题",
        category: "c",
        tags: [],
        text: "关键词也在这里",
        updatedAt: "2026-02-02",
      },
    ];
    expect(ids("关键词", corpus)).toEqual(["new", "old"]);
    expect(ids("关键词", corpus)).toEqual(ids("关键词", corpus));
  });

  it("结果有上限，并明确告诉调用方被截断了", () => {
    const many: SearchDocument[] = Array.from({ length: MAX_RESULTS + 10 }, (_, i) => ({
      kind: "article" as const,
      id: `note-${String(i).padStart(3, "0")}`,
      title: `第 ${i} 篇`,
      category: "批量",
      tags: [],
      text: "共同关键词",
      updatedAt: "2026-10-30",
    }));
    const outcome = done("共同关键词", many);
    expect(outcome.results).toHaveLength(MAX_RESULTS);
    expect(outcome.truncated).toBe(true);
  });
});

describe("摘要与高亮", () => {
  it("高亮区间一定能从那个字符串里切出查询词（大小写差异允许）", () => {
    for (const query of ["注意力", "transformer", "模型"]) {
      for (const item of done(query).results) {
        const tokens = normalizeQuery(query);
        if (tokens.state !== "ok") throw new Error("期望 ok");
        for (const range of item.excerptRanges) {
          const slice = item.excerpt.slice(range.start, range.end).toLowerCase();
          expect(
            tokens.tokens.some((token) => slice.includes(token.toLowerCase())),
            `${query} → ${slice}`,
          ).toBe(true);
        }
        for (const range of item.titleRanges) {
          expect(range.end).toBeLessThanOrEqual(item.title.length);
          expect(range.start).toBeLessThan(range.end);
        }
      }
    }
  });

  it("摘要不回传全文（否则搜索等于把整个库吐给浏览器）", () => {
    const long = "前言".repeat(500) + "关键词" + "后记".repeat(500);
    const corpus: SearchDocument[] = [
      {
        kind: "article",
        id: "long",
        title: "长文",
        category: "c",
        tags: [],
        text: long,
        updatedAt: "2026-10-30",
      },
    ];
    const [item] = done("关键词", corpus).results;
    expect(item.excerpt.length).toBeLessThan(140);
    expect(item.excerpt).toContain("关键词");
  });

  it("截断的两端有省略号，从头开始时不加前导省略号", () => {
    const text = "关键词在开头。" + "填充".repeat(200);
    const hit = { start: 0, end: 3 };
    expect(buildExcerpt(text, [hit]).excerpt.startsWith("…")).toBe(false);
    expect(buildExcerpt(text, [hit]).excerpt.endsWith("…")).toBe(true);

    const tail = "填充".repeat(200) + "关键词在结尾。";
    const tailHit = { start: tail.indexOf("关键词"), end: tail.indexOf("关键词") + 3 };
    expect(buildExcerpt(tail, [tailHit]).excerpt.startsWith("…")).toBe(true);
    expect(buildExcerpt(tail, [tailHit]).excerpt.endsWith("…")).toBe(false);
  });

  it("摘要不劈开 UTF-16 代理对（emoji 落在窗口边界时整个保留）", () => {
    // 结尾边界：0..78 是 a，79 是高代理，80 是低代理 → 窗口末端正好落在 80（劈开）
    const tailCut = "a".repeat(79) + "😀" + "b".repeat(50);
    const tailOut = buildExcerpt(tailCut, [{ start: 0, end: 79 }]);
    expect(tailOut.excerpt).toContain("😀");
    expect(LONE_SURROGATE.test(tailOut.excerpt)).toBe(false);

    // 开头边界：起点 80 正好是低代理 → 必须退到 79
    const headCut = "a".repeat(79) + "😀" + "b".repeat(100);
    const headOut = buildExcerpt(headCut, [{ start: 120, end: 121 }]);
    expect(headOut.excerpt).toContain("😀");
    expect(LONE_SURROGATE.test(headOut.excerpt)).toBe(false);
    expect(headOut.excerpt.slice(headOut.ranges[0].start, headOut.ranges[0].end)).toBe(
      headCut.slice(120, 121),
    );
  });

  it("重叠的命中区间被合并（不能出现两层 mark 套在一起）", () => {
    expect(mergeRanges([{ start: 0, end: 3 }, { start: 2, end: 5 }])).toEqual([
      { start: 0, end: 5 },
    ]);
    expect(mergeRanges([{ start: 0, end: 2 }, { start: 2, end: 4 }])).toEqual([
      { start: 0, end: 4 },
    ]);
    expect(mergeRanges([{ start: 5, end: 7 }, { start: 0, end: 2 }])).toEqual([
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
  });

  it("区间永远有序、非空、且落在字符串内", () => {
    const outcome: SearchOutcome = searchDocuments(docs, "注意力 Transformer");
    if (outcome.state !== "done") throw new Error("期望 done");
    for (const item of outcome.results) {
      for (const ranges of [item.titleRanges, item.excerptRanges]) {
        let previousEnd = -1;
        for (const range of ranges) {
          expect(range.start).toBeGreaterThanOrEqual(previousEnd);
          expect(range.end).toBeGreaterThan(range.start);
          previousEnd = range.end;
        }
      }
      for (const range of item.excerptRanges) {
        expect(range.end).toBeLessThanOrEqual(item.excerpt.length);
      }
    }
  });

  it("只在标签里命中时也给正文开头做摘要（结果不能只有一行标题）", () => {
    const [item] = done("工具调用").results;
    expect(item.excerpt.length).toBeGreaterThan(0);
    expect(item.excerpt.startsWith("一个 Agent")).toBe(true);
    expect(item.excerptRanges).toEqual([]);
  });
});
