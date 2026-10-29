import { ListChecks, Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const STATUSES = [
  { label: "待办", dot: "bg-muted-foreground" },
  { label: "进行中", dot: "bg-warning" },
  { label: "已完成", dot: "bg-success" },
] as const;

export default function LearningPage() {
  return (
    <>
      <PageHeader
        title="学习任务"
        en="Learning"
        description="每一条任务就是一个要学的东西：状态、截止日期，以及它关联的笔记与资源。"
        action={
          <Button variant="outline" size="sm" disabled title="阶段 6 启用">
            <Plus aria-hidden />
            新建任务
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-4" aria-label="计划支持的状态">
        {STATUSES.map((status) => (
          <span
            key={status.label}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span aria-hidden className={`size-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <EmptyState
          icon={<ListChecks aria-hidden className="size-5" />}
          title="还没有任务"
          description="不会有甘特图、复杂项目管理、AI 排课 —— 只有这三档状态和截止日期。"
          stage="阶段 6 接入"
        />
      </div>
    </>
  );
}
