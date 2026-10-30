"use client";

import { cn } from "cn";
import { Save, TriangleAlert } from "lucide-react";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  INITIAL_TASK_FORM_STATE,
  type TaskFormState,
} from "@/features/tasks/form-state";
import { TASK_STATUSES, TASK_STATUS_LABELS } from "@/lib/content/task-types";

/**
 * 学习任务的表单（新建 / 编辑）。
 *
 * 与笔记、资源同一个骨架：`useActionState`（失败不丢输入）+ 未保存提醒 + 过期保存的「仍然覆盖」。
 * 与资源的区别：多了三档状态、截止日期，以及**多个**关联（笔记与资源各是多选）。
 */

export type LinkOption = { id: string; title: string };

export type TaskFormInitial = {
  id: string;
  title: string;
  status: string;
  dueDate: string;
  note: string;
  articleIds: string[];
  resourceIds: string[];
  /** 打开这条任务时的指纹，保存时带回去做冲突检查 */
  revision: string;
};

type Props = {
  mode: "create" | "edit";
  action: (prev: TaskFormState, formData: FormData) => Promise<TaskFormState>;
  initial?: TaskFormInitial;
  articles: LinkOption[];
  resources: LinkOption[];
};

const fieldClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      <Save aria-hidden />
      {pending ? "保存中…" : label}
    </Button>
  );
}

/** 多选清单：没有可选项时说明"为什么空"，而不是给一个空气泡 */
function LinkPicker({
  legend,
  name,
  options,
  selected,
  onToggle,
  emptyHint,
}: {
  legend: string;
  name: string;
  options: LinkOption[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  emptyHint: string;
}) {
  const groupId = useId();
  return (
    <fieldset className="grid gap-1.5">
      <legend className="text-xs text-muted-foreground">{legend}</legend>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <ul
          id={groupId}
          className="max-h-44 overflow-y-auto rounded-lg border border-border bg-surface p-1"
        >
          {options.map((option) => {
            const checked = selected.includes(option.id);
            return (
              <li key={option.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-elevated">
                  <input
                    type="checkbox"
                    name={name}
                    value={option.id}
                    checked={checked}
                    onChange={(event) => onToggle(option.id, event.target.checked)}
                    className="mt-1 size-3.5 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words">{option.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                    {option.id}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}

export function TaskForm({ mode, action, initial, articles, resources }: Props) {
  const [state, formAction] = useActionState(action, INITIAL_TASK_FORM_STATE);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [status, setStatus] = useState(initial?.status ?? "todo");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [articleIds, setArticleIds] = useState(initial?.articleIds ?? []);
  const [resourceIds, setResourceIds] = useState(initial?.resourceIds ?? []);

  /**
   * React 19 在 action 结束后会 reset 表单。text input 会被 React 写回，
   * 但 radio / checkbox 的 checked prop 没变时 React 不重写 DOM —— 校验失败后
   * 「进行中」看起来退回「待办」、关联勾选看起来丢了（state 其实还在）。
   * 2026-10-30 的 E2E 抓到。这里把 DOM 同步回 state：只操作 DOM，不 setState。
   */
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (state.status !== "error" || !form) return;
    form.querySelectorAll<HTMLInputElement>('input[name="status"]').forEach((input) => {
      input.checked = input.value === status;
    });
    form.querySelectorAll<HTMLInputElement>('input[name="articleIds"]').forEach((input) => {
      input.checked = articleIds.includes(input.value);
    });
    form.querySelectorAll<HTMLInputElement>('input[name="resourceIds"]').forEach((input) => {
      input.checked = resourceIds.includes(input.value);
    });
  }, [state, status, articleIds, resourceIds]);

  const dirty = useMemo(() => {
    if (mode === "create") {
      return Boolean(title || dueDate || note || articleIds.length || resourceIds.length);
    }
    if (!initial) return false;
    return (
      title !== initial.title ||
      status !== initial.status ||
      dueDate !== initial.dueDate ||
      note !== initial.note ||
      articleIds.join(",") !== initial.articleIds.join(",") ||
      resourceIds.join(",") !== initial.resourceIds.join(",")
    );
  }, [mode, initial, title, status, dueDate, note, articleIds, resourceIds]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const fieldErrors = state.fieldErrors ?? {};

  function toggle(list: string[], id: string, checked: boolean): string[] {
    if (checked) return list.includes(id) ? list : [...list, id];
    return list.filter((item) => item !== id);
  }

  return (
    <form ref={formRef} action={formAction} className="grid max-w-3xl gap-4">
      {mode === "edit" && initial ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="base" value={initial.revision} />
        </>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs break-words text-muted-foreground">
          任务 id：
          <span className="font-mono text-foreground">{initial?.id ?? "（按标题生成）"}</span>
          {mode === "edit" ? <span className="ml-2">（改标题不改 id）</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn("text-[11px]", dirty ? "text-warning" : "text-muted-foreground")}
            aria-live="polite"
          >
            {dirty ? "有未保存的修改" : mode === "edit" ? "没有改动" : "还没填内容"}
          </span>
          <SubmitButton label={mode === "create" ? "创建任务" : "保存"} />
        </div>
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          className="grid gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          <p className="flex items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="break-words">{state.error}</span>
          </p>
          {state.code === "stale" ? (
            <p className="pl-6 text-xs break-words text-muted-foreground">
              你可能在另一个标签页改过这条任务，或者在列表上点过状态。点下面的按钮会用当前表单覆盖磁盘上的版本。
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          标题
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={fieldClass}
            placeholder="例如：学 Transformer Attention"
            aria-invalid={Boolean(fieldErrors.title)}
          />
        </label>
        {fieldErrors.title ? (
          <p className="text-xs text-destructive">{fieldErrors.title}</p>
        ) : null}
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="text-xs text-muted-foreground">状态</legend>
        <div className="flex flex-wrap gap-2">
          {TASK_STATUSES.map((value) => (
            <label
              key={value}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1 text-xs",
                status === value
                  ? "border-primary/50 bg-primary/15 text-foreground"
                  : "border-border bg-surface text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name="status"
                value={value}
                checked={status === value}
                onChange={() => setStatus(value)}
                className="sr-only"
              />
              {TASK_STATUS_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          截止日期（可以不填）
          <input
            type="date"
            name="dueDate"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className={fieldClass}
            aria-invalid={Boolean(fieldErrors.dueDate)}
          />
        </label>
        <label className="grid gap-1.5 text-xs text-muted-foreground">
          备注
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={fieldClass}
            placeholder="想记下来的上下文（最长 500 字）"
          />
        </label>
      </div>
      {fieldErrors.dueDate ? (
        <p className="text-xs text-destructive">{fieldErrors.dueDate}</p>
      ) : null}

      <LinkPicker
        legend="关联笔记（可多选）"
        name="articleIds"
        options={articles}
        selected={articleIds}
        onToggle={(id, checked) => setArticleIds((list) => toggle(list, id, checked))}
        emptyHint="还没有笔记可关联 —— 先去知识库写一篇。"
      />

      <LinkPicker
        legend="关联资源（可多选）"
        name="resourceIds"
        options={resources}
        selected={resourceIds}
        onToggle={(id, checked) => setResourceIds((list) => toggle(list, id, checked))}
        emptyHint="还没有资源可关联 —— 先去资源收藏存一条。"
      />

      {state.code === "stale" ? (
        <div>
          <Button type="submit" name="force" value="1" variant="destructive" size="sm">
            仍然覆盖
          </Button>
        </div>
      ) : null}
    </form>
  );
}
