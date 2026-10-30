import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DATA-01：恢复日志 + 启动自动回滚。
 *
 * 任务卡里最难验证的一条是「进程在逐文件写的时候被强杀」。这里用**可构造的状态**代替真的 kill：
 * `backups/restore-journal.json` 留着 phase=applying，`content/` 是混合数据 ——
 * 这正是下次启动会看到的现场。恢复流程必须自己回到快照，而不是等人记得手动回滚。
 *
 * 每一条都先看着它红（`recoverPendingRestore` / `restore-journal` 还不存在），再修。
 */

vi.mock("@/lib/fs/atomic-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fs/atomic-write")>();
  const state = { failOn: "", calls: [] as string[] };
  return {
    ...actual,
    writeFileAtomic: async (filePath: string, data: string | Uint8Array) => {
      state.calls.push(filePath);
      if (state.failOn && filePath.endsWith(state.failOn)) {
        state.failOn = "";
        throw Object.assign(new Error("注入的写失败"), { code: "EIO" });
      }
      return actual.writeFileAtomic(filePath, data);
    },
    __inject: state,
  };
});

const { applyRestore, recoverPendingRestore, RESTORE_CONFIRM_TEXT } =
  await import("@/lib/content/restore-store");
const { createBackup, listBackups, previewRestore } = await import("@/lib/content/backup-store");
const { RESTORE_JOURNAL_NAME, restoreJournalPath } = await import("@/lib/content/restore-journal");
const inject = (
  (await import("@/lib/fs/atomic-write")) as unknown as {
    __inject: { failOn: string; calls: string[] };
  }
).__inject;

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const NOW = new Date(2026, 9, 30, 10, 15, 0);

let root: string;
let contentRoot: string;
let backupsDir: string;
let journalPath: string;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function note(id: string, title = id): string {
  return `---\nid: ${id}\ntitle: "${title}"\ncategory: 测试\ntags: []\ncreatedAt: "2026-10-01"\nupdatedAt: "2026-10-02"\n---\n\n${title} 正文\n`;
}

async function write(relative: string, text: string): Promise<void> {
  const full = path.join(contentRoot, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, text, "utf8");
}

async function read(relative: string): Promise<string> {
  return fs.readFile(path.join(contentRoot, relative), "utf8");
}

async function exists(relative: string): Promise<boolean> {
  return Boolean(await fs.stat(path.join(contentRoot, relative)).catch(() => null));
}

async function baseContent(): Promise<void> {
  await write("articles/alpha.md", note("alpha", "Alpha"));
  await write("articles/beta.md", note("beta", "Beta"));
  await write("resources.json", '{"version":1,"resources":[]}\n');
  await write("tasks.json", '{"version":1,"tasks":[]}\n');
}

/** 混合状态：alpha 被改、beta 被删、gamma 是新文件 —— 写到一半被杀的现场长这样 */
async function mixedContent(): Promise<void> {
  await write("articles/alpha.md", note("alpha", "Alpha v2"));
  await fs.rm(path.join(contentRoot, "articles", "beta.md"));
  await write("articles/gamma.md", note("gamma", "Gamma"));
}

/**
 * content/ 的字节指纹。跳过 `.trash/`：自动回滚把「多出来的文件」挪进
 * `content/.trash/restore-rollback-*`，那正是它该做的事，不算数据没回来。
 */
async function digest(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".trash") continue;
      const full = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, relative);
      else if (entry.isFile()) out.set(relative, sha256(await fs.readFile(full)));
    }
  }
  await walk(contentRoot, "");
  return out;
}

/** 恢复前快照（pre-restore-*.zip），内容 = 当前 content/ */
async function makeSnapshot(): Promise<{ name: string; path: string }> {
  const created = await createBackup({ contentRoot, backupsDir, now: NOW, kind: "pre-restore" });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("夹具快照没建出来");
  return { name: created.name, path: created.path };
}

async function makeBackup(): Promise<{ name: string; path: string }> {
  const created = await createBackup({ contentRoot, backupsDir, now: NOW });
  expect(created.ok).toBe(true);
  if (!created.ok) throw new Error("夹具备份没建出来");
  return { name: created.name, path: created.path };
}

