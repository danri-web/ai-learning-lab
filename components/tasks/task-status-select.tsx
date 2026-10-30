"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";
import {
  TASK_STATUSES,
  TASK_STATUS_DOTS,
  TASK_STATUS_LABELS,
  isTaskStatus,
} from "@/lib/content/task-types";

/**
 * 列表上直接改状态（不用进编辑页）。
 *
 * 用原生 `<select>` 而不是三个按钮：一行任务已经有编辑/删除两个按钮了，
 * 再塞三个药丸会把列表塞满；原生控件键盘、读屏、手机上都是免费做对的。
 * 写入走的是专门的 `updateTaskStatus`（只动 status 与 updatedAt），
 * 不会把别处的草稿覆盖掉。
 */
export function TaskStatusSelect({
  id,
  status,
  action,
}: {
  id: string;
  status: string;
  action: (id: string, status: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [current, setCurrent] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          isTaskStatus(current) ? TASK_STATUS_DOTS[current] : "bg-muted-foreground",
        )}
      />
      <label className="sr-only" htmlFor={`status-${id}`}>
        状态
      </label>
      <select
        id={`status-${id}`}
        value={current}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          setCurrent(next);
          setError(null);
          startTransition(async () => {
            const result = await action(id, next);
            if (!result.ok) {
              setCurrent(status); // 失败就退回真实状态，别让界面撒谎
              setError(result.error ?? "改状态失败");
            }
          });
        }}
        className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {TASK_STATUSES.map((value) => (
          <option key={value} value={value}>
            {TASK_STATUS_LABELS[value]}
          </option>
        ))}
      </select>
      {pending ? <Loader2 aria-hidden className="size-3 animate-spin text-muted-foreground" /> : null}
      {error ? (
        <span role="alert" className="text-[11px] text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}
