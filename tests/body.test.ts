import { describe, expect, it } from "vitest";

import { stripLeadingDuplicateH1 } from "@/lib/markdown/body";

describe("去掉与标题重复的首个 H1", () => {
  it("标题一致 → 删掉那一行", () => {
    const body = "# Transformer 基础\n\n正文第一段";
    expect(stripLeadingDuplicateH1(body, "Transformer 基础")).toBe("正文第一段");
  });

  it("忽略大小写与多余空格", () => {
    const body = "#  transformer   基础\n\n正文";
    expect(stripLeadingDuplicateH1(body, "Transformer 基础")).toBe("正文");
  });

  it("标题不一致 → 原样保留（不做聪明的猜测）", () => {
    const body = "# 另一个标题\n\n正文";
    expect(stripLeadingDuplicateH1(body, "Transformer 基础")).toBe(body);
  });

  it("没有 H1 → 原样保留", () => {
    const body = "## 小节\n\n正文";
    expect(stripLeadingDuplicateH1(body, "Transformer 基础")).toBe(body);
  });

  it("前面的空行不影响判断", () => {
    const body = "\n\n# 标题\n\n正文";
    expect(stripLeadingDuplicateH1(body, "标题")).toBe("正文");
  });
});
