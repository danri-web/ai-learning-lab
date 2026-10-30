import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { LockError, acquireScratchLock } from "../scripts/e2e-lock.mjs";

/**
 * 锁协议的确定性并发测试（审计 v6/v7 要求）。
 *
 * 这是**同一 Node 进程里的并发调用 + 真实文件系统 + barrier 钩子**，
 * 不是两个 OS 进程。它验证协议的交错顺序；进程级安全闸门在 e2e-safety.test.ts。
 */

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * 拿一个「确定已经退出」的 PID，而不是硬编码 999999。
 * spawn 一个空 Node 进程，等它退出后确认 kill(pid, 0) 抛 ESRCH。
 */
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
    const stale = deadPid();
    await fs.writeFile(lockPath, String(stale), "utf8");

    const bothRead = deferred();
    const aPublished = deferred();
    let reads = 0;
    const ownerPid = process.pid; // A 发布的是活 PID
    const latePid = stale; // B 的 PID 值本身不重要（它应该失败）

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
    // 先挂 rejection handler，再放行 barrier，避免 unhandled rejection
    const bRejected = expect(bPromise).rejects.toMatchObject({ code: "replaced" });

    let aHandle: Awaited<typeof aPromise> | undefined;
    try {
      aHandle = await aPromise;
      await bRejected;
      expect(await fs.readFile(lockPath, "utf8")).toBe(String(ownerPid));
    } finally {
      bothRead.resolve();
      aPublished.resolve();
      aHandle?.releaseSync();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("回收中途被新启动者抢到主锁时，回收者放弃（只有一个 owner）", async () => {
    const { dir, lockPath, reclaimPath } = await paths("e2e-lock-gap-");
    const stale = deadPid();
    await fs.writeFile(lockPath, String(stale), "utf8");

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
    const aRejected = expect(aPromise).rejects.toMatchObject({ code: "stolen" });

    let cHandle: Awaited<ReturnType<typeof acquireScratchLock>> | undefined;
    try {
      await removed.promise;
      // 主锁此刻不存在：新启动者走快路径直接拿到锁
      cHandle = await acquireScratchLock({ lockPath, reclaimPath, pid: 22222 });
      gate.resolve();
      await aRejected;
      expect(await fs.readFile(lockPath, "utf8")).toBe("22222");
    } finally {
      gate.resolve();
      cHandle?.releaseSync();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("回收守卫只允许一个回收者：A 持守卫时 B 直接 fail closed", async () => {
    const { dir, lockPath, reclaimPath } = await paths("e2e-lock-guard-");
    await fs.writeFile(lockPath, String(deadPid()), "utf8");

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

    let aHandle: Awaited<typeof aPromise> | undefined;
    try {
      await aHoldsGuard.promise;
      // A 还持有回收守卫：B 必须拿不到，不能进入删旧/建新区
      await expect(acquireScratchLock({ lockPath, reclaimPath, pid: 22222 })).rejects.toMatchObject(
        { code: "reclaiming" },
      );
      releaseA.resolve();
      aHandle = await aPromise;
      expect(await fs.readFile(lockPath, "utf8")).toBe(String(process.pid));
    } finally {
      releaseA.resolve();
      aHandle?.releaseSync();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("活锁 / 空锁 / 守卫存在时给出对应 LockError", async () => {
    const { dir, lockPath, reclaimPath } = await paths("e2e-lock-states-");
    try {
      await fs.writeFile(lockPath, String(process.pid), "utf8");
      await expect(acquireScratchLock({ lockPath, reclaimPath })).rejects.toMatchObject({
        code: "in-use",
      });
      await fs.rm(lockPath, { force: true });

      await fs.writeFile(lockPath, "", "utf8");
      await expect(acquireScratchLock({ lockPath, reclaimPath })).rejects.toMatchObject({
        code: "occupied-empty",
      });

      await fs.writeFile(lockPath, String(deadPid()), "utf8");
      await fs.writeFile(reclaimPath, "999999", "utf8");
      await expect(acquireScratchLock({ lockPath, reclaimPath })).rejects.toMatchObject({
        code: "reclaiming",
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("LockError 是 Error 的子类（服务器脚本靠它决定 fail 话术）", () => {
    expect(new LockError("x", "y")).toBeInstanceOf(Error);
  });
});
