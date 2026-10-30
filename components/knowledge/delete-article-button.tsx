"use client";

import { Trash2, TriangleAlert } from "lucide-react";
import { useActionState, useId, useRef } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE, type FormState } from "@/features/articles/form-state";

/**
 * 删除确认（需求书 §6「删除确认」）。
 *
 * 用原生 `<dialog>` 而不是 `window.confirm`：
 *   - 焦点被困在对话框里、Esc 关闭、背后内容不可点，这些浏览器已经做好
 *   - 样式跟站点一致，而不是浏览器默认的「127.0.0.1 说…」
 *
 * 注意说明文字要讲清楚「不是真删」：文件被移到 `content/articles/.trash/`，
 * 用户才敢按下去（这份数据没有数据库兜底）。
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

export function DeleteArticleButton({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, INITIAL_FORM_STATE);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Trash2 aria-hidden />
        删除
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby={headingId}
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border bg-elevated p-5 text-foreground backdrop:bg-black/60"
      >
        <h2 id={headingId} className="text-sm font-semibold">
          删除这篇笔记？
        </h2>
        <p className="mt-2 text-sm break-words text-muted-foreground">
          「{title}」会被移到{" "}
          <span className="font-mono text-foreground">content/articles/.trash/</span>， 不会真的删掉
          —— 想找回来直接把它从那里拖回来就行。
        </p>

        <form action={formAction} className="mt-5 flex justify-end gap-2">
          <input type="hidden" name="id" value={id} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => dialogRef.current?.close()}
          >
            取消
          </Button>
          <ConfirmButton />
        </form>

        {state.status === "error" ? (
          <p
            role="alert"
            className="mt-3 flex items-start gap-1.5 text-xs break-words text-destructive"
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {state.error}
          </p>
        ) : null}
      </dialog>
    </>
  );
}
