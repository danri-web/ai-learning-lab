"use client";

import { CornerDownLeft, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { searchAction } from "@/app/(workspace)/search-actions";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { type Range, type SearchResult } from "@/lib/search/query";
import type { SearchResponse } from "@/lib/search/contract";

/**
 * `Ctrl+K` 搜索弹窗（阶段 5）。
 *
 * 三条来自需求书 §6 的硬要求，都在这里落地：
 * - **键盘可操作**：↑↓ 选、Enter 打开、Esc 关闭、焦点可见（焦点跑不掉，Radix 圈着）
 * - **加载 / 空 / 错误状态**：一个都不省（错误是"读不出来"，不是"没找到"）
 * - **中文输入法**：组字期间的回车是"选词"，**不能**当成"打开第一条"
 *
 * 还有一条不那么显眼：迟到的搜索结果不许覆盖新的（`seq` 计数），
 * 否则快手打字会看到"回退到上一次的结果"。
 */

const DEBOUNCE_MS = 140;

/** 高亮：只按区间切片，绝不拼 HTML 字符串（源码闸门禁止把 HTML 塞进 DOM） */
function Highlight({ text, ranges }: { text: string; ranges: Range[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark
        key={`${range.start}-${range.end}`}
        className="rounded-sm bg-primary/25 px-0.5 text-foreground"
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

const FIELD_LABELS: Record<string, string> = {
  title: "标题",
  tags: "标签",
  category: "分类",
  url: "链接",
  text: "正文",
};

function hrefOf(item: SearchResult): string {
  return item.kind === "article" ? `/knowledge/${encodeURIComponent(item.id)}` : (item.url ?? "#");
}

export function SearchCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const seqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Ctrl+K / ⌘K：在任何页面都能叫出来，再按一次收起
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // 关掉时清空：下次打开是干净的，不会看到上一次的旧结果。
  // 顺手把 seq 推进一格 —— 已经在飞的请求回来时会被当成"迟到"丢掉。
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      seqRef.current += 1;
      setQuery("");
      setResponse(null);
      setError(null);
      setPending(false);
      setActive(0);
    }
  }, []);

  // 防抖 + 迟到结果丢弃；换查询、换刷新记号都会重跑。
  // 空查询的清理放在 onChange 里（事件里改状态，不是 effect 里 —— 否则会级联渲染）。
  useEffect(() => {
    if (!open) return;
    if (query.trim().length === 0) return;

    const seq = ++seqRef.current;

    const timer = setTimeout(() => {
      setPending(true);
      searchAction(query)
        .then((next) => {
          if (seq !== seqRef.current) return;
          setResponse(next);
          setError(null);
          setPending(false);
          setActive(0);
        })
        .catch((cause: unknown) => {
          if (seq !== seqRef.current) return;
          setError(cause instanceof Error ? cause.message : "搜索失败，看看开发服务器还在不在");
          setPending(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, open, refreshToken]);

  const results = response?.outcome.state === "done" ? response.outcome.results : [];
  const articles = results.filter((item) => item.kind === "article");
  const resources = results.filter((item) => item.kind === "resource");
  const flat = [...articles, ...resources];

  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const openItem = useCallback(
    (item: SearchResult) => {
      handleOpenChange(false);
      if (item.kind === "resource") {
        if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
        return;
      }
      router.push(hrefOf(item));
    },
    [handleOpenChange, router],
  );

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 中文输入法组字中：这些键属于输入法（回车在选词），不是我们的快捷键
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (flat.length === 0 ? 0 : Math.min(index + 1, flat.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const item = flat[active];
      if (item) {
        event.preventDefault();
        openItem(item);
      }
    }
  };

  const tooLong = response?.outcome.state === "too-long" ? response.outcome.limit : null;
  const activeId = flat.length > 0 ? `search-option-${active}` : undefined;

  function renderRow(item: SearchResult, index: number) {
    const isActive = index === active;
    const hitFields = item.matched
      .filter((field) => field !== "text")
      .map((field) => FIELD_LABELS[field]);
    return (
      <a
        key={`${item.kind}-${item.id}`}
        id={`search-option-${index}`}
        data-index={index}
        role="option"
        aria-selected={isActive}
        href={hrefOf(item)}
        target={item.kind === "resource" ? "_blank" : undefined}
        rel={item.kind === "resource" ? "noopener noreferrer" : undefined}
        onMouseEnter={() => setActive(index)}
        onClick={(event) => {
          event.preventDefault();
          openItem(item);
        }}
        className={cn(
          "block rounded-md px-3 py-2 outline-none",
          isActive ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-surface",
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-medium break-words text-foreground">
            <Highlight text={item.title} ranges={item.titleRanges} />
          </span>
          {hitFields.length > 0 ? (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {hitFields.join(" · ")}
            </span>
          ) : null}
        </span>
        {item.excerpt ? (
          <span className="mt-0.5 line-clamp-2 block text-xs break-words text-muted-foreground">
            <Highlight text={item.excerpt} ranges={item.excerptRanges} />
          </span>
        ) : null}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        aria-label="搜索笔记与资源（Ctrl+K）"
        className="relative flex h-8 w-9 shrink-0 items-center justify-center gap-2 rounded-md border border-input bg-surface text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:w-full md:justify-start md:px-3"
      >
        <Search aria-hidden className="size-4 shrink-0" />
        <span className="hidden truncate md:inline">搜索笔记与资源</span>
        <kbd
          aria-hidden
          className="absolute top-1/2 right-2 hidden -translate-y-1/2 rounded border border-border bg-elevated px-1.5 py-0.5 text-[10px] md:block"
        >
          Ctrl K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="top-[10vh] left-1/2 max-h-[80vh] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">搜索笔记与资源</DialogTitle>
          <DialogDescription className="sr-only">
            输入关键词搜索全部笔记正文与资源；↑↓ 选择，Enter 打开，Esc 关闭。
          </DialogDescription>

          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => {
                const next = event.target.value;
                setQuery(next);
                if (next.trim().length === 0) {
                  // 清空要**立刻**回到提示态，不能等 140ms 防抖
                  seqRef.current += 1;
                  setResponse(null);
                  setError(null);
                  setPending(false);
                  setActive(0);
                }
              }}
              onKeyDown={onInputKeyDown}
              type="text"
              role="combobox"
              aria-expanded={open}
              aria-controls="search-results"
              aria-activedescendant={activeId}
              aria-autocomplete="list"
              aria-label="搜索关键词"
              placeholder="搜索笔记与资源（中文短词也行）"
              className="h-12 w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {pending ? (
              <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
            <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
              Esc
            </kbd>
          </div>

          <div
            id="search-results"
            ref={listRef}
            role="listbox"
            aria-label="搜索结果"
            aria-busy={pending}
            className="min-h-24 flex-1 overflow-y-auto overscroll-contain p-1"
          >
            {error ? (
              <p className="flex items-start gap-2 px-3 py-4 text-xs text-danger">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="break-words">搜索出错了：{error}</span>
              </p>
            ) : tooLong ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                查询太长（最多 {tooLong} 个字）。这么长的东西更适合直接写进笔记。
              </p>
            ) : query.trim().length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                <p>输入关键词开始搜索：笔记的标题、分类、标签、正文，以及资源的标题、描述、标签、链接。</p>
                <p className="mt-1">中文短词直接搜，不用分词（「模型」「机制」都能命中）。</p>
              </div>
            ) : (
              <>
                {response && response.problems.length > 0 ? (
                  <p
                    className="flex items-start gap-2 px-3 py-2 text-[11px] text-warning"
                    title={response.problems.map((problem) => `${problem.file}：${problem.error}`).join("\n")}
                  >
                    <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      有 {response.problems.length} 个文件读不出来，它们不在结果里（其余结果不受影响）
                    </span>
                  </p>
                ) : null}

                {flat.length === 0 ? (
                  // 注意：还没拿到结果（response 为空）**不等于**"没找到" ——
                  // 防抖的 140ms + 一次往返之间，说"没有找到"是在撒谎。
                  !response || pending ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">搜索中…</p>
                  ) : (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                      没有找到「{query.trim()}」。试试短一点的关键词，或者只搜标签。
                    </p>
                  )
                ) : (
                  <>
                    {articles.length > 0 ? (
                      <div role="presentation" className="px-3 pt-2 pb-1 text-[11px] text-muted-foreground">
                        笔记 {articles.length}
                      </div>
                    ) : null}
                    {articles.map((item, index) => renderRow(item, index))}

                    {resources.length > 0 ? (
                      <div role="presentation" className="px-3 pt-2 pb-1 text-[11px] text-muted-foreground">
                        资源 {resources.length}
                      </div>
                    ) : null}
                    {resources.map((item, index) => renderRow(item, articles.length + index))}
                  </>
                )}

                {response?.outcome.state === "done" && response.outcome.truncated ? (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground">
                    结果太多，只显示前 {flat.length} 条 —— 再加一个关键词收窄一下。
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1">↑</kbd>
              <kbd className="rounded border border-border px-1">↓</kbd>
              选择
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft aria-hidden className="size-3" />
              打开
            </span>
            <span className="ml-auto flex items-center gap-2">
              {response ? (
                <span>
                  已扫描 {response.counts.articles} 篇笔记 / {response.counts.resources} 条资源 ·{" "}
                  {response.tookMs} ms
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setRefreshToken((token) => token + 1)}
                disabled={pending || query.trim().length === 0}
                className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-primary/40 hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw aria-hidden className="size-3" />
                重新扫描
              </button>
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
