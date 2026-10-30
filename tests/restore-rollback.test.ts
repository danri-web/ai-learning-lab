import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 故障注入：让恢复写到第二个文件时失败，检查两件事：
 *   1. 返回失败（不是假成功）
 *   2. content/ 被自动回滚到恢复前的字节状态（快照兜底）
 *
 * 这是「坏备份/坏时机不该毁掉现有数据」里最难的一条 —— 不是靠代码读起来对，
 * 而是靠注入一次真实的 I/O 失败，看它能不能回去。
 */
vi.mock("@/lib/fs/atomic-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fs/atomic-write")>();
  const state = { failOn: "" };
  return {
    ...actual,
    writeFileAtomic: async (filePath: string, data: string | Uint8Array) => {
      if (state.failOn && filePath.endsWith(state.failOn)) {
        state.failOn = "";
        throw Object.assign(new Error("注入的写失败"), { code: "EIO" });
      }
      return actual.writeFileAtomic(filePath, data);
    },
    __inject: state,
  };
});

const { applyRestore, RESTORE_CONFIRM_TEXT } = await import("@/lib/content/restore-store");
const { createBackup, loadVerifiedBackup, previewRestore } =
  await import("@/lib/content/backup-store");
const inject = (
  (await import("@/lib/fs/atomic-write")) as unknown as {
    __inject: { failOn: string };
  }
).__inject;

const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const NOW = new Date(2026, 9, 30, 10, 15, 0);

let root: string;
let contentRoot: string;
let backupsDir: string;

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

async function digest(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        out.set(
          path.relative(contentRoot, full).split(path.sep).join("/"),
          sha256(await fs.readFile(full)),
        );
      }
    }
  }
  await walk(contentRoot);
  return out;
}

beforeEach(async () => {
  inject.failOn = "";
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  root = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "rollback-"));
  contentRoot = path.join(root, "content");
  backupsDir = path.join(root, "backups");

  await write("articles/alpha.md", note("alpha", "Alpha"));
  await write("articles/beta.md", note("beta", "Beta"));
  await write("resources.json", '{"version":1,"resources":[]}\n');
  await write("tasks.json", '{"version":1,"tasks":[]}\n');
});

afterEach(async () => {
  inject.failOn = "";
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("恢复中途失败 → 自动回滚", () => {
  it("第二个文件写失败时，回到恢复前的字节状态", async () => {
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    await fs.rm(path.join(contentRoot, "articles", "beta.md"));
    await write("articles/gamma.md", note("gamma", "Gamma"));
    const before = await digest();

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: created.name,
      includeDeletes: true,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    // 计划按路径排序：alpha（覆盖）→ beta（新增）→ 删除 gamma
    inject.failOn = "beta.md";

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: created.name,
      planHash: preview.plan.planHash,
      includeDeletes: true,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("已自动回滚");

    expect(await digest()).toEqual(before);
    expect(await fs.readFile(path.join(contentRoot, "articles", "alpha.md"), "utf8")).toContain(
      "Alpha v2",
    );
    expect(
      await fs.stat(path.join(contentRoot, "articles", "beta.md")).catch(() => null),
    ).toBeNull();
    expect(
      await fs.stat(path.join(contentRoot, "articles", "gamma.md")).catch(() => null),
    ).toBeTruthy();
  });

  it("预检失败（目标位置是个目录）时，一个文件都不写", async () => {
    const created = await createBackup({ contentRoot, backupsDir, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await write("articles/alpha.md", note("alpha", "Alpha v2"));
    // 把 resources.json 换成同名目录：恢复要写它，预检应该在这里停下
    await fs.rm(path.join(contentRoot, "resources.json"));
    await fs.mkdir(path.join(contentRoot, "resources.json"));
    const before = await digest();

    const preview = await previewRestore({
      contentRoot,
      backupsDir,
      name: created.name,
      includeDeletes: false,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;

    const result = await applyRestore({
      contentRoot,
      backupsDir,
      name: created.name,
      planHash: preview.plan.planHash,
      includeDeletes: false,
      confirm: RESTORE_CONFIRM_TEXT,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("没有改动");
    expect(await digest()).toEqual(before);

    // 快照仍然建了，而且能读
    const backups = await fs.readdir(backupsDir);
    const snapshot = backups.find((name) => name.startsWith("pre-restore-"));
    expect(snapshot).toBeTruthy();
    if (snapshot) {
      const loaded = await loadVerifiedBackup(path.join(backupsDir, snapshot));
      expect(loaded.ok).toBe(true);
    }
  });
});
