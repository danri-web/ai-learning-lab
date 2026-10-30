"use client";

import { cn } from "cn";
import { Save, TriangleAlert } from "lucide-react";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  INITIAL_RESOURCE_FORM_STATE,
  type ResourceFormState,
} from "@/features/resources/form-state";
import { RESOURCE_TYPES, RESOURCE_TYPE_LABELS } from "@/lib/content/resource-types";
import { resourceHost } from "@/lib/security/resource-url";

/**
 * 资源收藏的表单（新建 / 编辑）。
 *
 * 与笔记编辑器同一个骨架：`useActionState`（失败不丢输入）+ 未保存提醒 + 过期保存的「仍然覆盖」。
 * 少了实时预览（资源没有正文），多了类型选择和"关联笔记"。
 */

export type ResourceFormInitial = {
  id: string;
  title: string;
  url: string;
  type: string;
  category: string;
  tags: string[];
  description: string;
  articleId: string;
  /** 打开这条资源时的指纹（`resourceRevision`），保存时带回去做冲突检查 */
  revision: string;
};

export type ArticleOption = { id: string; title: string };

type Props = {
  mode: "create" | "edit";
  action: (prev: ResourceFormState, formData: FormData) => Promise<ResourceFormState>;
  initial?: ResourceFormInitial;
  articles: ArticleOption[];
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

export function ResourceForm({ mode, action, initial, articles }: Props) {
  const [state, formAction] = useActionState(action, INITIAL_RESOURCE_FORM_STATE);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [type, setType] = useState(initial?.type ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [articleId, setArticleId] = useState(initial?.articleId ?? "");

  const dirty = useMemo(() => {
    if (mode === "create") {
      return Boolean(title || url || type || category || tags || description || articleId);
    }
    if (!initial) return false;
    return (
      title !== initial.title ||
      url !== initial.url ||
      type !== initial.type ||
      category !== initial.category ||
      tags !== initial.tags.join(", ") ||
      description !== initial.description ||
      articleId !== initial.articleId
    );
  }, [mode, initial, title, url, type, category, tags, description, articleId]);

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
  const host = resourceHost(url);

  return (
    <form action={formAction} className="grid max-w-3xl gap-4">
      {mode === "edit" && initial ? (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="base" value={initial.revision} />
        </>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs break-words text-muted-foreground">
          资源 id：
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
          <SubmitButton label={mode === "create" ? "收藏" : "保存"} />
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
                你的内容还在下面（没丢）。可以覆盖磁盘上的版本，或者先回列表看看改了什么。
              </span>
              <Button type="submit" name="force" value="1" variant="destructive" size="xs">
                仍然覆盖
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

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
          placeholder="例如：Attention Is All You Need"
          aria-invalid={fieldErrors.title ? true : undefined}
          className={fieldClass}
        />
        {fieldErrors.title ? <p className="text-xs text-destructive">{fieldErrors.title}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="url" className="text-xs font-medium text-muted-foreground">
          链接（只接受 http / https）
        </label>
        <input
          id="url"
          name="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          inputMode="url"
          autoComplete="off"
          placeholder="https://arxiv.org/abs/1706.03762"
          aria-invalid={fieldErrors.url ? true : undefined}
          className={cn(fieldClass, "font-mono text-[13px]")}
        />
        <p className="text-[11px] break-words text-muted-foreground">
          {host ? `域名：${host}（应用不会去抓取这个地址）` : "填完整地址，例如 https://…"}
        </p>
        {fieldErrors.url ? <p className="text-xs text-destructive">{fieldErrors.url}</p> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <label htmlFor="type" className="text-xs font-medium text-muted-foreground">
            类型
          </label>
          <select
            id="type"
            name="type"
            value={type}
            onChange={(event) => setType(event.target.value)}
            aria-invalid={fieldErrors.type ? true : undefined}
            className={fieldClass}
          >
            <option value="">（选择类型）</option>
            {RESOURCE_TYPES.map((value) => (
              <option key={value} value={value}>
                {RESOURCE_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
          {fieldErrors.type ? <p className="text-xs text-destructive">{fieldErrors.type}</p> : null}
        </div>

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
        {fieldErrors.tags ? <p className="text-xs text-destructive">{fieldErrors.tags}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="description" className="text-xs font-medium text-muted-foreground">
          描述（可选，最多 500 字）
        </label>
        <textarea
          id="description"
          name="description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          maxLength={500}
          placeholder="一句话说明它是什么、为什么值得留着"
          aria-invalid={fieldErrors.description ? true : undefined}
          className={cn(fieldClass, "resize-y")}
        />
        {fieldErrors.description ? (
          <p className="text-xs text-destructive">{fieldErrors.description}</p>
        ) : null}
      </div>

      <div className="grid gap-1.5">
        <label htmlFor="articleId" className="text-xs font-medium text-muted-foreground">
          关联笔记（可选）
        </label>
        <select
          id="articleId"
          name="articleId"
          value={articleId}
          onChange={(event) => setArticleId(event.target.value)}
          aria-invalid={fieldErrors.articleId ? true : undefined}
          className={fieldClass}
        >
          <option value="">（不关联）</option>
          {articles.map((article) => (
            <option key={article.id} value={article.id}>
              {article.title}
            </option>
          ))}
        </select>
        {fieldErrors.articleId ? (
          <p className="text-xs text-destructive">{fieldErrors.articleId}</p>
        ) : null}
      </div>
    </form>
  );
}
