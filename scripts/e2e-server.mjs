#!/usr/bin/env node
/**
 * E2E 服务器（阶段 8）——**永远不在真实项目目录里跑**。
 *
 * 做四件事：
 *   1. 把当前工作树（不含 node_modules / .next / content / backups / .env*）复制到
 *      `_scratch`（默认系统临时目录）里的 `app/`；
 *   2. 复制 node_modules（Windows 用 robocopy 多线程，约 6 秒；不用目录联接 —— Turbopack
 *      拒绝解析工作区外的链接依赖）；
 *   3. 用 `e2e/fixtures/content/` 覆盖测试数据 —— **真实 content/ 只读，绝不参与**；
 *   4. 生产构建后起两个实例：3210 本机模式、3211 局域网模式（ALLOW_LAN=1 + 测试口令）。
 *
 * 为什么不在真实目录里跑：E2E 会新建/编辑/删除笔记、建备份、执行恢复。
 * 这些动作只能在一次性副本里发生（ADR D14）。
 *
 * 安全闸门（先于任何删除/复制执行）：
 *   - scratch 在仓库里面 → 拒绝（否则可能把仓库当副本删掉）
 *   - 副本目录是仓库本身 / 是仓库的祖先 → 拒绝
 *
 * 可复现的调试用法：
 *   E2E_REUSE=1 node scripts/e2e-server.mjs   # 复用上次副本与构建（改测试时用）
 *   E2E_SCRATCH=<仓库外的目录> node scripts/e2e-server.mjs
 */
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { generateSecret, hashPassword } from "./auth-lib.mjs";

const REPO = process.cwd();
const SCRATCH = path.resolve(
  process.env.E2E_SCRATCH ?? path.join(os.tmpdir(), "ai-learning-lab-e2e"),
);
const APP = path.join(SCRATCH, "app");
const FIXTURES = path.join(REPO, "e2e", "fixtures", "content");
const NEXT_BIN = path.join(APP, "node_modules", "next", "dist", "bin", "next");

const PORT_LOCAL = Number(process.env.E2E_PORT ?? 3210);
const PORT_LAN = Number(process.env.E2E_LAN_PORT ?? 3211);
const TEST_PASSWORD = process.env.E2E_PASSWORD ?? "e2e-local-password";
const REUSE = process.env.E2E_REUSE === "1";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "content",
  "backups",
  "test-results",
  "playwright-report",
  "coverage",
]);

function fail(message) {
  console.error(`\n✗ E2E 服务器：${message}\n`);
  process.exit(1);
}

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function assertSafeScratch() {
  if (path.resolve(APP) === path.resolve(REPO)) {
    fail(`副本目录不能是仓库本身：${APP}`);
  }
  if (isInside(APP, REPO)) {
    fail(`副本目录必须在仓库外面：${APP}（真实 content/ 不能被 E2E 碰到）`);
  }
  if (isInside(SCRATCH, REPO)) {
    fail(
      `副本必须放在仓库外面（它在仓库里面：${SCRATCH}）。` +
        `默认用系统临时目录，或把 E2E_SCRATCH 指向 _scratch。`,
    );
  }
  if (isInside(REPO, APP)) {
    fail(`副本目录不能包含仓库本身：${APP}`);
  }
}

/** 复制工作树（保留未提交的改动），跳过重目录、用户数据与密钥 */
async function copyTree() {
  const filter = (src) => {
    const rel = path.relative(REPO, src);
    if (rel === "") return true;
    const top = rel.split(path.sep)[0];
    if (SKIP_DIRS.has(top)) return false;
    const base = path.basename(src);
    if (base.startsWith(".env") && base !== ".env.example") return false;
    if (base.endsWith(".tsbuildinfo")) return false;
    return true;
  };
  await fs.cp(REPO, APP, { recursive: true, filter, errorOnExist: false, force: true });
}

