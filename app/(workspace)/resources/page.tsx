import type { Metadata } from "next";
import { Library, Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

const RESOURCE_TYPES = [
  "Paper",
  "Tutorial",
  "Documentation",
  "GitHub Repository",
  "Video",
  "Tool",
  "Other",
] as const;

export const metadata: Metadata = { title: "资源收藏" };

export default function ResourcesPage() {
  return (
    <>
      <PageHeader
        title="资源收藏"
        en="Resources"
        description="论文、教程、文档、仓库、视频、工具。可按类型、标签、分类筛选与排序，并能挂到某篇笔记上。"
        action={
          <Button variant="outline" size="sm" disabled title="阶段 4 启用">
            <Plus aria-hidden />
            收藏资源
          </Button>
        }
      />

      <div className="mt-6 flex flex-wrap gap-1.5" aria-label="计划支持的类型">
        {RESOURCE_TYPES.map((type) => (
          <span
            key={type}
            className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground"
          >
            {type}
          </span>
        ))}
      </div>

      <div className="mt-4">
        <EmptyState
          icon={<Library aria-hidden className="size-5" />}
          title="还没有收藏"
          description="收藏只存标题、链接、描述与标签，不会去抓取你填的地址（避免 SSRF），也不会执行页面里的代码。"
          stage="阶段 4 接入"
        />
      </div>
    </>
  );
}
