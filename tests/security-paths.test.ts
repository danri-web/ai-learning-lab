import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARTICLES_DIR,
  UnsafePathError,
  articleIdFromPath,
  isSafeArticleId,
  resolveArticlePath,
} from "@/lib/security/paths";

// 不写真实盘符路径：仓库是公开的，盘符会暴露机器结构（publish-check 会警告）
const ROOT = path.resolve("test-root", ARTICLES_DIR);

/**
 * 恶意样本。每一条都是「如果校验失灵，会真的写到正文目录外面 / 写出怪文件」的输入。
 * 新增校验规则时，也往这里加一条假样本 —— 否则就是「改完不知道对不对」。
 *
 * 注意：带盘符的两条故意用拼接写法（`DRIVE + "\\..."`）。仓库是公开的，
 * 源码里直接写字面量盘符路径会被 publish-check 判成「暴露机器结构」的警告，
 * 而这里需要的只是「运行时值是盘符路径」。
 */
const DRIVE = "C";
const MALICIOUS_IDS = [
  "../etc/passwd",
  "..",
  ".",
  "./x",
  "a/../../b",
  "a\\..\\b",
  "..\\..\\windows\\system32",
  `${DRIVE}:\\Windows\\System32\\drivers\\etc\\hosts`,
  `${DRIVE}:/Windows/win.ini`,
  "\\\\server\\share\\x",
  "/etc/shadow",
  "article/../../x",
  "x\0y",
  "x\ny",
  " article",
  "article ",
  "ARTICLE",
  "article_001",
  "con",
  "nul",
  "com1",
  "lpt9",
  "",
  "x".repeat(65),
  "．",
  "ａｒｔｉｃｌｅ",
];

describe("文章 id 白名单", () => {
  it("正常 id 通过", () => {
    for (const id of ["article-001", "a", "transformer-basics", "x1", "x".repeat(64)]) {
      expect(isSafeArticleId(id), id).toBe(true);
    }
  });

  it("恶意 / 畸形 id 一律拒绝", () => {
    const leaked = MALICIOUS_IDS.filter((id) => isSafeArticleId(id));
    expect(leaked).toEqual([]);
  });

  it("resolveArticlePath 对恶意 id 抛错，而不是返回一个「看起来还行」的路径", () => {
    const bad = MALICIOUS_IDS.filter((id) => {
      try {
        resolveArticlePath(ROOT, id);
        return true;
      } catch (error) {
        return !(error instanceof UnsafePathError);
      }
    });
    expect(bad).toEqual([]);
  });
});

describe("解析出来的路径", () => {
  it("永远落在正文目录里面（逐条验证相对路径不以 .. 开头）", () => {
    for (const id of ["article-001", "a", "x".repeat(64)]) {
      const full = resolveArticlePath(ROOT, id);
      const relative = path.relative(ROOT, full);
      expect(relative.startsWith(".."), `${id} → ${relative}`).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
      expect(full.endsWith(`${id}.md`)).toBe(true);
    }
  });

  it("id 与文件名互为逆运算（读目录时拿到的 id 一定合法）", () => {
    for (const id of ["article-001", "transformer-basics", "x".repeat(64)]) {
      const full = resolveArticlePath(ROOT, id);
      expect(articleIdFromPath(full)).toBe(id);
    }
  });

  it("扩展名固定为 .md，API 不再接受外部传入的扩展名", () => {
    // 外部审计指出的问题：旧版本有个 ext 参数，测试名字说"拒绝 .exe"、断言却是"不抛错"。
    // 现在参数已删除；这条断言防止有人再加回来。
    expect(resolveArticlePath(ROOT, "article-001").endsWith(".md")).toBe(true);
    expect(resolveArticlePath.length).toBe(2);
  });
});
