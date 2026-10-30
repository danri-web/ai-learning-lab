import { expect, test } from "@playwright/test";

import { openSearch } from "./helpers";

/**
 * 性能检查（阶段 8）：记录真实数字，阈值定得宽松 —— 本地单用户应用，
 * 这里要抓的是「某次改动把页面拖成几秒」这种退化，不是微基准。
 *
 * 数字会写进 README「测试与发布」一节；每次跑 E2E 都会重新打印。
 */
const PAGES: Array<{ path: string; name: string }> = [
  { path: "/", name: "总览" },
  { path: "/knowledge", name: "知识库" },
  { path: "/resources", name: "资源收藏" },
  { path: "/learning", name: "学习任务" },
  { path: "/backup", name: "备份" },
];

test.describe("性能", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "性能基线只在桌面项目跑");

  test("五个页面的导航耗时与搜索耗时在预算内", async ({ page }) => {
    const timings: Array<{ name: string; domContentLoaded: number; load: number }> = [];

    for (const entry of PAGES) {
      await page.goto(entry.path);
      await page.waitForLoadState("load");
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        return {
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
          load: Math.round(nav.loadEventEnd - nav.startTime),
        };
      });
      timings.push({ name: entry.name, ...timing });

      // 本地生产构建：3 秒已经是很宽的线，超过它说明真的退化了
      expect(timing.domContentLoaded, `${entry.name} 的 DOMContentLoaded 超过 3s`).toBeLessThan(
        3000,
      );
    }

    for (const row of timings) {
      console.log(
        `[perf] ${row.name}: DOMContentLoaded ${row.domContentLoaded}ms / load ${row.load}ms`,
      );
    }

    // 搜索：界面自己会写「已扫描 N 篇笔记 / M 条资源 · X ms」，直接读它（和用户看到的一致）
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox", { name: "搜索关键词" }).fill("E2E检索标记");

    const footer = dialog.getByText(/已扫描 \d+ 篇笔记 \/ \d+ 条资源 · [\d.]+ ms/);
    await expect(footer).toBeVisible();
    const text = await footer.textContent();
    const match = text?.match(/已扫描 (\d+) 篇笔记 \/ (\d+) 条资源 · ([\d.]+) ms/);
    expect(match, `搜索状态文本不可解析：${text}`).not.toBeNull();

    const articles = Number(match![1]);
    const resources = Number(match![2]);
    const tookMs = Number(match![3]);
    console.log(`[perf] 搜索：${articles} 篇笔记 / ${resources} 条资源 · ${tookMs}ms`);
    // 夹具是 2 篇笔记 / 2 条资源；别的测试若留下临时笔记，笔记数只会更多
    expect(articles).toBeGreaterThanOrEqual(2);
    expect(resources).toBe(2);
    expect(tookMs).toBeLessThan(500);
  });
});
