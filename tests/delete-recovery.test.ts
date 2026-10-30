import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createResource, deleteResource } from "@/lib/content/resources-store";
import { readResources } from "@/lib/content/resources";
import { createTask, deleteTask } from "@/lib/content/tasks-store";
import { readTasks } from "@/lib/content/tasks";

/**
 * 删除的恢复顺序（审计 F2）：
 * 旧实现先把记录从 resources.json / tasks.json 移除，再把整条记录追加到 .trash；
 * 如果 .trash 不可写，用户看到「删除失败」，但记录已经从活动数据里消失。
 *
 * 这里用「.trash 是普通文件」制造第二步失败，断言活动数据一个字节都不变。
 * 先看它失败，再改实现；改完这条必须是绿的。
 */

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const NOW = new Date(2026, 9, 30, 10, 15, 0);

let root: string;

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "delete-recovery-"));
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("删除失败时，活动数据必须原样保留", () => {
  it("资源：.trash 不是目录时，resources.json 不变", async () => {
    const created = await createResource(
      {
        title: "可恢复的资源",
        url: "https://example.com/resource",
        type: "paper",
        category: "测试",
        tags: [],
        description: "",
      },
      { root, now: NOW },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const resourcesFile = path.join(root, "resources.json");
    const before = await fs.readFile(resourcesFile, "utf8");
    await fs.writeFile(path.join(root, ".trash"), "not a directory", "utf8");

    const result = await deleteResource(created.id, { root, now: NOW });
    expect(result.ok).toBe(false);
    expect(await fs.readFile(resourcesFile, "utf8")).toBe(before);

    const current = await readResources(root);
    expect(current.resources.map((item) => item.id)).toContain(created.id);
  });

  it("任务：.trash 不是目录时，tasks.json 不变", async () => {
    const created = await createTask(
      {
        title: "可恢复的任务",
        status: "todo",
        note: "",
        articleIds: [],
        resourceIds: [],
      },
      { root, now: NOW },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const tasksFile = path.join(root, "tasks.json");
    const before = await fs.readFile(tasksFile, "utf8");
    await fs.writeFile(path.join(root, ".trash"), "not a directory", "utf8");

    const result = await deleteTask(created.id, { root, now: NOW });
    expect(result.ok).toBe(false);
    expect(await fs.readFile(tasksFile, "utf8")).toBe(before);

    const current = await readTasks(root);
    expect(current.tasks.map((item) => item.id)).toContain(created.id);
  });
});
