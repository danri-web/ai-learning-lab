import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { FIXTURE_NOTE_ID, LAN_URL, openSearch } from "./helpers";

/**
 * 可访问性：用 axe 扫 WCAG 2 A/AA（阶段 8 需求「可访问性检查」）。
 *
 * 只把 critical / serious 当失败：moderate / minor 里混着一些对本地单用户应用
 * 意义不大的建议（landmark 最佳实践、区域语言细节），全按 0 要求会变成噪音。
 * 所有级别的结果都打印出来，方便人工判断（ADR D14）。
 */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const PAGES: Array<{ path: string; name: string }> = [
  { path: "/", name: "总览" },
  { path: "/knowledge", name: "知识库列表" },
  { path: `/knowledge/${encodeURIComponent(FIXTURE_NOTE_ID)}`, name: "笔记详情" },
  { path: "/resources", name: "资源收藏" },
  { path: "/learning", name: "学习任务" },
  { path: "/backup", name: "备份" },
  { path: "/settings", name: "设置" },
];

function summarize(violations: Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"]) {
  return violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "n/a"}) ×${violation.nodes.length}: ${violation.help}`,
    )
    .join("\n");
}

test.describe("可访问性（axe / WCAG 2 A-AA）", () => {
  test.skip(
    ({ isMobile }) => Boolean(isMobile),
    "a11y 扫描在桌面项目跑一次；手机布局由 Pixel 7 冒烟覆盖",
  );

  test("五个页面 + 搜索弹窗 + 登录页没有 critical/serious 问题", async ({ page }) => {
    for (const entry of PAGES) {
      await page.goto(entry.path);
      const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === "critical" || violation.impact === "serious",
      );
      console.log(
        `[a11y] ${entry.name}: ${results.violations.length} 条规则命中（其中 critical/serious ${blocking.length}）`,
      );
      if (results.violations.length > 0) console.log(summarize(results.violations));
      expect(
        blocking,
        `${entry.name} 有 critical/serious 可访问性问题：\n${summarize(blocking)}`,
      ).toEqual([]);
    }

    // 搜索弹窗是独立的一层（dialog + combobox + listbox），单独扫
    await page.goto("/");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox", { name: "搜索关键词" }).fill("E2E检索标记");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    const dialogResults = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const dialogBlocking = dialogResults.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `[a11y] 搜索弹窗: ${dialogResults.violations.length} 条规则命中（critical/serious ${dialogBlocking.length}）`,
    );
    if (dialogResults.violations.length > 0) console.log(summarize(dialogResults.violations));
    expect(dialogBlocking, `搜索弹窗有 critical/serious：\n${summarize(dialogBlocking)}`).toEqual(
      [],
    );

    // 局域网登录页不属于工作区布局，单独访问
    await page.goto(`${LAN_URL}/login`);
    const loginResults = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const loginBlocking = loginResults.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    console.log(
      `[a11y] 登录页: ${loginResults.violations.length} 条规则命中（critical/serious ${loginBlocking.length}）`,
    );
    if (loginResults.violations.length > 0) console.log(summarize(loginResults.violations));
    expect(loginBlocking, `登录页有 critical/serious：\n${summarize(loginBlocking)}`).toEqual([]);
  });
});
