import type { Metadata } from "next";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { ResourceForm } from "@/components/resources/resource-form";
import { listArticles } from "@/lib/content/articles";
import { articleIdFromParam } from "@/lib/content/id";
import { readResources, resourceRevision } from "@/lib/content/resources";
import { updateResourceAction } from "../../actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

async function findResource(rawId: string) {
  const id = articleIdFromParam(rawId);
  const { resources, problem } = await readResources();
  const resource = resources.find((item) => item.id.toLowerCase() === id.toLowerCase());
  return { id, resource, problem };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { resource } = await findResource(id).catch(() => ({
    resource: undefined,
    problem: null,
  }));
  return { title: resource ? `编辑：${resource.title}` : "编辑资源" };
}

export default async function EditResourcePage({ params }: Props) {
  const { id } = await params;
  const { resource, problem } = await findResource(id);

  if (!resource) notFound();

  const { articles } = await listArticles();

  return (
    <>
      <PageHeader
        title="编辑资源"
        en="Edit"
        description="保存会重写 content/resources.json（原子写入：要么旧版本，要么新版本，不会留半截）。"
      />

      {problem ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs break-words text-muted-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
          {problem}
        </p>
      ) : null}

      <div className="mt-4">
        <Link
          href="/resources"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          返回资源列表
        </Link>
      </div>

      <div className="mt-4">
        <ResourceForm
          mode="edit"
          action={updateResourceAction}
          articles={articles.map((article) => ({ id: article.id, title: article.title }))}
          initial={{
            id: resource.id,
            title: resource.title,
            url: resource.url,
            type: resource.type,
            category: resource.category,
            tags: resource.tags,
            description: resource.description,
            articleId: resource.articleId ?? "",
            revision: resourceRevision(resource),
          }}
        />
      </div>
    </>
  );
}
