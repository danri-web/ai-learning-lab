import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseArticle, readFrontmatter } from "@/lib/content/frontmatter";
import { createArticle } from "@/lib/content/write";

/**
 * SEC-01 回归：gray-matter 4.0.3 的 `---javascript` / `---js` 会 `eval`。
 * 断言方式不是“看起来被拒绝”，而是**执行标记必须保持 0**：
 * 只要解析器真的跑了 payload，标记就会变成 1，测试立刻红。
 */

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const markerHolder = globalThis as typeof globalThis & { __aiLabFrontmatterMarker?: number };

function marker(): number {
  return markerHolder.__aiLabFrontmatterMarker ?? 0;
}

const FIELDS =
  'id: "hello", title: "你好", category: "测试", tags: [], createdAt: "2026-10-01", updatedAt: "2026-10-02"';

const JAVASCRIPT = `---javascript
(globalThis.__aiLabFrontmatterMarker = 1, { ${FIELDS} })
---
正文`;

const JS_ALIAS = `---js
(globalThis.__aiLabFrontmatterMarker = 2, { ${FIELDS} })
---
正文`;

describe("frontmatter 不允许执行代码（SEC-01）", () => {
  beforeEach(() => {
    markerHolder.__aiLabFrontmatterMarker = 0;
  });

  afterEach(() => {
    delete markerHolder.__aiLabFrontmatterMarker;
  });

  it("---javascript 被拒绝，payload 从未执行", () => {
    const result = parseArticle(JAVASCRIPT, "hello");
    expect(result.ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("---js 别名同样被拒绝", () => {
    const result = parseArticle(JS_ALIAS, "hello");
    expect(result.ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("readFrontmatter（保存时读旧字段）也不会执行", () => {
    expect(() => readFrontmatter(JAVASCRIPT)).toThrow(/可执行语言/);
    expect(marker()).toBe(0);
  });

  it("普通 YAML 仍然能正常解析", () => {
    const source = `---
id: hello
title: 你好
category: 测试
createdAt: "2026-10-01"
updatedAt: "2026-10-02"
---
正文`;
    const result = parseArticle(source, "hello");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.article.title).toBe("你好");
  });
});

describe("写笔记时不解析正文里的 ---javascript（SEC-01 写入路径）", () => {
  let dir: string;

  beforeEach(async () => {
    await fs.mkdir(TMP, { recursive: true });
    dir = await fs.mkdtemp(path.join(TMP, "frontmatter-security-"));
    markerHolder.__aiLabFrontmatterMarker = 0;
  });

  afterEach(async () => {
    delete markerHolder.__aiLabFrontmatterMarker;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("正文首行是 ---javascript 时，只把它当正文，不执行", async () => {
    const root = path.join(dir, "articles");
    const body = "---javascript\n(globalThis.__aiLabFrontmatterMarker = 3, {})\n---\n正文";
    const created = await createArticle(
      { title: "安全写入", category: "测试", tags: [], body },
      { root },
    );
    expect(created.ok).toBe(true);
    expect(marker()).toBe(0);

    const text = await fs.readFile(path.join(root, "安全写入.md"), "utf8");
    expect(text).toContain("---javascript");
    expect(text).toContain("正文");
  });
});
