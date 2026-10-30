import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * v3b 复核（P2）：日志查询失败不能当成“没有日志”。
 *
 * 原实现把 `lstat` 的任何错误都变成 `journal: null`，于是 EACCES / EIO 这类暂时性失败
 * 会让写入闸门放行；等目录恢复可读，旧的 `applying` 日志又会触发回滚，把之前的编辑顶掉。
 * 契约：只有 **ENOENT（确认不存在）** 算“没有日志”，其它错误必须冒出来并挡住写入。
 */

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const state: { error: NodeJS.ErrnoException | null } = { error: null };
  return {
    ...actual,
    promises: {
      ...actual.promises,
      lstat: async (target: string, ...rest: unknown[]) => {
        if (state.error && String(target).endsWith("restore-journal.json")) {
          throw state.error;
        }
        return (actual.promises.lstat as unknown as (...args: unknown[]) => Promise<unknown>)(
          target,
          ...rest,
        );
      },
    },
    __lstatState: state,
  };
});

const { readRestoreJournal } = await import("@/lib/content/restore-journal");
const { pendingRestoreMessage } = await import("@/lib/content/restore-gate");
const state = (
  (await import("node:fs")) as unknown as { __lstatState: { error: NodeJS.ErrnoException | null } }
).__lstatState;

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");

let dir: string;

beforeEach(async () => {
  state.error = null;
  await fs.mkdir(TMP, { recursive: true });
  dir = await fs.mkdtemp(path.join(TMP, "lookup-"));
});

afterEach(async () => {
  state.error = null;
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`injected ${code}`), { code });
}

describe("日志查询的 I/O 错误（v3b 复核 P2）", () => {
  it("EACCES：readRestoreJournal 返回错误，不是 journal:null", async () => {
    state.error = errno("EACCES");

    const read = await readRestoreJournal(dir);

    expect(read.ok).toBe(false);
    expect(state.error).not.toBeNull();
  });

  it("EACCES：写入闸门必须挡住，而不是放行", async () => {
    state.error = errno("EACCES");

    const message = await pendingRestoreMessage(dir);

    expect(message).not.toBeNull();
    expect(message).toContain("restore-journal.json");
  });

  it("EIO：同样 fail closed", async () => {
    state.error = errno("EIO");

    const message = await pendingRestoreMessage(dir);

    expect(message).not.toBeNull();
  });

  it("ENOENT：确认不存在 → 视为没有日志，放行", async () => {
    state.error = errno("ENOENT");

    const read = await readRestoreJournal(dir);

    expect(read.ok).toBe(true);
    expect(await pendingRestoreMessage(dir)).toBeNull();
  });
});
