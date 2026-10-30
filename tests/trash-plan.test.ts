import { describe, expect, it } from "vitest";

import {
  isExpiredAt,
  parseTrashStamp,
  pruneJsonlText,
  trashCutoff,
  trashPlanHash,
  TRASH_RETENTION_DAYS,
} from "@/lib/content/trash-plan";

/**
 * `.trash` 清理的纯函数部分（P1）。
 *
 * 关键约定：
 *   - 时间只认本项目写的 `YYYYMMDD-HHmmss`（本地时间）
 *   - 正好 90 天整**保留**，严格更老才删
 *   - JSONL 只裁超期行；坏行/缺字段/空行原样保留，原文件不动（原子写在执行层）
 *   - 保留行的字节（CRLF / 末尾换行 / BOM）不能被顺手「规范化」
 */

const NOW = new Date(2026, 0, 31, 12, 0, 0);
const STALE = '{"deletedAt":"20250101-000000"}';
const FRESH = '{"deletedAt":"20261001-000000"}';

function cutoff(): Date {
  return trashCutoff(NOW, TRASH_RETENTION_DAYS);
}

describe("parseTrashStamp：只认 YYYYMMDD-HHmmss", () => {
  it("合法时间解析成本地时间；非法日期一律 null（不抛）", () => {
    const parsed = parseTrashStamp("20261030-101500");
    expect(parsed?.date.getTime()).toBe(new Date(2026, 9, 30, 10, 15, 0).getTime());

    for (const bad of [
      "20261301-000000", // 13 月
      "20260230-000000", // 2 月 30
      "20261030-240000", // 24 时
      "20261030-106000", // 60 分
      "20261030-100060", // 60 秒
      "2026-10-30 10:15:00",
      "20261030",
      "",
      null,
      123,
    ]) {
      expect(parseTrashStamp(bad)).toBeNull();
    }
  });
});

describe("90 天边界", () => {
  it("正好 90 天整保留，早 1 秒才超期", () => {
    expect(cutoff().getTime()).toBe(new Date(2025, 10, 2, 12, 0, 0).getTime());
    expect(isExpiredAt(new Date(2025, 10, 2, 12, 0, 0), cutoff())).toBe(false);
    expect(isExpiredAt(new Date(2025, 10, 2, 11, 59, 59), cutoff())).toBe(true);
  });
});

describe("pruneJsonlText：只裁超期行", () => {
  it("新鲜行、坏 JSON、缺 deletedAt、非对象、空行都原样保留", () => {
    const badJson = "{not json";
    const missing = '{"resource":{"id":"missing"}}';
    const array = "[]";
    const input = [STALE, FRESH, badJson, missing, array, ""].join("\n") + "\n";

    const pruned = pruneJsonlText(input, cutoff());

    expect(pruned.dropped).toBe(1);
    expect(pruned.kept).toBe(4);
    expect(pruned.text).toBe([FRESH, badJson, missing, array, ""].join("\n") + "\n");
    expect(pruned.skipped.map((item) => item.line)).toEqual([3, 4, 5]);
  });

  it("保留行的字节不变：CRLF、末尾无换行、BOM", () => {
    expect(pruneJsonlText(`${STALE}\r\n${FRESH}\r\n`, cutoff()).text).toBe(`${FRESH}\r\n`);
    expect(pruneJsonlText(`${STALE}\n${FRESH}`, cutoff()).text).toBe(FRESH);
    expect(pruneJsonlText(`\uFEFF${STALE}\n${FRESH}\n`, cutoff()).text).toBe(`\uFEFF${FRESH}\n`);
  });

  it("全部超期时返回空文本（文件本身由执行层保留）", () => {
    const pruned = pruneJsonlText(`${STALE}\n`, cutoff());
    expect(pruned.text).toBe("");
    expect(pruned.dropped).toBe(1);
    expect(pruned.kept).toBe(0);
  });
});

describe("trashPlanHash", () => {
  it("同一方案稳定；候选变化（含 JSONL 原文指纹）就变", () => {
    const base = [
      {
        kind: "article" as const,
        path: "articles/.trash/20250101-000000-a.md",
        deletedAt: "2025-01-01T00:00:00.000Z",
      },
    ];
    const same = [{ ...base[0] }];
    const withJsonl = [
      ...base,
      {
        kind: "jsonl" as const,
        path: ".trash/resources-deleted.jsonl",
        deletedAt: "",
        fileHash: "abc",
        dropped: 1,
      },
    ];

    expect(trashPlanHash(base)).toBe(trashPlanHash(same));
    expect(trashPlanHash(base)).not.toBe(trashPlanHash(withJsonl));
    expect(trashPlanHash(base)).toMatch(/^[0-9a-f]{32}$/);
  });
});
