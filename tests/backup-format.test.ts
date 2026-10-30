import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  APP_VERSION,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MANIFEST_NAME,
  backupBaseName,
  buildManifest,
  computeRestorePlan,
  formatBytes,
  isBackupFileName,
  parseManifest,
  type BackupFileMeta,
} from "@/lib/content/backup-format";
import { MAX_ENTRY_COUNT, MAX_FILE_BYTES } from "@/lib/security/backup-entry";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function meta(entry: string, size: number, sha256: string): BackupFileMeta {
  return { path: entry, size, sha256 };
}

const NOW = new Date("2026-10-30T02:15:00.000Z");

describe("manifest", () => {
  it("按路径排序、总量等于逐项之和、时间是本地时间 + ISO", () => {
    const manifest = buildManifest(
      [
        meta("content/tasks.json", 10, HASH_A),
        meta("content/articles/b.md", 20, HASH_B),
        meta("content/articles/a.md", 30, HASH_A),
      ],
      { kind: "manual", now: NOW },
    );

    expect(manifest.format).toBe(BACKUP_FORMAT);
    expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.files.map((file) => file.path)).toEqual([
      "content/articles/a.md",
      "content/articles/b.md",
      "content/tasks.json",
    ]);
    expect(manifest.totalBytes).toBe(60);
    expect(manifest.createdAt).toBe("2026-10-30T02:15:00.000Z");
    expect(manifest.createdAtLocal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("APP_VERSION 与 package.json 一致（改版本时两处一起改）", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
      version: string;
    };
    expect(pkg.version).toBe(APP_VERSION);
  });

  it("合法 manifest 能往返", () => {
    const manifest = buildManifest([meta("content/resources.json", 2, HASH_A)], {
      kind: "manual",
      now: NOW,
    });
    const parsed = parseManifest(manifest);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest).toEqual(manifest);
  });

  const good = buildManifest([meta("content/resources.json", 2, HASH_A)], {
    kind: "manual",
    now: NOW,
  });

  it.each([
    ["不是对象", null],
    ["缺 format", { ...good, format: undefined }],
    ["版本不对", { ...good, formatVersion: 2 }],
    ["kind 不对", { ...good, kind: "auto" }],
    ["createdAt 不是 ISO", { ...good, createdAt: "2026/10/30" }],
    ["本地时间格式不对", { ...good, createdAtLocal: "2026-10-30" }],
    [
      "sha 不是 64 位十六进制",
      { ...good, files: [{ ...meta("content/resources.json", 2, HASH_A), sha256: "xyz" }] },
    ],
    ["路径不在白名单", { ...good, files: [meta("package.json", 2, HASH_A)], totalBytes: 2 }],
    ["manifest 把自己列进去", { ...good, files: [meta(MANIFEST_NAME, 2, HASH_A)], totalBytes: 2 }],
    ["totalBytes 与逐项之和不一致", { ...good, totalBytes: 999 }],
    [
      "单文件超过上限",
      {
        ...good,
        files: [meta("content/resources.json", MAX_FILE_BYTES + 1, HASH_A)],
        totalBytes: MAX_FILE_BYTES + 1,
      },
    ],
    [
      "条目重复（大小写）",
      {
        ...good,
        files: [
          meta("content/articles/Foo.md", 2, HASH_A),
          meta("content/articles/foo.md", 2, HASH_A),
        ],
        totalBytes: 4,
      },
    ],
  ])("拒绝坏 manifest：%s", (_label, input) => {
    const parsed = parseManifest(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(0);
  });

  it("条目数超过上限时拒绝", () => {
    const files = Array.from({ length: MAX_ENTRY_COUNT + 1 }, () =>
      meta("content/resources.json", 1, HASH_A),
    );
    const parsed = parseManifest({ ...good, files, totalBytes: files.length });
    expect(parsed.ok).toBe(false);
  });
});

describe("恢复预览（diff）", () => {
  const current = [
    meta("content/articles/same.md", 3, HASH_A),
    meta("content/articles/changed.md", 3, HASH_A),
    meta("content/articles/gone.md", 3, HASH_A),
  ];
  const backup = [
    meta("content/articles/same.md", 3, HASH_A),
    meta("content/articles/changed.md", 4, HASH_B),
    meta("content/articles/new.md", 5, HASH_A),
  ];

  it("新增 / 覆盖 / 相同 / 删除 四态各自正确", () => {
    const plan = computeRestorePlan(current, backup, false);
    expect(plan.counts).toEqual({ added: 1, overwritten: 1, unchanged: 1, deleted: 1 });
    expect(plan.entries.find((entry) => entry.path.endsWith("new.md"))?.status).toBe("added");
    expect(plan.entries.find((entry) => entry.path.endsWith("changed.md"))?.status).toBe(
      "overwritten",
    );
    expect(plan.entries.find((entry) => entry.path.endsWith("same.md"))?.status).toBe("unchanged");
    expect(plan.entries.find((entry) => entry.path.endsWith("gone.md"))?.status).toBe("deleted");
  });

  it("删除不勾选时，planHash 与勾选时不同（确认的是不同的计划）", () => {
    const keep = computeRestorePlan(current, backup, false);
    const remove = computeRestorePlan(current, backup, true);
    expect(keep.planHash).not.toBe(remove.planHash);
    expect(keep.counts).toEqual(remove.counts);
    expect(remove.includeDeletes).toBe(true);
  });

  it("当前内容变了，planHash 就变（防止「预览 A、确认 B」）", () => {
    const first = computeRestorePlan(current, backup, false);
    const changed = [...current.slice(0, 2), meta("content/articles/gone.md", 4, HASH_B)];
    const second = computeRestorePlan(changed, backup, false);
    expect(first.planHash).not.toBe(second.planHash);
  });

  it("同样的输入永远得到同样的 planHash（排序稳定）", () => {
    const shuffled = [current[2], current[0], current[1]];
    expect(computeRestorePlan(shuffled, backup, false).planHash).toBe(
      computeRestorePlan(current, backup, false).planHash,
    );
  });
});

describe("备份文件名", () => {
  it("按本地时间生成，两种前缀", () => {
    expect(backupBaseName(new Date("2026-10-30T02:15:00"), "manual")).toBe(
      "ai-lab-20261030-021500",
    );
    expect(backupBaseName(new Date("2026-10-30T02:15:00"), "pre-restore")).toBe(
      "pre-restore-20261030-021500",
    );
  });

  it("只接受自己生成的名字", () => {
    expect(isBackupFileName("ai-lab-20261030-021500.zip")).toBe(true);
    expect(isBackupFileName("pre-restore-20261030-021500.zip")).toBe(true);
    expect(isBackupFileName("ai-lab-20261030-021500-2.zip")).toBe(true);
    for (const bad of [
      "../ai-lab-20261030-021500.zip",
      "ai-lab-20261030-021500.zip.exe",
      "ai-lab-2026.zip",
      "ai-lab-20261030-021500",
      "C" + ":\\ai-lab-20261030-021500.zip",
      "ai-lab-20261030-021500/../x.zip",
      "ai-lab-20261030-021500.zip ",
    ]) {
      expect(isBackupFileName(bad), bad).toBe(false);
    }
  });
});

describe("formatBytes", () => {
  it("人类可读，负数/NaN 给占位符", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10 * 1024)).toBe("10 KB");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});
