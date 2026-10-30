import type { Metadata } from "next";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArticleEditor } from "@/components/knowledge/article-editor";
import { PageHeader } from "@/components/layout/page-header";
import { readArticle } from "@/lib/content/articles";
import { articleIdFromParam } from "@/lib/content/id";
import { saveArticleAction } from "../../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const result = await readArticle(articleIdFromParam(id)).catch(() => null);
  return { title: result?.ok ? `编辑：${result.article.title}` : "编辑笔记" };
}

export default async function EditArticlePage({ params }: Props) {
  const { id } = await params;
  const articleId = articleIdFromParam(id);
  const result = await readArticle(articleId);

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
            这篇笔记读不出来，所以也不能编辑
          </p>
          <p className="mt-2 font-mono text-xs break-words text-muted-foreground">{articleId}.md</p>
          <p className="mt-3 text-sm break-words text-foreground">{result.error}</p>
        </div>
      </div>
    );
  }

  const { article } = result;

  return (
    <>
      <PageHeader
        title="编辑笔记"
        en="Edit"
        description="保存会直接改写这个 Markdown 文件（原子写入：要么是旧版本，要么是新版本，不会留半截）。"
      />
      <div className="mt-6">
        <ArticleEditor
          mode="edit"
          action={saveArticleAction}
          initial={{
            id: article.id,
            title: article.title,
            category: article.category,
            tags: article.tags,
            body: article.body,
          }}
        />
      </div>
    </>
  );
}
