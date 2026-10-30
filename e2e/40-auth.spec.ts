import { expect, test } from "@playwright/test";

import { FIXTURE_NOTE_TITLE, LAN_PASSWORD, LAN_URL, collectPageErrors } from "./helpers";

/**
 * 局域网认证的真实 HTTP 请求（不是只看源码）。
 *
 * 阶段 7 的三道门只用 curl 验过；审计 v4 也留了一条「F3 限速只做了单元级」。
 * 这里在 LAN 模式实例（3211，ALLOW_LAN=1）上真打请求，覆盖：
 *   未登录页面 307 / 未登录 action POST 401 / 错误口令 / 登录成功 / 登出后回到 307。
 *
 * 只错一次口令：限速是全局桶（5 次 / 5 分钟），E2E 不能自己把门锁上。
 */
test.describe("局域网认证", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "认证流程在桌面项目跑；手机登录已由真机覆盖");

  test("未登录被挡、登录后能读、登出后再次被挡", async ({ page, request }) => {
    const errors = collectPageErrors(page);

    // 1) 未登录：页面 307 到 /login，action POST 直接 401
    const pageResponse = await request.get(`${LAN_URL}/`, { maxRedirects: 0 });
    expect(pageResponse.status()).toBe(307);
    expect(pageResponse.headers()["location"]).toContain("/login");

    const knowledgeResponse = await request.get(`${LAN_URL}/knowledge`, { maxRedirects: 0 });
    expect(knowledgeResponse.status()).toBe(307);
    expect(await knowledgeResponse.text()).not.toContain(FIXTURE_NOTE_TITLE);

    const actionResponse = await request.post(`${LAN_URL}/knowledge`, {
      maxRedirects: 0,
      headers: { "Next-Action": "e2e-unauthorized" },
      data: {},
    });
    expect(actionResponse.status()).toBe(401);
    expect(await actionResponse.text()).toContain("需要登录");

    // 2) 错误口令：留在登录页并给出提示
    await page.goto(`${LAN_URL}/login`);
    await expect(page.getByRole("heading", { level: 1, name: "局域网登录" })).toBeVisible();
    await page.getByLabel("口令").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "口令不对" })).toBeVisible();

    // 3) 正确口令：种下会话，能读到夹具内容
    await page.getByLabel("口令").fill(LAN_PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL(`${LAN_URL}/`);
    await expect(page.getByRole("heading", { level: 1, name: "总览" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(FIXTURE_NOTE_TITLE) }).first(),
    ).toBeVisible();

    // 4) 登出：cookie 清掉，再访问又回到登录页
    await page.goto(`${LAN_URL}/settings`);
    await page.getByRole("button", { name: "退出登录" }).click();
    await page.waitForURL(/\/login$/);
    await page.goto(`${LAN_URL}/`);
    await expect(page).toHaveURL(/\/login/);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });
});
