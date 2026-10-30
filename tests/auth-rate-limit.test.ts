import { describe, expect, it } from "vitest";

import { LoginRateLimiter } from "@/lib/security/login-rate-limit";

describe("登录失败限速", () => {
  it("连续错 5 次后锁 5 分钟，时间到了自动放行", () => {
    let now = 0;
    const limiter = new LoginRateLimiter({ now: () => now });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      limiter.recordFailure("1.2.3.4");
      expect(limiter.check("1.2.3.4").allowed).toBe(true);
    }

    limiter.recordFailure("1.2.3.4");
    const locked = limiter.check("1.2.3.4");
    expect(locked.allowed).toBe(false);
    if (!locked.allowed) expect(locked.retryAfterSeconds).toBe(300);

    now = 299_000;
    expect(limiter.check("1.2.3.4").allowed).toBe(false);

    now = 301_000;
    expect(limiter.check("1.2.3.4").allowed).toBe(true);
  });

  it("登录成功会清掉失败计数", () => {
    const now = 0;
    const limiter = new LoginRateLimiter({ now: () => now });
    for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure("ip");
    limiter.recordSuccess("ip");
    expect(limiter.check("ip").allowed).toBe(true);

    for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure("ip");
    expect(limiter.check("ip").allowed).toBe(true);
  });

  it("不同来源互不影响", () => {
    const limiter = new LoginRateLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure("a");
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(true);
  });

  it("窗口过期后重新计数", () => {
    let now = 0;
    const limiter = new LoginRateLimiter({ now: () => now });
    for (let attempt = 0; attempt < 4; attempt += 1) limiter.recordFailure("ip");
    now = 6 * 60 * 1000;
    limiter.recordFailure("ip");
    expect(limiter.check("ip").allowed).toBe(true);
  });
});
