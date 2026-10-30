"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import { useActionState, useId, useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { INITIAL_TASK_FORM_STATE, type TaskFormState } from "@/features/tasks/form-state";

/**
 * 删除任务的确认（同笔记、资源的删除对话框）。
 * 说明文字必须讲清楚"不是真删"：记录会追加到 `content/.trash/tasks-deleted.jsonl`。
 */
function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      <Trash2 aria-hidden />
      {pending ? "删除中…" : "确认删除"}
    </Button>
  );
}

export function DeleteTaskButton({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action: (prev: TaskFormState, formData: FormData) => Promise<TaskFormState>;
}) {
  const [state, formAction] = useActionState(action, INITIAL_TASK_FORM_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => dialogRef.current?.showModal()}>
        <Trash2 aria-hidden />
        删除
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-elevated p-5 text-foreground backdrop:bg-black/60"
      >
        <h2 id={headingId} className="text-sm font-semibold">
          删除这条任务？
        </h2>
        <p className="mt-2 text-sm break-words text-muted-foreground">
          「{title}」会从列表里移除，同时把整条记录追加到{" "}
          <span className="font-mono text-foreground">content/.trash/tasks-deleted.jsonl</span>
          ，想找回来可以贴回去。
        </p>

        <form action={formAction} className="mt-5 flex justify-end gap-2">
          <input type="hidden" name="id" value={id} />
          <Button type="button" variant="ghost" size="sm" onClick={() => dialogRef.current?.close()}>
            取消
          </Button>
          <ConfirmButton />
        </form>

        {state.status === "error" ? (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-xs break-words text-destructive">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {state.error}
          </p>
        ) : null}
      </dialog>
    </>
  );
}
