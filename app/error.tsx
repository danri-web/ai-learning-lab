"use client";

import { House, RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * 根级错误边界（需求书 §9 的失败路径要求；ADR 残余风险「无 ErrorBoundary」在阶段 8 收掉）。
 *
 * 为什么是 client 组件：Next 的错误边界必须是 `"use client"`。
 * 所以这里**不包 AppShell**（AppShell 是服务端组件，读运行时 env 决定页脚文案），
 * 只给一个能出去的最小页面：重试、回总览。侧栏不在这一层是可接受的 ——
 * 出错的页面本身已经不可用，先保证「不白屏、有出口、说清楚数据没被改」。
 *
 * 覆盖范围：根布局以下的渲染错误。根布局自己抛错要走 `global-error.tsx`，
 * 这里不假装覆盖（见 README「已知问题」）。
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 保留控制台里的原始堆栈：本地应用没有上报服务，控制台就是唯一线索
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-10">
      <section className="w-full max-w-lg rounded-xl border border-border bg-surface p-6">
        <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
          <TriangleAlert aria-hidden className="size-3.5" />
          ERROR
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">这个页面没能加载出来</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          你的笔记、资源与任务都没有被改动 —— 只是这个页面渲染失败了。可以先重试一次；
          如果一直失败，回到总览再从侧栏进来，或看终端里的报错。
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs break-all text-muted-foreground">
            错误编号（服务端日志里能搜到）：{error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden />
            再试一次
          </Button>
          <Button asChild variant="outline">
            <Link href="/">
              <House aria-hidden />
              回到总览
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