async function seedJournal(overrides: Record<string, unknown> = {}): Promise<void> {
  await fs.mkdir(backupsDir, { recursive: true });
  const journal = {
    version: 1,
    snapshot: "pre-restore-20261030-101500.zip",
    planHash: "plan-hash",
    startedAt: NOW.toISOString(),
    phase: "applying",
    ...overrides,
  };
  await fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, "utf8");
}

async function journalExists(): Promise<boolean> {
  return Boolean(await fs.lstat(journalPath).catch(() => null));
}

beforeEach(async () => {
  inject.failOn = "";
  inject.calls = [];
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "recovery-"));
  contentRoot = path.join(root, "content");
  backupsDir = path.join(root, "backups");
  journalPath = restoreJournalPath(backupsDir);
  await baseContent();
});

afterEach(async () => {
  inject.failOn = "";
  inject.calls = [];
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("启动恢复：backups/restore-journal.json", () => {
  it("没有日志：什么都不做", async () => {
    const before = await digest();
    const result = await recoverPendingRestore({ contentRoot, backupsDir, now: NOW });
    expect(result).toEqual({ state: "none" });
    expect(await digest()).toEqual(before);
  });

  it("phase=applying：回滚到快照字节，然后删掉日志", async () => {
    const snapshot = await makeSnapshot();
    const before = await digest();
    await mixedContent();
    await seedJournal({ snapshot: snapshot.name, phase: "applying" });

    const result = await recoverPendingRestore({ contentRoot, backupsDir, now: NOW });

    expect(result.state).toBe("recovered");
    if (result.state !== "recovered") return;
    expect(result.snapshot).toBe(snapshot.name);
    expect(await digest()).toEqual(before);
    expect(await read("articles/alpha.md")).toContain("Alpha 正文");
    expect(await exists("articles/beta.md")).toBe(true);
    expect(await exists("articles/gamma.md")).toBe(false);
    expect(await journalExists()).toBe(false);
    // 快照本身不能因为这次回滚被删（它仍是用户手动回滚的兜底）
    expect((await listBackups(backupsDir)).length).toBe(1);
  });

  it("phase=verified：上次其实已经成功，只删日志、一个字节都不碰", async () => {
    await mixedContent();
    const before = await digest();
    await seedJournal({ phase: "verified" });

    const result = await recoverPendingRestore({ contentRoot, backupsDir, now: NOW });

    expect(result.state).toBe("already-complete");
    expect(await digest()).toEqual(before);
    expect(await journalExists()).toBe(false);
  });

  it.each<[string, string]>([
    ["坏 JSON", "{ this is not json"],
    [
      "缺 planHash",
      JSON.stringify({
        version: 1,
        snapshot: "pre-restore-20261030-101500.zip",
        startedAt: NOW.toISOString(),
        phase: "applying",
      }),
    ],
    [
      "版本不认识",
      JSON.stringify({
        version: 2,
        snapshot: "pre-restore-20261030-101500.zip",
        planHash: "plan-hash",
        startedAt: NOW.toISOString(),
        phase: "applying",
      }),
    ],
    [
      "phase 不认识",
      JSON.stringify({
        version: 1,
        snapshot: "pre-restore-20261030-101500.zip",
        planHash: "plan-hash",
        startedAt: NOW.toISOString(),
        phase: "done",
      }),
    ],
    [
      "snapshot 是路径",
      JSON.stringify({
        version: 1,
        snapshot: "../../evil.zip",
        planHash: "plan-hash",
        startedAt: NOW.toISOString(),
        phase: "applying",
      }),
    ],
  ])("%s：fail closed，content 与日志都不变", async (_label, raw) => {
    const before = await digest();
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(journalPath, raw, "utf8");

    const result = await recoverPendingRestore({ contentRoot, backupsDir, now: NOW });

    expect(result.state).toBe("failed");
    if (result.state === "failed") {
      expect(result.snapshot).toBeNull();
      expect(result.error).toContain(journalPath);
    }
    // 不猜、不修、不删：日志就是唯一线索
    expect(await fs.readFile(journalPath, "utf8")).toBe(raw);
    expect(await digest()).toEqual(before);
  });

  it("快照缺失：保留日志，错误里给出快照名与手动回滚入口", async () => {
    await mixedContent();
    const before = await digest();
    await seedJournal({ snapshot: "pre-restore-20261030-999999.zip", phase: "applying" });

    const result = await recoverPendingRestore({ contentRoot, backupsDir, now: NOW });

    expect(result.state).toBe("failed");
    if (result.state === "failed") {
      expect(result.snapshot).toBe("pre-restore-20261030-999999.zip");
      expect(result.error).toContain("pre-restore-20261030-999999.zip");
      expect(result.error).toContain("/backup");
    }
    expect(await journalExists()).toBe(true);
    expect(await digest()).toEqual(before);
  });

  it("快照是坏 zip：保留日志", async () => {
    await fs.mkdir(backupsDir, { recursive: true });
    const broken = "pre-restore-20261030-888888.zip";
    await fs.writeFile(path.join(backupsDir, broken), "PK\u0003\u0004truncated", "utf8");
    await mixedContent();
    const before = await digest();
    await seedJournal({ snapshot: broken, phase: "applying" });

    const result = await recoverPendingRestore({ contentRoot, backupsDir, now: NOW });

    expect(result.state).toBe("failed");
    if (result.state === "failed") expect(result.snapshot).toBe(broken);
    expect(await journalExists()).toBe(true);
    expect(await digest()).toEqual(before);
  });

  it("回滚失败（目标位置变成目录）：journal 保留，错误里带快照名", async () => {
    const snapshot = await makeSnapshot();
    await mixedContent();
    await fs.rm(path.join(contentRoot, "resources.json"));
    await fs.mkdir(path.join(contentRoot, "resources.json"));

    const before = await digest();
    await seedJournal({ snapshot: snapshot.name, phase: "applying" });

    const result = await recoverPendingRestore({ contentRoot, backupsDir, now: NOW });

    expect(result.state).toBe("failed");
    if (result.state === "failed") {
      expect(result.snapshot).toBe(snapshot.name);
      expect(result.error).toContain(snapshot.name);
      expect(result.error).toContain("/backup");
    }
    expect(await journalExists()).toBe(true);
    expect(await digest()).toEqual(before);
  });

  it("正常恢复成功：没有日志残留", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(await journalExists()).toBe(false);
  });

  it("恢复顺序：日志先落盘，再动 content/ 的第一个文件", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });
    expect(result.ok).toBe(true);

    const journalIndex = inject.calls.findIndex((file) => file.endsWith(RESTORE_JOURNAL_NAME));
    const firstContentFile = inject.calls.findIndex((file) => file.endsWith(".md"));
    expect(journalIndex).toBeGreaterThanOrEqual(0);
    expect(firstContentFile).toBeGreaterThan(journalIndex);
  });

  it("普通失败但回滚成功：没有日志残留", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    await fs.rm(path.join(contentRoot, "articles", "beta.md"));

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    inject.failOn = "beta.md";
    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("已自动回滚");
    expect(await journalExists()).toBe(false);
  });

  it("预检失败（一个文件都没写）：日志不残留，content 字节不变", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    await fs.rm(path.join(contentRoot, "resources.json"));
    await fs.mkdir(path.join(contentRoot, "resources.json"));

    const before = await digest();
    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("没有改动");
    expect(await digest()).toEqual(before);
    expect(await journalExists()).toBe(false);
  });

  it("日志写失败：不写 content/，返回 io 错误", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));

    const before = await digest();
    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    inject.failOn = RESTORE_JOURNAL_NAME;
    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("io");
      expect(result.error).toContain("恢复日志");
      expect(result.error).toContain("没有改动");
    }
    expect(await digest()).toEqual(before);
    expect(await journalExists()).toBe(false);
  });

  it("日志坏掉时拒绝开始新的恢复（先收尾，再恢复）", async () => {
    const backup = await makeBackup();
    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    const before = await digest();
    await fs.writeFile(journalPath, "{ broken", "utf8");

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: backup.name,
      planHash: "whatever",
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("恢复日志");
    expect(await digest()).toEqual(before);
    expect(await fs.readFile(journalPath, "utf8")).toBe("{ broken");
  });
});
