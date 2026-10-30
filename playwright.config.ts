import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试（阶段 8）。
 *
 * 只做两件事：**核心流程真的能点通**、**手机宽度回归**。不追求覆盖所有分支
 * （单元测试已经 444 条），也不做截图对比（界面还在演进，比出来的红是噪音）。
 *
 * 用系统 Chrome（`channel: "chrome"`），不下载 Playwright 自带的 Chromium：
 * Windows 本机已经有 Chrome，少下载 150MB，也少一份要跟着升级的二进制（ADR D14）。
 *
 * 数据隔离见 scripts/e2e-server.mjs：副本在系统临时目录（可用 E2E_SCRATCH 指定），
 * 真实 content/ 不参与。端口刻意不用 3000，避免误连到正在跑的 dev。
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // 写流程会改同一份夹具内容，串行跑才可复现
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "windows-chrome",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // 需求书 §7 阶段 8 的 Android 检查：真机已在 10-30 验过，这里只做 Pixel 7 回归
      name: "pixel-7",
      use: { ...devices["Pixel 7"], channel: "chrome" },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
  },
});
