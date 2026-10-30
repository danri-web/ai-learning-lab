import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { readAuthConfig, safeNextPath } from "@/lib/security/auth-config";
import { SESSION_COOKIE, verifySession } from "@/lib/security/session";

export const metadata: Metadata = { title: "登录" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  wrong: "口令不对。连续错 5 次会锁 5 分钟。",
  rate: "失败次数太多，请过几分钟再试。",
  origin: "请求来源不对，已拒绝。",
  config: "局域网模式还没配置口令与会话密钥。",
};

type Params = { next?: string; error?: string; setup?: string };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const config = readAuthConfig();
  const next = safeNextPath(params.next);

  if (!config.allowLan) {
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">本机模式，不需要登录</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            这个实例现在只监听 127.0.0.1。要从手机访问，先跑
            <code className="mx-1 rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">
              npm run auth:set-password
            </code>
            设置口令，再用
            <code className="mx-1 rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">
              npm run start:lan
            </code>
            启动局域网模式。
          </p>
          <Button asChild className="mt-5">
            <Link href="/">回到总览</Link>
          </Button>
        </section>
      </main>
    );
  }

  if (config.ready) {
    const store = await cookies();
    const session = await verifySession(
      store.get(SESSION_COOKIE)?.value,
      process.env.SESSION_SECRET ?? "",
    );
    if (session) redirect(next);
  }

  const error = params.error ? (ERRORS[params.error] ?? "登录失败，请重试。") : null;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6">
        <p className="text-xs tracking-wide text-muted-foreground">AI Learning Lab</p>
        <h1 className="mt-1 text-xl font-semibold">局域网登录</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          这台实例现在对局域网开放，读取与写入都需要口令。口令只以 scrypt 哈希保存在这台电脑的
          <code className="mx-1 rounded bg-elevated px-1.5 py-0.5 font-mono text-xs">
            .env.local
          </code>
          里。
        </p>

        {!config.ready ? (
          <div className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            <p className="font-medium text-warning">还没有配置口令</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              在项目目录运行 <code>npm run auth:set-password</code>，然后重新
              <code className="mx-1">npm run start:lan</code>。配置不齐时服务会拒绝所有受保护请求，
              不会退回「不登录也能看」。
            </p>
            {config.problems.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                {config.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <form method="post" action="/api/auth/login" className="mt-5 grid gap-3">
            <input type="hidden" name="next" value={next} />
            <label htmlFor="password" className="text-sm font-medium">
              口令
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              maxLength={1024}
              autoComplete="current-password"
              autoFocus
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="mt-1 h-10">
              登录
            </Button>
          </form>
        )}

        <p className="mt-5 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
          现在是局域网 HTTP，传输没有加密：只在可信 Wi-Fi 下使用，别在公共网络开。 会话 12
          小时；换掉 <code>SESSION_SECRET</code> 会让所有设备立刻退出。
        </p>
      </section>
    </main>
  );
}
