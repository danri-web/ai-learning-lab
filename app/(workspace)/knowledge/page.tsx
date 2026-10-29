import { BookOpen, Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function KnowledgePage() {
  return (
    <>
      <PageHeader
        title="知识库"
        en="Knowledge"
        description="Markdown 笔记：分类、标签、内部链接、公式、代码高亮、文章目录。正文以文件为权威来源。"
        action={
          <Button variant="outline" size="sm" disabled title="阶段 3 启用">
            <Plus aria-hidden />
            新建笔记
          </Button>
        }
      />

      <div className="mt-6">
        <EmptyState
          icon={<BookOpen aria-hidden className="size-5" />}
          title="还没有笔记"
          description="笔记会写成 content/articles/*.md，带 id、标题、分类、标签等 frontmatter；编辑器左写右预览。"
          stage="阶段 3 接入"
        />
      </div>
    </>
  );
}
