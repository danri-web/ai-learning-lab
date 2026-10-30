/**
 * 会话 cookie 的签名与校验（阶段 7）。
 *
 * 为什么是「HMAC 签名 + 过期」而不是自己存 session 表：
 *   - 本地单用户应用，不需要服务端会话存储；cookie 本身就是凭据
 *   - 签名用 Web Crypto（Node 24 的全局 crypto.subtle），proxy.ts 与 Route Handler 都能用；
 *     不引 jose/jsonwebtoken，也不自己拼 JWT（少一个依赖、少一类算法混淆）
 *
 * 格式：`v1.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>`
 *   payload = { v: 1, sub: "owner", iat: 秒, exp: 秒 }
 *
 * 关键点（都有断言）：
 *   - 先验签、再解析 payload —— 不把未签名的 JSON 当数据
 *   - 过期时间由服务端写、服务端验；客户端改不了（改了签名就不对）
 *   - 换 SESSION_SECRET 会让所有旧 cookie 立刻失效（等于「全端登出」）
 *   - token 长度有上限，避免拿一个超大字符串来耗 CPU
 */

export const SESSION_COOKIE = "ai_lab_session";

/** 12 小时：够一天用，又不至于让手机长期免登录 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/** cookie 值上限（正常约 150 字符；超大值直接拒绝） */
const MAX_TOKEN_LENGTH = 4096;

/** 允许 60 秒时钟偏差（本机与手机可能差几秒） */
const CLOCK_SKEW_SECONDS = 60;

const HMAC_ALG = { name: "HMAC", hash: "SHA-256" } as const;

export type SessionPayload = {
  v: 1;
  sub: "owner";
  iat: number;
  exp: number;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  try {
    const binary = atob(padded + padding);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), HMAC_ALG, false, [
    "sign",
    "verify",
  ]);
}

/**
 * TS 5.7 的 typed array 泛型：`Uint8Array<ArrayBufferLike>` 不能直接当 `BufferSource`
 * （它可能是 SharedArrayBuffer）。拷进一个新的、确定由 ArrayBuffer 支撑的数组再交给 Web Crypto。
 */
function copyBytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === 1 &&
    payload.sub === "owner" &&
    typeof payload.iat === "number" &&
    Number.isInteger(payload.iat) &&
    typeof payload.exp === "number" &&
    Number.isInteger(payload.exp) &&
    payload.exp > payload.iat
  );
}

/** 签发：`now` 可注入，测试里不依赖真实时钟 */
export async function signSession(
  secret: string,
  now: number = Date.now(),
  ttlMs: number = SESSION_TTL_MS,
): Promise<string> {
  const iat = Math.floor(now / 1000);
  const exp = Math.floor((now + ttlMs) / 1000);
  const payload: SessionPayload = { v: 1, sub: "owner", iat, exp };
  const body = `v1.${toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign(HMAC_ALG, key, new TextEncoder().encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * 校验：签名不对 / 过期 / 结构不对，一律返回 null（不区分原因，避免给攻击者提示）。
 * `now` 可注入；`exp` 用秒，比较时换算成毫秒。
 */
export async function verifySession(
  token: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<SessionPayload | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  if (!secret || secret.length < 32) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, payloadPart, signaturePart] = parts;
  if (version !== "v1") return null;

  const signature = fromBase64Url(signaturePart);
  if (!signature) return null;

  const body = `${version}.${payloadPart}`;
  let valid = false;
  try {
    const key = await importKey(secret);
    valid = await crypto.subtle.verify(
      HMAC_ALG,
      key,
      copyBytes(signature),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const payloadBytes = fromBase64Url(payloadPart);
  if (!payloadBytes) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (!isSessionPayload(parsed)) return null;

  const nowSeconds = Math.floor(now / 1000);
  if (parsed.exp <= nowSeconds) return null;
  if (parsed.iat > nowSeconds + CLOCK_SKEW_SECONDS) return null;
  if (parsed.exp - parsed.iat > SESSION_TTL_SECONDS + CLOCK_SKEW_SECONDS) return null;

  return parsed;
}

/** 给 Route Handler 的 cookies().set 用；LAN 是 HTTP，`secure` 由调用方按协议决定 */
export function sessionCookieOptions(secure: boolean): {
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
  secure: boolean;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    secure,
  };
}
