import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LockError, acquireScratchLock } from "../scripts/e2e-lock.mjs";

/**
 * 锁协议的确定性并发测试（审计 v6 要求）。
 *
 * 真实双进程交错很难稳定复现；这里用模块的 phase hooks 当 barrier：
 * 让两个「回收者」都先读到同一个死 PID，再让 A 完成回收并发布新锁，
 * 最后才放 B 继续 —— B 必须拒绝，且不能删掉 A 的新锁。
 */

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function paths(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    dir,
    lockPath: path.join(dir, ".lock"),
    reclaimPath: path.join(dir, ".lock.reclaim"),
  };
}

describe("E2E 副本锁协议", () => {
  it("两个回收者：后到的那个不能删掉先到者的新锁（审计 v6 P2）", async () => {
    const { dir, lockPath, reclaimPath } = await paths("e2e-lock-race-");
    await fs.writeFile(lockPath, "999999", "utf8");

    const bothRead = deferred();
    const aPublished = deferred();
    let reads = 0;
    const ownerPid = process.pid; // A 发布的是活 PID
    const latePid = 999999; // B 的 PID 值本身不重要（它应该失败）

    const afterRead = async ({ pid }: { pid: number }) => {
      reads += 1;
      if (reads === 2) bothRead.resolve();
      await bothRead.promise;
      // A 先走；B 等 A 真正发布新锁之后才继续
      if (pid === latePid) await aPublished.promise;
    };

    const aPromise = acquireScratchLock({
      lockPath,
      reclaimPath,
      pid: ownerPid,
      hooks: { afterRead, afterCreate: () => aPublished.resolve() },
    });
    const bPromise = acquireScratchLock({
      lockPath,
      reclaimPath,
      pid: latePid,
      hooks: { afterRead },
    });

    const aHandle = await aPromise;
    await expect(bPromise).rejects.toMatchObject({ code: "replaced" });
    // A 的锁必须还在
    expect(await fs.readFile(lockPath, "utf8")).toBe(String(ownerPid));

    aHandle.releaseSync();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("回收中途被新启动者抢到主锁时，回收者放弃（只有一个 owner）", async () => {
    const { dir, lockPath, reclaimPath } = await paths("e2e-lock-gap-");
    await fs.writeFile(lockPath, "999999", "utf8");

    const removed = deferred();
    const gate = deferred();
    const aPromise = acquireScratchLock({
      lockPath,
      reclaimPath,
      pid: 11111,
      hooks: {
        beforeCreate: async () => {
          removed.resolve();
          await gate.promise;
        },
      },
    });

    await removed.promise;
    // 主锁此刻不存在：新启动者走快路径直接拿到锁
    const cHandle = await acquireScratchLock({ lockPath, reclaimPath, pid: 22222 });
    gate.resolve();

    await expect(aPromise).rejects.toMatchObject({ code: "stolen" });
    expect(await fs.readFile(lockPath, "utf8")).toBe("22222");

    cHandle.releaseSync();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("回收守卫只允许一个回收者：A 持守卫时 B 直接 fail closed", async () => {
    const { dir, lockPath, reclaimPath } = await paths("e2e-lock-guard-");
    await fs.writeFile(lockPath, "999999", "utf8");

    const aHoldsGuard = deferred();
    const releaseA = deferred();
    const aPromise = acquireScratchLock({
      lockPath,
      reclaimPath,
      pid: process.pid,
      hooks: {
        afterReclaim: async () => {
          aHoldsGuard.resolve();
          await releaseA.promise;
        },
      },
    });

    await aHoldsGuard.promise;
    // A 还持有回收守卫：B 必须拿不到，不能进入删旧/建新区
    await expect(
      acquireScratchLock({ lockPath, reclaimPath, pid: 22222 }),
    ).rejects.toMatchObject({ code: "reclaiming" });

    releaseA.resolve();
    const aHandle = await aPromise;
    expect(await fs.readFile(lockPath, "utf8")).toBe(String(process.pid));

    aHandle.releaseSync();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("活锁 / 空锁 / 守卫存在时给出对应 LockError", async () => {
    const { dir, lockPath, reclaimPath } = await paths("e2e-lock-states-");

    await fs.writeFile(lockPath, String(process.pid), "utf8");
    await expect(acquireScratchLock({ lockPath, reclaimPath })).rejects.toMatchObject({
      code: "in-use",
    });
    await fs.rm(lockPath, { force: true });

    await fs.writeFile(lockPath, "", "utf8");
    await expect(acquireScratchLock({ lockPath, reclaimPath })).rejects.toMatchObject({
      code: "occupied-empty",
    });

    await fs.writeFile(lockPath, "999999", "utf8");
    await fs.writeFile(reclaimPath, "999999", "utf8");
    await expect(acquireScratchLock({ lockPath, reclaimPath })).rejects.toMatchObject({
      code: "reclaiming",
    });

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("LockError 是 Error 的子类（服务器脚本靠它决定 fail 话术）", () => {
    expect(new LockError("x", "y")).toBeInstanceOf(Error);
  });
});
