import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { toSearchText } from "@/lib/search/plain-text";
import { loadSearchCorpus, searchLibrary } from "@/lib/search/sources";

const SEARCH_FIXTURES = path.join(process.cwd(), "tests", "fixtures", "search");
const BROKEN_FIXTURES = path.join(process.cwd(), "tests", "fixtures", "search-broken");

const roots = { articlesRoot: path.join(SEARCH_FIXTURES, "articles"), contentRoot: SEARCH_FIXTURES };

function resultsOf(response: Awaited<ReturnType<typeof searchLibrary>>) {
  if (response.outcome.state !== "done") {
    throw new Error(`期望 done，实际是 ${response.outcome.state}`);
  }
  return response.outcome.results;
}

/** 递归列出目录下所有文件（带大小与 mtime），用来证明"搜索没动过任何文件" */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const info = statSync(full);
        out.push(`${path.relative(dir, full)}|${info.size}|${info.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

describe("搜索取数层（只读，不越界）", () => {
  it("只有合法笔记进语料：草稿、回收站、坏 frontmatter 都不算", async () => {
    const corpus = await loadSearchCorpus(roots);
    expect(corpus.counts).toEqual({ articles: 2, resources: 1 });
    expect(corpus.documents.filter((doc) => doc.kind === "article").map((doc) => doc.id).sort()).toEqual(
      ["agent-loop", "注意力机制"].sort(),
    );
    // 坏掉的那篇要**报出来**，不能悄悄消失
    expect(corpus.problems.map((problem) => problem.file)).toContain("broken.md");
  });

  it("草稿 / 回收站 / 坏笔记里的内容搜不到（搜索不越过 content/articles 的可见范围）", async () => {
    const response = await searchLibrary("秘密关键词", roots);
    expect(resultsOf(response)).toEqual([]);
    // 而且"搜不到"不能是因为整页崩了 —— 正常返回，问题单独报
    expect(response.outcome.state).toBe("done");
    expect(response.problems.length).toBeGreaterThan(0);
  });

  it("正文进语料前被整成一行（井号/围栏不进摘要）", async () => {
    const corpus = await loadSearchCorpus(roots);
    const article = corpus.documents.find((doc) => doc.id === "注意力机制");
    expect(article?.text).toContain("RNN 顺序处理");
    expect(article?.text).not.toContain("##");
    expect(article?.text).not.toContain("```");
    expect(article?.text).not.toContain("---");
    expect(article?.text).not.toContain("\n");
  });

  it("资源带上链接；搜链接也能找到（按域名找收藏是常见需求）", async () => {
    const corpus = await loadSearchCorpus(roots);
    const resource = corpus.documents.find((doc) => doc.kind === "resource");
    expect(resource?.url).toBe("https://arxiv.org/abs/1706.03762");

    const [hit] = resultsOf(await searchLibrary("arxiv", roots));
    expect(hit.kind).toBe("resource");
    expect(hit.id).toBe("attention-paper");
  });

  it("同一个词跨笔记与资源都能命中，并带上各自的 kind（界面要分组）", async () => {
    const hits = resultsOf(await searchLibrary("Transformer", roots));
    expect(new Set(hits.map((hit) => hit.kind))).toEqual(new Set(["article", "resource"]));
  });

  it("resource.json 坏掉时只报一条问题，不抛错、不冒充空库", async () => {
    const response = await searchLibrary("attention", {
      articlesRoot: path.join(SEARCH_FIXTURES, "articles"),
      contentRoot: BROKEN_FIXTURES,
    });
    expect(response.counts.resources).toBe(0);
    expect(response.problems.map((problem) => problem.file)).toContain("resources.json");
    expect(response.outcome.state).toBe("done");
  });

  it("搜一次不改任何文件（搜索是只读路径，别让它有写的机会）", async () => {
    const before = snapshot(SEARCH_FIXTURES);
    await searchLibrary("注意力", roots);
    await searchLibrary("Transformer", roots);
    expect(snapshot(SEARCH_FIXTURES)).toEqual(before);
  });

  it("给出扫描耗时与条数（界面上要写「已扫描 N 篇 · X ms」）", async () => {
    const response = await searchLibrary("注意力", roots);
    expect(Number.isFinite(response.tookMs)).toBe(true);
    expect(response.tookMs).toBeGreaterThanOrEqual(0);
    expect(response.counts).toEqual({ articles: 2, resources: 1 });
  });

  it("空查询也不扫盘（返回 empty，仍带上条数方便界面显示）", async () => {
    const response = await searchLibrary("   ", roots);
    expect(response.outcome).toEqual({ state: "empty" });
    expect(response.counts.articles).toBe(2);
  });
});

describe("Markdown → 一行文字", () => {
  it("去掉标题井号、列表符号、引用符与代码围栏", () => {
    const source = [
      "## 为什么需要它",
      "",
      "- 第一点",
      "1. 第二点",
      "> 引用一句",
      "```python",
      "def attention(): pass",
      "```",
    ].join("\n");
    const text = toSearchText(source);
    expect(text).not.toMatch(/^#/);
    expect(text).not.toContain("- 第一点");
    expect(text).toContain("第一点");
    expect(text).toContain("第二点");
    expect(text).toContain("引用一句");
    expect(text).toContain("def attention(): pass");
  });

  it("表格的分隔行不进口摘要，竖线变空格（否则摘要一开头就是一片 | 与 -）", () => {
    const table = ["| 结构 | 并行 |", "| --- | --- |", "| RNN | 否 |"].join("\n");
    const text = toSearchText(table);
    expect(text).not.toContain("|");
    expect(text).not.toMatch(/---/);
    expect(text).toBe("结构 并行 RNN 否");
  });

  it("连续空白压成一个空格，不破坏中文", () => {
    expect(toSearchText("注意力\n\n   机制\t（上）")).toBe("注意力 机制 （上）");
  });

  it("空正文不会变成 undefined 或抛错", () => {
    expect(toSearchText("")).toBe("");
    expect(toSearchText("   \n\n ")).toBe("");
  });
});

describe("夹具自检", () => {
  it("固定样本没有被顺手改掉：两篇好笔记 + 一篇坏笔记 + 一份坏 JSON", () => {
    const files = readdirSync(path.join(SEARCH_FIXTURES, "articles")).filter((name) =>
      name.endsWith(".md"),
    );
    expect(files.sort()).toEqual(["agent-loop.md", "broken.md", "_draft-skip.md", "注意力机制.md"].sort());
    expect(readFileSync(path.join(BROKEN_FIXTURES, "resources.json"), "utf8")).toContain("not json");
  });
});
