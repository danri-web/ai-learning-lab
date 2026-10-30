import { NextResponse } from "next/server";

import {
  isAllowedOrigin,
  readAuthConfig,
  requestOrigin,
  safeNextPath,
} from "@/lib/security/auth-config";
import { loginRateLimitKey, loginRateLimiter } from "@/lib/security/login-rate-limit";
import { verifyPassword } from "@/lib/security/password";
import {
  LOGIN_BODY_MAX_BYTES,
  isFormContentType,
  readBodyWithLimit,
} from "@/lib/security/request-body";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/security/session";

/**
 * 登录：表单 POST → 校验 → 种会话 cookie → 跳回 next。
 *
 * 安全点：
 *   - 只在本机模式之外工作；本机模式直接回首页（不需要登录）
 *   - Origin 不等于本站就拒绝（CSRF）；同时接受「协议 + Host 头」的 origin，
 *     否则 `-H 0.0.0.0` 下 request.url 是 0.0.0.0、浏览器是 localhost，合法登录会被误拒
 *   - 连续失败 5 次锁 5 分钟（进程内全局桶；见 ADR 残余风险）
 *   - cookie 是 HttpOnly + SameSite=Lax + 12 小时；刷新页面不会重置过期时间
 */

function redirect(request: Request, path: string): NextResponse {
  const origin = requestOrigin(request.headers.get("host"), request.url);
  return NextResponse.redirect(new URL(path, origin), 303);
}

function rateLimited(request: Request, retryAfterSeconds: number): NextResponse {
  const response = redirect(request, "/login?error=rate");
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

export async function POST(request: Request): Promise<NextResponse> {
  const config = readAuthConfig();

  if (!config.allowLan) return redirect(request, "/");
  if (!config.ready) return redirect(request, "/login?setup=1");

  if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"), request.url)) {
    return redirect(request, "/login?error=origin");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!isFormContentType(contentType)) {
    return redirect(request, "/login?error=wrong");
  }

  // 先只读预检，桶已锁就直接回去，不读请求体（SEC-02）
  const rateKey = loginRateLimitKey();
  const precheck = loginRateLimiter.check(rateKey);
  if (!precheck.allowed) {
    return rateLimited(request, precheck.retryAfterSeconds);
  }

  // 在流上限制字节数：Content-Length 可以撒谎，chunked 也可以没有它
  let body: ArrayBuffer | null;
  try {
    body = await readBodyWithLimit(request, LOGIN_BODY_MAX_BYTES);
  } catch {
    return redirect(request, "/login?error=wrong");
  }
  if (!body) return redirect(request, "/login?error=wrong");

  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return redirect(request, "/login?error=wrong");
  }

  // 读到表单后再占坑，然后才跑 scrypt：并发请求最多 maxAttempts 个在飞（SEC-03）
  const admission = loginRateLimiter.beginAttempt(rateKey);
  if (!admission.allowed) {
    return rateLimited(request, admission.retryAfterSeconds);
  }

  const rawPassword = form.get("password");
  const password = typeof rawPassword === "string" ? rawPassword : "";
  const next = safeNextPath(
    typeof form.get("next") === "string" ? (form.get("next") as string) : null,
  );

  if (password.length === 0 || password.length > 1024) {
    loginRateLimiter.recordFailure(rateKey);
    return redirect(request, `/login?error=wrong&next=${encodeURIComponent(next)}`);
  }

  const stored = process.env.LAB_PASSWORD_HASH ?? "";
  let valid: boolean;
  try {
    valid = await verifyPassword(password, stored);
  } catch {
    loginRateLimiter.recordFailure(rateKey);
    return redirect(request, `/login?error=wrong&next=${encodeURIComponent(next)}`);
  }
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
