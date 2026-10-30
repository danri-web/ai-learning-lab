import { NextResponse, type NextRequest } from "next/server";

import { isLoopbackHost, readAuthConfig, safeNextPath } from "@/lib/security/auth-config";
import { SESSION_COOKIE, verifySession } from "@/lib/security/session";

/**
 * Next 16 的 Proxy（原来的 middleware）：每个请求在渲染之前先过这里。
 *
 * 规则只有三条：
 *   1. 本机模式：只允许 Host 是本机的请求；发现有人从局域网访问（说明有人绕过了
 *      `npm run start:lan` 手动绑了 0.0.0.0）就 503，不假装自己是安全的
 *   2. 局域网模式：`/login` 与登出永远放行；其余请求必须有有效会话
 *   3. 局域网模式但口令/密钥没配好：fail closed（503），绝不退回「裸奔」
 *
 * Server Action 的 POST 也走这里：未登录直接 401，action 根本不会执行。
 * 布局与 action 里还有第二、第三道（见 lib/security/auth.ts），不靠单点。
 */

export const config = {
  matcher: [
    // 排除静态资源；页面、action、route handler 全部进来
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

function htmlResponse(status: number, title: string, body: string): NextResponse {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0b0f;color:#e7e7ea;margin:0;display:grid;place-items:center;min-height:100dvh;padding:24px}main{max-width:36rem;background:#14141a;border:1px solid #2a2a33;border-radius:12px;padding:24px;line-height:1.7}h1{font-size:1.1rem;margin:0 0 8px}p{margin:8px 0;color:#a8a8b3}code{background:#1d1d25;padding:2px 6px;border-radius:4px;color:#e7e7ea}</style></head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function unauthorized(request: NextRequest): NextResponse {
  if (
    request.method !== "GET" ||
    request.headers.get("rsc") === "1" ||
    request.headers.get("next-router-prefetch") !== null
  ) {
    return new NextResponse("需要登录：请先在 /login 登录", {
      status: 401,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const next = safeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  const login = new URL("/login", request.url);
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login, 307);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const config = readAuthConfig();

  if (!config.allowLan) {
    const host = request.headers.get("host") ?? request.nextUrl.host;
    if (!isLoopbackHost(host)) {
      return htmlResponse(
        503,
        "这个实例只监听本机",
        "检测到请求不是从 127.0.0.1 / localhost 发来的。要从手机访问，请用 <code>npm run build</code> 之后运行 <code>npm run start:lan</code>（局域网模式会强制口令登录）。",
      );
    }
    return NextResponse.next();
  }

  if (!config.ready) {
    return htmlResponse(
      503,
      "局域网模式还没配置好",
      `缺少：${config.problems.join("；")}。先运行 <code>npm run auth:set-password</code>，再重新 <code>npm run start:lan</code>。`,
    );
  }

  const session = await verifySession(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.SESSION_SECRET ?? "",
  );
  if (session) return NextResponse.next();

  return unauthorized(request);
}
