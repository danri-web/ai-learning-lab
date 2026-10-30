import { NextResponse } from "next/server";

import {
  isAllowedOrigin,
  readAuthConfig,
  requestOrigin,
  safeNextPath,
} from "@/lib/security/auth-config";
import { loginRateLimiter } from "@/lib/security/login-rate-limit";
import { verifyPassword } from "@/lib/security/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/security/session";

/**
 * 登录：表单 POST → 校验 → 种会话 cookie → 跳回 next。
 *
 * 安全点：
 *   - 只在本机模式之外工作；本机模式直接回首页（不需要登录）
 *   - Origin 不等于本站就拒绝（CSRF）；同时接受「协议 + Host 头」的 origin，
 *     否则 `-H 0.0.0.0` 下 request.url 是 0.0.0.0、浏览器是 localhost，合法登录会被误拒
 *   - 连续失败 5 次锁 5 分钟（进程内；见 ADR 残余风险）
 *   - cookie 是 HttpOnly + SameSite=Lax + 12 小时；刷新页面不会重置过期时间
 */

function redirect(request: Request, path: string): NextResponse {
  const origin = requestOrigin(request.headers.get("host"), request.url);
  return NextResponse.redirect(new URL(path, origin), 303);
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "local";
}

export async function POST(request: Request): Promise<NextResponse> {
  const config = readAuthConfig();

  if (!config.allowLan) return redirect(request, "/");
  if (!config.ready) return redirect(request, "/login?setup=1");

  if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"), request.url)) {
    return redirect(request, "/login?error=origin");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(request, "/login?error=wrong");
  }

  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const next = safeNextPath(
    typeof form.get("next") === "string" ? (form.get("next") as string) : null,
  );

  const rateKey = clientKey(request);
  const decision = loginRateLimiter.check(rateKey);
  if (!decision.allowed) {
    const response = redirect(request, "/login?error=rate");
    response.headers.set("Retry-After", String(decision.retryAfterSeconds));
    return response;
  }

  if (password.length === 0 || password.length > 1024) {
    loginRateLimiter.recordFailure(rateKey);
    return redirect(request, `/login?error=wrong&next=${encodeURIComponent(next)}`);
  }

  const stored = process.env.LAB_PASSWORD_HASH ?? "";
  const valid = await verifyPassword(password, stored);
  if (!valid) {
    loginRateLimiter.recordFailure(rateKey);
    return redirect(request, `/login?error=wrong&next=${encodeURIComponent(next)}`);
  }

  loginRateLimiter.recordSuccess(rateKey);
  const token = await signSession(process.env.SESSION_SECRET ?? "");
  const response = redirect(request, next);
  const protocol = new URL(requestOrigin(request.headers.get("host"), request.url)).protocol;
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(protocol === "https:"));
  return response;
}
