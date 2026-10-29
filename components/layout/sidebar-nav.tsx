"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActivePath } from "./nav-items";

/** 侧栏导航。桌面固定显示，手机放在抽屉里（同一个组件）。 */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="主导航" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
      {NAV_ITEMS.map((item) => {
        const active = isActivePath(pathname, item.href);
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
