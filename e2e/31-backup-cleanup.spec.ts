import { expect, test } from "@playwright/test";

import { collectPageErrors } from "./helpers";

/**
 * P1 清理的端到端闭环（只碰 E2E 一次性副本里的 content/ 与 backups/）：
 *   1. 备份保留：先造出超过 10 份手动备份 → 预览 → 勾选 + 输入「清理」→ 只剩 10 份
 *   2. 回收站清理：夹具里各放一条过期/未过期的笔记与 JSONL 行 → 只清过期的
 *
 * 两条都走真实页面、真实 Server Action；不直接改副本里的文件。
 */
test.describe("清理（P1）", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "清理流程在桌面项目跑；手机由冒烟覆盖");

  test("备份保留：11 份以上只留最新 10 份", async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto("/backup");
    const beforeManual = await page
      .getByRole("listitem")
      .filter({ hasText: "手动备份" })
      .count();

    for (let index = 0; index < 11; index += 1) {
      await page.getByRole("button", { name: "立即备份" }).click();
      await expect(page.getByText(/备份已创建并通过自检/)).toBeVisible();
    }

    const expectedExpired = Math.max(0, beforeManual + 11 - 10);
    expect(expectedExpired, "这套用例至少要造出 1 份超期备份").toBeGreaterThan(0);

    await page.goto("/backup?prune=backups");
    const section = page.getByRole("region", { name: "清理旧备份" });
    await expect(section.getByText(new RegExp(`可清理 ${expectedExpired} 份`))).toBeVisible();
    await page.screenshot({ path: "docs/screenshot-backup-prune.png", fullPage: true });

    const expiredNames = await section
      .locator("ul")
      .first()
      .locator("span.font-mono")
      .allInnerTexts();
    expect(expiredNames).toHaveLength(expectedExpired);
    const oldest = expiredNames[0];

    await section.getByRole("checkbox").check();
    await section.locator('input[name="confirm"]').fill("清理");
    await section.getByRole("button", { name: "执行清理" }).click();

    await expect(page.getByText(new RegExp(`旧备份清理完成：删掉 ${expectedExpired} 项`))).toBeVisible();

    await page.goto("/backup");
    await expect(
      page.getByRole("listitem").filter({ hasText: "手动备份" }),
    ).toHaveCount(10);
    await expect(page.getByText(oldest)).toHaveCount(0);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });

  test("回收站清理：只清过期笔记与超期 JSONL 行", async ({ page }) => {
    const errors = collectPageErrors(page);
    const oldNote = "articles/.trash/20200101-000000-旧笔记.md";

    await page.goto("/backup?prune=trash");
    const section = page.getByRole("region", { name: "清理回收站" });

    await expect(section.getByText(oldNote)).toBeVisible();
    await expect(section.getByText(/\.trash\/resources-deleted\.jsonl/)).toBeVisible();
    await expect(section.getByText(/删 1 行 · 留 \d+ 行/)).toBeVisible();
    await page.screenshot({ path: "docs/screenshot-trash-prune.png", fullPage: true });

    await section.getByRole("checkbox").check();
    await section.locator('input[name="confirm"]').fill("清理");
    await section.getByRole("button", { name: "执行清理" }).click();

    await expect(page.getByText(/回收站清理完成：删掉 \d+ 项/)).toBeVisible();

    await page.goto("/backup?prune=trash");
    await expect(section.getByText(/90 天内没有可清理的条目/)).toBeVisible();
    await expect(section.getByText(oldNote)).toHaveCount(0);

    expect(errors, `浏览器错误：\n${errors.join("\n")}`).toEqual([]);
  });
});
