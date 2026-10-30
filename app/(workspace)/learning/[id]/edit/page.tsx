import type { Metadata } from "next";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import { listArticles } from "@/lib/content/articles";
import { articleIdFromParam } from "@/lib/content/id";
import { readResources } from "@/lib/content/resources";
import { readTasks, taskRevision } from "@/lib/content/tasks";
import { updateTaskAction } from "../../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function findTask(rawId: string) {
  const id = articleIdFromParam(rawId);
  const { tasks, problem } = await readTasks();
  const task = tasks.find((item) => item.id.toLowerCase() === id.toLowerCase());
  return { id, task, problem };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { task } = await findTask(id).catch(() => ({ task: undefined, problem: null }));
  return { title: task ? `编辑：${task.title}` : "编辑任务" };
}

export default async function EditTaskPage({ params }: Props) {
  const { id } = await params;
  const { task, problem } = await findTask(id);

  if (!task) notFound();

  const [{ articles }, { resources }] = await Promise.all([listArticles(), readResources()]);

  return (
    <>
      <PageHeader
        title="编辑任务"
        en="Edit"
        description="保存会重写 content/tasks.json（原子写入：要么旧版本，要么新版本，不会留半截）。"
      />

      {problem ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs break-words text-muted-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {problem}
        </p>
      ) : null}

      <div className="mt-4">
        <Link
          href="/learning"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          返回任务列表
        </Link>
      </div>

      <div className="mt-4">
        <TaskForm
          mode="edit"
          action={updateTaskAction}
          articles={articles.map((article) => ({ id: article.id, title: article.title }))}
          resources={resources.map((resource) => ({ id: resource.id, title: resource.title }))}
          initial={{
            id: task.id,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate ?? "",
            note: task.note,
            articleIds: task.articleIds,
            resourceIds: task.resourceIds,
            revision: taskRevision(task),
          }}
        />
      </div>
    </>
  );
}
