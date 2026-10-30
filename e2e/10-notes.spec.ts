import { expect, test } from "@playwright/test";

import { collectPageErrors, openSearch } from "./helpers";

/**
 * 笔记闭环：新建（中文标题）→ 编辑 → 搜索找到 → 删除。
 *
 * 只在桌面 project 跑：手机上的同一条流程已在 2026-10-30 真机上验过，
 * Pixel 7 只做布局与导航回归（少一次写操作，少一份不确定性）。
 */
test.describe("知识库闭环", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "写入流程在桌面项目跑；手机由真机与冒烟覆盖");

  test("新建 → 编辑 → 搜索 → 删除", async ({ page }) => {
    const errors = collectPageErrors(page);
    const stamp = Date.now().toString(36);
    const title = `E2E 新建笔记 ${stamp}`;
    const token = `E2E新建标记${stamp}`;

    await page.goto("/knowledge");
    await expect(page.getByRole("heading", { level: 1, name: "知识库" })).toBeVisible();
    await page.getByRole("main").getByRole("link", { name: "新建笔记" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "新建笔记" })).toBeVisible();
    await page.getByLabel("标题").fill(title);
    await page.getByLabel("分类").fill("E2E 测试");
    await page.getByLabel(/标签/).fill("E2E, 新建");
    await page.locator("#body").fill(`## 测试小节\n\n${token}\n\n- 第一项\n- 第二项`);
    await page.getByRole("button", { name: "创建" }).click();

    // 中文标题会直接变成文件名（ADR D7），URL 里是 URL 编码后的 id
    await page.waitForURL(/\/knowledge\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(token)).toBeVisible();

    // 编辑：追加一段，保存后详情页立刻能看到
    await page.getByRole("link", { name: "编辑" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "编辑笔记" })).toBeVisible();
    await page.locator("#body").fill(`## 测试小节\n\n${token}\n\n第二段：编辑后的内容`);
    await page.getByRole("button", { name: "保存" }).click();
    await page.waitForURL(/\/knowledge\/[^/]+$/);
    await expect(page.getByText("第二段：编辑后的内容")).toBeVisible();

    // 搜索：Ctrl+K → 命中刚写的笔记 → 点开
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox", { name: "搜索关键词" }).fill(token);
    const hit = dialog.getByRole("option").filter({ hasText: title }).first();
    await expect(hit).toBeVisible();
    await expect(dialog.getByText(/已扫描 \d+ 篇笔记/)).toBeVisible();
    await hit.click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

    // 删除：进回收站（不是真删），列表里不再出现
    await page.getByRole("button", { name: "删除" }).click();
    const confirmDialog = page.getByRole("dialog");
    await expect(confirmDialog.getByText("删除这篇笔记？")).toBeVisible();
    await confirmDialog.getByRole("button", { name: "确认删除" }).click();
    await page.waitForURL(/\/knowledge$/);
    await expect(page.getByRole("link", { name: new RegExp(title) })).toHaveCount(0);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });
});
