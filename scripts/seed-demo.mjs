#!/usr/bin/env node
/**
 * 把 `demo/content/` 铺进 `content/`，让新 clone 的人不用先写笔记就能看到「有数据的样子」。
 *
 * 为什么是脚本而不是把 `content/` 提交进仓库：D5 定的是「主仓库公开，笔记属于私有仓库」，
 * 所以 `content/` 永远不进 Git；演示数据放 `demo/`，用这个脚本搬一次。
 *
 * 只做一件事，但有一条硬规则：**目标里已经有数据就拒绝，一个字节都不写**。
 * 演示脚本不该有机会覆盖别人的笔记。
 *
 * 用法：
 *   npm run seed:demo                     # 铺到 <仓库>/content
 *   node scripts/seed-demo.mjs --target D:\somewhere\content
 */
import { cp, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DIR = path.join(HERE, "..", "demo", "content");

/** 目标目录里已经有什么？返回人类可读的清单（空数组 = 可以铺） */
async function inspectExisting(targetDir) {
  const found = [];
  const articlesDir = path.join(targetDir, "articles");
  if (existsSync(articlesDir)) {
    const entries = await readdir(articlesDir, { withFileTypes: true });
    const notes = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
    if (notes.length > 0) found.push(`${notes.length} 篇笔记`);
  }
  for (const name of ["resources.json", "tasks.json"]) {
    if (existsSync(path.join(targetDir, name))) found.push(name);
  }
  return found;
}

/**
 * @param {{ demoDir?: string, targetDir: string }} options
 * @returns {Promise<{ ok: true, targetDir: string, files: string[] } | { ok: false, reason: "occupied", existing: string[] } | { ok: false, reason: "missing-demo", demoDir: string }>}
 */
export async function seedDemo({ demoDir = DEMO_DIR, targetDir } = {}) {
  if (!existsSync(demoDir)) return { ok: false, reason: "missing-demo", demoDir };

  const existing = await inspectExisting(targetDir);
  if (existing.length > 0) return { ok: false, reason: "occupied", existing };

  await mkdir(targetDir, { recursive: true });
  await cp(path.join(demoDir, "articles"), path.join(targetDir, "articles"), { recursive: true });
  for (const name of ["resources.json", "tasks.json"]) {
    await cp(path.join(demoDir, name), path.join(targetDir, name));
  }

  const articlesDir = path.join(targetDir, "articles");
  const notes = (await readdir(articlesDir)).filter((name) => name.endsWith(".md"));
  return { ok: true, targetDir, files: [...notes.map((name) => `articles/${name}`), "resources.json", "tasks.json"] };
}

function targetFromArgv(argv) {
  const index = argv.indexOf("--target");
  if (index >= 0 && argv[index + 1]) return path.resolve(argv[index + 1]);
  return path.join(process.cwd(), "content");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const targetDir = targetFromArgv(process.argv);
  const result = await seedDemo({ targetDir });

  if (!result.ok && result.reason === "missing-demo") {
    console.error(`找不到演示数据：${result.demoDir}`);
    process.exitCode = 1;
  } else if (!result.ok) {
    console.error(`content/ 里已经有数据了（${result.existing.join("、")}），不覆盖。`);
    console.error("想重建演示数据：先备份或删掉 content/，再跑一次 npm run seed:demo。");
    process.exitCode = 1;
  } else {
    console.log(`已铺入演示数据 → ${result.targetDir}`);
    for (const file of result.files) console.log(`  · ${file}`);
    console.log("\n下一步：npm run dev → http://127.0.0.1:3000");
  }
}
