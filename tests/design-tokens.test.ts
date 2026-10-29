import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CSS = readFileSync(join(ROOT, "app/globals.css"), "utf8");

/**
 * 对照表：docs/需求书.md §6「设计令牌（初始建议）」的十个色值。
 * 这里断言的是「需求书 ↔ 实现」的关系，不是快照 —— 改需求书没改 CSS 就会红。
 */
const PALETTE: readonly { token: string; hex: string; role: string }[] = [
  { token: "background", hex: "#0B0D12", role: "Background" },
  { token: "surface", hex: "#12151C", role: "Surface" },
  { token: "elevated", hex: "#191D26", role: "Elevated" },
  { token: "border", hex: "#292E39", role: "Border" },
  { token: "foreground", hex: "#F1F3F7", role: "Primary text" },
  { token: "muted-foreground", hex: "#9299A8", role: "Muted text" },
  { token: "primary", hex: "#8B82F6", role: "Accent" },
  { token: "success", hex: "#48B58A", role: "Success" },
  { token: "warning", hex: "#E5AC62", role: "Warning" },
  { token: "destructive", hex: "#E06C75", role: "Danger" },
];

function tokenValue(name: string): string {
  const match = CSS.match(new RegExp(`(?:^|\\s)--${name}:\\s*([^;]+);`, "m"));
  return match ? match[1].trim().toLowerCase() : "";
}

/** 粗略相对亮度：用来断言「深色主题真的是深色」 */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const TOKEN_FILES = ["app", "components"];
const SOURCE_EXT = /\.(tsx|ts)$/;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full));
    else if (SOURCE_EXT.test(entry)) out.push(full);
  }
  return out;
}

describe("设计令牌", () => {
  it("需求书 §6 的十个色值都落到了对应变量上", () => {
    const wrong = PALETTE.filter(
      (entry) => tokenValue(entry.token) !== entry.hex.toLowerCase(),
    ).map(
      (entry) =>
        `${entry.role}：--${entry.token} 应为 ${entry.hex}，实际 ${tokenValue(entry.token) || "（缺失）"}`,
    );
    expect(wrong).toEqual([]);
  });

  it("主题真的是深色：背景暗、正文亮，对比足够", () => {
    const bg = luminance(tokenValue("background"));
    const fg = luminance(tokenValue("foreground"));
    expect(bg).toBeLessThan(0.02);
    expect(fg).toBeGreaterThan(0.85);
  });

  it("三档底色是递进的（Background < Surface < Elevated）", () => {
    const steps = ["background", "surface", "elevated"].map((name) => luminance(tokenValue(name)));
    expect(steps[0]).toBeLessThan(steps[1]!);
    expect(steps[1]).toBeLessThan(steps[2]!);
  });

  it("body 用的是令牌而不是字面色值", () => {
    expect(CSS).toMatch(/body\s*{[^}]*@apply bg-background text-foreground/);
  });

  it("组件里没有硬编码的十六进制颜色（只走令牌）", () => {
    const offenders: string[] = [];
    for (const dir of TOKEN_FILES) {
      for (const file of collectSourceFiles(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
          offenders.push(`${file.replace(ROOT, "")}:${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 半透明文字会把对比度压到临界线（实测：muted-foreground/80 叠在 surface/50 上
   * 只有 4.58:1，勉强压过 4.5 的线）。这种写法被复制一次就会静默劣化一次。
   */
  it("文字颜色不使用透明度修饰符（避免对比度悄悄掉到临界）", () => {
    const offenders: string[] = [];
    for (const dir of TOKEN_FILES) {
      for (const file of collectSourceFiles(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/\btext-(?:muted-)?foreground\/\d+/g)) {
          offenders.push(`${file.replace(ROOT, "")}:${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
