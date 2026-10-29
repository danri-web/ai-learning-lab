import { describe, expect, it } from "vitest";

import { extractToc, slugifyHeading } from "@/lib/markdown/toc";

describe("标题锚点", () => {
  it("英文转小写、空格变连字符", () => {
    expect(slugifyHeading("Why Attention Matters")).toBe("why-attention-matters");
  });

  it("中文保留（HTML5 的 id 允许非 ASCII）", () => {
    expect(slugifyHeading("为什么需要它")).toBe("为什么需要它");
  });

  it("行内代码的反引号与强调符号被去掉", () => {
    expect(slugifyHeading("用 `useSyncExternalStore` **修** 水合")).toBe(
      "用-usesyncexternalstore-修-水合",
    );
  });

  it("全是符号时给一个兜底 id，不返回空串", () => {
    expect(slugifyHeading("· · ·")).toBe("section");
  });
});

describe("提取目录", () => {
  const markdown = [
    "# 一级标题不进目录",
    "",
    "## 第一节",
    "",
    "正文里的 ## 不是标题？这句只是普通文字。",
    "",
    "### 小节 A",
    "",
    "```bash",
    "## 代码块里的假标题",
    "```",
    "",
    "## 重复的标题",
    "## 重复的标题",
  ].join("\n");

  it("只收 h2/h3，跳过 h1", () => {
    const toc = extractToc(markdown);
    expect(toc.map((entry) => entry.text)).toEqual([
      "第一节",
      "小节 A",
      "重复的标题",
      "重复的标题",
    ]);
    expect(toc.map((entry) => entry.level)).toEqual([2, 3, 2, 2]);
  });

  it("代码块里的 ## 不算标题（最容易出错的边界）", () => {
    const toc = extractToc(markdown);
    expect(toc.some((entry) => entry.text.includes("假标题"))).toBe(false);
  });

  it("同名标题的锚点自动加后缀，不会互相顶掉", () => {
    const toc = extractToc(markdown);
    const ids = toc.map((entry) => entry.id);
    expect(ids).toContain("重复的标题");
    expect(ids).toContain("重复的标题-1");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("没有标题时返回空数组", () => {
    expect(extractToc("只有正文，没有标题")).toEqual([]);
  });
});
