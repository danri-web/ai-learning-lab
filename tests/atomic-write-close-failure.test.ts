import { promises as realFs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 故障注入：让「关闭临时文件句柄」这一步失败，检查原子写入是否还会留下垃圾。
 * 这是外部审计（P2-F1）指出的控制流缺口 —— 先写这条测试去撞它，撞红了才说明问题真实存在。
 */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const state = { failNextClose: false };

  const open: typeof actual.promises.open = async (...args) => {
    const handle = await actual.promises.open(...args);
    return new Proxy(handle, {
      get(target, prop) {
        if (prop === "close" && state.failNextClose) {
          state.failNextClose = false;
          return async () => {
            await target.close();
            throw Object.assign(new Error("注入的 close 失败"), { code: "EIO" });
          };
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Awaited<ReturnType<typeof actual.promises.open>>;
  };

  return { ...actual, promises: { ...actual.promises, open }, __inject: state };
});

const { writeFileAtomic, listTempLeftovers } = await import("@/lib/fs/atomic-write");
// 这是 mock 里挂出来的注入开关，不是 node:fs 的真实成员，所以要转型
const inject = ((await import("node:fs")) as unknown as { __inject: { failNextClose: boolean } })
  .__inject;

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
let dir: string;

beforeEach(async () => {
  await realFs.mkdir(TEST_TMP_ROOT, { recursive: true });
  dir = await realFs.mkdtemp(path.join(TEST_TMP_ROOT, "close-"));
});

afterEach(async () => {
  if (dir) await realFs.rm(dir, { recursive: true, force: true });
});

describe("关闭句柄失败时", () => {
  it("抛错、目标文件保持原样，并且清理掉临时文件", async () => {
    const target = path.join(dir, "article-001.md");
    await realFs.writeFile(target, "原文");

    inject.failNextClose = true;
    await expect(writeFileAtomic(target, "新内容")).rejects.toThrow(/close 失败/);

    expect(await realFs.readFile(target, "utf8")).toBe("原文");
    expect(await listTempLeftovers(dir)).toEqual([]);
  });
});
