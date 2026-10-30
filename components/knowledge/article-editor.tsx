"use client";

import { cn } from "cn";
import { Eye, PencilLine, Save, TriangleAlert } from "lucide-react";
import { useActionState, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { ArticleMarkdown } from "@/components/knowledge/article-markdown";
import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE, type FormState } from "@/features/articles/form-state";
import { slugifyTitle } from "@/lib/content/id";

/**
 * Markdown 编辑器：左边写、右边看（窄屏切换）。
 *
 * 刻意做的几件事：
 *   - **未保存提醒**：改动过且没提交时，关标签页/刷新会弹浏览器原生确认（beforeunload）
 *   - 预览用 `useDeferredValue`：打字不卡，预览稍慢半拍可以接受
 *   - 新建时实时显示「文件名」，因为它由标题生成、创建后不再变（D3 / D7）
 *   - 表单用 Server Action + `useActionState`：保存失败时**输入不丢**，错误回到字段旁边
 */

export type EditorInitial = {
  id: string;
  title: string;
  category: string;
  tags: string[];
  body: string;
  /** 打开时的正文指纹：保存时带回去，磁盘上的正文变了就拒绝写（审计 v3 F2） */
  revision: string;
};

type Props = {
  mode: "create" | "edit";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial?: EditorInitial;
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

export function ArticleEditor({ mode, action, initial }: Props) {
  const [state, formAction] = useActionState(action, INITIAL_FORM_STATE);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [body, setBody] = useState(initial?.body ?? "");
  const [tab, setTab] = useState<"write" | "preview">("write");

  const dirty = useMemo(() => {
    if (mode === "create") return Boolean(title || category || tags || body);
    if (!initial) return false;
    return (
      title !== initial.title ||
      category !== initial.category ||
      tags !== initial.tags.join(", ") ||
      body !== initial.body
    );
  }, [mode, initial, title, category, tags, body]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // 老浏览器要靠 returnValue 才弹；现代浏览器忽略它但需要被赋值
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const deferredBody = useDeferredValue(body);
  const fieldErrors = state.fieldErrors ?? {};
  const fileName = mode === "edit" ? (initial?.id ?? "") : title.trim() ? slugifyTitle(title) : "";

  return (
    <form action={formAction} className="grid gap-6">
      {mode === "edit" && initial ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          {/* 打开这份稿子时正文的指纹：保存时比对，变了就拒绝（别静默覆盖别人的改动） */}
          <input type="hidden" name="base" value={initial.revision} />
        </>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs break-words text-muted-foreground">
          文件名：
          <span className="font-mono text-foreground">
            {fileName || "（按标题生成）"}
            {fileName ? ".md" : ""}
          </span>
          {mode === "edit" ? <span className="ml-2">（改标题不会改文件名）</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <span
            className={cn("text-[11px]", dirty ? "text-warning" : "text-muted-foreground")}
            aria-live="polite"
          >
            {dirty ? "有未保存的修改" : mode === "edit" ? "没有改动" : "还没写内容"}
          </span>
          <SubmitButton label={mode === "create" ? "创建" : "保存"} />
        </div>
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <p className="flex items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <span className="break-words">{state.error}</span>
          </p>
          {state.code === "stale" ? (
            <div className="flex flex-wrap items-center gap-2 pl-6">
              <span className="text-xs break-words text-muted-foreground">
                你的稿子还在下面（没丢）。可以选择覆盖磁盘上的版本，或者先打开那篇看看改了什么。
              </span>
              <Button type="submit" name="force" value="1" variant="destructive" size="xs">
                仍然覆盖
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 写 */}
        <div className={cn("grid min-w-0 gap-3", tab === "preview" && "hidden lg:grid")}>
          <div className="grid gap-1.5">
            <label htmlFor="title" className="text-xs font-medium text-muted-foreground">
              标题
            </label>
            <input
              id="title"
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              autoComplete="off"
              placeholder="例如：Transformer 的注意力机制"
              aria-invalid={fieldErrors.title ? true : undefined}
              className={fieldClass}
            />
            {fieldErrors.title ? (
              <p className="text-xs text-destructive">{fieldErrors.title}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="category" className="text-xs font-medium text-muted-foreground">
                分类
              </label>
              <input
                id="category"
                name="category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={60}
                autoComplete="off"
                placeholder="Deep Learning"
                aria-invalid={fieldErrors.category ? true : undefined}
                className={fieldClass}
              />
              {fieldErrors.category ? (
                <p className="text-xs text-destructive">{fieldErrors.category}</p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="tags" className="text-xs font-medium text-muted-foreground">
                标签（逗号或换行分隔）
              </label>
              <input
                id="tags"
                name="tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                autoComplete="off"
                placeholder="Transformer, Attention"
                aria-invalid={fieldErrors.tags ? true : undefined}
                className={fieldClass}
              />
              {fieldErrors.tags ? (
                <p className="text-xs text-destructive">{fieldErrors.tags}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 lg:justify-start">
            <span className="text-xs font-medium text-muted-foreground">正文（Markdown）</span>
            <div className="flex gap-1 lg:hidden">
              <Button
                type="button"
                variant={tab === "write" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setTab("write")}
              >
                <PencilLine aria-hidden />写
              </Button>
              <Button
                type="button"
                variant={tab === "preview" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setTab("preview")}
              >
                <Eye aria-hidden />看
              </Button>
            </div>
          </div>
          <textarea
            id="body"
            name="body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={22}
            spellCheck={false}
            placeholder={"# 小标题\n\n正文。支持表格、代码块、$公式$。"}
            aria-invalid={fieldErrors.body ? true : undefined}
            className={cn(fieldClass, "min-h-80 resize-y font-mono text-[13px] leading-relaxed")}
          />
          {fieldErrors.body ? <p className="text-xs text-destructive">{fieldErrors.body}</p> : null}
        </div>

        {/* 看 */}
        <div
          className={cn(
            "min-w-0 rounded-lg border border-border bg-surface/40 p-4",
            tab === "write" && "hidden lg:block",
            "lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto",
          )}
        >
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">预览</p>
          {deferredBody.trim() ? (
            <div className="mt-3">
              <ArticleMarkdown body={deferredBody} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">正文写在这里会实时渲染。</p>
          )}
        </div>
      </div>
    </form>
  );
}
