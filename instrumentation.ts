/**
 * 进程启动时先收尾上一次没做完的恢复（DATA-01 / ADR D18）。
 *
 * 为什么终于用 instrumentation：v2 外部审计指出「延迟到打开 /backup 才回滚」会把
 * **重启后先做的编辑**顶掉。要消掉这个窗口，恢复必须在服务开始处理请求之前跑。
 * Next 16 自己的 `registerInstrumentation()` 已经用
 * `NEXT_PHASE === 'phase-production-build'` 跳过构建阶段（见
 * `node_modules/next/dist/server/lib/router-utils/instrumentation-globals.external.js`），
 * 所以这里不会再出现「build 期间回滚文件」的问题。
 *
 * 失败不阻塞启动：日志保留、写入闸门（lib/content/restore-gate.ts）会挡住正常写入，
 * 用户在 /backup 看到原因并决定重试或放弃日志。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { recoverPendingRestore } = await import("@/lib/content/restore-store");
    const { recordStartupRecovery } = await import("@/lib/content/restore-startup");
    const result = await recoverPendingRestore({});
    recordStartupRecovery(result);

    if (result.state === "recovered") {
      console.warn(`[restore] 上次恢复没有完成，已自动回滚（快照 ${result.snapshot}）`);
    } else if (result.state === "failed") {
      console.error(`[restore] 启动收尾失败，写入已暂停：${result.error}`);
    }
  } catch (error) {
    console.error("[restore] 启动收尾出错（写入会被闸门挡住，去 /backup 处理）", error);
  }
}
