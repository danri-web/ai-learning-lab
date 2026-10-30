import type { ReactNode } from "react";

import { readAuthConfig } from "@/lib/security/auth-config";
import { Brand } from "./brand";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";

/**
 * 应用外壳：桌面 = 侧栏 + 顶栏 + 主区；手机 = 顶栏（含抽屉）+ 单列主区。
 * 所有 `min-w-0` 都是为了「不出现横向溢出」（README §6 手机端要求）。
 */
export function AppShell({ children }: { children: ReactNode }) {
  const config = readAuthConfig();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm focus:text-foreground"
      >
        跳到主要内容
      </a>
      <div className="flex min-h-dvh flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
          <Brand />
          <SidebarNav />
          <div className="border-t border-border px-4 py-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              阶段 8 · 测试与本地发布
              <br />
              Ctrl+K 搜全库；数据与备份都在这台电脑上
            </p>
          </div>
        </aside>
        <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
          <TopBar />
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6 focus:outline-none md:px-8 md:py-8"
          >
            {children}
          </main>
          <footer className="border-t border-border px-4 py-4 text-[11px] text-muted-foreground md:px-8">
            {config.allowLan
              ? "局域网模式 · HTTP 未加密 · 数据不出本机"
              : "本地优先 · 默认只监听 127.0.0.1 · 数据不出本机"}
          </footer>
        </div>
      </div>
    </div>
  );
}
