import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { afterAll, describe, expect, it } from "vitest";

import type { BackupManifest } from "@/lib/content/backup-format";
import { checkBackupPayload } from "@/lib/content/backup-validate";
import { createBackup } from "@/lib/content/backup-store";
import { parseArticle, readFrontmatter } from "@/lib/content/frontmatter";
import { pendingRestoreMessage } from "@/lib/content/restore-gate";
import { restoreJournalPath } from "@/lib/content/restore-journal";
import { recoverPendingRestore } from "@/lib/content/restore-store";

/**
 * v3 复核探针（33 个样例）。
 *
 * 给外部复核者的入口：`npm run audit:probes`，只读、不联网、不碰真实 `content/` 与 `backups/`。
 * 它不替代 `npm run verify`，只是把“内容解析不执行代码 / 恢复状态机不丢数据”这两件事
 * 用一张能直接读的 PASS/FAIL 表摆出来。
 *
 * 断言方式：每个样例都把全局执行标记清零；跑完必须还是 0。
 */

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp", "probes");
const markerHolder = globalThis as typeof globalThis & { __aiLabProbeMarker?: number };
const FIELDS =
  'id: "hello", title: "你好", category: "测试", tags: [], createdAt: "2026-10-01", updatedAt: "2026-10-02"';
const GAPS: [string, string][] = [
  ["NBSP U+00A0", "\u00a0"],
  ["EM SPACE U+2003", "\u2003"],
  ["NARROW NBSP U+202F", "\u202f"],
  ["IDEOGRAPHIC SPACE U+3000", "\u3000"],
  ["BOM U+FEFF", "\ufeFF"],
  ["VERTICAL TAB U+000B", "\u000b"],
];

type Case = { title: string; run: () => Promise<boolean> | boolean };

function reset(): void {
  markerHolder.__aiLabProbeMarker = 0;
}
function executed(): number {
  return markerHolder.__aiLabProbeMarker ?? 0;
}
function jsPayload(gap: string, where: "trailing" | "leading"): string {
  const opener = where === "trailing" ? `---javascript${gap}` : `---${gap}javascript`;
  return `${opener}\n(globalThis.__aiLabProbeMarker = 1, { ${FIELDS} })\n---\n正文`;
}

async function digest(dir: string): Promise<string> {
  const parts: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (entry.name === ".trash") continue;
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, rel);
      else if (entry.isFile()) {
        const bytes = await fs.readFile(full);
        parts.push(`${rel}:${createHash("sha256").update(bytes).digest("hex")}`);
      }
    }
  }
  await walk(dir, "");
  return parts.sort().join("\n");
}

async function makeFixture(): Promise<{
  root: string;
  contentRoot: string;
  backupsDir: string;
}> {
  const root = await fs.mkdtemp(path.join(TMP, "probe-"));
  const contentRoot = path.join(root, "content");
  const backupsDir = path.join(root, "backups");
  const write = async (rel: string, text: string) => {
    const full = path.join(contentRoot, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, text, "utf8");
  };
  await write("articles/alpha.md", note("alpha", "Alpha"));
  await write("articles/beta.md", note("beta", "Beta"));
  await write("resources.json", '{"version":1,"resources":[]}\n');
  await write("tasks.json", '{"version":1,"tasks":[]}\n');
  return { root, contentRoot, backupsDir };
}

function note(id: string, title: string): string {
  return `---\nid: ${id}\ntitle: "${title}"\ncategory: 测试\ntags: []\ncreatedAt: "2026-10-01"\nupdatedAt: "2026-10-02"\n---\n\n${title} 正文\n`;
}

