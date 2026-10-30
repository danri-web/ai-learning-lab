import { describe, expect, it } from "vitest";

import {
  assignHeadingIds,
  headingTextOf,
  nextHeadingId,
  slugifyHeading,
  type HastNode,
} from "@/lib/markdown/heading-ids";
import { extractToc } from "@/lib/markdown/toc";

/**
 * 审计 v3 F4：目录给同名标题加后缀（`example-1`），渲染器却不加 —— 第二个目录链接没有落点。
 * 现在两边共用 `nextHeadingId`。这组测试就是「两边必须算出同一份 id」的等式证明。
 */

const element = (tagName: string, ...children: HastNode[]): HastNode => ({
  type: "element",
  tagName,
  properties: {},
  children,
});

const text = (value: string): HastNode => ({ type: "text", value });

const root = (...children: HastNode[]): HastNode => ({ type: "root", children });

describe("锚点 id 分配", () => {
  it("按出现顺序去重：同名标题得到 example / example-1", () => {
    const seen = new Map<string, number>();
    expect(nextHeadingId("Example", seen)).toBe("example");
    expect(nextHeadingId("Example", seen)).toBe("example-1");
    expect(nextHeadingId("Example", seen)).toBe("example-2");
    // 不同标题各算各的
    expect(nextHeadingId("Other", seen)).toBe("other");
  });

  it("给 hast 树里的 h2/h3 写 id，h1 与正文元素不动", () => {
    const tree = root(
      element("h1", text("大标题")),
      element("h2", text("Example")),
      element("p", text("正文")),
      element("h3", text("Example")),
      element("h2", text("示例")),
    );

    const assigned = assignHeadingIds(tree);

    expect(assigned.map((entry) => entry.id)).toEqual(["example", "example-1", "示例"]);
    expect(tree.children?.[0].properties?.id).toBeUndefined();
    expect(tree.children?.[1].properties?.id).toBe("example");
    expect(tree.children?.[3].properties?.id).toBe("example-1");
    expect(tree.children?.[4].properties?.id).toBe("示例");
  });

  it("标题里的行内元素（代码/加粗/链接）文字会被拼起来再算 slug", () => {
    const tree = root(
      element("h2", text("用 "), element("code", text("useSyncExternalStore")), text(" 修 水合")),
    );
    expect(assignHeadingIds(tree)[0].id).toBe("用-usesyncexternalstore-修-水合");
  });

  it("每次分配都是独立状态（同一棵树渲染两次结果相同，不会越编越大）", () => {
    const make = () => root(element("h2", text("Example")), element("h2", text("Example")));
    expect(assignHeadingIds(make()).map((entry) => entry.id)).toEqual(["example", "example-1"]);
    expect(assignHeadingIds(make()).map((entry) => entry.id)).toEqual(["example", "example-1"]);
  });

  it("headingTextOf 能把嵌套结构摊平", () => {
    expect(headingTextOf(element("h2", text("a"), element("strong", text("b"))))).toBe("ab");
  });
});

describe("目录与渲染的 id 必须一致（F4 的等式）", () => {
  it("同名标题：目录拿到的 id，和渲染器分配到的完全一样", () => {
    const markdown = [
      "## Example",
      "",
      "正文",
      "",
      "### Example",
      "",
      "## Example",
      "",
      "## 中文标题",
      "",
      "## 中文标题",
    ].join("\n");

    const fromToc = extractToc(markdown).map((entry) => entry.id);

    // 用同样顺序搭一棵 hast 树（相当于渲染器看到的结构）
    const tree = root(
      element("h2", text("Example")),
      element("h3", text("Example")),
      element("h2", text("Example")),
      element("h2", text("中文标题")),
      element("h2", text("中文标题")),
    );
    const fromRenderer = assignHeadingIds(tree).map((entry) => entry.id);

    expect(fromRenderer).toEqual(fromToc);
    expect(fromRenderer).toEqual(["example", "example-1", "example-2", "中文标题", "中文标题-1"]);
    // 每个目录锚点都恰好对应一个标题（没有重复 id、没有落空的链接）
    expect(new Set(fromToc).size).toBe(fromToc.length);
  });

  it("标题里带链接：目录与渲染都要剥掉 URL 再算 slug", () => {
    const markdown = "## [Attention](https://example.com/a)";
    const fromToc = extractToc(markdown);
    const tree = root(element("h2", text("Attention")));

    expect(fromToc[0].id).toBe(assignHeadingIds(tree)[0].id);
    expect(fromToc[0].text).toBe("Attention");
  });

  it("slugifyHeading 保持原有行为（改它等于改所有旧链接）", () => {
    expect(slugifyHeading("Why Attention Matters")).toBe("why-attention-matters");
    expect(slugifyHeading("用 `useSyncExternalStore` **修** 水合")).toBe(
      "用-usesyncexternalstore-修-水合",
    );
    expect(slugifyHeading("· · ·")).toBe("section");
  });
});
