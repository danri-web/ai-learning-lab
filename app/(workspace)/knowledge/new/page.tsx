import type { Metadata } from "next";

import { ArticleEditor } from "@/components/knowledge/article-editor";
import { PageHeader } from "@/components/layout/page-header";
import { createArticleAction } from "../actions";

export const metadata: Metadata = { title: "新建笔记" };

export default function NewArticlePage() {
  return (
    <>
      <PageHeader
        title="新建笔记"
        en="New note"
        description="标题直接当文件名（中文也没问题），创建后不改名 —— 改标题不会改文件名，这样链接不会断。"
      />
      <div className="mt-6">
        <ArticleEditor mode="create" action={createArticleAction} />
      </div>
    </>
  );
}
