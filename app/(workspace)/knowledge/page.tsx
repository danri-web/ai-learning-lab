import type { Metadata } from "next";
import { BookOpen, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listArticles } from "@/lib/content/articles";

export const metadata: Metadata = { title: "知识库" };
export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const { articles, problems, missingRoot } = await listArticles();

  return (
    <>
      <PageHeader
        title="知识库"
        en="Knowledge"
        description="读的是 content/articles/ 下的 Markdown 文件本身 —— 没有数据库，你用任何编辑器改完刷新就能看到。"
        action={
          <Button variant="outline" size="sm" disabled title="阶段 3b 启用">
            <Plus aria-hidden />
            新建笔记
          </Button>
        }
      />

      {problems.length > 0 ? (
        <section
          aria-label="解析失败的文件"
          className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert aria-hidden className="size-4 text-warning" />
            {problems.length} 个文件没读出来（其它笔记不受影响）
          </p>
          <ul className="mt-2 space-y-1.5">
            {problems.map((problem) => (
              <li key={problem.file} className="text-xs break-words text-muted-foreground">
                <span className="font-mono text-foreground">{problem.file}</span> — {problem.error}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6">
        {missingRoot ? (
          <EmptyState
            icon={<BookOpen aria-hidden className="size-5" />}
            title="还没有正文目录"
            description="建一个 content/articles/ 目录，把 .md 文件丢进去就会出现在这里。这个目录不进主仓库（它属于你自己的私有仓库）。"
            stage="阶段 3a"
          />
        ) : articles.length === 0 ? (
          <EmptyState
            icon={<BookOpen aria-hidden className="size-5" />}
            title="还没有笔记"
            description="往 content/articles/ 里放一个 .md 文件，刷新这一页就会看到。文件名就是 id，frontmatter 里的 id 必须和它一致。"
            stage="阶段 3a"
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {articles.map((article) => (
              <li key={article.id}>
                <Link
                  href={`/knowledge/${article.id}`}
                  className="flex h-full flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-primary/40 hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="text-sm font-medium break-words text-foreground">
                    {article.title}
                  </span>
                  <span className="mt-1 text-[11px] text-muted-foreground">
                    {article.category} · 更新于 {article.updatedAt}
                  </span>
                  {article.tags.length > 0 ? (
                    <span className="mt-3 flex flex-wrap gap-1.5">
                      {article.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
