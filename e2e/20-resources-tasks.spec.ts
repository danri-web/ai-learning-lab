import { expect, test } from "@playwright/test";

import { collectPageErrors } from "./helpers";

/**
 * 资源与任务的核心写入流程。
 *
 * 资源那条先故意填一个 `javascript:` 链接：需求书 §8 要求外部链接只允许安全协议，
 * 这不是「表单提示」，而是服务端拒绝 —— E2E 直接对着真实页面验一次。
 */
test.describe("资源与任务", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "写入流程在桌面项目跑；手机由真机与冒烟覆盖");

  test("资源：危险协议被拒，合法链接能收藏、能删", async ({ page }) => {
    const errors = collectPageErrors(page);
    const stamp = Date.now().toString(36);
    const title = `E2E 新收藏 ${stamp}`;

    await page.goto("/resources");
    await page.getByRole("main").getByRole("link", { name: "收藏资源" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "收藏资源" })).toBeVisible();

    await page.getByLabel("标题").fill(title);
    await page.getByLabel(/链接/).fill("javascript:alert(1)");
    await page.getByLabel("分类").fill("E2E 临时");
    await page.getByLabel("类型").selectOption("tool");
    await page.getByRole("button", { name: "收藏" }).click();

    await expect(page.getByLabel(/链接/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("只接受 http / https 链接")).toBeVisible();
    // 回归（阶段 8 抓到的真 bug）：React 19 在 action 后 reset 表单，select 的
    // value 没变时不会写回 DOM，看起来像「类型被清空」。修法是失败后重挂载控件。
    await expect(page.getByLabel("类型")).toHaveValue("tool");

    // 换成合法地址：同一个表单不丢输入，直接改链接再提交
    await page.getByLabel(/链接/).fill(`https://example.com/e2e-${stamp}`);
    await page.getByRole("button", { name: "收藏" }).click();
    await page.waitForURL(/\/resources$/);
    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible();

    await item.getByRole("button", { name: "删除" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("删除这条资源？")).toBeVisible();
    await dialog.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });

  test("任务：新建、列表上改状态、删除", async ({ page }) => {
    const errors = collectPageErrors(page);
    const stamp = Date.now().toString(36);
    const title = `E2E 新任务 ${stamp}`;

    await page.goto("/learning");
    await page.getByRole("main").getByRole("link", { name: "新建任务" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "新建任务" })).toBeVisible();

    await page.getByLabel("标题").fill(title);
    await page.locator('input[name="status"][value="doing"]').check({ force: true });
    await page.getByLabel("备注").fill("E2E 固定夹具之外的临时任务");

    // 先故意不填标题提交一次：错误提示出现，且「进行中」不能看起来被重置（同上一个回归）
    await page.getByLabel("标题").fill("");
    await page.getByRole("button", { name: "创建任务" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "表单里有不合规" })).toBeVisible();
    await expect(page.locator('input[name="status"][value="doing"]')).toBeChecked();

    await page.getByLabel("标题").fill(title);
    await page.getByRole("button", { name: "创建任务" }).click();
    await page.waitForURL(/\/learning$/);

    const item = page.getByRole("listitem").filter({ hasText: title });
    await expect(item).toBeVisible();
    await expect(item.getByLabel("状态")).toHaveValue("doing");

    // 列表上直接改状态：只动 status / updatedAt，不重写别的字段
    await item.getByLabel("状态").selectOption("done");
    await page.reload();
    const reloaded = page.getByRole("listitem").filter({ hasText: title });
    await expect(reloaded.getByLabel("状态")).toHaveValue("done");

    await reloaded.getByRole("button", { name: "删除" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("删除这条任务？")).toBeVisible();
    await dialog.getByRole("button", { name: "确认删除" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });
});
