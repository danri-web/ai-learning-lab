"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActivePath } from "./nav-items";

/**
 * 「是否已水合」：服务端渲染 false，客户端水合完成后变 true。
 *
 * 为什么必须这样：404 页面在生产构建里是**预渲染好的静态 HTML**，会被复用于任意
 * 未匹配的地址。此时服务端拿到的 pathname 是 `/_not-found`，而浏览器地址栏是真实
 * 地址 → 两边算出的「高亮项」不一致 → React 抛 Hydration error #418。
 * 所以高亮一律等水合之后再画。别再改回「服务端直接算路径」的写法。
 */
const subscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

/** 侧栏导航。桌面固定显示，手机放在抽屉里（同一个组件）。 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const hydrated = useHydrated();

  return (
    <nav aria-label="主导航" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      {NAV_ITEMS.map((item) => {
        const active = hydrated && isActivePath(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2 transition-colors",
              "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              active
                ? "bg-elevated text-foreground"
                : "text-muted-foreground hover:bg-elevated/70 hover:text-foreground",
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                "size-4 shrink-0",
                active
                  ? "text-primary"
                  : "text-muted-foreground transition-colors group-hover:text-foreground",
              )}
            />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{item.label}</span>
              <span className="truncate text-[11px] text-muted-foreground">{item.en}</span>
            </span>
            {active ? (
              <span aria-hidden className="ml-auto h-4 w-0.5 shrink-0 rounded-full bg-primary" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
