/**
 * 登录失败限速（进程内）。
 *
 * 为什么需要：局域网里任何一台设备都能试口令；没有限速时，弱口令就是可穷举的。
 * 这里不追求分布式限速（单进程、单用户），只保证「连续错 5 次，锁 5 分钟」。
 *
 * 进程内 Map 的已知边界（写进 ADR 残余风险）：
 *   - 重启进程就清空
 *   - 多进程/多实例不共享（本项目只跑一个 next start）
 *
 * 审计 v5 的 SEC-03：只 `check` 不占位时，100 个并发请求都能在第一次失败落账前
 * 通过准入、一起跑 scrypt。现在用 `beginAttempt` **先占坑**（pending），
 * 失败/成功后再结算；同一时刻最多 maxAttempts 个在飞。
 */

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Entry = { count: number; firstAt: number; lockedUntil: number; pending: number };

export type RateLimitOptions = {
  maxAttempts?: number;
  windowMs?: number;
  lockMs?: number;
  now?: () => number;
};

export class LoginRateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly now: () => number;
  private readonly entries = new Map<string, Entry>();

  constructor(options: RateLimitOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowMs = options.windowMs ?? 5 * 60 * 1000;
    this.lockMs = options.lockMs ?? 5 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** 只读预检：不占坑。用于“还没读请求体，先看桶是不是已经锁了” */
  check(key: string): RateLimitDecision {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true };

    const now = this.now();
    if (entry.lockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
    }

    if (now - entry.firstAt > this.windowMs) {
      this.entries.delete(key);
      return { allowed: true };
    }

    if (entry.count + entry.pending >= this.maxAttempts) {
      return { allowed: false, retryAfterSeconds: 1 };
    }

    return { allowed: true };
  }

  /**
   * 占一个坑（在 scrypt 之前调用）。返回 allowed 后，调用方**必须**在
   * 成功/失败路径各结算一次（recordSuccess / recordFailure），否则这个坑会一直占着。
   */
  beginAttempt(key: string): RateLimitDecision {
    this.prune();
    const now = this.now();
    let entry = this.entries.get(key);

    if (!entry || now - entry.firstAt > this.windowMs) {
      entry = { count: 0, firstAt: now, lockedUntil: 0, pending: 0 };
      this.entries.set(key, entry);
    }

    if (entry.lockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) };
    }

    if (entry.count + entry.pending >= this.maxAttempts) {
      return { allowed: false, retryAfterSeconds: 1 };
    }

    entry.pending += 1;
    return { allowed: true };
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.entries.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) {
      this.entries.set(key, { count: 1, firstAt: now, lockedUntil: 0, pending: 0 });
      return;
    }

    if (entry.pending > 0) entry.pending -= 1;
    entry.count += 1;
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockMs;
      entry.pending = 0;
    }
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** 测试/热重载用：清空所有桶（生产路径不调用） */
  reset(): void {
    this.entries.clear();
  }

  /** 只清理明显过期的条目，避免长期运行后 Map 无限增长 */
  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.pending > 0) continue;
      const expired =
        entry.lockedUntil === 0
          ? now - entry.firstAt > this.windowMs
          : entry.lockedUntil <= now && now - entry.firstAt > this.windowMs;
      if (expired) this.entries.delete(key);
    }
  }
}

/** 登录接口共用的一个实例（模块级；Next 开发模式热重载会重建，可接受） */
export const loginRateLimiter = new LoginRateLimiter();

/**
 * 登录限速的桶 key（审计 v4 F3）。
 *
 * `next start` 是直接暴露的，前面没有可信反向代理；`X-Forwarded-For` / `X-Real-IP`
 * 都是客户端可改的。按它们分桶等于让攻击者换头绕过 5 次锁。
 *
 * 单用户应用用**全局桶**：所有登录尝试共用同一个计数。代价是攻击者可以故意失败
 * 把房主锁 5 分钟（可用性 DoS），但换头不能绕过穷举；两者相权，先保「不可绕过」。
 * 如果将来真的放到可信反向代理后面，再加 `TRUST_PROXY=1` 的显式分支，而不是现在猜。
 */
export function loginRateLimitKey(): string {
  return "owner";
}
