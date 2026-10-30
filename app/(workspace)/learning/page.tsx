import type { Metadata } from "next";
import { Link2, ListChecks, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { DeleteTaskButton } from "@/components/tasks/delete-task-button";
import { TaskStatusSelect } from "@/components/tasks/task-status-select";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { listArticles } from "@/lib/content/articles";
import { formatLocalDate } from "@/lib/content/clock";
import { readResources } from "@/lib/content/resources";
import {
  TASK_SORT_LABELS,
  dueInfo,
  filterTasks,
  isTaskSort,
  readTasks,
  sortTasks,
  summarizeTasks,
  type TaskSort,
} from "@/lib/content/tasks";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isTaskStatus,
  type TaskStatus,
} from "@/lib/content/task-types";
import { cn } from "@/lib/utils";
import { deleteTaskAction, setTaskStatusAction } from "./actions";

export const metadata: Metadata = { title: "学习任务" };
export const dynamic = "force-dynamic";

type Params = { status?: string; sort?: string };
const SORTS: TaskSort[] = ["due", "updated", "created"];

function hrefWith(params: Params, patch: Partial<Params>): string {
  const next: Params = { ...params, ...patch };
  const search = new URLSearchParams();
  for (const key of ["status", "sort"] as const) {
    const value = next[key];
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/learning?${qs}` : "/learning";
}

function chipClass(active: boolean): string {
  return active
    ? "rounded-full border border-primary/50 bg-primary/15 px-2.5 py-1 text-[11px] text-foreground"
    : "rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground";
}

const TONE_CLASS: Record<string, string> = {
  none: "text-muted-foreground",
  normal: "text-muted-foreground",
  soon: "text-warning",
  overdue: "text-danger",
};

export default async function LearningPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const today = formatLocalDate(new Date());

  const [{ tasks, problem, missing }, { articles }, { resources }] = await Promise.all([
    readTasks(),
    listArticles(),
    readResources(),
  ]);

  const activeStatus: TaskStatus | undefined = isTaskStatus(params.status)
    ? params.status
    : undefined;
  const sort: TaskSort = isTaskSort(params.sort) ? params.sort : "due";

  const summary = summarizeTasks(tasks, today);
  const visible = sortTasks(filterTasks(tasks, { status: activeStatus }), sort);

  const articleTitles = new Map(articles.map((article) => [article.id.toLowerCase(), article.title]));
  const resourceTitles = new Map(
    resources.map((resource) => [resource.id.toLowerCase(), resource.title]),
  );

  return (
    <>
      <PageHeader
        title="学习任务"
        en="Learning"
        description="每一条任务就是一个要学的东西：三档状态、截止日期，以及它关联的笔记与资源。数据在 content/tasks.json（文件是真相，原子写入）。"
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/learning/new">
              <Plus aria-hidden />
              新建任务
            </Link>
          </Button>
        }
      />

      {problem ? (
        <section
          aria-label="任务文件的问题"
          className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert aria-hidden className="size-4 text-warning" />
            content/tasks.json 现在读不出来（为免把坏文件覆盖掉，暂时不能新增/编辑）
          </p>
          <p className="mt-2 text-xs break-words text-muted-foreground">{problem}</p>
        </section>
      ) : null}

      {tasks.length > 0 ? (
        <>
          <p className="mt-5 text-xs text-muted-foreground">
            待办 {summary.todo} · 进行中 {summary.doing} · 已完成 {summary.done}
            {summary.overdue > 0 ? (
              <span className="text-danger"> · 逾期 {summary.overdue}</span>
            ) : null}
          </p>

          <section aria-label="筛选与排序" className="mt-3 grid gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-muted-foreground">状态</span>
              <Link href={hrefWith(params, { status: undefined })} className={chipClass(!activeStatus)}>
                全部 {summary.total}
              </Link>
              {TASK_STATUSES.map((status) => (
                <Link
                  key={status}
                  href={hrefWith(params, { status: activeStatus === status ? undefined : status })}
                  className={chipClass(activeStatus === status)}
                >
                  {TASK_STATUS_LABELS[status]} {summary[status]}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-muted-foreground">排序</span>
              {SORTS.map((value) => (
                <Link
                  key={value}
                  href={hrefWith(params, { sort: value })}
                  className={chipClass(sort === value)}
                >
                  {TASK_SORT_LABELS[value]}
                </Link>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <div className="mt-5">
        {missing || tasks.length === 0 ? (
          <EmptyState
            icon={<ListChecks aria-hidden className="size-5" />}
            title="还没有任务"
            description="不会有甘特图、复杂项目管理、AI 排课 —— 只有这三档状态、一个截止日期，以及关联的笔记与资源。"
            stage="阶段 6"
            action={
              <Button asChild size="sm">
                <Link href="/learning/new">
                  <Plus aria-hidden />
                  建第一条任务
                </Link>
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<ListChecks aria-hidden className="size-5" />}
            title="这个状态下没有任务"
            description="换个状态看看，或者建一条新的。"
            stage="阶段 6"
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/learning">看全部</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3">
            {visible.map((task) => {
              const due = dueInfo(task, today);
              const linkedArticles = task.articleIds.map((id) => ({
                id,
                title: articleTitles.get(id.toLowerCase()),
              }));
              const linkedResources = task.resourceIds.map((id) => ({
                id,
                title: resourceTitles.get(id.toLowerCase()),
              }));
              const linkCount = linkedArticles.length + linkedResources.length;

              return (
                <li key={task.id}>
                  <article
                    className={cn(
                      "rounded-lg border p-4",
                      task.status === "done"
                        ? "border-border/60 bg-surface/60"
                        : "border-border bg-surface",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3
                          className={cn(
                            "text-sm font-medium break-words",
                            task.status === "done"
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                          )}
                        >
                          {task.title}
                        </h3>
                        <p className="mt-1 text-[11px] break-words text-muted-foreground">
                          <span className={TONE_CLASS[due.tone]}>{due.text}</span>
                          <span aria-hidden> · </span>
                          更新于 {task.updatedAt}
                          {linkCount > 0 ? (
                            <>
                              <span aria-hidden> · </span>
                              <Link2 aria-hidden className="inline size-3 align-[-1px]" />{" "}
                              {linkCount} 个关联
                            </>
                          ) : null}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        <TaskStatusSelect
                          id={task.id}
                          status={task.status}
                          action={setTaskStatusAction}
                        />
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/learning/${encodeURIComponent(task.id)}/edit`}>编辑</Link>
                        </Button>
                        <DeleteTaskButton
                          id={task.id}
                          title={task.title}
                          action={deleteTaskAction}
                        />
                      </div>
                    </div>

                    {task.note ? (
                      <p className="mt-2 text-sm break-words text-muted-foreground">{task.note}</p>
                    ) : null}

                    {linkCount > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {linkedArticles.map((link) => (
                          <li key={`a-${link.id}`}>
                            {link.title ? (
                              <Link
                                href={`/knowledge/${encodeURIComponent(link.id)}`}
                                className="inline-block rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              >
                                笔记：{link.title}
                              </Link>
                            ) : (
                              <span
                                title="这篇笔记可能被删了或改了文件名"
                                className="inline-block rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning"
                              >
                                笔记已失效：{link.id}
                              </span>
                            )}
                          </li>
                        ))}
                        {linkedResources.map((link) => (
                          <li key={`r-${link.id}`}>
                            {link.title ? (
                              <Link
                                href={`/resources/${encodeURIComponent(link.id)}/edit`}
                                className="inline-block rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              >
                                资源：{link.title}
                              </Link>
                            ) : (
                              <span
                                title="这条资源可能被删了或改了 id"
                                className="inline-block rounded-full border border-warning/40 px-2 py-0.5 text-[11px] text-warning"
                              >
                                资源已失效：{link.id}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
