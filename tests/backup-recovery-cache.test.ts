import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RestoreRecovery } from "@/lib/content/restore-types";

/**
 * v3c/v3d 复核：恢复检查的缓存边界。
 *
 * 反例：overview 先检查到“没有日志”（成功）→ 之后的恢复失败，留下 `applying` →
 * 后续 overview 复用旧的成功结果，恢复提示一直是 null，`/backup` 上的“放弃日志”入口不出现。
 * 契约：只缓存**正在进行的检查**，结果不缓存；每次 overview 都现读日志。
 * 启动提示（instrumentation 收尾成功后日志已删）单独保留，但**一旦被清掉就必须标记为已消费**，
 * 否则下一次 overview 会从 globalThis 把旧提示读回来（v3d 复核 Low）。
 */

const mocks = vi.hoisted(() => ({
  recover: vi.fn(async (): Promise<RestoreRecovery> => ({ state: "none" })),
  startup: vi.fn((): RestoreRecovery | null => null),
  applyRestore: vi.fn(async () => ({ ok: true as const })),
  discard: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("@/lib/security/auth", () => ({ requireAuth: vi.fn(async () => undefined) }));
vi.mock("@/lib/content/backup-store", () => ({
  backupsRoot: () => "D:/tmp/backups",
  contentFilesRoot: () => "D:/tmp/content",
  createBackup: vi.fn(),
  listBackups: vi.fn(async () => []),
  previewRestore: vi.fn(),
  readBackupBytes: vi.fn(),
  resolveBackupFile: vi.fn(),
  scanContent: vi.fn(async () => ({ files: [], skipped: [] })),
  verifyBackupByName: vi.fn(),
}));
vi.mock("@/lib/content/backup-validate", () => ({
  countByKind: () => ({ notes: 0, resources: 0, tasks: 0, trash: 0 }),
}));
vi.mock("@/lib/content/restore-journal", () => ({
  restoreJournalPath: (dir: string) => `${dir}/restore-journal.json`,
}));
vi.mock("@/lib/content/restore-startup", () => ({ startupRecovery: mocks.startup }));
vi.mock("@/lib/content/restore-store", () => ({
  recoverPendingRestore: mocks.recover,
  applyRestore: mocks.applyRestore,
  discardPendingRestore: mocks.discard,
}));

type Service = typeof import("@/features/backup/service");

let service: Service;

beforeEach(async () => {
  // 每个用例重新加载 service，清掉模块级的“启动提示已读/提示内容”状态
  vi.resetModules();
  mocks.recover.mockReset();
  mocks.startup.mockReset();
  mocks.applyRestore.mockReset();
  mocks.discard.mockReset();
  mocks.recover.mockResolvedValue({ state: "none" });
  mocks.startup.mockReturnValue(null);
  mocks.applyRestore.mockResolvedValue({ ok: true });
  mocks.discard.mockResolvedValue({ ok: true });
  service = await import("@/features/backup/service");
});

describe("恢复检查的缓存边界（v3c/v3d 复核）", () => {
  it("启动提示在被成功恢复消费后，不会从 globalThis 复活（v3d 复核 Low）", async () => {
    // 启动时 instrumentation 收尾成功，但用户还没打开过 /backup（提示尚未被读过）
    mocks.startup.mockReturnValue({ state: "recovered", snapshot: "pre-old.zip" });

    // 先发生一次新的成功恢复：它必须把旧启动提示消费掉
    await service.applyRestoreFromForm({
      name: "ai-lab-20261030-101500.zip",
      planHash: "x",
      includeDeletes: false,
      confirm: "恢复",
    });

    const overview = await service.loadBackupOverview();

    expect(overview.recovery).toBeNull();
  });

  it("启动收尾的提示会保留（日志这时已经删了）", async () => {
    mocks.startup.mockReturnValue({ state: "recovered", snapshot: "pre-restore-x.zip" });

    const overview = await service.loadBackupOverview();

    expect(overview.recovery?.message).toContain("已自动回到恢复前");
    expect(overview.recovery?.message).toContain("pre-restore-x.zip");
  });

  it("先成功后失败：下一次 overview 必须重新检查，并显示错误提示", async () => {
    expect((await service.loadBackupOverview()).recovery).toBeNull();

    // 模拟“恢复失败、回滚也失败，留下 applying 日志”
    mocks.recover.mockResolvedValueOnce({
      state: "failed",
      snapshot: "pre-restore-x.zip",
      error: "自动回滚也失败",
    });

    const second = await service.loadBackupOverview();

    expect(second.recovery?.tone).toBe("error");
    expect(second.recovery?.message).toContain("pre-restore-x.zip");
  });

  it("并发请求只共用一次检查（缓存的是进行中的 Promise）", async () => {
    let resolveRecovery!: (value: RestoreRecovery) => void;
    mocks.recover.mockImplementationOnce(
      () =>
        new Promise<RestoreRecovery>((resolve) => {
          resolveRecovery = resolve;
        }),
    );

    const first = service.loadBackupOverview();
    const second = service.loadBackupOverview();
    await Promise.resolve();

    expect(mocks.recover).toHaveBeenCalledTimes(1);

    resolveRecovery({ state: "none" });
    await Promise.all([first, second]);
  });
});
