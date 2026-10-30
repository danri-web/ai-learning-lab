import { describe, expect, it } from "vitest";

import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/security/session";

const SECRET = "s".repeat(32);
const NOW = Date.UTC(2026, 9, 30, 2, 15, 0);

describe("会话 token", () => {
  it("签发的 token 能验回来，payload 是服务端写的", async () => {
    const token = await signSession(SECRET, NOW, 60_000);
    const session = await verifySession(token, SECRET, NOW + 1_000);
    expect(session).toMatchObject({ v: 1, sub: "owner" });
    expect(session?.exp).toBe(Math.floor((NOW + 60_000) / 1000));
  });

  it("过期就失效（不靠客户端时间）", async () => {
    const token = await signSession(SECRET, NOW, 60_000);
    expect(await verifySession(token, SECRET, NOW + 61_000)).toBeNull();
  });

  it("改 payload 会破坏签名", async () => {
    const token = await signSession(SECRET, NOW, 60_000);
    const [version, payload, signature] = token.split(".");
    const flipped = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A");
    expect(await verifySession(`${version}.${flipped}.${signature}`, SECRET, NOW)).toBeNull();
  });

  it("改签名会失效", async () => {
    const token = await signSession(SECRET, NOW, 60_000);
    const [version, payload, signature] = token.split(".");
    const flipped = signature.slice(0, -1) + (signature.endsWith("A") ? "B" : "A");
    expect(await verifySession(`${version}.${payload}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("换密钥 = 所有旧会话立即失效", async () => {
    const token = await signSession(SECRET, NOW, 60_000);
    expect(await verifySession(token, "t".repeat(32), NOW)).toBeNull();
  });

  it("有效期超过 12 小时上限的 token 不被接受", async () => {
    const token = await signSession(SECRET, NOW, 8 * 24 * 60 * 60 * 1000);
    expect(await verifySession(token, SECRET, NOW + 1_000)).toBeNull();
  });

  it("签发时间在未来（超过 60 秒偏差）不被接受", async () => {
    const token = await signSession(SECRET, NOW + 5 * 60 * 1000, 60_000);
    expect(await verifySession(token, SECRET, NOW)).toBeNull();
  });

  it.each([
    ["空", ""],
    ["只有两段", "v1.abc"],
    ["版本不对", "v2.abc.def"],
    ["非 base64url", "v1.@@@.###"],
    ["超长", `v1.${"a".repeat(5000)}.b`],
    ["null", null],
    ["undefined", undefined],
  ])("坏 token 一律 null：%s", async (_label, token) => {
    expect(await verifySession(token as string | null, SECRET, NOW)).toBeNull();
  });

  it("密钥太短时拒绝验证（fail closed）", async () => {
    const token = await signSession("short", NOW, 60_000);
    expect(await verifySession(token, "short", NOW)).toBeNull();
    expect(await verifySession(token, SECRET, NOW)).toBeNull();
  });

  it("cookie 是 HttpOnly + SameSite=Lax + 12 小时", () => {
    const options = sessionCookieOptions(false);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.maxAge).toBe(SESSION_TTL_SECONDS);
    expect(options.secure).toBe(false);
    expect(sessionCookieOptions(true).secure).toBe(true);
    expect(SESSION_COOKIE).toBe("ai_lab_session");
  });
});
