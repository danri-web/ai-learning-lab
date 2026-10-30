import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 审计 v4 复核 F3：只断言 `loginRateLimitKey()` 返回 "owner" 不够 ——
 * 路由完全可能另选 key，而 helper 测试仍然是绿的。
 *
 * 这里直接打 POST /api/auth/login：5 次不同 X-Forwarded-For 的失败必须落在同一个桶，
 * 第 6 次（再换一个头）必须被限速挡住，而且不再调用 verifyPassword。
 * 把路由改回按头分桶，这条会红。
 */
vi.mock("@/lib/security/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/password")>();
  const state = { calls: 0 };
  return {
    ...actual,
    verifyPassword: async () => {
      state.calls += 1;
      return false;
    },
    __state: state,
  };
});

const { POST } = await import("@/app/api/auth/login/route");
const { loginRateLimiter } = await import("@/lib/security/login-rate-limit");
const passwordState = (
  (await import("@/lib/security/password")) as unknown as { __state: { calls: number } }
).__state;

const KEYS = ["ALLOW_LAN", "SESSION_SECRET", "LAB_PASSWORD_HASH"] as const;
const HASH = "scrypt:32768:8:1:YWJjZGVmZ2hpamtsbW5vcA:" + "a".repeat(43);
const saved = new Map<string, string | undefined>();

function loginRequest(forwardedFor: string): Request {
  return new Request("http://127.0.0.1:3000/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": forwardedFor,
    },
    body: new URLSearchParams({ password: "wrong-password", next: "/knowledge" }).toString(),
  });
}

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
  }
  process.env.ALLOW_LAN = "1";
  process.env.SESSION_SECRET = "s".repeat(32);
  process.env.LAB_PASSWORD_HASH = HASH;
  loginRateLimiter.reset();
  passwordState.calls = 0;
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  loginRateLimiter.reset();
});

describe("登录路由的限速桶", () => {
  it("换 5 个 X-Forwarded-For 仍然同桌吃饭，第 6 次被锁且不再验口令", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(loginRequest(`203.0.113.${attempt + 1}`));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toContain("/login?error=wrong");
    }
    expect(passwordState.calls).toBe(5);

    const sixth = await POST(loginRequest("198.51.100.99"));
    expect(sixth.status).toBe(303);
    expect(sixth.headers.get("location")).toContain("/login?error=rate");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    // 被限速的请求不应该再跑 scrypt
    expect(passwordState.calls).toBe(5);
  });
});
