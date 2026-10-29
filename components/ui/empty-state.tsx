import type { ReactNode } from "react";

/**
 * 空状态。阶段 2 的每个功能区都还没有数据，用它统一表达「这里将来有什么」。
 * 显式写出「哪个阶段接进来」，避免看起来像坏掉了。
 */
export function EmptyState({
  icon,
  title,
  description,
  stage,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  /** 例如 "阶段 3 接入" */
  stage: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-border bg-surface/50 px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-muted-foreground">{icon}</div> : null}
      <p className="text-sm font-medium break-words text-foreground">{title}</p>
      <p className="mt-1.5 max-w-md text-sm break-words text-muted-foreground">{description}</p>
      <p className="mt-4 text-[11px] tracking-wide break-words text-muted-foreground uppercase">
        {stage}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
