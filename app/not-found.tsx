import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

/**
 * 404。默认的 Next 404 是英文、无样式、也没有导航 —— 从侧栏点进来还好，
 * 但手输错的地址或过期链接会掉进一个「出不去的页面」，所以这里给回导航和出口。
 */
export default function NotFound() {
  return (
    <AppShell>
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <p className="font-mono text-xs tracking-widest text-muted-foreground">404</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">这里没有页面</h1>
        <p className="mt-2 max-w-md text-sm break-words text-muted-foreground">
          地址可能写错了，或者这个功能还没做到（当前进度见侧栏与 README 的阶段表）。
        </p>
        <Button asChild variant="outline" size="sm" className="mt-5">
          <Link href="/">回到总览</Link>
        </Button>
      </div>
    </AppShell>
  );
}
