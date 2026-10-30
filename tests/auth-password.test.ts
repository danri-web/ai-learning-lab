import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SCRYPT_PARAMS,
  hashPassword,
  isPasswordHash,
  isValidScryptParams,
  verifyPassword,
} from "@/lib/security/password";

/** 测试用更小的 N：验证的是「口令 ↔ 哈希」的关系，不是 scrypt 的强度 */
const FAST = { N: 1024, r: 8, p: 1, keylen: 32 };

describe("scrypt 口令哈希", () => {
  it("正确口令通过，错误口令不通过", async () => {
    const stored = await hashPassword("correct horse battery staple", { params: FAST });
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("wrong", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("同一口令 + 同一 salt 得到同一个哈希；不同 salt 得到不同哈希", async () => {
    const salt = Buffer.from("0123456789abcdef");
    const first = await hashPassword("中文口令", { salt, params: FAST });
    const second = await hashPassword("中文口令", { salt, params: FAST });
    const third = await hashPassword("中文口令", { salt: randomBytes(16), params: FAST });

    expect(first).toBe(second);
    expect(first).not.toBe(third);
    expect(await verifyPassword("中文口令", third)).toBe(true);
  });

  it("哈希里不含明文口令", async () => {
    const stored = await hashPassword("plaintext-secret", { params: FAST });
    expect(stored).not.toContain("plaintext-secret");
    expect(stored.startsWith("scrypt:")).toBe(true);
  });

  it("默认参数在生产范围里", () => {
    expect(isValidScryptParams(DEFAULT_SCRYPT_PARAMS)).toBe(true);
    expect(DEFAULT_SCRYPT_PARAMS.N).toBe(32768);
  });

  it.each([
    ["空字符串", ""],
    ["不是我们的格式", "plaintext"],
    ["少一段", "scrypt:1024:8:1:abc"],
    ["salt 不是 base64url", "scrypt:1024:8:1:@@@:abc"],
    ["N 不是 2 的幂", "scrypt:1000:8:1:YWJj:YWJj"],
    ["N 太大", "scrypt:999999:8:1:YWJj:YWJj"],
    ["r 为 0", "scrypt:1024:0:1:YWJj:YWJj"],
    ["keylen 太短", "scrypt:1024:8:1:YWJj:YWJj"],
  ])("坏哈希一律 false：%s", async (_label, stored) => {
    expect(await verifyPassword("anything", stored)).toBe(false);
    expect(isPasswordHash(stored)).toBe(false);
  });

  it("hashPassword 拒绝空口令与非法参数", async () => {
    await expect(hashPassword("")).rejects.toThrow();
    await expect(hashPassword("x", { params: { ...FAST, N: 3 } })).rejects.toThrow();
  });
});
