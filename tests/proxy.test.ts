import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { proxy } from "@/proxy";
import { SESSION_COOKIE, signSession } from "@/lib/security/session";

const SECRET = "s".repeat(32);
const HASH = "scrypt:32768:8:1:YWJjZGVmZ2hpamtsbW5vcA:" + "a".repeat(43);
const KEYS = ["ALLOW_LAN", "SESSION_SECRET", "LAB_PASSWORD_HASH"] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

function request(pathname: string, init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`http://127.0.0.1:3000${pathname}`, init);
}

function lanMode(): void {
  process.env.ALLOW_LAN = "1";
  process.env.SESSION_SECRET = SECRET;
  process.env.LAB_PASSWORD_HASH = HASH;
}

function isNext(response: Response): boolean {
  return response.status === 200 && response.headers.get("x-middleware-next") === "1";
}

describe("本机模式", () => {
  it("127.0.0.1 / localhost 放行", async () => {
    expect(isNext(await proxy(request("/knowledge")))).toBe(true);
    expect(
      isNext(await proxy(request("/knowledge", { headers: { host: "localhost:3000" } }))),
    ).toBe(true);
  });

  it("非本机 Host 直接 503（有人绕过 start:lan 手动绑 0.0.0.0 时 fail closed）", async () => {
    const response = await proxy(request("/knowledge", { headers: { host: "192.168.1.5:3000" } }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("只监听本机");
  });

  it("/login 永远放行（否则配置出错时连说明页都看不到）", async () => {
    const response = await proxy(request("/login", { headers: { host: "192.168.1.5:3000" } }));
    expect(isNext(response)).toBe(true);
  });

  it("本机模式下写操作也不需要登录（边界是绑定地址）", async () => {
    const response = await proxy(request("/knowledge/new", { method: "POST" }));
    expect(isNext(response)).toBe(true);
  });
});

describe("局域网模式", () => {
  it("没配口令/密钥：fail closed（503），但 /login 能看说明", async () => {
    process.env.ALLOW_LAN = "1";
    const blocked = await proxy(request("/knowledge"));
    expect(blocked.status).toBe(503);
    expect(await blocked.text()).toContain("还没配置好");

    const login = await proxy(request("/login"));
    expect(isNext(login)).toBe(true);
  });

  it("未登录的页面请求 → 307 到 /login?next=…", async () => {
    lanMode();
    const response = await proxy(request("/knowledge?x=1"));
    expect(response.status).toBe(307);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("next=%2Fknowledge%3Fx%3D1");
  });

  it("未登录的 Server Action POST → 401（action 根本不会执行）", async () => {
    lanMode();
    const response = await proxy(
      request("/knowledge/new", { method: "POST", headers: { "next-action": "abc" } }),
    );
    expect(response.status).toBe(401);
  });

  it("未登录的 RSC 请求 → 401，不把页面数据吐出来", async () => {
    lanMode();
    const response = await proxy(request("/knowledge", { headers: { rsc: "1" } }));
    expect(response.status).toBe(401);
  });

  it("有效会话放行", async () => {
    lanMode();
    const token = await signSession(SECRET);
    const response = await proxy(
      request("/knowledge", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    );
    expect(isNext(response)).toBe(true);
  });

  it("过期会话不放行", async () => {
    lanMode();
    const token = await signSession(SECRET, Date.now() - 24 * 60 * 60 * 1000, 60_000);
    const response = await proxy(
      request("/knowledge", { headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    );
    expect(response.status).toBe(307);
  });

  it("篡改的 cookie 不放行", async () => {
    lanMode();
    const token = await signSession(SECRET);
    const last = token.slice(-1);
    const tampered = `${token.slice(0, -1)}${last === "x" ? "y" : "x"}`;
    const response = await proxy(
      request("/knowledge", { headers: { cookie: `${SESSION_COOKIE}=${tampered}` } }),
    );
    expect(response.status).toBe(307);
  });

  it("登录/登出接口在局域网模式下也放行", async () => {
    lanMode();
    expect(isNext(await proxy(request("/api/auth/login", { method: "POST" })))).toBe(true);
    expect(isNext(await proxy(request("/api/auth/logout", { method: "POST" })))).toBe(true);
  });
});
