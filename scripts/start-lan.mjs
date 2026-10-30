#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { readEnvFile } from "./env-file.mjs";

/**
 * 局域网启动（阶段 7 唯一支持的局域网入口）。
 *
 *   npm run build
 *   npm run start:lan
 *
 * 为什么要有这个脚本，而不是 `next start -H 0.0.0.0`：
 *   - 需求书 §8.2 要求局域网用**生产构建**，不是 dev
 *   - 打开 0.0.0.0 之前必须确认口令哈希与会话密钥都在，否则 fail closed
 *   - 绑定地址只出现在这一个文件里；`binding.test.ts` 守着别的脚本不许写 0.0.0.0
 *
 * 不做的事：不自动改防火墙、不开 HTTPS、不把地址发到公网。
 */

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env.local");
const BUILD_ID = path.join(ROOT, ".next", "BUILD_ID");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const PASSWORD_SHAPE = /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function lanUrls(port) {
  const urls = [`http://127.0.0.1:${port}`];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return [...new Set(urls)];
}

async function main() {
  const fileEnv = await readEnvFile(ENV_PATH);
  const env = { ...process.env };
  for (const [key, value] of fileEnv) env[key] = value;

  if (!(await exists(BUILD_ID))) {
    fail("没有生产构建。先运行 npm run build，再 npm run start:lan");
  }
  if (!(await exists(NEXT_BIN))) {
    fail("找不到 node_modules/next。先运行 npm install");
  }

  const password = env.LAB_PASSWORD_HASH ?? "";
  const secret = env.SESSION_SECRET ?? "";
  const problems = [];
  if (!PASSWORD_SHAPE.test(password)) {
    problems.push("缺少 LAB_PASSWORD_HASH（运行 npm run auth:set-password）");
  }
  if (secret.length < 32) {
    problems.push("缺少 SESSION_SECRET（运行 npm run auth:set-password）");
  }
  if (problems.length > 0) {
    fail(`局域网模式不会在没配置的情况下启动：\n  - ${problems.join("\n  - ")}`);
  }

  const port = String(env.PORT ?? "3000");
  env.ALLOW_LAN = "1";
  env.PORT = port;

  const urls = lanUrls(port);
  console.log("\nAI Learning Lab — 局域网模式（生产构建）");
  console.log("  绑定：0.0.0.0（所有网卡）");
  console.log(`  访问：${urls.join("  ·  ")}`);
  console.log("  保护：所有页面与写入都要口令；会话 12 小时");
  console.log("  警告：HTTP 不加密，只在可信 Wi-Fi 下使用；不要做端口转发。");
  console.log("  手机第一次访问如果连不上，检查 Windows 防火墙的「专用网络」是否放行该端口。\n");

  const child = spawn(process.execPath, [NEXT_BIN, "start", "-H", "0.0.0.0", "-p", port], {
    cwd: ROOT,
    env,
    stdio: "inherit",
  });

  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
