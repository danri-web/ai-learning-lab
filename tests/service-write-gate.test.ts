import { describe, expect, it, vi } from "vitest";

/**
 * v3b 复核：闸门测试以前只断言“消息长什么样”，没有证明**服务层真的不会走到写入**。
 * 这里把闸门换成“永远有未收尾恢复”，再 mock 写入层；如果服务漏了闸门，
 * mock 的写入函数会被调用（测试红），也不会碰到真实 content/。
 */

const mocks = vi.hoisted(() => ({
  pendingRestoreMessage: vi.fn(
    async (): Promise<string | null> =>
      "上次恢复没有完成（快照 pre-restore-x.zip）。写入已暂停；请打开 /backup。",
  ),
  trashArticle: vi.fn(async () => ({ ok: true, id: "hello", trashedTo: "trash/hello.md" })),
  deleteResource: vi.fn(async () => ({ ok: true, id: "hello" })),
  deleteTask: vi.fn(async () => ({ ok: true, id: "hello" })),
}));

vi.mock("@/lib/content/restore-gate", () => ({
  pendingRestoreMessage: mocks.pendingRestoreMessage,
}));
vi.mock("@/lib/content/write", () => ({
  createArticle: vi.fn(),
  saveArticle: vi.fn(),
  trashArticle: mocks.trashArticle,
}));
vi.mock("@/lib/content/resources-store", () => ({
  createResource: vi.fn(),
  updateResource: vi.fn(),
  deleteResource: mocks.deleteResource,
}));
vi.mock("@/lib/content/tasks-store", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  updateTaskStatus: vi.fn(),
  deleteTask: mocks.deleteTask,
}));

const { deleteArticleById } = await import("@/features/articles/service");
const { deleteResourceById } = await import("@/features/resources/service");
const { deleteTaskById } = await import("@/features/tasks/service");

describe("服务层写入闸门（v3b 复核）", () => {
  it("笔记删除：未收尾时拒绝，写入层一次都没调用", async () => {
    mocks.trashArticle.mockClear();

    const result = await deleteArticleById("hello");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("写入已暂停");
    expect(mocks.trashArticle).not.toHaveBeenCalled();
  });

  it("资源删除：未收尾时拒绝，写入层一次都没调用", async () => {
    mocks.deleteResource.mockClear();

    const result = await deleteResourceById("hello");

    expect(result.ok).toBe(false);
    expect(mocks.deleteResource).not.toHaveBeenCalled();
  });

  it("任务删除：未收尾时拒绝，写入层一次都没调用", async () => {
    mocks.deleteTask.mockClear();

    const result = await deleteTaskById("hello");

    expect(result.ok).toBe(false);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it("闸门放行时才会走到写入层（证明不是永远拒绝）", async () => {
    mocks.pendingRestoreMessage.mockResolvedValueOnce(null);
    mocks.trashArticle.mockClear();

    const result = await deleteArticleById("hello");

    expect(result.ok).toBe(true);
    expect(mocks.trashArticle).toHaveBeenCalledTimes(1);
  });
});
