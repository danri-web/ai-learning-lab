#!/usr/bin/env node
import path from "node:path";
import readline from "node:readline";

import { generateSecret, hashPassword, isPasswordHash } from "./auth-lib.mjs";
import { readEnvFile, writeEnvValues } from "./env-file.mjs";

/**
 * 设置局域网口令：只把 scrypt 哈希写进 .env.local，不写明文。
 *
 *   npm run auth:set-password
 *   npm run auth:set-password -- --rotate-session   # 同时换会话密钥（所有设备退出）
 *
 * 不设置 ALLOW_LAN：本机模式不受影响；`npm run start:lan` 会在子进程里显式打开。
 */

const ENV_PATH = path.join(process.cwd(), ".env.local");
const MIN_LENGTH = 8;
const MAX_LENGTH = 1024;

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function readLineFromStdin() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
}

async function readPassword(prompt) {
  if (!process.stdin.isTTY) {
    process.stdout.write(prompt);
    const line = await readLineFromStdin();
    process.stdout.write("\n");
    return line;
  }

  process.stdout.write(prompt);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (chunk) => {
      for (const char of Array.from(chunk)) {
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        value += char;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const rotateSession = args.has("--rotate-session");

  console.log("\nAI Learning Lab — 设置局域网口令");
  console.log(`哈希会写入 ${ENV_PATH}（该文件不进 Git，也不进备份）\n`);

  const first = await readPassword("新口令（至少 8 位，输入不回显）：");
  if (first.length < MIN_LENGTH || first.length > MAX_LENGTH) {
    fail(`口令长度要在 ${MIN_LENGTH}–${MAX_LENGTH} 位之间`);
  }
  const second = await readPassword("再输一次：");
  if (first !== second) fail("两次输入不一致，没有写入任何东西");

  const existing = await readEnvFile(ENV_PATH);
  const currentSecret = existing.get("SESSION_SECRET") ?? "";
  const secret = rotateSession || currentSecret.length < 32 ? generateSecret() : currentSecret;

  const passwordHash = await hashPassword(first);
  if (!isPasswordHash(passwordHash)) fail("生成的哈希格式不对（这不该发生）");

  await writeEnvValues(ENV_PATH, {
    LAB_PASSWORD_HASH: passwordHash,
    SESSION_SECRET: secret,
  });

  console.log("\n✓ 已写入 LAB_PASSWORD_HASH 与 SESSION_SECRET");
  if (rotateSession) console.log("✓ 会话密钥已更换：所有设备都需要重新登录");
  console.log("\n下一步（局域网模式用生产构建，不用 dev）：");
  console.log("  npm run build");
  console.log("  npm run start:lan\n");
  console.log("提示：.env.local 不进备份；换电脑/重装后要重新跑一次本命令。");
  console.log("      只在可信 Wi-Fi 下开局域网，HTTP 不加密。\n");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
