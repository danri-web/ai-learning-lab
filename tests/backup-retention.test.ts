import { describe, expect, it } from "vitest";

import {
  BACKUP_KEEP_COUNT,
  selectExpiredBackups,
  type BackupRetentionItem,
} from "@/lib/content/backup-retention";

/**
 * P1 备份保留（按份数，不按时间）。
 *
 * 这些是纯函数用例：不碰磁盘，先把「哪些能删」钉死，再写执行层。
 * 每条都对应交接《下一轮》里的一个边界；先看它红，再实现。
 */

function manual(
  stamp: string,
  options: { damaged?: boolean; suffix?: number } = {},
): BackupRetentionItem {
  return {
    name: `ai-lab-${stamp}${options.suffix ? `-${options.suffix}` : ""}.zip`,
    damaged: options.damaged ?? false,
  };
}

/** 同一秒里连续的备份（秒数递增 = 越来越新） */
function series(count: number, startSeconds = 0): BackupRetentionItem[] {
  return Array.from({ length: count }, (_, index) => {
    const seconds = String(startSeconds + index).padStart(2, "0");
    return manual(`20261030-1000${seconds}`);
  });
}

const SNAPSHOTS: BackupRetentionItem[] = [
  { name: "pre-restore-20250101-000000.zip", damaged: false },
  { name: "pre-restore-20261001-000000.zip", damaged: false },
  { name: "pre-restore-20261030-100000.zip", damaged: false },
];

describe("selectExpiredBackups：只按份数保留最近 10 份", () => {
  it("12 份健康备份：只删最老 2 份，最新 10 份原样保留", () => {
    const items = series(12);
    const result = selectExpiredBackups(items);

    expect(result.expired).toEqual([items[0].name, items[1].name]);
    expect(result.damaged).toEqual([]);
    expect(result.keep).toHaveLength(BACKUP_KEEP_COUNT);
    expect(result.keep).toEqual(
      items
        .slice(2)
        .map((item) => item.name)
        .reverse(),
    );
    expect(result.expired).not.toContain(items[11].name);
  });

  it("边界：9 / 10 份不删，11 份只删 1 份", () => {
    expect(selectExpiredBackups(series(9)).expired).toEqual([]);
    expect(selectExpiredBackups(series(10)).expired).toEqual([]);
    expect(selectExpiredBackups(series(11)).expired).toEqual([series(11)[0].name]);
  });

  it("keep 传 0 / 负数 / NaN 也至少保住最新一份", () => {
    for (const keep of [0, -1, Number.NaN]) {
      const items = series(4);
      const result = selectExpiredBackups(items, keep);

      expect(result.expired).toEqual(
        items.slice(0, 3).map((item) => item.name),
      );
      expect(result.expired).not.toContain(items[3].name);
    }
  });

  it("pre-restore 快照永不进候选，也不占 10 份名额", () => {
    const ten = [...series(10), ...SNAPSHOTS];
    const result = selectExpiredBackups(ten);

    expect(result.expired).toEqual([]);
    expect(result.keep).toHaveLength(10);
    for (const snapshot of SNAPSHOTS) {
      expect([...result.keep, ...result.expired, ...result.damaged]).not.toContain(snapshot.name);
    }

    // 11 份手动备份 + 3 份快照：仍然只删 1 份手动备份
    expect(selectExpiredBackups([...series(11), ...SNAPSHOTS]).expired).toHaveLength(1);
  });

  it("白名单外的名字一个都不进任何名单", () => {
    const junk: BackupRetentionItem[] = [
      "restore-journal.json",
      "foo.zip",
      "AI-LAB-20261030-100000.ZIP",
      "ai-lab-2026.zip",
      "ai-lab-20261030-100000.zip.bak",
      "pre-restore-20261030-100000.zip",
    ].map((name) => ({ name, damaged: false }));

    const result = selectExpiredBackups([...series(12), ...junk]);
    const all = [...result.keep, ...result.expired, ...result.damaged];

    for (const item of junk) expect(all).not.toContain(item.name);
    expect(result.expired).toEqual([series(12)[0].name, series(12)[1].name]);
  });

  it("超期但损坏的只标记不删，且仍占保留位", () => {
    const items = series(12);
    items[0] = { ...items[0], damaged: true };

    const result = selectExpiredBackups(items);

    expect(result.damaged).toEqual([items[0].name]);
    expect(result.expired).toEqual([items[1].name]);
    // 10 份保留 + 1 份损坏 = 11 份留在盘上；不能为了凑 10 份把健康的那份也删掉
    expect(result.keep).toHaveLength(10);
  });

  it("同一秒的 -2 后缀按创建顺序排；打乱输入结果稳定", () => {
    const base = manual("20261030-100000");
    const second = manual("20261030-100000", { suffix: 2 });
    const newer = series(10, 10);

    const result = selectExpiredBackups([second, ...newer, base]);
    expect(result.expired).toEqual([base.name, second.name]);

    const shuffled = selectExpiredBackups([...newer, base, second].reverse());
    expect(shuffled.expired).toEqual(result.expired);
    expect(shuffled.keep).toEqual(result.keep);
    expect(shuffled.planHash).toBe(result.planHash);
  });

  it("planHash：同一方案稳定，候选增减或损坏状态变化就变", () => {
    const baseline = selectExpiredBackups(series(12));
    const same = selectExpiredBackups(series(12));

    expect(baseline.planHash).toBe(same.planHash);
    expect(baseline.planHash).toMatch(/^[0-9a-f]{32}$/);

    const oneMore = selectExpiredBackups(series(13));
    expect(oneMore.planHash).not.toBe(baseline.planHash);

    const damaged = series(12);
    damaged[0] = { ...damaged[0], damaged: true };
    expect(selectExpiredBackups(damaged).planHash).not.toBe(baseline.planHash);
  });
});
