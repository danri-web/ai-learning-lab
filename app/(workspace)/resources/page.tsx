import type { Metadata } from "next";
import { ExternalLink, Library, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { DeleteResourceButton } from "@/components/resources/delete-resource-button";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  RESOURCE_SORT_LABELS,
  RESOURCE_TYPE_LABELS,
  RESOURCE_TYPES,
  filterResources,
  isResourceSort,
  isResourceType,
  readResources,
  resourceFacets,
  sortResources,
  type ResourceSort,
} from "@/lib/content/resources";
import { resourceHost } from "@/lib/security/resource-url";
import { deleteResourceAction } from "./actions";

export const metadata: Metadata = { title: "资源收藏" };
export const dynamic = "force-dynamic";

type Params = {
  type?: string;
  category?: string;
  tag?: string;
  sort?: string;
};

const SORTS: ResourceSort[] = ["updated", "created", "title"];

function hrefWith(params: Params, patch: Partial<Params>): string {
  const next: Params = { ...params, ...patch };
  const search = new URLSearchParams();
  for (const key of ["type", "category", "tag", "sort"] as const) {
    const value = next[key];
    if (value) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `/resources?${qs}` : "/resources";
}

function chipClass(active: boolean): string {
  return active
    ? "rounded-full border border-primary/50 bg-primary/15 px-2.5 py-1 text-[11px] text-foreground"
    : "rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-foreground";
}

export default async function ResourcesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { resources, problem, missing } = await readResources();

  const activeType = isResourceType(params.type) ? params.type : undefined;
  const activeCategory =
    params.category && resources.some((item) => item.category === params.category)
      ? params.category
      : undefined;
  const activeTag =
    params.tag && resources.some((item) => item.tags.includes(params.tag!))
      ? params.tag
      : undefined;
  const sortParam = params.sort;
  const sort: ResourceSort = isResourceSort(sortParam) ? sortParam : "updated";

  const facets = resourceFacets(resources);
  const visible = sortResources(
    filterResources(resources, { type: activeType, category: activeCategory, tag: activeTag }),
    sort,
  );
  const filtering = Boolean(activeType || activeCategory || activeTag);

  return (
    <>
      <PageHeader
        title="资源收藏"
        en="Resources"
        description="论文、教程、文档、仓库、视频、工具。只存标题、链接与标签 —— 不会去抓取你填的地址（避免 SSRF）。"
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/resources/new">
              <Plus aria-hidden />
              收藏资源
            </Link>
          </Button>
        }
      />

      {problem ? (
        <section
          aria-label="资源文件的问题"
          className="mt-6 rounded-lg border border-warning/40 bg-warning/10 p-4"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <TriangleAlert aria-hidden className="size-4 text-warning" />
            content/resources.json 现在读不出来（为免把坏文件覆盖掉，暂时不能新增/编辑）
          </p>
          <p className="mt-2 text-xs break-words text-muted-foreground">{problem}</p>
        </section>
      ) : null}

      {resources.length > 0 ? (
        <section aria-label="筛选与排序" className="mt-5 grid gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-muted-foreground">类型</span>
            <Link href={hrefWith(params, { type: undefined })} className={chipClass(!activeType)}>
              全部 {resources.length}
            </Link>
            {RESOURCE_TYPES.map((type) => {
              const count = facets.types.find((facet) => facet.value === type)?.count ?? 0;
              if (count === 0) return null;
              return (
                <Link
                  key={type}
                  href={hrefWith(params, { type: activeType === type ? undefined : type })}
                  className={chipClass(activeType === type)}
                >
                  {RESOURCE_TYPE_LABELS[type]} {count}
                </Link>
              );
            })}
          </div>

          {facets.categories.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-muted-foreground">分类</span>
              {facets.categories.slice(0, 8).map((facet) => (
                <Link
                  key={facet.value}
                  href={hrefWith(params, {
                    category: activeCategory === facet.value ? undefined : facet.value,
                  })}
                  className={chipClass(activeCategory === facet.value)}
                >
                  {facet.value} {facet.count}
                </Link>
              ))}
            </div>
          ) : null}

          {facets.tags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-muted-foreground">标签</span>
              {facets.tags.map((facet) => (
                <Link
                  key={facet.value}
                  href={hrefWith(params, {
                    tag: activeTag === facet.value ? undefined : facet.value,
                  })}
                  className={chipClass(activeTag === facet.value)}
                >
                  {facet.value}
                </Link>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-muted-foreground">排序</span>
            {SORTS.map((value) => (
              <Link
                key={value}
                href={hrefWith(params, { sort: value })}
                className={chipClass(sort === value)}
              >
                {RESOURCE_SORT_LABELS[value]}
              </Link>
            ))}
            {filtering ? (
              <Link href="/resources" className="ml-1 text-[11px] text-muted-foreground underline">
                清除筛选
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="mt-5">
        {missing || resources.length === 0 ? (
          <EmptyState
            icon={<Library aria-hidden className="size-5" />}
            title="还没有收藏"
            description="收藏只存标题、链接、描述与标签，不会去抓取你填的地址（避免 SSRF），也不会执行页面里的代码。"
            stage="阶段 4"
            action={
              <Button asChild size="sm">
                <Link href="/resources/new">
                  <Plus aria-hidden />
                  收藏第一条
                </Link>
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Library aria-hidden className="size-5" />}
            title="这个筛选下没有资源"
            description="换个类型/标签，或者点「清除筛选」看全部。"
            stage="阶段 4"
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/resources">清除筛选</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {visible.map((item) => (
              <li key={item.id}>
                <article className="flex h-full flex-col rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group inline-flex items-start gap-1.5 text-sm font-medium break-words text-foreground hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span>{item.title}</span>
                      <ExternalLink
                        aria-hidden
                        className="mt-1 size-3 shrink-0 text-muted-foreground group-hover:text-primary"
                      />
                    </a>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {RESOURCE_TYPE_LABELS[item.type]}
                    </span>
                  </div>

                  <p className="mt-1 text-[11px] break-words text-muted-foreground">
                    {resourceHost(item.url)} · {item.category} · 更新于 {item.updatedAt}
                  </p>

                  {item.description ? (
                    <p className="mt-2 text-sm break-words text-muted-foreground">
                      {item.description}
                    </p>
                  ) : null}

                  {item.tags.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {item.tags.map((tag) => (
                        <li
                          key={tag}
                          className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
                    {item.articleId ? (
                      <Link
                        href={`/knowledge/${encodeURIComponent(item.articleId)}`}
                        className="text-[11px] text-primary hover:underline"
                      >
                        关联笔记：{item.articleId}
                      </Link>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">未关联笔记</span>
                    )}
                    <div className="flex items-center gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/resources/${encodeURIComponent(item.id)}/edit`}>编辑</Link>
                      </Button>
                      <DeleteResourceButton
                        id={item.id}
                        title={item.title}
                        action={deleteResourceAction}
                      />
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
