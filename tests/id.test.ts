import { describe, expect, it } from "vitest";

import { formatLocalDate, formatLocalStamp } from "@/lib/content/clock";
import { articleIdFromParam, fallbackNoteId, slugifyTitle } from "@/lib/content/id";
import { MAX_ID_LENGTH, isSafeArticleId } from "@/lib/security/article-id";

/** 2026-10-30 15:30:12，本地时区（月份从 0 开始） */
const NOW = new Date(2026, 9, 30, 15, 30, 12);

describe("标题 → 文件名（D7：中文直接当文件名）", () => {
  it.each([
    ["注意力机制", "注意力机制"],
    ["Transformer 的注意力机制", "Transformer-的注意力机制"],
    ["注意力：机制", "注意力-机制"],
    ["GPT-4 与 Claude（对比）", "GPT-4-与-Claude-对比"],
    ["  多个   空格  ", "多个-空格"],
    ["Transformer（上）!!!", "Transformer-上"],
    // 全角字母先做 NFKC 归一，否则会生成一个「看起来一样、其实不同」的文件名
    ["ＡＩ 基础", "AI-基础"],
    ["已经是-slug_形式", "已经是-slug_形式"],
  ])("%s → %s", (title, expected) => {
    expect(slugifyTitle(title)).toBe(expected);
  });

  it("生成的 id 一律合法（这条防的是有人改了正则却没改生成）", () => {
    for (const title of [
      "注意力机制",
      "???",
      "!!!",
      "con",
      "new",
      "",
      "Атака (атака)",
      "🧠 大脑",
      "a".repeat(300),
    ]) {
      expect(isSafeArticleId(slugifyTitle(title)), title).toBe(true);
    }
  });

  it("再长的标题也不会超过 64 位", () => {
    const slug = slugifyTitle("很长很长的标题".repeat(50));
    expect(Array.from(slug).length).toBeLessThanOrEqual(MAX_ID_LENGTH);
    expect(isSafeArticleId(slug)).toBe(true);
  });

  it("Windows 保留名与路由保留名加 note- 前缀，而不是拒绝保存", () => {
    expect(slugifyTitle("con")).toBe("note-con");
    expect(slugifyTitle("NUL")).toBe("note-NUL");
    expect(slugifyTitle("new")).toBe("note-new");
  });

  it("一个可用的字都没有时退回时间戳，且能看出是哪天写的", () => {
    for (const title of ["???", "!!!", "", "（）", "🧠🧠"]) {
      expect(slugifyTitle(title, { fallback: undefined })).toMatch(/^note-\d{8}-[0-9a-f]{4}$/);
    }
  });
});

describe("兜底 id", () => {
  it("格式 note-YYYYMMDD-xxxx，随机数可注入（测试不靠运气）", () => {
    expect(fallbackNoteId(NOW, () => 0)).toBe("note-20261030-0000");
    expect(fallbackNoteId(NOW, () => 0.5)).toBe("note-20261030-8000");
  });
});

describe("本地日期", () => {
  it("用本地时区，不是 UTC（否则晚上 11 点写的会被记成前一天）", () => {
    expect(formatLocalDate(NOW)).toBe("2026-10-30");
    expect(formatLocalStamp(NOW)).toBe("20261030-153012");
  });

  it("月份/日期补零", () => {
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(formatLocalStamp(new Date(2026, 0, 5, 9, 8, 7))).toBe("20260105-090807");
  });
});

describe("路由参数 → id（中文 id 的真实坑）", () => {
  it("Next 16 交来的是没解码的原始段，必须解开", () => {
    // 实测：访问 /knowledge/注意力机制 时 params.id 拿到的是下面这串，不是「注意力机制」
    expect(articleIdFromParam("%E6%B3%A8%E6%84%8F%E5%8A%9B%E6%9C%BA%E5%88%B6")).toBe("注意力机制");
    const mixed = encodeURIComponent("Transformer-的注意力机制-上");
    expect(articleIdFromParam(mixed)).toBe("Transformer-的注意力机制-上");
  });

  it("没有 % 就原样返回（ASCII id 不受影响）", () => {
    expect(articleIdFromParam("transformer-basics")).toBe("transformer-basics");
  });

  it("畸形转义不抛异常（交给路径闸门去拒绝）", () => {
    expect(articleIdFromParam("a%E0%A4%A")).toBe("a%E0%A4%A");
    expect(isSafeArticleId(articleIdFromParam("a%E0%A4%A"))).toBe(false);
  });
});
