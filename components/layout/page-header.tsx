import type { ReactNode } from "react";

/** 每个页面的标题区。action 放在右侧（手机上会自动换行）。 */
export function PageHeader({
  title,
  en,
  description,
  action,
}: {
  title: string;
  en: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
          <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{en}</span>
        </div>
        <p className="mt-1.5 max-w-2xl text-sm break-words text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
