import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * E2E 的数据安全闸门（阶段 8）。
 *
 * E2E 会新建/删除笔记、建备份、执行恢复 —— 只能发生在一次性副本里。
 * 这里用**真实进程**撞一次守卫：把 E2E_SCRATCH 指到仓库根目录，脚本必须在
 * 删除/复制任何东西之前拒绝并退出。
 *
 * 另外钉两条关系：
 *   - Playwright 的端口不是 3000（避免误连正在跑的 dev，把自己的数据改了）
 *   - 夹具自身自洽（frontmatter id == 文件名；关联 id 都真实存在）
 */

const ROOT = process.cwd();

/** 拿一个确定已退出的 PID（不要硬编码 999999：它可能被系统复用） */
function deadPid(): number {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = spawnSync(process.execPath, ["-e", ""]);
    const pid = result.pid;
    if (!pid) continue;
    try {
      process.kill(pid, 0);
    } catch {
      return pid;
    }
  }
  throw new Error("拿不到一个已退出的 PID");
}

describe("E2E 隔离", () => {
  it("副本落在仓库里时，服务器脚本直接拒绝（不会动真实 content/）", () => {
    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: ROOT },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("副本目录必须在仓库外面");
    expect(result.stdout).not.toContain("[e2e] 已复制");
  });

  it("已有 app/ 但没有所有权标记时拒绝删除（防 E2E_SCRATCH 误配）", async () => {
    // 必须放在仓库外：就是这条守卫要拦的「误配到别人的项目根」场景
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-owned-"));
    const app = path.join(scratch, "app");
    await fs.mkdir(app, { recursive: true });
    await fs.writeFile(path.join(app, "keep.txt"), "不要删我", "utf8");

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("不是本脚本建的");
    // 关键断言：别人的文件必须原样还在
    expect(await fs.readFile(path.join(app, "keep.txt"), "utf8")).toBe("不要删我");

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("E2E_REUSE=1 不能绕过所有权检查（未标记的构建不能复用）", async () => {
    // 审计 v5 F1：复用分支以前跳过 prepare，也就跳过了所有权检查，
    // 会直接拿一个未标记的 app/（可能装着真实笔记）起服务并写入。
    // 哨兵放在 content/ 里：如果所有权被绕过、走到 resetData，它会被删掉。
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-reuse-"));
    const app = path.join(scratch, "app");
    await fs.mkdir(path.join(app, ".next"), { recursive: true });
    await fs.writeFile(path.join(app, ".next", "BUILD_ID"), "fake-build", "utf8");
    await fs.mkdir(path.join(app, "content"), { recursive: true });
    await fs.writeFile(path.join(app, "content", "sentinel.txt"), "真实数据", "utf8");

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "1" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("不是本脚本建的");
    // 就绪日志在 stdout：要断言「它根本没走到起服务」
    expect(result.stdout).not.toContain("[e2e] 就绪");
    expect(await fs.readFile(path.join(app, "content", "sentinel.txt"), "utf8")).toBe("真实数据");

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== "win32")(
    "scratch 是仓库的 junction 别名时拒绝（词法检查不够，要查物理路径）",
    async () => {
      // 审计 v5 F2：E2E_SCRATCH 字符串在仓库外，但实际指向仓库 → removeApp 会删真实 app/
      const parent = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-alias-"));
      const alias = path.join(parent, "link");
      await fs.symlink(ROOT, alias, "junction");

      const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
        cwd: ROOT,
        env: { ...process.env, E2E_SCRATCH: alias, E2E_REUSE: "" },
        encoding: "utf8",
        timeout: 30_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("物理路径");
      // 真正的破坏目标是 ROOT/app：连里面的源码都要在（不只是 package.json）
      expect(await fs.stat(path.join(ROOT, "app", "layout.tsx"))).toBeTruthy();
      expect(await fs.stat(path.join(ROOT, "package.json"))).toBeTruthy();

      await fs.rmdir(alias);
      await fs.rm(parent, { recursive: true, force: true });
    },
  );

  it("同一副本已有活动锁时拒绝启动（两个 E2E 不能共用）", async () => {
    // 审计 v5 F3：两个 Playwright 同时跑默认副本，会互相删文件
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-lock-"));
    await fs.writeFile(
      path.join(scratch, ".ai-learning-lab-e2e.lock"),
      String(process.pid),
      "utf8",
    );

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("另一个 E2E");
    expect(result.stderr).toContain(`pid ${process.pid}`);

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("旧锁（死 PID）会被安全回收，但回收后仍要过所有权检查（审计 v6 P2）", async () => {
    // 两个进程都判旧锁已死时，回收必须串行（回收守卫），不能互相删新锁。
    // 这里验证：回收能发生，但后续所有权检查仍然挡住未标记的 app/。
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-stale-"));
    const app = path.join(scratch, "app");
    await fs.mkdir(app, { recursive: true });
    await fs.writeFile(path.join(app, "keep.txt"), "不要删我", "utf8");
    const stale = deadPid();
    await fs.writeFile(path.join(scratch, ".ai-learning-lab-e2e.lock"), String(stale), "utf8");

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("不是本脚本建的");
    // 回收后自己建的锁随 fail 释放，守卫也不能留
    await expect(fs.access(path.join(scratch, ".ai-learning-lab-e2e.lock"))).rejects.toThrow();
    await expect(
      fs.access(path.join(scratch, ".ai-learning-lab-e2e.lock.reclaim")),
    ).rejects.toThrow();
    expect(await fs.readFile(path.join(app, "keep.txt"), "utf8")).toBe("不要删我");

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("回收守卫已存在时 fail closed（第二个回收者不能进破坏区）", async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-reclaim-"));
    const lock = path.join(scratch, ".ai-learning-lab-e2e.lock");
    const reclaim = `${lock}.reclaim`;
    const stale = deadPid();
    await fs.writeFile(lock, String(stale), "utf8");
    await fs.writeFile(reclaim, String(process.pid), "utf8");

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("正在回收");
    // 旧锁和守卫都不动：等正在回收的那个进程结束 / 人工确认
    expect(await fs.readFile(lock, "utf8")).toBe(String(stale));
    expect(await fs.readFile(reclaim, "utf8")).toBe(String(process.pid));

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("空锁文件也按占用处理（不能当成死锁清掉）", async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-empty-lock-"));
    const lock = path.join(scratch, ".ai-learning-lab-e2e.lock");
    await fs.writeFile(lock, "", "utf8");

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("副本已被占用");
    expect(await fs.readFile(lock, "utf8")).toBe("");

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== "win32")(
    "app/ 本身是 junction 时拒绝（避免删到链接目标）",
    async () => {
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-applink-"));
      const target = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-apptarget-"));
      await fs.writeFile(path.join(target, "keep.txt"), "链接目标", "utf8");
      await fs.symlink(target, path.join(scratch, "app"), "junction");
      await fs.writeFile(path.join(scratch, ".ai-learning-lab-e2e"), "owned", "utf8");

      const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
        cwd: ROOT,
        env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "" },
        encoding: "utf8",
        timeout: 30_000,
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("不是普通目录");
      expect(await fs.readFile(path.join(target, "keep.txt"), "utf8")).toBe("链接目标");

      await fs.rmdir(path.join(scratch, "app"));
      await fs.rm(scratch, { recursive: true, force: true });
      await fs.rm(target, { recursive: true, force: true });
    },
  );

  it("所有权标记是目录时不算数（标记必须是普通文件）", async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-marker-"));
    await fs.mkdir(path.join(scratch, "app"), { recursive: true });
    await fs.writeFile(path.join(scratch, "app", "keep.txt"), "不要删我", "utf8");
    // 标记做成目录：旧实现只 fs.access，存在就算数
    await fs.mkdir(path.join(scratch, ".ai-learning-lab-e2e"), { recursive: true });

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: { ...process.env, E2E_SCRATCH: scratch, E2E_REUSE: "" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("不是本脚本建的");
    expect(await fs.readFile(path.join(scratch, "app", "keep.txt"), "utf8")).toBe("不要删我");

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("E2E_REUSE=1 会重置 content/backups；子进程失败会带走 supervisor", async () => {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-reset-"));
    const app = path.join(scratch, "app");
    await fs.mkdir(path.join(app, ".next"), { recursive: true });
    await fs.writeFile(path.join(app, ".next", "BUILD_ID"), "fake-build", "utf8");
    await fs.writeFile(path.join(scratch, ".ai-learning-lab-e2e"), "owned", "utf8");
    await fs.mkdir(path.join(app, "content"), { recursive: true });
    await fs.writeFile(path.join(app, "content", "old-note.txt"), "上一轮留下的", "utf8");
    await fs.mkdir(path.join(app, "backups"), { recursive: true });
    await fs.writeFile(path.join(app, "backups", "old.zip"), "x", "utf8");

    const result = spawnSync(process.execPath, ["scripts/e2e-server.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        E2E_SCRATCH: scratch,
        E2E_REUSE: "1",
        E2E_PORT: "3298",
        E2E_LAN_PORT: "3299",
      },
      encoding: "utf8",
      timeout: 60_000,
    });

    // 副本里没有 node_modules/next：子进程必然起不来，supervisor 不能装作没事
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("意外退出");
    // 旧数据被清掉，夹具被重新写入
    await expect(fs.access(path.join(app, "content", "old-note.txt"))).rejects.toThrow();
    await expect(fs.access(path.join(app, "backups"))).rejects.toThrow();
    const fixture = await fs.readFile(
      path.join(app, "content", "articles", "E2E-基线笔记.md"),
      "utf8",
    );
    expect(fixture).toContain("E2E 基线笔记");

    await fs.rm(scratch, { recursive: true, force: true });
  });

  it("Playwright 用 3210/3211，不碰真实 dev 的 3000", async () => {
    const config = await fs.readFile(path.join(ROOT, "playwright.config.ts"), "utf8");
    expect(config).toContain("E2E_PORT ?? 3210");
    expect(config).toContain("scripts/e2e-server.mjs");
    expect(config).not.toContain("127.0.0.1:3000");
  });

  it("夹具自洽：文件名 == frontmatter id，关联 id 都真实存在", async () => {
    const fixtureRoot = path.join(ROOT, "e2e", "fixtures", "content");
    const articlesDir = path.join(fixtureRoot, "articles");
    const files = (await fs.readdir(articlesDir)).filter((name) => name.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);

    const articleIds = new Set<string>();
    for (const file of files) {
      const source = await fs.readFile(path.join(articlesDir, file), "utf8");
      const match = source.match(/^id:\s*(.+)$/m);
      expect(match, `${file} 的 frontmatter 里没有 id`).not.toBeNull();
      expect(match![1].trim(), `${file} 的 id 与文件名不一致`).toBe(file.replace(/\.md$/, ""));
      articleIds.add(match![1].trim());
    }

    const resourceFile = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, "resources.json"), "utf8"),
    ) as { version: number; resources: Array<{ id: string; articleId?: string }> };
    const resourceIds = new Set(resourceFile.resources.map((resource) => resource.id));
    for (const resource of resourceFile.resources) {
      if (resource.articleId) {
        expect(articleIds.has(resource.articleId), `资源 ${resource.id} 关联了不存在的笔记`).toBe(
          true,
        );
      }
    }

    const taskFile = JSON.parse(
      await fs.readFile(path.join(fixtureRoot, "tasks.json"), "utf8"),
    ) as {
      version: number;
      tasks: Array<{ id: string; articleIds: string[]; resourceIds: string[] }>;
    };
    for (const task of taskFile.tasks) {
      for (const articleId of task.articleIds) {
        expect(articleIds.has(articleId), `任务 ${task.id} 关联了不存在的笔记 ${articleId}`).toBe(
          true,
        );
      }
      for (const resourceId of task.resourceIds) {
        expect(
          resourceIds.has(resourceId),
          `任务 ${task.id} 关联了不存在的资源 ${resourceId}`,
        ).toBe(true);
      }
    }
  });
});
