import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { ResourceForm } from "@/components/resources/resource-form";
import { listArticles } from "@/lib/content/articles";
import { createResourceAction } from "../actions";

export const metadata: Metadata = { title: "收藏资源" };
export const dynamic = "force-dynamic";

export default async function NewResourcePage() {
  const { articles } = await listArticles();

  return (
    <>
      <PageHeader
        title="收藏资源"
        en="New resource"
        description="链接只接受 http / https。应用不会去抓取你填的地址 —— 所以也没有 SSRF 这一层风险。"
      />
      <div className="mt-6">
        <ResourceForm
          mode="create"
          action={createResourceAction}
          articles={articles.map((article) => ({ id: article.id, title: article.title }))}
        />
      </div>
    </>
  );
}
