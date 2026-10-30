/**
 * 登录失败限速（进程内）。
 *
 * 为什么需要：局域网里任何一台设备都能试口令；没有限速时，弱口令就是可穷举的。
 * 这里不追求分布式限速（单进程、单用户），只保证「连续错 5 次，锁 5 分钟」。
 *
 * 进程内 Map 的已知边界（写进 ADR 残余风险）：
 *   - 重启进程就清空
 *   - 多进程/多实例不共享（本项目只跑一个 next start）
 */

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

type Entry = { count: number; firstAt: number; lockedUntil: number };

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

    return { allowed: true };
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.entries.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) {
      this.entries.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
      return;
    }

    entry.count += 1;
    if (entry.count >= this.maxAttempts) {
      entry.lockedUntil = now + this.lockMs;
    }
  }

  recordSuccess(key: string): void {
    this.entries.delete(key);
  }

  /** 只清理明显过期的条目，避免长期运行后 Map 无限增长 */
  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
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
