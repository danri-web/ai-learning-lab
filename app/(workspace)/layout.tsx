import { AppShell } from "@/components/layout/app-shell";
import { requirePageAuth } from "@/lib/security/auth";
import { readAuthConfig } from "@/lib/security/auth-config";

/** 工作区路由组：五个页面共用这一层外壳（侧栏 / 顶栏 / 主区）。 */
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  // 第二道门：proxy 之外再确认一次。本机模式直接放行；局域网模式没会话就回登录页。
  await requirePageAuth();
  const config = readAuthConfig();

  return (
    <AppShell>
      {config.allowLan ? (
        <div className="mb-5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          局域网模式 · HTTP 未加密：只在可信 Wi-Fi 下使用；所有页面与写入都需要登录。
        </div>
      ) : null}
      {children}
    </AppShell>
  );
}
