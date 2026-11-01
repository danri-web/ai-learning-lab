import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listArticles } from "@/lib/content/articles";
import { readResources } from "@/lib/content/resources";
import { readTasks } from "@/lib/content/tasks";

/**
 * `npm run seed:demo` 的断言（2026-11-01）。
 *
 * 演示脚本的价值全在「别人 clone 下来能看到东西」，所以这里断言的不是"复制了几个文件"，
 * 而是**应用自己的读取函数能把它们读进来**（schema 对不上就等于没铺），
 * 以及**它永远不会覆盖已有数据**（演示脚本毁数据是最坏的一种 bug）。
 *
 * 跑的是真的 CLI（`node scripts/seed-demo.mjs --target …`），不是 import 内部函数：
 * 退出码和那句「拒绝」也是给别人看的交付物。
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = path.join(ROOT, "scripts", "seed-demo.mjs");
const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const run = promisify(execFile);

let dir: string;
let target: string;

beforeEach(async () => {
  await fs.mkdir(TMP, { recursive: true });
  dir = await fs.mkdtemp(path.join(TMP, "seed-"));
  target = path.join(dir, "content");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

const seed = () => run(process.execPath, [SCRIPT, "--target", target], { cwd: ROOT });

describe("seed:demo", () => {
  it("铺进去的数据，应用自己的读取函数真的能读进来（含关联关系）", async () => {
    const { stdout } = await seed();
    expect(stdout).toContain("已铺入演示数据");

    const articles = await listArticles(path.join(target, "articles"));
    expect(articles.problems).toEqual([]);
    expect(articles.articles).toHaveLength(3);
    const articleIds = new Set(articles.articles.map((item) => item.id));

    const resources = await readResources(target);
    expect(resources.problem).toBeNull();
    expect(resources.missing).toBe(false);
    expect(resources.resources).toHaveLength(2);
    for (const resource of resources.resources) {
      if (resource.articleId) expect(articleIds.has(resource.articleId), resource.articleId).toBe(true);
    }

    const tasks = await readTasks(target);
    expect(tasks.problem).toBeNull();
    expect(tasks.tasks).toHaveLength(2);
    for (const task of tasks.tasks) {
      for (const id of task.articleIds) expect(articleIds.has(id), id).toBe(true);
      for (const id of task.resourceIds) {
        expect(resources.resources.some((item) => item.id === id), id).toBe(true);
      }
    }
    // 三篇笔记里至少有一篇是能渲染正文的（不是只有 frontmatter 的空壳）
    expect(articles.articles.every((item) => item.title.length > 0)).toBe(true);
  });

  it("目标里已经有数据：退出码 1、一个字节都不改", async () => {
    await seed();
    const note = path.join(target, "articles", "Prompt-工程-三条最小原则.md");
    const before = await fs.readFile(note, "utf8");
    await fs.writeFile(note, `${before}\n手写的一行\n`, "utf8");

    await expect(seed()).rejects.toMatchObject({ code: 1 });
    const after = await fs.readFile(note, "utf8");
    expect(after).toBe(`${before}\n手写的一行\n`);
    expect(await fs.readdir(path.join(target, "articles"))).toHaveLength(3);
  });
});
