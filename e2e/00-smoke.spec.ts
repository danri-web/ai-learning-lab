import { expect, test } from "@playwright/test";

import {
  FIXTURE_NOTE_TITLE,
  collectPageErrors,
  expectNoHorizontalOverflow,
  gotoPage,
} from "./helpers";

/**
 * 冒烟：五个页面都打得开、没有浏览器错误、手机宽度不溢出。
 *
 * 两个 project 都跑这一条 —— 它同时就是「Pixel 7 回归」（需求书 §7 阶段 8 的 Android 检查）。
 */
test.describe("冒烟：五个页面与 404", () => {
  test("总览渲染真实数据，没有浏览器错误", async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "总览" })).toBeVisible();

    // 总览的数字来自固定夹具：2 篇笔记 / 2 条资源 / 2 条任务
    await expect(page.getByText("知识笔记")).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(FIXTURE_NOTE_TITLE) }).first(),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });

  test("五个页面都能从导航打开，且不横向溢出", async ({ page, isMobile }) => {
    const errors = collectPageErrors(page);
    await page.goto("/");

    for (const label of ["知识库", "资源收藏", "学习任务", "备份", "设置"]) {
      await gotoPage(page, label, { mobile: isMobile });
      await expectNoHorizontalOverflow(page);
    }

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });

  test("404 页有导航出口、不水合报错", async ({ page }) => {
    // 404 的「主文档」本身就会被浏览器记一条 console error（Failed to load resource），
    // 这里只抓未捕获异常 —— 我们关心的是水合/脚本崩溃，不是「页面确实不存在」。
    const errors = collectPageErrors(page, { consoleErrors: false });
    const response = await page.goto("/no-such-page");

    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "这里没有页面" })).toBeVisible();
    await expect(page.getByRole("link", { name: "回到总览" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });
});
