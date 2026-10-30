import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { readTasks, taskRevision } from "@/lib/content/tasks";
import {
  createTask,
  deleteTask,
  updateTask,
  updateTaskStatus,
  type TaskInput,
} from "@/lib/content/tasks-store";

/** 临时目录落在 node_modules 里（`mkdtemp` 在受限沙箱 EPERM） */
async function tempRoot(name: string): Promise<string> {
  const dir = path.join(
    process.cwd(),
    "node_modules",
    ".vitest-tmp",
    "task-store",
    `${name}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

const NOW = new Date("2026-10-30T10:00:00");

function input(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    title: "学 Transformer Attention",
    status: "todo",
    note: "",
    articleIds: [],
    resourceIds: [],
    ...overrides,
  };
}

describe("新建任务", () => {
  it("落盘后能原样读回来（写进去的必须读得回来）", async () => {
    const root = await tempRoot("create");
    const result = await createTask(
      input({ dueDate: "2026-11-05", articleIds: ["注意力机制"], resourceIds: ["attention-paper"] }),
      { root, now: NOW },
    );
    expect(result.ok).toBe(true);

    const { tasks, problem } = await readTasks(root);
    expect(problem).toBeNull();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "学 Transformer Attention",
      status: "todo",
      dueDate: "2026-11-05",
      articleIds: ["注意力机制"],
      resourceIds: ["attention-paper"],
      createdAt: "2026-10-30",
      updatedAt: "2026-10-30",
    });
  });

  it("id 由标题生成；重名加 -2（中文照抄）", async () => {
    const root = await tempRoot("dedupe");
    const first = await createTask(input(), { root, now: NOW });
    const second = await createTask(input(), { root, now: NOW });
    expect(first.ok && first.id).toBe("学-Transformer-Attention");
    expect(second.ok && second.id).toBe("学-Transformer-Attention-2");
  });

  it("关联的 id 会去重（同一个资源选两次不该存两遍）", async () => {
    const root = await tempRoot("unique-links");
    await createTask(input({ articleIds: ["a", "a", "b"], resourceIds: ["r", "r"] }), {
      root,
      now: NOW,
    });
    const { tasks } = await readTasks(root);
    expect(tasks[0].articleIds).toEqual(["a", "b"]);
    expect(tasks[0].resourceIds).toEqual(["r"]);
  });

  it.each([
    ["空标题", input({ title: "   " })],
    ["不存在的截止日期", input({ dueDate: "2026-02-30" })],
    ["非法状态", input({ status: "paused" as never })],
  ])("坏输入被拒绝：%s", async (_label, bad) => {
    const root = await tempRoot("reject");
    const result = await createTask(bad, { root, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
    // 一条都不该落盘
    expect((await readTasks(root)).tasks).toEqual([]);
  });
});

describe("并发（D8 的回归）", () => {
  it("同一标题 8 路并发新建：8 个不同 id，8 份内容都在", async () => {
    const root = await tempRoot("concurrent");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createTask(input({ title: `并发任务 ${index}` }), { root, now: NOW }),
      ),
    );
    const ids = results.map((result) => (result.ok ? result.id : `fail-${result.error}`));
    expect(new Set(ids).size).toBe(8);
    expect((await readTasks(root)).tasks).toHaveLength(8);
  });
});

describe("保存任务", () => {
  it("改标题不改 id，createdAt 不变，updatedAt 跟着走", async () => {
    const root = await tempRoot("update");
    const created = await createTask(input(), { root, now: NOW });
    if (!created.ok) throw new Error("建失败");

    const later = new Date("2026-11-01T09:00:00");
    const result = await updateTask(
      created.id,
      input({ title: "学 Attention（改名后）", status: "doing" }),
      { root, now: later, expectRevision: created.revision },
    );
    expect(result.ok).toBe(true);

    const { tasks } = await readTasks(root);
    expect(tasks[0]).toMatchObject({
      id: created.id,
      title: "学 Attention（改名后）",
      status: "doing",
      createdAt: "2026-10-30",
      updatedAt: "2026-11-01",
    });
  });

  it("指纹对不上就拒绝，磁盘一个字都不变（D8）", async () => {
    const root = await tempRoot("stale");
    const created = await createTask(input(), { root, now: NOW });
    if (!created.ok) throw new Error("建失败");

    const before = await readFile(path.join(root, "tasks.json"), "utf8");
    const result = await updateTask(created.id, input({ title: "别人改过的稿" }), {
      root,
      now: NOW,
      expectRevision: "过期的指纹",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("stale");
    expect(await readFile(path.join(root, "tasks.json"), "utf8")).toBe(before);
  });

  it("force 可以覆盖（决定权在用户手里）", async () => {
    const root = await tempRoot("force");
    const created = await createTask(input(), { root, now: NOW });
    if (!created.ok) throw new Error("建失败");

    const result = await updateTask(created.id, input({ title: "强制覆盖" }), {
      root,
      now: NOW,
      expectRevision: "过期的指纹",
      force: true,
    });
    expect(result.ok).toBe(true);
    expect((await readTasks(root)).tasks[0].title).toBe("强制覆盖");
  });

  it("保存不存在的 id → not-found", async () => {
    const root = await tempRoot("missing");
    const result = await updateTask("no-such-task", input(), { root, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-found");
  });
});

describe("列表上改状态", () => {
  it("只动 status 与 updatedAt，别的字段一个都不许变", async () => {
    const root = await tempRoot("status");
    const created = await createTask(
      input({ dueDate: "2026-11-05", note: "备注要保住", articleIds: ["注意力机制"] }),
      { root, now: NOW },
    );
    if (!created.ok) throw new Error("建失败");

    const later = new Date("2026-10-31T20:00:00");
    const result = await updateTaskStatus(created.id, "done", { root, now: later });
    expect(result.ok).toBe(true);

    const { tasks } = await readTasks(root);
    expect(tasks[0]).toMatchObject({
      status: "done",
      note: "备注要保住",
      dueDate: "2026-11-05",
      articleIds: ["注意力机制"],
      createdAt: "2026-10-30",
      updatedAt: "2026-10-31",
    });
  });

  it("找不到这条任务 → not-found，不写任何东西", async () => {
    const root = await tempRoot("status-missing");
    const result = await updateTaskStatus("nope", "done", { root, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-found");
  });
});

describe("删除任务", () => {
  it("从列表里移除，并把整条记录追加进回收站（内容一字不差）", async () => {
    const root = await tempRoot("delete");
    const created = await createTask(input({ note: "删了也要能找回来" }), { root, now: NOW });
    if (!created.ok) throw new Error("建失败");

    const result = await deleteTask(created.id, { root, now: NOW });
    expect(result.ok).toBe(true);
    expect((await readTasks(root)).tasks).toEqual([]);

    const trash = await readFile(path.join(root, ".trash", "tasks-deleted.jsonl"), "utf8");
    const lines = trash.trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { deletedAt: string; task: { note: string; id: string } };
    expect(entry.task.id).toBe(created.id);
    expect(entry.task.note).toBe("删了也要能找回来");
    expect(entry.deletedAt).toMatch(/^\d{8}-\d{6}$/); // 20261030-100000，与笔记的回收站命名同一个格式
  });
});

describe("坏文件保护", () => {
  it("tasks.json 坏掉时拒绝写入，且不去覆盖它", async () => {
    const root = await tempRoot("broken");
    const broken = "{ 这不是 json";
    await writeFile(path.join(root, "tasks.json"), broken, "utf8");

    const result = await createTask(input(), { root, now: NOW });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid");
    expect(await readFile(path.join(root, "tasks.json"), "utf8")).toBe(broken);
  });
});

describe("指纹", () => {
  it("落盘后的指纹与读回来的指纹一致（编辑页的 base 才不会一保存就冲突）", async () => {
    const root = await tempRoot("revision");
    const created = await createTask(input(), { root, now: NOW });
    if (!created.ok) throw new Error("建失败");

    const { tasks } = await readTasks(root);
    expect(taskRevision(tasks[0])).toBe(created.revision);
  });
});
