import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pendingRestoreMessage } from "@/lib/content/restore-gate";
import { restoreJournalPath } from "@/lib/content/restore-journal";

/**
 * 写入闸门（v2 审计 V2-DATA-01）。
 *
 * 自动回滚以前只在打开 /backup、/settings 或执行恢复时才跑；如果重启后先编辑了笔记，
 * 后来的回滚会把这次编辑覆盖掉。现在的契约：
 *   - 进程启动时先收尾（instrumentation.ts），正常情况根目录没有日志；
 *   - 万一日志还在（收尾失败 / 收尾没跑），**所有写入先被闸门挡住**，
 *     并给出快照名与处理入口 —— 宁可暂时不能写，也不静默覆盖。
 */

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");

let backupsDir: string;

async function seed(raw: string): Promise<void> {
  await fs.mkdir(backupsDir, { recursive: true });
  await fs.writeFile(restoreJournalPath(backupsDir), raw, "utf8");
}

function journal(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    snapshot: "pre-restore-20261030-101500.zip",
    planHash: "plan-hash",
    startedAt: "2026-10-30T10:15:00.000Z",
    phase: "applying",
    ...overrides,
  });
}

beforeEach(async () => {
  await fs.mkdir(TMP, { recursive: true });
  backupsDir = await fs.mkdtemp(path.join(TMP, "restore-gate-"));
});

afterEach(async () => {
  if (backupsDir) await fs.rm(backupsDir, { recursive: true, force: true });
});

describe("写入闸门：restore-journal 未收尾时挡住写入", () => {
  it("没有日志：放行", async () => {
    expect(await pendingRestoreMessage(backupsDir)).toBeNull();
  });

  it("backups/ 目录不存在：放行", async () => {
    expect(await pendingRestoreMessage(path.join(backupsDir, "nope"))).toBeNull();
  });

  it("phase=applying：挡住，并给出快照名与处理入口", async () => {
    await seed(journal());

    const message = await pendingRestoreMessage(backupsDir);

    expect(message).toContain("pre-restore-20261030-101500.zip");
    expect(message).toContain("/backup");
  });

  it("phase=verified：放行（数据已一致，只差清日志）", async () => {
    await seed(journal({ phase: "verified" }));
    expect(await pendingRestoreMessage(backupsDir)).toBeNull();
  });

  it("日志读不出来：挡住并给出日志路径，不猜内容", async () => {
    await seed("{ not json");

    const message = await pendingRestoreMessage(backupsDir);

    expect(message).toContain(restoreJournalPath(backupsDir));
  });
});
