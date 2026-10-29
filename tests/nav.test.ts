import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { NAV_ITEMS, isActivePath } from "@/components/layout/nav-items";

const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));

/** 路由 → 页面文件（路由组 (workspace) 不进 URL） */
function pageFileFor(href: string): string {
  const segment = href === "/" ? "" : `${href.slice(1)}/`;
  return `${APP_DIR}(workspace)/${segment}page.tsx`;
}

describe("导航项", () => {
  it("每个导航项都指向一个真实存在的页面文件（防止侧栏链到不存在的页面）", () => {
    const missing = NAV_ITEMS.filter((item) => !existsSync(pageFileFor(item.href))).map(
      (item) => `${item.href} → ${pageFileFor(item.href)}`,
    );
    expect(missing).toEqual([]);
  });

  it("路由不重复，中文与英文标签也不重复", () => {
    const unique = (values: string[]) => new Set(values).size === values.length;
    expect(unique(NAV_ITEMS.map((item) => item.href))).toBe(true);
    expect(unique(NAV_ITEMS.map((item) => item.label))).toBe(true);
    expect(unique(NAV_ITEMS.map((item) => item.en))).toBe(true);
  });

  it("每个页面都用侧栏标签当自己的标题（浏览器标签页能区分五个页面）", () => {
    const wrong = NAV_ITEMS.filter((item) => {
      const source = readFileSync(pageFileFor(item.href), "utf8");
      return !source.includes(`title: "${item.label}"`);
    }).map((item) => item.href);
    expect(wrong).toEqual([]);
  });
});

describe("对外壳的要求", () => {
  it("有 404 页面，并且它套着应用外壳（出错时不会掉进没有导航的空白页）", () => {
    const notFoundPath = `${APP_DIR}not-found.tsx`;
    expect(existsSync(notFoundPath)).toBe(true);
    const source = readFileSync(notFoundPath, "utf8");
    expect(source).toContain("AppShell");
    expect(source).toContain('href="/"');
  });

  it("主内容区可以被跳过导航链接聚焦（否则键盘用户跳不过来）", () => {
    const shell = readFileSync(`${APP_DIR}../components/layout/app-shell.tsx`, "utf8");
    expect(shell).toContain('id="main"');
    expect(shell).toContain("tabIndex={-1}");
  });
});

describe("isActivePath", () => {
  it("根路径只在完全相等时高亮，不会把其它页面也点亮", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/knowledge", "/")).toBe(false);
  });

  it("子路径也算父级选中，但相似前缀不算", () => {
    expect(isActivePath("/knowledge", "/knowledge")).toBe(true);
    expect(isActivePath("/knowledge/article_001", "/knowledge")).toBe(true);
    expect(isActivePath("/knowledge-base", "/knowledge")).toBe(false);
  });
});
