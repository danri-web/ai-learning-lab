import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { readAuthConfig } from "@/lib/security/auth-config";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/security/session";

/**
 * 服务端（布局 / Server Action / Route Handler）读取会话。
 *
 * 三道门的分工：
 *   - `proxy.ts`：每个请求的第一道，页面与 action POST 都过（Next 16 的 proxy 默认 Node 运行时，
 *     能读运行时的 process.env，不会被 build 时的环境变量固化）
 *   - 本文件的 `requirePageAuth()`：工作区布局里的第二道，防 proxy matcher 漏一条路由
 *   - 本文件的 `requireAuth()`：每个 Server Action / 受保护 Route Handler 的第三道，
 *     防「页面拦了、action 没拦」—— 写入永远要再确认一次
 *
 * 本机模式（ALLOW_LAN 未开）三道都直接放行：绑定地址本身就是边界。
 */

export class UnauthorizedError extends Error {
  constructor(message = "需要登录") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const config = readAuthConfig();
  if (!config.allowLan) return null;

  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET ?? "");
}

/** Server Action / Route Handler 用：本机模式放行；局域网模式必须有一个有效会话 */
export async function requireAuth(): Promise<void> {
  const config = readAuthConfig();
  if (!config.allowLan) return;
  if (!config.ready) throw new UnauthorizedError("局域网模式还没配置口令与会话密钥");

  const session = await getSession();
  if (!session) throw new UnauthorizedError("登录已过期，请重新登录");
}

/** 工作区布局用：没配置就去登录页看说明；没登录就带上回跳地址 */
export async function requirePageAuth(): Promise<void> {
  const config = readAuthConfig();
  if (!config.allowLan) return;
  if (!config.ready) redirect("/login?setup=1");

  const session = await getSession();
  if (!session) redirect("/login");
}
