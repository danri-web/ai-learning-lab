import { expect, test } from "@playwright/test";

import { FIXTURE_NOTE_ID, FIXTURE_NOTE_TITLE, collectPageErrors } from "./helpers";

/**
 * 备份与恢复的完整闭环（需求书 §7 阶段 8「备份恢复测试」）。
 *
 * 顺序：改夹具 → 备份 → 再改 → 预览 → 确认恢复 → 内容回到备份时 →
 * 对自动生成的 pre-restore 快照「回滚」→ 回到恢复前。
 *
 * 只碰副本里的 content/（见 scripts/e2e-server.mjs），真实笔记不参与。
 */
test.describe("备份与恢复", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "恢复流程在桌面项目跑；手机由真机与冒烟覆盖");

  test("备份 → 预览 → 恢复 → 用快照回滚", async ({ page }) => {
    const errors = collectPageErrors(page);
    const stamp = Date.now().toString(36);
    const before = `恢复前修改-${stamp}`;
    const after = `恢复后修改-${stamp}`;
    const editUrl = `/knowledge/${encodeURIComponent(FIXTURE_NOTE_ID)}/edit`;

    // 1) 改一篇夹具笔记
    await page.goto(editUrl);
    await expect(page.getByRole("heading", { level: 1, name: "编辑笔记" })).toBeVisible();
    const originalBody = await page.locator("#body").inputValue();
    await page.locator("#body").fill(`${originalBody}\n\n${before}`);
    await page.getByRole("button", { name: "保存" }).click();
    await page.waitForURL(new RegExp(`/knowledge/${encodeURIComponent(FIXTURE_NOTE_ID)}$`));
    await expect(page.getByText(before)).toBeVisible();

    // 2) 建一份备份（建完会重读 zip 自检）
    await page.goto("/backup");
    await page.getByRole("button", { name: "立即备份" }).click();
    await expect(page.getByText(/备份已创建并通过自检/)).toBeVisible();

    // 3) 再改一次：这次的内容应该被恢复覆盖掉
    await page.goto(editUrl);
    await page.locator("#body").fill(`${originalBody}\n\n${before}\n\n${after}`);
    await page.getByRole("button", { name: "保存" }).click();
    await page.waitForURL(new RegExp(`/knowledge/${encodeURIComponent(FIXTURE_NOTE_ID)}$`));
    await expect(page.getByText(after)).toBeVisible();

    // 4) 预览最新的一份手动备份 → 确认恢复
    await page.goto("/backup");
    const manualBackup = page.getByRole("listitem").filter({ hasText: "手动备份" }).first();
    await manualBackup.getByRole("link", { name: "预览恢复" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "恢复预览" })).toBeVisible();
    await expect(page.getByText(/备份里 \d+ 个文件/)).toBeVisible();

    await page.getByRole("checkbox").check();
    await page.locator('input[name="confirm"]').fill("恢复");
    await page.getByRole("button", { name: "执行恢复" }).click();
    await expect(page.getByText(/恢复完成。恢复前快照/)).toBeVisible();

    await page.goto(`/knowledge/${encodeURIComponent(FIXTURE_NOTE_ID)}`);
    await expect(page.getByRole("heading", { level: 1, name: FIXTURE_NOTE_TITLE })).toBeVisible();
    await expect(page.getByText(before)).toBeVisible();
    await expect(page.getByText(after)).toHaveCount(0);

    // 5) 对 pre-restore 快照点「回滚」：回到刚才恢复前的状态
    await page.goto("/backup");
    const snapshot = page.getByRole("listitem").filter({ hasText: "恢复前快照" }).first();
    await snapshot.getByRole("link", { name: "回滚" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "恢复预览" })).toBeVisible();
    await page.getByRole("checkbox").check();
    await page.locator('input[name="confirm"]').fill("恢复");
    await page.getByRole("button", { name: "执行恢复" }).click();
    await expect(page.getByText(/恢复完成。恢复前快照/)).toBeVisible();

    await page.goto(`/knowledge/${encodeURIComponent(FIXTURE_NOTE_ID)}`);
    await expect(page.getByText(after)).toBeVisible();

    // 恢复流程不该在浏览器里留下错误
    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });
});
