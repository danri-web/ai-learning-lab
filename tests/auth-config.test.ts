import { describe, expect, it } from "vitest";

import {
  isAllowedOrigin,
  isLoopbackHost,
  readAuthConfig,
  requestOrigin,
  safeNextPath,
} from "@/lib/security/auth-config";

const SECRET = "s".repeat(32);
const HASH = "scrypt:32768:8:1:YWJjZGVmZ2hpamtsbW5vcA:" + "a".repeat(43);

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("访问边界配置", () => {
  it("默认是本机模式，不需要口令", () => {
    const config = readAuthConfig(env({}));
    expect(config.allowLan).toBe(false);
    expect(config.ready).toBe(true);
    expect(config.problems).toEqual([]);
  });

  it("ALLOW_LAN=1 但缺口令/密钥：不 ready，并给出两条问题", () => {
    const config = readAuthConfig(env({ ALLOW_LAN: "1" }));
    expect(config.allowLan).toBe(true);
    expect(config.ready).toBe(false);
    expect(config.problems).toHaveLength(2);
  });

  it("ALLOW_LAN=1 + 口令哈希 + 32 位密钥：ready", () => {
    const config = readAuthConfig(
      env({ ALLOW_LAN: "1", LAB_PASSWORD_HASH: HASH, SESSION_SECRET: SECRET }),
    );
    expect(config.ready).toBe(true);
    expect(config.problems).toEqual([]);
  });

  it("ALLOW_LAN=true 也算打开；0 不算", () => {
    expect(readAuthConfig(env({ ALLOW_LAN: "true" })).allowLan).toBe(true);
    expect(readAuthConfig(env({ ALLOW_LAN: "0" })).allowLan).toBe(false);
  });

  it("口令哈希形状不对 / 密钥太短都不 ready", () => {
    expect(
      readAuthConfig(env({ ALLOW_LAN: "1", LAB_PASSWORD_HASH: "plain", SESSION_SECRET: SECRET }))
        .ready,
    ).toBe(false);
    expect(
      readAuthConfig(env({ ALLOW_LAN: "1", LAB_PASSWORD_HASH: HASH, SESSION_SECRET: "short" }))
        .ready,
    ).toBe(false);
  });
});

describe("isLoopbackHost", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.1:3000",
    "localhost",
    "localhost:3000",
    "[::1]",
    "[::1]:3000",
    "::1",
  ])("本机：%s", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each([
    "192.168.1.5:3000",
    "10.0.0.2",
    "example.com",
    "127.0.0.1.evil.com",
    "localhost.evil.com",
    "[::1].evil.com",
    "",
    null,
    undefined,
    "0.0.0.0:3000",
  ])("非本机：%s", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/knowledge", "/knowledge"],
    ["/resources?type=paper", "/resources?type=paper"],
    ["/backup?restore=ai-lab-20261030-021500.zip", "/backup?restore=ai-lab-20261030-021500.zip"],
  ])("接受站内路径：%s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["//evil.com", "/"],
    ["https://evil.com", "/"],
    ["/\\evil.com", "/"],
    ["/login", "/"],
    ["/login?next=/", "/"],
    ["javascript:alert(1)", "/"],
    ["/a\nb", "/"],
    ["", "/"],
  ])("拒绝并回首页：%s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});

describe("Origin 检查（0.0.0.0 绑定下不能误拒 localhost/局域网 IP）", () => {
  it("没有 Origin（curl）不拦", () => {
    expect(isAllowedOrigin(null, "localhost:3100", "http://0.0.0.0:3100/api/auth/login")).toBe(
      true,
    );
  });

  it("Origin: null（不透明来源）不拦", () => {
    expect(isAllowedOrigin("null", "localhost:3100", "http://0.0.0.0:3100/api/auth/login")).toBe(
      true,
    );
  });

  it("Origin 与 request.url 一致：放行", () => {
    expect(
      isAllowedOrigin("http://localhost:3100", "localhost:3100", "http://localhost:3100/x"),
    ).toBe(true);
  });

  it("request.url 是 0.0.0.0、浏览器是 localhost：按 Host 放行", () => {
    expect(
      isAllowedOrigin("http://localhost:3100", "localhost:3100", "http://0.0.0.0:3100/x"),
    ).toBe(true);
  });

  it("request.url 是 0.0.0.0、浏览器是局域网 IP：按 Host 放行", () => {
    expect(
      isAllowedOrigin("http://172.19.31.43:3100", "172.19.31.43:3100", "http://0.0.0.0:3100/x"),
    ).toBe(true);
  });

  it("跨站 Origin：拒绝", () => {
    expect(isAllowedOrigin("http://evil.example", "localhost:3100", "http://0.0.0.0:3100/x")).toBe(
      false,
    );
  });

  it("request.url 非法：拒绝", () => {
    expect(isAllowedOrigin("http://localhost:3100", "localhost:3100", "not a url")).toBe(false);
  });

  it("requestOrigin 优先用 Host（否则会把人送到 0.0.0.0）", () => {
    expect(requestOrigin("localhost:3100", "http://0.0.0.0:3100/x")).toBe("http://localhost:3100");
    expect(requestOrigin(null, "http://0.0.0.0:3100/x")).toBe("http://0.0.0.0:3100");
  });
});