async function removeApp() {
  const nodeModules = path.join(APP, "node_modules");
  try {
    const stat = await fs.lstat(nodeModules);
    // 目录联接必须先拆掉链接本身，不能递归进真实 node_modules
    if (stat.isSymbolicLink()) await fs.unlink(nodeModules);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.rm(APP, { recursive: true, force: true, maxRetries: 3 });
}

/**
 * 复制 node_modules。
 *
 * 为什么不用目录联接：Turbopack 以「最近的 lockfile」当工作区根，联接指向的工作区外
 * 依赖会被拒绝解析（实测 `Could not find the Next.js package`）。所以必须是真目录。
 * Windows 上用 robocopy /MT（36k 文件约 6 秒，`fs.cp` 约 45 秒）；失败再退回 `fs.cp`。
 */
async function copyNodeModules() {
  const source = path.join(REPO, "node_modules");
  const destination = path.join(APP, "node_modules");
  const stat = await fs.lstat(source).catch(() => null);
  if (!stat?.isDirectory()) fail(`找不到 ${source}，先 npm install`);

  if (process.platform === "win32") {
    try {
      // robocopy 的 0–7 都是成功（1 = 复制了文件，2 = 有多余文件…），8 以上才是失败
      await runWithCodes(
        "robocopy",
        [source, destination, "/E", "/MT:16", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"],
        { cwd: APP, stdio: "ignore" },
        [0, 1, 2, 3, 4, 5, 6, 7],
      );
      return;
    } catch {
      console.warn("[e2e] robocopy 失败，退回 fs.cp（会慢一些）");
      await fs.rm(destination, { recursive: true, force: true });
    }
  }
  await fs.cp(source, destination, { recursive: true });
}

async function writeFixtures() {
  const stat = await fs.lstat(FIXTURES).catch(() => null);
  if (!stat?.isDirectory()) fail(`找不到夹具目录：${FIXTURES}`);
  await fs.cp(FIXTURES, path.join(APP, "content"), { recursive: true });
}

async function prepare() {
  assertSafeScratch();
  console.log(`[e2e] 副本：${APP}`);
  await removeApp();
  await fs.mkdir(APP, { recursive: true });
  await copyTree();
  await copyNodeModules();
  await writeFixtures();
  console.log("[e2e] 已复制工作树与 node_modules、写入固定夹具（真实 content/ 未参与）");
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`)),
    );
  });
}

/** 同 run，但允许指定退出码（robocopy 的 0–7 都算成功） */
function runWithCodes(command, args, options, okCodes) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== null && okCodes.includes(code)) resolve();
      else reject(new Error(`${command} 退出码 ${code}`));
    });
  });
}

async function build() {
  console.log("[e2e] 生产构建（副本内）…");
  const env = { ...process.env };
  delete env.ALLOW_LAN;
  delete env.LAB_PASSWORD_HASH;
  delete env.SESSION_SECRET;
  delete env.PORT;
  await run(process.execPath, [NEXT_BIN, "build"], { cwd: APP, env });
  console.log("[e2e] 构建完成");
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      reject(new Error(`端口 ${port} 被占用（${error.code}）；可能上次的 E2E 服务没退干净`));
    });
    server.once("listening", () => server.close(resolve));
    server.listen(port, "127.0.0.1");
  });
}

async function waitFor(url, expected, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (expected.includes(response.status)) return;
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fail(`${url} 在 ${timeoutMs}ms 内没有就绪`);
}

const children = [];

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // 已经退出
    }
  }
}

function cleanup() {
  for (const child of children) killTree(child.pid);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(0);
  });
}

async function main() {
  assertSafeScratch();
  await assertPortFree(PORT_LOCAL);
  await assertPortFree(PORT_LAN);

  const buildId = path.join(APP, ".next", "BUILD_ID");
  const reusable =
    REUSE &&
    (await fs.access(buildId).then(
      () => true,
      () => false,
    ));
  if (reusable) {
    console.log("[e2e] E2E_REUSE=1：复用上次副本与构建");
  } else {
    await prepare();
    await build();
  }

  const passwordHash = await hashPassword(TEST_PASSWORD);
  const secret = generateSecret();

  const baseEnv = { ...process.env };
  delete baseEnv.ALLOW_LAN;
  delete baseEnv.LAB_PASSWORD_HASH;
  delete baseEnv.SESSION_SECRET;

  const local = spawn(
    process.execPath,
    [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(PORT_LOCAL)],
    { cwd: APP, env: { ...baseEnv, PORT: String(PORT_LOCAL) }, stdio: "inherit" },
  );
  children.push(local);

  const lan = spawn(
    process.execPath,
    [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(PORT_LAN)],
    {
      cwd: APP,
      env: {
        ...baseEnv,
        PORT: String(PORT_LAN),
        ALLOW_LAN: "1",
        LAB_PASSWORD_HASH: passwordHash,
        SESSION_SECRET: secret,
      },
      stdio: "inherit",
    },
  );
  children.push(lan);

  for (const child of children) {
    child.on("exit", (code) => {
      if (code !== 0) console.error(`[e2e] 子进程退出：${code}`);
    });
  }

  await waitFor(`http://127.0.0.1:${PORT_LOCAL}/`, [200]);
  await waitFor(`http://127.0.0.1:${PORT_LAN}/login`, [200]);

  console.log(
    [
      "",
      "[e2e] 就绪",
      `  本机模式：http://127.0.0.1:${PORT_LOCAL}`,
      `  局域网模式：http://127.0.0.1:${PORT_LAN}（口令 ${TEST_PASSWORD}）`,
      `  测试数据：${path.join(APP, "content")}（可随时删）`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  cleanup();
  fail(error instanceof Error ? error.message : String(error));
});
