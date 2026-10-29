import path from "node:path";
import { describe, expect, it } from "vitest";

import { listArticles, readArticle } from "@/lib/content/articles";
import { parseArticle } from "@/lib/content/frontmatter";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "articles");

describe("frontmatter 校验", () => {
  const good = `---
id: hello
title: 你好
category: 测试
tags:
  - a
createdAt: "2026-10-01"
updatedAt: "2026-10-02"
---

正文`;

  it("合法的解析成功，正文被剥掉 frontmatter", () => {
    const result = parseArticle(good, "hello");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.title).toBe("你好");
      expect(result.article.tags).toEqual(["a"]);
      expect(result.article.body).toBe("正文");
    }
  });

  it("tags 缺省 = 空数组（唯一允许的补默认值）", () => {
    const noTags = good.replace("tags:\n  - a\n", "");
    const result = parseArticle(noTags, "hello");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.article.tags).toEqual([]);
  });

  it.each([
    ["缺 title", good.replace("title: 你好\n", "")],
    ["缺 category", good.replace("category: 测试\n", "")],
    ["日期格式错", good.replace('createdAt: "2026-10-01"', "createdAt: 2026/10/01")],
    [
      "updatedAt 早于 createdAt",
      good.replace('updatedAt: "2026-10-02"', 'updatedAt: "2026-09-01"'),
    ],
    ["标题空白", good.replace("title: 你好", "title: '   '")],
    ["不是 YAML", "---\nid: hello\n: : :\n---\n正文"],
  ])("非法样本必须被拒绝：%s", (_label, source) => {
    const result = parseArticle(source, "hello");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("id 与文件名不一致必须拒绝（两个人抢同一个身份）", () => {
    const result = parseArticle(good, "another-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("不一致");
  });
});

describe("正文目录路径", () => {
  it("articlesRoot() 与 ARTICLES_DIR 指向同一个目录（防止两处字面量漂移）", async () => {
    const { articlesRoot } = await import("@/lib/content/articles");
    const { ARTICLES_DIR } = await import("@/lib/security/paths");
    expect(articlesRoot()).toBe(path.resolve(process.cwd(), ARTICLES_DIR));
  });
});
describe("列目录", () => {
  it("读出正常笔记，异常文件单独报出来，下划线开头的被跳过", async () => {
    const { articles, problems, missingRoot } = await listArticles(FIXTURES);

    expect(missingRoot).toBe(false);
    expect(articles.map((item) => item.id).sort()).toEqual(["ragging", "transformer-basics"]);
    // 三个问题文件：缺分类 / id 不一致 / 中文文件名
    expect(problems.map((item) => item.file).sort()).toEqual(
      ["id-mismatch.md", "missing-category.md", "中文笔记.md"].sort(),
    );
    // 下划线开头的不在任何一边
    expect(articles.some((item) => item.id.includes("draft"))).toBe(false);
    expect(problems.some((item) => item.file.includes("draft"))).toBe(false);
  });

  it("按 updatedAt 倒序排（最新的在最前）", async () => {
    const { articles } = await listArticles(FIXTURES);
    expect(articles.map((item) => item.id)).toEqual(["ragging", "transformer-basics"]);
  });

  it("目录不存在时返回 missingRoot，而不是抛错", async () => {
    const result = await listArticles(path.join(FIXTURES, "definitely-not-here"));
    expect(result).toMatchObject({ articles: [], problems: [], missingRoot: true });
  });
});

describe("读单篇", () => {
  it("存在 → 拿到正文", async () => {
    const result = await readArticle("transformer-basics", FIXTURES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.article.body).toContain("缩放点积注意力");
  });

  it("不存在 → not-found", async () => {
    const result = await readArticle("no-such-article", FIXTURES);
    expect(result).toMatchObject({ ok: false, reason: "not-found" });
  });

  it.each(["../etc/passwd", "..", "a/b", "CON", "x".repeat(70)])(
    "非法 id 直接拒绝：%s",
    async (id) => {
      const result = await readArticle(id, FIXTURES);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("invalid");
    },
  );

  it("frontmatter 坏掉 → invalid，并且给出人能看懂的原因", async () => {
    const result = await readArticle("missing-category", FIXTURES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
      expect(result.error).toContain("category");
    }
  });
});
