import { describe, expect, it } from "vitest";

import {
  MAX_RESOURCE_URL_LENGTH,
  isSafeResourceUrl,
  resourceHost,
} from "@/lib/security/resource-url";

/**
 * URL 白名单（阶段 4）。需求书 §8：外部链接仅允许安全协议；服务端也不去 fetch 用户给的地址。
 * 这里逐个撞「能让浏览器执行代码或碰本机文件」的协议。
 */

const OK = [
  "https://arxiv.org/abs/1706.03762",
  "http://example.com",
  "https://github.com/danri-web/ai-learning-lab",
  "https://example.com:8443/a/b?c=d#e",
  "  https://example.com/x  ", // 前后空格会被 trim
  "https://例子.测试/路径",
];

const BAD = [
  "javascript:alert(1)",
  "JavaScript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "file:///C:/Windows/win.ini",
  "file://server/share/x",
  "ftp://example.com/x",
  "example.com/x", // 裸域名：会被当成站内相对路径
  "/knowledge/transformer-basics",
  "//evil.com/x",
  "",
  "   ",
  "https://user:pass@example.com/x", // 带凭据：界面上会泄露、也没必要
  "https://",
  "x".repeat(MAX_RESOURCE_URL_LENGTH + 1),
];

describe("资源链接白名单", () => {
  it("http / https 通过", () => {
    for (const url of OK) expect(isSafeResourceUrl(url), url).toBe(true);
  });

  it("危险协议 / 相对路径 / 裸域名一律拒绝", () => {
    const leaked = BAD.filter((url) => isSafeResourceUrl(url));
    expect(leaked).toEqual([]);
  });

  it("非字符串与超长直接拒绝（不抛异常）", () => {
    expect(isSafeResourceUrl(null)).toBe(false);
    expect(isSafeResourceUrl(undefined)).toBe(false);
    expect(isSafeResourceUrl(123)).toBe(false);
  });

  it("展示用域名去掉 www 前缀，畸形 URL 不抛错", () => {
    expect(resourceHost("https://www.github.com/a/b")).toBe("github.com");
    expect(resourceHost("https://arxiv.org/abs/1")).toBe("arxiv.org");
    expect(resourceHost("not a url")).toBe("");
  });
});
