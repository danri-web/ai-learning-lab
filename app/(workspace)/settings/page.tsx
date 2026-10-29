import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";

const ROWS: readonly { label: string; value: string; note?: string }[] = [
  {
    label: "监听地址",
    value: "127.0.0.1:3000",
    note: "默认只允许本机访问；局域网模式要等阶段 7 的认证一起开（README §8）",
  },
  {
    label: "主题",
    value: "深色（MVP 唯一主题）",
    note: "令牌在 app/globals.css，组件里不硬编码颜色",
  },
  {
    label: "设计令牌来源",
    value: "docs/需求书.md §6",
    note: "十个色值：背景 / 表面 / 抬升 / 边框 / 正文 / 次要 / 强调 / 成功 / 警告 / 危险",
  },
  { label: "文章目录", value: "content/articles/", note: "阶段 3 创建" },
  { label: "数据目录", value: "data/", note: "阶段 3 创建；已排除在 git 之外" },
  { label: "备份与恢复", value: "未实现", note: "阶段 7" },
  { label: "认证", value: "未实现", note: "阶段 7；在此之前不开放局域网访问" },
] as const;

export const metadata: Metadata = { title: "设置" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="设置"
        en="Settings"
        description="这里目前是只读的现状清单。真正可修改的设置项要等阶段 7（认证、备份、局域网）才有意义。"
      />

      <dl className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        {ROWS.map((row) => (
          <div
            key={row.label}
            className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <dt className="w-32 shrink-0 text-xs text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0">
              <span className="font-mono text-sm break-words text-foreground">{row.value}</span>
              {row.note ? (
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  {row.note}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
