import { expect, type Page } from "@playwright/test";

/** 夹具里的固定值（见 e2e/fixtures/content/） */
export const FIXTURE_NOTE_ID = "E2E-基线笔记";
export const FIXTURE_NOTE_TITLE = "E2E 基线笔记：注意力与检索";
export const SEARCH_TOKEN = "E2E检索标记";

/** 3211 是局域网模式实例（ALLOW_LAN=1 + 测试口令），见 scripts/e2e-server.mjs */
export const LAN_URL = `http://127.0.0.1:${process.env.E2E_LAN_PORT ?? 3211}`;
export const LAN_PASSWORD = process.env.E2E_PASSWORD ?? "e2e-local-password";

/**
 * 收集浏览器端的错误（未捕获异常 + console.error）。
 *
 * 为什么专门断这个：阶段 2 曾出现 404 页水合错误（#418），只靠肉眼看页面是发现不了的。
 * 正常流程里出现任何一条都是真问题 —— 不要把它当噪音过滤掉。
 */
export function collectPageErrors(page: Page, options: { consoleErrors?: boolean } = {}): string[] {
  const { consoleErrors = true } = options;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  if (consoleErrors) {
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
  }
  return errors;
}

/** 手机/窄屏最容易出的事故：某个表格或长 URL 把整页撑宽 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(
    metrics.scrollWidth - metrics.clientWidth,
    `横向溢出了 ${metrics.scrollWidth - metrics.clientWidth}px（scrollWidth=${metrics.scrollWidth}, clientWidth=${metrics.clientWidth}）`,
  ).toBeLessThanOrEqual(1);
}

/** 通过导航（桌面侧栏 / 手机抽屉）进入某页，并确认页面标题出现 */
export async function gotoPage(
  page: Page,
  label: string,
  options: { mobile?: boolean } = {},
): Promise<void> {
  if (options.mobile) {
    await page.getByRole("button", { name: "打开导航菜单" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: new RegExp(label) })
      .click();
  } else {
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: new RegExp(label) })
      .click();
  }
  await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
}

/** 打开 Ctrl+K 搜索弹窗（手机上是同一个按钮） */
export async function openSearch(page: Page) {
  await page.getByRole("button", { name: "搜索笔记与资源", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "搜索笔记与资源" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 等搜索结果里出现某条记录（结果是 <a role="option">，不是普通链接） */
export async function expectSearchHit(dialog: ReturnType<Page["getByRole"]>, title: string) {
  await expect(dialog.getByRole("option").filter({ hasText: title }).first()).toBeVisible();
}
