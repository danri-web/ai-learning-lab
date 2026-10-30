import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = join(ROOT, "app");

/**
 * 关系断言：只要 app/ 下的 Server Action 或受保护 Route Handler 存在，
 * 它就必须在函数体里调 `requireAuth()`（不是只在文件里 import 一下）。
 *
 * 这不是 AST，是按 `export async function` 切块的正则扫描；扫描器先用假样本自检，
 * 免得「正则写错了，整页绿」——那正是阶段 3 审计里出现过的那类假绿。
 */

type SourceFile = { path: string; text: string };

function collect(dir: string, suffix: string): SourceFile[] {
  const out: SourceFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full, suffix));
    else if (entry.endsWith(suffix)) {
      out.push({
        path: relative(ROOT, full).replaceAll("\\", "/"),
        text: readFileSync(full, "utf8"),
      });
    }
  }
  return out;
}

function exportedAsyncBlocks(source: string): string[] {
  return source
    .split(/(?=export\s+async\s+function\s+)/)
    .filter((block) => /^export\s+async\s+function\s+/.test(block));
}

function missingAuth(file: SourceFile): string[] {
  return exportedAsyncBlocks(file.text)
    .filter((block) => !block.includes("requireAuth("))
    .map((block) => {
      const name = /^export\s+async\s+function\s+([A-Za-z0-9_]+)/.exec(block)?.[1] ?? "?";
      return `${file.path}#${name}`;
    });
}

describe("每个 Server Action 都要过写入门", () => {
  const actions = collect(APP, "actions.ts");

  it("至少找到了 action 文件（防止 collect 写错路径导致空扫描）", () => {
    expect(actions.map((file) => file.path).sort()).toEqual(
      expect.arrayContaining([
        "app/(workspace)/knowledge/actions.ts",
        "app/(workspace)/resources/actions.ts",
        "app/(workspace)/learning/actions.ts",
        "app/(workspace)/search-actions.ts",
        "app/(workspace)/backup/actions.ts",
      ]),
    );
  });

  it("每个 export async function 的函数体里都有 requireAuth(", () => {
    expect(actions.flatMap(missingAuth)).toEqual([]);
  });

  it("扫描器自检：缺 requireAuth 的假样本必须被抓到", () => {
    const fixture: SourceFile = {
      path: "app/fake/actions.ts",
      text: [
        '"use server";',
        "export async function bad() {",
        "  return 1;",
        "}",
        "export async function good() {",
        "  await requireAuth();",
        "  return 2;",
        "}",
      ].join("\n"),
    };
    expect(missingAuth(fixture)).toEqual(["app/fake/actions.ts#bad"]);
  });
});

describe("受保护的 Route Handler 也要过门", () => {
  const routes = collect(APP, "route.ts").filter(
    (file) =>
      !file.path.endsWith("app/api/auth/login/route.ts") &&
      !file.path.endsWith("app/api/auth/logout/route.ts"),
  );

  it("备份下载路由存在，并且调用 requireAuth", () => {
    const download = routes.find(
      (file) => file.path.includes("/backup/") && file.path.endsWith("download/route.ts"),
    );
    expect(download).toBeTruthy();
    if (download) expect(download.text).toContain("await requireAuth()");
  });

  it("其它受保护 route 也都调用 requireAuth（假样本证明扫描器有效）", () => {
    const fixture: SourceFile = {
      path: "app/fake/route.ts",
      text: "export async function GET() { return new Response('x'); }",
    };
    expect(missingAuth(fixture)).toEqual(["app/fake/route.ts#GET"]);
    expect(routes.flatMap(missingAuth)).toEqual([]);
  });
});

describe("每个工作区页面都在布局门之内", () => {
  it("所有 page.tsx 都在 app/(workspace)/ 或 app/login/ 下", () => {
    const pages = collect(APP, "page.tsx").map((file) => file.path);
    const outside = pages.filter(
      (page) => !page.startsWith("app/(workspace)/") && page !== "app/login/page.tsx",
    );
    expect(outside).toEqual([]);
  });

  it("工作区布局调用 requirePageAuth", () => {
    const layout = readFileSync(join(APP, "(workspace)", "layout.tsx"), "utf8");
    expect(layout).toContain("await requirePageAuth()");
  });
});
