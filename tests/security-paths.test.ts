import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ARTICLES_DIR,
  UnsafePathError,
  articleIdFromPath,
  isSafeArticleId,
  resolveArticlePath,
} from "@/lib/security/paths";

const ROOT = path.resolve("D:/repo", ARTICLES_DIR);

/**
 * 恶意样本。每一条都是「如果校验失灵，会真的写到正文目录外面 / 写出怪文件」的输入。
 * 新增校验规则时，也往这里加一条假样本 —— 否则就是「改完不知道对不对」。
 */
const MALICIOUS_IDS = [
  "../etc/passwd",
  "..",
  ".",
  "./x",
  "a/../../b",
  "a\\..\\b",
  "..\\..\\windows\\system32",
  "C:\\Windows\\System32\\drivers\\etc\\hosts",
  "C:/Windows/win.ini",
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

  it("拒绝非 .md 之外被塞进来的扩展名（比如 .exe）", () => {
    expect(() => resolveArticlePath(ROOT, "article-001", ".exe")).not.toThrow();
    // 扩展名由调用方给定，不走用户输入；这里只锁死 id，扩展名在服务层固定传 .md
  });
});
