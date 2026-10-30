import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { TaskForm } from "@/components/tasks/task-form";
import { listArticles } from "@/lib/content/articles";
import { readResources } from "@/lib/content/resources";
import { createTaskAction } from "../actions";

export const metadata: Metadata = { title: "新建任务" };
export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const [{ articles }, { resources }] = await Promise.all([listArticles(), readResources()]);

  return (
    <>
      <PageHeader
        title="新建任务"
        en="New task"
        description="标题决定 id（中文照抄），建完不改。状态、截止日期、关联都可以之后再改。"
      />
      <div className="mt-6">
        <TaskForm
          mode="create"
          action={createTaskAction}
          articles={articles.map((article) => ({ id: article.id, title: article.title }))}
          resources={resources.map((resource) => ({ id: resource.id, title: resource.title }))}
        />
      </div>
    </>
  );
}
