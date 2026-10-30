import { promises as fs, rmSync } from "node:fs";
import path from "node:path";

/**
 * E2E 副本锁（从 scripts/e2e-server.mjs 抽出来，便于做确定性并发测试）。
 *
 * 协议：
 *   1. 主锁用 `wx` 原子创建并写入 PID；成功即拥有。
 *   2. 已存在时：空/非法内容 fail closed；活 PID 拒绝；死 PID 才进入回收。
 *   3. 回收前必须用 `wx` 拿到**回收守卫**（同一时刻只有一个回收者）。
 *   4. 拿到守卫后**重读**主锁并再判活；如果已被替换成活锁，放弃（绝不删）。
 *   5. 删旧 → 建新都在守卫内；建新失败（被快路径抢先）就退出，保证只有一个 owner。
 *
 * 回收守卫只串行化「旧锁回收」；主锁不存在时快路径直接创建，不看守卫
 * —— 此时残留守卫只会在下一次遇到死主锁时挡住回收，需要人工清理。
 */

export class LockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LockError";
    this.code = code;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // 只探活，不发信号
    return true;
  } catch (error) {
    return error.code === "EPERM"; // 活着但没权限
  }
}

/**
 * @param {object} options
 * @param {string} options.lockPath
 * @param {string} options.reclaimPath
 * @param {number} [options.pid]
 * @param {(message: string) => void} [options.log]
 * @param {Record<string, (info: { pid: number, raw?: string }) => unknown | Promise<unknown>>} [options.hooks]
 *        测试用的阶段钩子：afterRead / afterReclaim / beforeRemove / beforeCreate
 */
export async function acquireScratchLock({
  lockPath,
  reclaimPath,
  pid = process.pid,
  log = () => {},
  hooks = {},
}) {
  const call = async (name, info) => {
    if (hooks[name]) await hooks[name](info);
  };
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  let created = false;
  const create = async () => {
    const handle = await fs.open(lockPath, "wx");
    try {
      await handle.writeFile(String(pid), "utf8");
    } finally {
      await handle.close();
    }
    created = true;
  };

  try {
    try {
      await create();
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw new LockError("io", `拿不到副本锁：${lockPath}（${error.code ?? error.message}）`);
      }

      const raw = await fs.readFile(lockPath, "utf8").catch(() => "");
      await call("afterRead", { pid, raw });
      const ownerPid = Number(raw.trim());
      if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
        throw new LockError(
          "occupied-empty",
          `副本已被占用（锁 ${lockPath}，PID 未知或为空）。\n` +
            `空锁可能是另一个 E2E 刚建还没写完：不会自动处理，确认没有其他 E2E 后手动删除锁文件。`,
        );
      }
      if (isProcessAlive(ownerPid)) {
        throw new LockError(
          "in-use",
          `另一个 E2E 正在使用同一份副本（pid ${ownerPid}）：${path.dirname(lockPath)}\n` +
            `等它结束，或换一个 E2E_SCRATCH。`,
        );
      }

      let reclaimHeld = false;
      try {
        try {
          const handle = await fs.open(reclaimPath, "wx");
          try {
            await handle.writeFile(String(pid), "utf8");
          } finally {
            await handle.close();
          }
          reclaimHeld = true;
        } catch (error) {
          if (error.code === "EEXIST") {
            throw new LockError(
              "reclaiming",
              `另一个 E2E 正在回收旧锁或启动中（守卫 ${reclaimPath} 存在）。\n` +
                `确认没有其他 E2E 后，手动删除它和 ${lockPath}。`,
            );
          }
          throw new LockError(
            "io",
            `拿不到回收守卫：${reclaimPath}（${error.code ?? error.message}）`,
          );
        }

        await call("afterReclaim", { pid });
        // 关键：拿到守卫后重读，防止把刚被替换的活锁删掉
        const againRaw = await fs.readFile(lockPath, "utf8").catch(() => "");
        const againPid = Number(againRaw.trim());
        if (againPid !== ownerPid || isProcessAlive(againPid)) {
          throw new LockError(
            "replaced",
            `旧锁在回收期间被替换（${raw.trim() || "空"} → ${againRaw.trim() || "空"}），` +
              `放弃回收，避免删掉活锁。`,
          );
        }

        await call("beforeRemove", { pid });
        await fs.rm(lockPath, { force: true });
        await call("beforeCreate", { pid });
        try {
          await create();
        } catch (error) {
          throw new LockError(
            "stolen",
            `回收旧锁时被另一个进程抢先：${error.code ?? error.message}`,
          );
        }
        log(`[e2e] 旧锁已回收（pid ${ownerPid} 已退出）`);
      } finally {
        if (reclaimHeld) {
          reclaimHeld = false;
          await fs.rm(reclaimPath, { force: true }).catch(() => {});
        }
      }
    }

    await call("afterCreate", { pid });
    return {
      pid,
      lockPath,
      releaseSync() {
        try {
          rmSync(lockPath, { force: true });
        } catch {
          // 正在退出，尽力而为
        }
      },
      async release() {
        await fs.rm(lockPath, { force: true }).catch(() => {});
      },
    };
  } catch (error) {
    // 只清理「自己建出来的」主锁；绝不能删别人刚建/替换的锁
    if (created) await fs.rm(lockPath, { force: true }).catch(() => {});
    if (error instanceof LockError) throw error;
    throw new LockError("io", `副本锁操作失败：${error.code ?? error.message}`);
  }
}
