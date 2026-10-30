import { describe, expect, it } from "vitest";

import { hashPassword as scriptHash, generateSecret } from "../scripts/auth-lib.mjs";
import { upsertEnv } from "../scripts/env-file.mjs";
import { hashPassword as libHash, verifyPassword } from "@/lib/security/password";

/**
 * 脚本与 lib 必须生成同一种哈希格式。
 * 这里用 lib 的 verify 去验脚本生成的值 —— 两边一旦漂了（少一段、换算法、base64 变体），
 * 这里立刻红。脚本自己不该有第二套「看起来像」的格式。
 */
describe("scripts/auth-lib 与 lib/security/password 兼容", () => {
  it("脚本生成的哈希能被 lib 验证", async () => {
    const stored = await scriptHash("中文口令 with spaces", Buffer.from("0123456789abcdef"), {
      N: 1024,
      r: 8,
      p: 1,
      keylen: 32,
    });
    expect(stored.startsWith("scrypt:1024:8:1:")).toBe(true);
    expect(await verifyPassword("中文口令 with spaces", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
  });

  it("lib 生成的哈希与脚本同一形状（脚本侧只校验形状，不重复实现 verify）", async () => {
    const stored = await libHash("another", {
      salt: Buffer.from("fedcba9876543210"),
      params: { N: 1024, r: 8, p: 1, keylen: 32 },
    });
    expect(stored.split(":")).toHaveLength(6);
    expect(stored.startsWith("scrypt:1024:8:1:")).toBe(true);
  });

  it("generateSecret 够长且不重复", () => {
    const first = generateSecret();
    const second = generateSecret();
    expect(first.length).toBeGreaterThanOrEqual(32);
    expect(second.length).toBeGreaterThanOrEqual(32);
    expect(first).not.toBe(second);
  });
});

describe(".env 写入器", () => {
  it("保留注释与无关行，替换同名键，追加新键", () => {
    const input = "# 注释\nPORT=3000\nA=1\n";
    const output = upsertEnv(input, { A: "2", B: "hello world" });
    expect(output).toContain("# 注释");
    expect(output).toContain("PORT=3000");
    expect(output).toContain("A=2");
    expect(output).toContain("B=hello world");
    expect(output).not.toContain("A=1");
  });

  it("空文件也能写", () => {
    expect(upsertEnv("", { X: "1" })).toBe("X=1\n");
  });
});
