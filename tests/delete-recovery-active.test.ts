import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 审计 v4 F2 的第二半：先写 .trash、再写活动 JSON。
 * 如果活动 JSON 写失败，刚追加的恢复行必须撤回，否则会出现
 * 「活动数据还在、却多了一条删除记录」的假删除。
 */
vi.mock("@/lib/fs/atomic-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fs/atomic-write")>();
  const state = { failOn: "" };
  return {
    ...actual,
    writeFileAtomic: async (filePath: string, data: string | Uint8Array) => {
      if (state.failOn && filePath.endsWith(state.failOn)) {
        state.failOn = "";
        throw Object.assign(new Error("注入的写失败"), { code: "EIO" });
      }
      return actual.writeFileAtomic(filePath, data);
    },
    __inject: state,
  };
});

const { createResource, deleteResource } = await import("@/lib/content/resources-store");
const { readResources } = await import("@/lib/content/resources");
const { createTask, deleteTask } = await import("@/lib/content/tasks-store");
const { readTasks } = await import("@/lib/content/tasks");
const inject = (
  (await import("@/lib/fs/atomic-write")) as unknown as { __inject: { failOn: string } }
).__inject;

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const NOW = new Date(2026, 9, 30, 10, 15, 0);

let root: string;

beforeEach(async () => {
  inject.failOn = "";
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "delete-rollback-"));
});

afterEach(async () => {
  inject.failOn = "";
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("活动 JSON 写失败时，撤回刚追加的删除记录", () => {
  it("资源：resources.json 写失败，记录仍在活动数据里，.trash 没有残留行", async () => {
    const created = await createResource(
      {
        title: "写失败也要留下",
        url: "https://example.com/keep",
        type: "paper",
        category: "测试",
        tags: [],
        description: "",
      },
      { root, now: NOW },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const trashFile = path.join(root, ".trash", "resources-deleted.jsonl");
    inject.failOn = "resources.json";
    const result = await deleteResource(created.id, { root, now: NOW });
    expect(result.ok).toBe(false);

    const current = await readResources(root);
    expect(current.resources.map((item) => item.id)).toContain(created.id);
    expect(await fs.readFile(trashFile, "utf8")).toBe("");
  });

  it("任务：tasks.json 写失败，记录仍在活动数据里，.trash 没有残留行", async () => {
    const created = await createTask(
      { title: "写失败也要留下", status: "todo", note: "", articleIds: [], resourceIds: [] },
      { root, now: NOW },
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const trashFile = path.join(root, ".trash", "tasks-deleted.jsonl");
    inject.failOn = "tasks.json";
    const result = await deleteTask(created.id, { root, now: NOW });
    expect(result.ok).toBe(false);

    const current = await readTasks(root);
    expect(current.tasks.map((item) => item.id)).toContain(created.id);
    expect(await fs.readFile(trashFile, "utf8")).toBe("");
  });
});
