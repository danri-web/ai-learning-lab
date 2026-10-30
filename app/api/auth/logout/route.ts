import { NextResponse } from "next/server";

import { isAllowedOrigin, readAuthConfig, requestOrigin } from "@/lib/security/auth-config";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/security/session";

/**
 * 登出：清 cookie 后回登录页。
 * 只接受 POST（GET 退出会被浏览器预取/图片标签误触发），并检查 Origin。
 * 未登录也能调用 —— 最坏结果只是「本来就没登录」。
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isAllowedOrigin(request.headers.get("origin"), request.headers.get("host"), request.url)) {
    return new NextResponse("跨站请求被拒绝", { status: 403 });
  }

  const origin = requestOrigin(request.headers.get("host"), request.url);
  const config = readAuthConfig();
  const response = NextResponse.redirect(new URL(config.allowLan ? "/login" : "/", origin), 303);
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(new URL(origin).protocol === "https:"),
    maxAge: 0,
  });
  return response;
}
