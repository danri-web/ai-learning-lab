import type { Metadata } from "next";
import { ArrowLeft, Pencil, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleMarkdown } from "@/components/knowledge/article-markdown";
import { DeleteArticleButton } from "@/components/knowledge/delete-article-button";
import { Button } from "@/components/ui/button";
import { readArticle } from "@/lib/content/articles";
import { articleIdFromParam } from "@/lib/content/id";
import { stripLeadingDuplicateH1 } from "@/lib/markdown/body";
import { extractToc } from "@/lib/markdown/toc";
import { deleteArticleAction } from "../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await readArticle(articleIdFromParam(id)).catch(() => null);
  if (result?.ok) return { title: result.article.title };
  return { title: "笔记" };
}

export default async function ArticlePage({ params }: Props) {
  const { id } = await params;
  const articleId = articleIdFromParam(id);
  const result = await readArticle(articleId);

  // 没这篇 → 404；读不了/内容坏了 → 显示具体原因（比 404 有用，能告诉你怎么修）
  if (!result.ok && result.reason === "not-found") notFound();

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-2xl">
        <Link
          href="/knowledge"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          返回知识库
        </Link>
        <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert aria-hidden className="size-4 text-warning" />
            这篇笔记读不出来
          </p>
          <p className="mt-2 font-mono text-xs break-words text-muted-foreground">{articleId}.md</p>
          <p className="mt-3 text-sm break-words text-foreground">{result.error}</p>
        </div>
      </div>
    );
  }

  const { article } = result;
  // 页头已经显示标题，正文里重复的那个 H1 去掉，避免同一句话出现两遍
  const body = stripLeadingDuplicateH1(article.body, article.title);
  const toc = extractToc(body);

  return (
    <article className="mx-auto max-w-6xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/knowledge"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          返回知识库
        </Link>

        <div className="flex items-center gap-1.5">
          <Button asChild variant="outline" size="sm">
            <Link href={`/knowledge/${encodeURIComponent(article.id)}/edit`}>
              <Pencil aria-hidden />
              编辑
            </Link>
          </Button>
          <DeleteArticleButton id={article.id} title={article.title} action={deleteArticleAction} />
        </div>
      </div>

      <header className="mt-4 border-b border-border pb-5">
        <h1 className="text-2xl font-semibold tracking-tight break-words md:text-3xl">
          {article.title}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{article.category}</span>
          <span aria-hidden>·</span>
          <span>
            创建 {article.createdAt} · 更新 {article.updatedAt}
          </span>
          <span aria-hidden>·</span>
          <span className="font-mono">{article.id}</span>
        </p>
        {article.tags.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {article.tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0">
          <ArticleMarkdown body={body} />
        </div>

        {toc.length > 1 ? (
          <aside aria-label="文章目录" className="hidden lg:block">
            <div className="sticky top-20">
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">目录</p>
              <ul className="mt-2 space-y-1 border-l border-border pl-3">
                {toc.map((entry) => (
                  <li key={entry.id} className={entry.level === 3 ? "pl-3" : undefined}>
                    <a
                      href={`#${entry.id}`}
                      className="block text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {entry.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        ) : null}
      </div>
    </article>
  );
}
