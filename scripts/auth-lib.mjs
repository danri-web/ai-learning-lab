import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

/**
 * 脚本侧的 scrypt 口令哈希。
 *
 * 格式必须与 `lib/security/password.ts` 完全一致：
 *   scrypt:N:r:p:<salt base64url>:<hash base64url>
 *
 * 用 `:` 而不是 `$`：Next 读 .env.local 时会展开 `$VAR`，`$32768` 会被吃掉。
 *
 * 这里重复实现而不是 import TS，是因为 `node scripts/*.mjs` 不经过构建。
 * `tests/auth-script.test.ts` 会用 lib 的 verify 去验脚本生成的值，两边漂了就会红。
 */

const scryptAsync = promisify(scrypt);

export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };

export async function hashPassword(password, salt = randomBytes(16), params = SCRYPT_PARAMS) {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("口令不能为空");
  }
  const hash = await scryptAsync(password, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: Math.max(64 * 1024 * 1024, 128 * params.N * params.r * 2),
  });
  return `scrypt:${params.N}:${params.r}:${params.p}:${salt.toString(
    "base64url",
  )}:${hash.toString("base64url")}`;
}

export function generateSecret() {
  return randomBytes(32).toString("base64url");
}

export function isPasswordHash(value) {
  return (
    typeof value === "string" && /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(value)
  );
}
