import type { RestoreRecovery } from "@/lib/content/restore-types";

/**
 * 启动恢复的结果要跨 bundle 传给页面（v2 审计之后的新路径）。
 *
 * `instrumentation.ts` 里的 `register()` 会被 Next 单独打成一个 chunk，模块级变量和
 * 应用路由里的模块**不一定是同一份实例**；所以把结果放在 `globalThis` 上，用固定键读写。
 *
 * 只存最后一次结果；同一进程只启动一次，不需要队列。
 */

const KEY = "__aiLabRestoreStartupRecovery";

type GlobalWithRecovery = typeof globalThis & {
  __aiLabRestoreStartupRecovery?: RestoreRecovery;
};

export function recordStartupRecovery(result: RestoreRecovery): void {
  (globalThis as GlobalWithRecovery)[KEY] = result;
}

export function startupRecovery(): RestoreRecovery | null {
  return (globalThis as GlobalWithRecovery)[KEY] ?? null;
}
