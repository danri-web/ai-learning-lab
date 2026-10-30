import type { Metadata } from "next";
import { BookOpen, ExternalLink, Library, ListChecks, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { listArticles } from "@/lib/content/articles";
import { formatLocalDate } from "@/lib/content/clock";
import { readResources } from "@/lib/content/resources";
import { dueInfo, readTasks, sortTasks, summarizeTasks } from "@/lib/content/tasks";
import { TASK_STATUS_DOTS, TASK_STATUS_LABELS } from "@/lib/content/task-types";
import { resourceHost } from "@/lib/security/resource-url";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "总览" };
export const dynamic = "force-dynamic";

const RECENT = 3;
const ACTIVE_TASKS = 4;

function EmptyLine({ text, href, cta }: { text: string; href: string; cta: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      {text}{" "}
      <Link href={href} className="text-primary hover:underline">
        {cta}
      </Link>
    </p>
  );
}

export default async function DashboardPage() {
  const today = formatLocalDate(new Date());
  const [{ articles }, { resources, problem: resourceProblem }, { tasks, problem: taskProblem }] =
    await Promise.all([listArticles(), readResources(), readTasks()]);

  const summary = summarizeTasks(tasks, today);
  const searchable = articles.length + resources.length;
  const problems = [resourceProblem, taskProblem].filter((item): item is string => Boolean(item));

  // 最近笔记：按 updatedAt 倒序（listArticles 已经排好）
  const recentArticles = articles.slice(0, RECENT);
  const recentResources = [...resources]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title, "zh-CN"))
    .slice(0, RECENT);

  // 「进行中的任务」= 进行中 + 逾期的待办；按截止日期排，没日期的沉底
  const activeTasks = sortTasks(
    tasks.filter((task) => task.status === "doing" || (task.status === "todo" && task.dueDate)),
    "due",
  )
    .filter((task) => task.status !== "done")
    .slice(0, ACTIVE_TASKS);

  const stats = [
    {
      label: "知识笔记",
      value: articles.length,
      hint:
        articles.length > 0
          ? `最近更新 ${articles[0].updatedAt}`
          : "还没有笔记，去知识库写一篇",
      icon: BookOpen,
      href: "/knowledge",
    },
    {
      label: "资源收藏",
      value: resources.length,
      hint: resources.length > 0 ? `最近更新 ${recentResources[0]?.updatedAt ?? "—"}` : "还没有收藏",
      icon: Library,
      href: "/resources",
    },
    {
      label: "学习任务",
      value: summary.total,
      hint:
        summary.total > 0
          ? `完成 ${summary.done}${summary.overdue > 0 ? ` · 逾期 ${summary.overdue}` : ""}`
          : "还没有任务",
      icon: ListChecks,
      href: "/learning",
    },
    {
      label: "可搜索条目",
      value: searchable,
      hint: "笔记 + 资源，Ctrl+K 直接搜",
      icon: Search,
      href: "/knowledge",
    },
  ] as const;

  return (
    <>
      <PageHeader
        title="总览"
        en="Dashboard"
        description="数字都是从文件里现算的（笔记 / 资源 / 任务各读各的），没有缓存、也没有假数据。"
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/learning/new">新建任务</Link>
          </Button>
        }
      />

      {problems.length > 0 ? (
        <section
          aria-label="数据文件的问题"
          className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
        >
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert aria-hidden className="size-3.5 text-warning" />
            有数据文件读不出来，下面的数字只统计了能读的部分
          </p>
          <ul className="mt-1.5 grid gap-1 pl-5 text-muted-foreground">
            {problems.map((problem) => (
              <li key={problem} className="break-words">
                {problem}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-label="统计" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className="rounded-lg border border-border bg-surface p-4 hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{stat.label}</span>
                <Icon aria-hidden className="size-3.5 text-muted-foreground" />
              </span>
              <span className="mt-2 block text-2xl font-semibold tabular-nums">{stat.value}</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">{stat.hint}</span>
            </Link>
          );
        })}
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="recent-notes">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="recent-notes" className="text-sm font-medium">
              最近笔记
            </h2>
            <Link href="/knowledge" className="text-[11px] text-muted-foreground hover:text-foreground">
              全部
            </Link>
          </div>
          {recentArticles.length === 0 ? (
            <EmptyLine text="还没有笔记。" href="/knowledge/new" cta="写第一篇" />
          ) : (
            <ul className="grid gap-2">
              {recentArticles.map((article) => (
                <li key={article.id}>
                  <Link
                    href={`/knowledge/${encodeURIComponent(article.id)}`}
                    className="block rounded-lg border border-border bg-surface px-3 py-2 hover:border-primary/40"
                  >
                    <span className="block text-sm break-words text-foreground">{article.title}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {article.category} · 更新于 {article.updatedAt}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="active-tasks">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="active-tasks" className="text-sm font-medium">
              进行中的任务
            </h2>
            <Link href="/learning" className="text-[11px] text-muted-foreground hover:text-foreground">
              全部
            </Link>
          </div>
          {activeTasks.length === 0 ? (
            <EmptyLine
              text={summary.total > 0 ? "没有进行中的任务。" : "还没有任务。"}
              href="/learning/new"
              cta="建一条"
            />
          ) : (
            <ul className="grid gap-2">
              {activeTasks.map((task) => {
                const due = dueInfo(task, today);
                return (
                  <li key={task.id}>
                    <Link
                      href={`/learning/${encodeURIComponent(task.id)}/edit`}
                      className="block rounded-lg border border-border bg-surface px-3 py-2 hover:border-primary/40"
                    >
                      <span className="flex items-center gap-1.5 text-sm break-words text-foreground">
                        <span
                          aria-hidden
                          className={cn("size-1.5 shrink-0 rounded-full", TASK_STATUS_DOTS[task.status])}
                        />
                        {task.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {TASK_STATUS_LABELS[task.status]}
                        <span aria-hidden> · </span>
                        <span className={due.tone === "overdue" ? "text-danger" : undefined}>
                          {due.text}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-resources" className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 id="recent-resources" className="text-sm font-medium">
              最近资源
            </h2>
            <Link href="/resources" className="text-[11px] text-muted-foreground hover:text-foreground">
              全部
            </Link>
          </div>
          {recentResources.length === 0 ? (
            <EmptyLine text="还没有收藏。" href="/resources/new" cta="收藏一条" />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {recentResources.map((resource) => (
                <li key={resource.id}>
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-full flex-col rounded-lg border border-border bg-surface px-3 py-2 hover:border-primary/40"
                  >
                    <span className="flex items-start gap-1.5 text-sm break-words text-foreground">
                      {resource.title}
                      <ExternalLink aria-hidden className="mt-1 size-3 shrink-0 text-muted-foreground" />
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {resourceHost(resource.url)} · {resource.category}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
