import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * 口令哈希：scrypt（Node 内置，无依赖）。
 *
 * 为什么不是 bcrypt/argon2：那两个都要原生模块；本地 Windows 应用不该为「一个用户、一个口令」
 * 引入编译工具链。scrypt 是 Node 自带、抗 GPU 的 KDF，参数写死在格式里，将来换参数也能验旧哈希。
 *
 * 存的内容只有**哈希**：`scrypt:N:r:p:<salt base64url>:<hash base64url>`。
 * `.env.local` 里不会出现明文口令；备份也不含 `.env.local`（见 ADR D12）。
 *
 * 为什么分隔符是 `:` 而不是 `$`：Next 读 `.env.local` 时会做变量展开（dotenv-expand），
 * 值里的 `$32768` 会被当成变量名展开成空 —— 哈希当场变形，登录永远失败。
 * 换成 `:` 后值里没有 `$`，用户手改 `.env.local` 也不会踩这个坑。
 *
 * 参数校验：从环境里读到的哈希也是输入，N 太大或不是 2 的幂会被拒绝，
 * 免得一个被改坏的值让每次登录都卡死几十秒。
 */

export type ScryptParams = {
  N: number;
  r: number;
  p: number;
  keylen: number;
};

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 32768,
  r: 8,
  p: 1,
  keylen: 64,
};

/** scrypt 的内存上限：128 * N * r 再加余量 */
function maxmemFor(params: ScryptParams): number {
  return Math.max(64 * 1024 * 1024, 128 * params.N * params.r * 2);
}

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function fromBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

function isPowerOfTwo(value: number): boolean {
  return value > 1 && (value & (value - 1)) === 0;
}

/** 校验参数是否在可接受范围（防止坏配置把登录拖死） */
export function isValidScryptParams(params: ScryptParams): boolean {
  return (
    isPowerOfTwo(params.N) &&
    params.N >= 1024 &&
    params.N <= 131072 &&
    Number.isInteger(params.r) &&
    params.r >= 1 &&
    params.r <= 32 &&
    Number.isInteger(params.p) &&
    params.p >= 1 &&
    params.p <= 16 &&
    Number.isInteger(params.keylen) &&
    params.keylen >= 16 &&
    params.keylen <= 128
  );
}

/** 生成一个新的口令哈希（salt 16 字节；测试可注入固定 salt 与更小参数） */
export async function hashPassword(
  password: string,
  options: { salt?: Buffer; params?: ScryptParams } = {},
): Promise<string> {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("口令不能为空");
  }
  const params = options.params ?? DEFAULT_SCRYPT_PARAMS;
  if (!isValidScryptParams(params)) throw new Error("scrypt 参数不合法");

  const salt = options.salt ?? randomBytes(16);
  const hash = await scryptAsync(password, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params),
  });

  return `scrypt:${params.N}:${params.r}:${params.p}:${toBase64Url(salt)}:${toBase64Url(hash)}`;
}

type ParsedHash = { params: ScryptParams; salt: Buffer; hash: Buffer };

function parseHash(stored: string): ParsedHash | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split(":");
  if (parts.length !== 6) return null;
  const [algorithm, n, r, p, saltPart, hashPart] = parts;
  if (algorithm !== "scrypt") return null;

  const params: ScryptParams = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    keylen: 0,
  };
  const salt = fromBase64Url(saltPart);
  const hash = fromBase64Url(hashPart);
  if (!salt || !hash) return null;
  params.keylen = hash.length;
  if (!isValidScryptParams(params)) return null;

  return { params, salt, hash };
}

/** 这个字符串看起来是不是我们生成的哈希（用于 fail-closed 判断，不做真实验证） */
export function isPasswordHash(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return parseHash(value) !== null;
}

/**
 * 校验口令。任何解析失败都返回 false（不抛错）——
 * 登录页只该看到「口令不对」，不该看到内部格式的报错。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  if (typeof password !== "string" || password.length === 0) return false;

  try {
    const candidate = await scryptAsync(password, parsed.salt, parsed.params.keylen, {
      N: parsed.params.N,
      r: parsed.params.r,
      p: parsed.params.p,
      maxmem: maxmemFor(parsed.params),
    });
    if (candidate.length !== parsed.hash.length) return false;
    return timingSafeEqual(candidate, parsed.hash);
  } catch {
    return false;
  }
}
