import { promises as fs } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 错误边界的源码闸门（阶段 8 收掉 ADR 里的「无 ErrorBoundary」风险）。
 *
 * 两种断言：
 *   1. 假样本能被抓出来 —— 证明检查本身有用（沿用 security-gates 的做法）
 *   2. 真实文件通过
 *
 * 为什么拦「import AppShell」：错误边界必须是 client 组件，而 AppShell 是服务端组件
 * （它读运行时 env）。client 里 import 服务端组件会直接构建失败 —— 与其等 build 报错，
 * 不如让源码闸门先说清楚。
 */

const ROOT = process.cwd();
const ERROR_PAGE = "app/error.tsx";

function problems(source: string): string[] {
  const issues: string[] = [];
  if (!source.trimStart().startsWith('"use client"')) issues.push("缺少 use client 指令");
  if (/components\/layout\/app-shell/.test(source))
    issues.push("client 错误边界 import 了服务端组件 AppShell");
  if (/from\s+["']node:fs["']/.test(source) || /@\/lib\/(?:fs|content)\//.test(source)) {
    issues.push("client 错误边界 import 了碰文件系统的模块");
  }
  if (!/reset\s*:\s*\(\)\s*=>\s*void/.test(source)) issues.push("没有 reset 回调");
  if (!/export\s+default\s+function/.test(source)) issues.push("没有默认导出");
  return issues;
}

describe("app/error.tsx（错误边界）", () => {
  it("真实文件满足 client 边界的所有约束", async () => {
    const source = await fs.readFile(path.join(ROOT, ERROR_PAGE), "utf8");
    expect(problems(source)).toEqual([]);
  });

  it("假样本会被抓出来（闸门自检）", () => {
    const bad = [
      'import { AppShell } from "@/components/layout/app-shell";',
      '"use client";',
      'import { promises as fs } from "node:fs";',
      "export default function ErrorPage() { return null; }",
    ].join("\n");
    const issues = problems(bad);
    expect(issues).toContain("缺少 use client 指令");
    expect(issues).toContain("client 错误边界 import 了服务端组件 AppShell");
    expect(issues).toContain("client 错误边界 import 了碰文件系统的模块");
    expect(issues).toContain("没有 reset 回调");
  });

  it("有「再试一次」和「回到总览」两个出口", async () => {
    const source = await fs.readFile(path.join(ROOT, ERROR_PAGE), "utf8");
    expect(source).toContain("再试一次");
    expect(source).toContain('href="/"');
  });
});