const CREATED: string[] = [];
afterAll(async () => {
  for (const dir of CREATED) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

const cases: Case[] = [];

// A. 六种 Unicode 空白 × 前置 / 后置（12）
for (const [label, gap] of GAPS) {
  for (const where of ["trailing", "leading"] as const) {
    cases.push({
      title: `---javascript ${where} ${label}：不执行`,
      run: () => {
        reset();
        const result = parseArticle(jsPayload(gap, where), "hello");
        return !result.ok && executed() === 0;
      },
    });
  }
}

// B–H. 其它入口与边界（12）
cases.push({
  title: "文件头 BOM + 尾部 NBSP：不执行",
  run: () => {
    reset();
    const result = parseArticle(`\uFEFF${jsPayload("\u00a0", "trailing")}`, "hello");
    return !result.ok && executed() === 0;
  },
});
cases.push({
  title: "两个前导 BOM：不执行",
  run: () => {
    reset();
    const result = parseArticle(`\uFEFF\uFEFF${jsPayload("", "trailing")}`, "hello");
    return !result.ok && executed() === 0;
  },
});
cases.push({
  title: "两个前导 BOM + 未知语言 ---javascriptX：不执行",
  run: () => {
    reset();
    const payload = `\uFEFF\uFEFF---javascriptX\n(globalThis.__aiLabProbeMarker = 1, { ${FIELDS} })\n---\n正文`;
    return !parseArticle(payload, "hello").ok && executed() === 0;
  },
});
cases.push({
  title: "完全没有换行的 ---javascriptX：不选非数据引擎",
  run: () => {
    reset();
    const engines = (matter as unknown as { engines: Record<string, unknown> }).engines;
    const original = engines.javascript;
    let engineSelected = false;
    engines.javascript = {
      parse: () => {
        engineSelected = true;
        return {};
      },
    };
    try {
      // fixture 里没有 \n：覆盖 gray-matter 缺换行时的截断路径
      const result = parseArticle("---javascriptX", "hello");
      return !result.ok && !engineSelected && executed() === 0;
    } finally {
      engines.javascript = original;
    }
  },
});
cases.push({
  title: "readFrontmatter（保存旧笔记的入口）：拒绝且不执行",
  run: () => {
    reset();
    try {
      readFrontmatter(jsPayload("\u00a0", "trailing"));
      return false;
    } catch {
      return executed() === 0;
    }
  },
});
cases.push({
  title: "元数据不合法时也不会先执行",
  run: () => {
    reset();
    const payload = `---javascript\u00a0\n(globalThis.__aiLabProbeMarker = 1, { id: "wrong" })\n---\n正文`;
    return !parseArticle(payload, "hello").ok && executed() === 0;
  },
});
cases.push({
  title: "备份 payload 入口：不执行",
  run: () => {
    reset();
    const bytes = Buffer.from(jsPayload("\u00a0", "trailing"), "utf8");
    const manifest = {
      files: [{ path: "content/articles/hello.md", size: bytes.length, sha256: "0".repeat(64) }],
    } as unknown as BackupManifest;
    const check = checkBackupPayload(manifest, new Map([["content/articles/hello.md", bytes]]));
    return check.ok && executed() === 0;
  },
});
cases.push({
  title: "普通 YAML 正常解析",
  run: () =>
    parseArticle(
      `---\nid: hello\ntitle: 你好\ncategory: 测试\ntags: []\ncreatedAt: "2026-10-01"\nupdatedAt: "2026-10-02"\n---\n正文`,
      "hello",
    ).ok,
});
cases.push({
  title: "---json 按数据解析",
  run: () =>
    parseArticle(
      `---json\n{"id":"hello","title":"你好","category":"测试","createdAt":"2026-10-01","updatedAt":"2026-10-02"}\n---\n正文`,
      "hello",
    ).ok,
});
cases.push({
  title: "---js（无空白）拒绝且不执行",
  run: () => {
    reset();
    const payload = `---js\n(globalThis.__aiLabProbeMarker = 1, { ${FIELDS} })\n---\n正文`;
    return !parseArticle(payload, "hello").ok && executed() === 0;
  },
});
cases.push({
  title: "YAML !!js/function 标签不执行",
  run: () => {
    reset();
    const payload = `---\nid: hello\nfn: !!js/function "globalThis.__aiLabProbeMarker = 1"\n---\n正文`;
    try {
      parseArticle(payload, "hello");
    } catch {
      /* 解析失败也算过 */
    }
    return executed() === 0;
  },
});
cases.push({
  title: "正文序列化（对象形式）不解析正文",
  run: () => {
    reset();
    const text = matter.stringify(
      { content: "---javascript\n(globalThis.__aiLabProbeMarker = 1, {})\n---\n正文" },
      { id: "hello", title: "你好" },
    );
    return executed() === 0 && text.includes("---javascript");
  },
});

// I. 写入闸门（5）
cases.push({
  title: "闸门：没有日志时放行",
  run: async () => (await pendingRestoreMessage(path.join(TMP, "no-such-dir"))) === null,
});
cases.push({
  title: "闸门：applying 挡住并给快照名",
  run: async () => {
    const { backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(
      restoreJournalPath(backupsDir),
      JSON.stringify({
        version: 1,
        snapshot: "pre-restore-20261030-101500.zip",
        planHash: "x",
        startedAt: new Date().toISOString(),
        phase: "applying",
      }),
      "utf8",
    );
    const message = await pendingRestoreMessage(backupsDir);
    return Boolean(
      message && message.includes("pre-restore-20261030-101500.zip") && message.includes("/backup"),
    );
  },
});
cases.push({
  title: "闸门：verified 放行",
  run: async () => {
    const { backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(
      restoreJournalPath(backupsDir),
      JSON.stringify({
        version: 1,
        snapshot: "pre-restore-20261030-101500.zip",
        planHash: "x",
        startedAt: new Date().toISOString(),
        phase: "verified",
      }),
      "utf8",
    );
    return (await pendingRestoreMessage(backupsDir)) === null;
  },
});
cases.push({
  title: "闸门：坏日志挡住并给路径",
  run: async () => {
    const { backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(restoreJournalPath(backupsDir), "{ broken", "utf8");
    const message = await pendingRestoreMessage(backupsDir);
    return Boolean(message && message.includes(restoreJournalPath(backupsDir)));
  },
});
cases.push({
  title: "闸门：verified 的日志不会触发回滚",
  run: async () => {
    const { contentRoot, backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    await fs.mkdir(backupsDir, { recursive: true });
    const before = await digest(contentRoot);
    await fs.writeFile(
      restoreJournalPath(backupsDir),
      JSON.stringify({
        version: 1,
        snapshot: "pre-restore-20261030-101500.zip",
        planHash: "x",
        startedAt: new Date().toISOString(),
        phase: "verified",
      }),
      "utf8",
    );
    const result = await recoverPendingRestore({ contentRoot, backupsDir });
    return result.state === "already-complete" && (await digest(contentRoot)) === before;
  },
});

// J. 恢复状态机（4）
cases.push({
  title: "恢复：applying 回到快照并删日志",
  run: async () => {
    const { contentRoot, backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    const snapshot = await createBackup({
      contentRoot,
      backupsDir,
      kind: "pre-restore",
      now: new Date(2026, 9, 30, 10, 15, 0),
    });
    if (!snapshot.ok) return false;
    const before = await digest(contentRoot);
    await fs.writeFile(path.join(contentRoot, "articles", "alpha.md"), note("alpha", "Alpha v2"));
    await fs.writeFile(path.join(contentRoot, "articles", "zz-new.md"), note("zz-new", "New"));
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(
      restoreJournalPath(backupsDir),
      JSON.stringify({
        version: 1,
        snapshot: snapshot.name,
        planHash: "x",
        startedAt: new Date().toISOString(),
        phase: "applying",
      }),
      "utf8",
    );
    const result = await recoverPendingRestore({ contentRoot, backupsDir });
    const journalGone = await fs
      .lstat(restoreJournalPath(backupsDir))
      .then(() => false)
      .catch(() => true);
    return result.state === "recovered" && (await digest(contentRoot)) === before && journalGone;
  },
});
cases.push({
  title: "恢复：坏日志 fail closed，日志与内容都不变",
  run: async () => {
    const { contentRoot, backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(restoreJournalPath(backupsDir), "{ not json", "utf8");
    const before = await digest(contentRoot);
    const result = await recoverPendingRestore({ contentRoot, backupsDir });
    const kept =
      (await fs.readFile(restoreJournalPath(backupsDir), "utf8").catch(() => "")) === "{ not json";
    return result.state === "failed" && kept && (await digest(contentRoot)) === before;
  },
});
cases.push({
  title: "恢复：快照缺失时保留日志",
  run: async () => {
    const { contentRoot, backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(
      restoreJournalPath(backupsDir),
      JSON.stringify({
        version: 1,
        snapshot: "pre-restore-20261030-999999.zip",
        planHash: "x",
        startedAt: new Date().toISOString(),
        phase: "applying",
      }),
      "utf8",
    );
    const result = await recoverPendingRestore({ contentRoot, backupsDir });
    const kept = await fs
      .lstat(restoreJournalPath(backupsDir))
      .then(() => true)
      .catch(() => false);
    return (
      result.state === "failed" && result.snapshot === "pre-restore-20261030-999999.zip" && kept
    );
  },
});
cases.push({
  title: "恢复：日志快照名不能是路径",
  run: async () => {
    const { contentRoot, backupsDir } = await makeFixture();
    CREATED.push(path.dirname(backupsDir));
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.writeFile(
      restoreJournalPath(backupsDir),
      JSON.stringify({
        version: 1,
        snapshot: "../../evil.zip",
        planHash: "x",
        startedAt: new Date().toISOString(),
        phase: "applying",
      }),
      "utf8",
    );
    const result = await recoverPendingRestore({ contentRoot, backupsDir });
    return result.state === "failed" && result.snapshot === null;
  },
});

describe("v3 复核探针（33 个样例，只读）", () => {
  it("全部 PASS，执行标记始终为 0", async () => {
    await fs.mkdir(TMP, { recursive: true });
    const failures: string[] = [];

    for (const [index, item] of cases.entries()) {
      let ok = false;
      try {
        ok = await item.run();
      } catch (error) {
        ok = false;
        console.log(`[${index + 1}] ERROR ${item.title}：${(error as Error).message}`);
      }
      console.log(`[${String(index + 1).padStart(2, "0")}] ${ok ? "PASS" : "FAIL"}  ${item.title}`);
      if (!ok) failures.push(item.title);
    }

    console.log(`结果：${cases.length - failures.length}/${cases.length} PASS`);
    expect(failures).toEqual([]);
  });
});
