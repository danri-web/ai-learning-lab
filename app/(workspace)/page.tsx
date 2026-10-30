import type { Metadata } from "next";
import { BookOpen, Library, ListChecks, Search } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";

const STATS = [
  { label: "知识笔记", hint: "阶段 6 接入", icon: BookOpen },
  { label: "资源收藏", hint: "阶段 4 接入", icon: Library },
  { label: "学习任务", hint: "阶段 6 接入", icon: ListChecks },
  { label: "搜索条目", hint: "阶段 6 接入", icon: Search },
] as const;

export const metadata: Metadata = { title: "总览" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="总览"
        en="Dashboard"
        description="今天要做什么。数字与「最近笔记」还没接 —— 总览的统计在阶段 6 接真实数据，现在不显示假值。"
      />

      <section aria-label="统计" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                <Icon aria-hidden className="size-3.5 text-muted-foreground" />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">—</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{stat.hint}</p>
            </div>
          );
        })}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-medium">最近笔记</h2>
          <EmptyState
            icon={<BookOpen aria-hidden className="size-5" />}
            title="总览还没读笔记"
            description="笔记已经能读能写了（去「知识库」看）；总览的最近笔记与统计在阶段 6 接，这里不放假数据。"
            stage="阶段 6 接入"
          />
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium">进行中的任务</h2>
          <EmptyState
            icon={<ListChecks aria-hidden className="size-5" />}
            title="还没有学习任务"
            description="任务只有三种状态：待办 / 进行中 / 完成，可以关联笔记和收藏的资源。"
            stage="阶段 6 接入"
          />
        </div>
      </section>
    </>
  );
}
