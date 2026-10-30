import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { restoreJournalPath } from "@/lib/content/restore-journal";
import { discardPendingRestore } from "@/lib/content/restore-store";
import { serialize } from "@/lib/fs/mutex";

/**
 * v3b 复核：`discardRestoreJournal()` 原来绕过了恢复的 `serialize` 队列，
 * 可能与正在跑的恢复同时删日志。现在走 `discardPendingRestore()`（restore-store 内部拿锁），
 * 这两个测试钉住两件事：真的删掉、不会插到正在进行的恢复前面。
 */

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");

let dir: string;

beforeEach(async () => {
  await fs.mkdir(TMP, { recursive: true });
  dir = await fs.mkdtemp(path.join(TMP, "discard-"));
  await fs.writeFile(restoreJournalPath(dir), '{"version":1}', "utf8");
});

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe("放弃恢复日志（v3b 复核）", () => {
  it("删掉日志并返回 ok", async () => {
    const result = await discardPendingRestore(dir);

    expect(result.ok).toBe(true);
    await expect(fs.lstat(restoreJournalPath(dir))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("与正在进行的恢复串行：不会插队删日志", async () => {
    const order: string[] = [];

    const recovering = serialize(async () => {
      order.push("recover-start");
      await new Promise((resolve) => setTimeout(resolve, 60));
      order.push("recover-end");
    });
    const discarding = discardPendingRestore(dir).then((result) => {
      order.push(`discard:${result.ok}`);
    });

    await Promise.all([recovering, discarding]);

    expect(order).toEqual(["recover-start", "recover-end", "discard:true"]);
  });
});
