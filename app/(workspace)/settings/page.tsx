import type { Metadata } from "next";
import Link from "next/link";
import { Archive, LogOut, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { loadBackupOverview } from "@/features/backup/service";
import { formatBytes } from "@/lib/content/backup-format";
import { getSession } from "@/lib/security/auth";
import { readAuthConfig } from "@/lib/security/auth-config";

export const metadata: Metadata = { title: "设置" };
export const dynamic = "force-dynamic";

function Row({
  label,
  value,
  note,
  mono = false,
}: {
  label: string;
  value: string;
  note?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-32 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">
        <span className={`text-sm break-words text-foreground ${mono ? "font-mono" : ""}`}>
          {value}
        </span>
        {note ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function Section({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  /** `<dl>` 里只能放 dt/dd（或包着它们的 div）；按钮要放在 dl 外面，否则 axe 报 definition-list */
  footer?: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium">{title}</h2>
      <dl className="mt-2 overflow-hidden rounded-lg border border-border bg-surface">{children}</dl>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </section>
  );
}

export default async function SettingsPage() {
  const config = readAuthConfig();
  const session = await getSession();
  const overview = await loadBackupOverview();
  const latest = overview.backups[0] ?? null;
  const totalBackupBytes = overview.backups.reduce((sum, item) => sum + item.sizeBytes, 0);

  return (
    <>
      <PageHeader
        title="设置"
        en="Settings"
        description="查看数据存在哪、现在怎么访问、备份做到了哪一步。能改的东西会在这一页给出入口，只读的信息会标出来。"
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/backup">
              <Archive aria-hidden />
              打开备份
            </Link>
          </Button>
        }
      />

      <Section title="访问">
        <Row
          label="模式"
          value={config.allowLan ? "局域网（需要登录）" : "仅本机"}
          note={
            config.allowLan
              ? "由 npm run start:lan 用生产构建启动；绑定 0.0.0.0。"
              : "只绑定 127.0.0.1；从其它设备连不上。要从手机访问，运行 npm run start:lan。"
          }
        />
        <Row
          label="监听地址"
          value={config.allowLan ? "0.0.0.0（所有网卡）" : "127.0.0.1"}
          note="实际值来自启动方式；本机模式的绑定地址写死在 package.json 的脚本里。"
          mono
        />
        <Row
          label="认证"
          value={
            config.allowLan
              ? config.ready
                ? session
                  ? "已登录 · 会话 12 小时"
                  : "需要登录"
                : "配置不齐 · 已拒绝所有受保护请求"
              : "不需要（本机模式）"
          }
          note={
            config.allowLan
              ? "口令只存 scrypt 哈希在 .env.local；换 SESSION_SECRET 会让所有设备退出。"
              : "本机模式的安全边界是「只监听 127.0.0.1」，不是登录。"
          }
        />
        {config.allowLan && config.problems.length > 0 ? (
          <Row label="缺什么" value={config.problems.join("；")} note="配置齐之前服务不会放行。" />
        ) : null}
      </Section>

      <Section title="存储">
        <Row
          label="数据目录"
          value={overview.contentRoot}
          note={`笔记、资源、任务与回收站都在这里：${overview.files.notes} 篇笔记 · ${overview.files.resources} 个 resources.json · ${overview.files.tasks} 个 tasks.json · ${overview.files.trash} 个回收站文件。`}
          mono
        />
        <Row
          label="备份目录"
          value={overview.backupsRoot}
          note={`${overview.backups.length} 份备份，共 ${formatBytes(totalBackupBytes)}；已 gitignore。`}
          mono
        />
        {overview.skipped.length > 0 ? (
          <Row
            label="未纳入备份"
            value={`${overview.skipped.length} 个条目`}
            note="在备份页展开可以看到具体是哪些；它们不会进 zip，也不会被恢复删除。"
          />
        ) : null}
      </Section>

      <Section
        title="备份与恢复"
        footer={
          <Button asChild size="sm">
            <Link href="/backup">
              <ShieldCheck aria-hidden />
              打开备份与恢复
            </Link>
          </Button>
        }
      >
        <Row
          label="最近一次"
          value={latest ? latest.name : "还没有备份"}
          note={
            latest
              ? `${latest.manifest?.createdAtLocal ?? latest.modifiedAt.toLocaleString("zh-CN")} · ${formatBytes(latest.sizeBytes)}${latest.error ? ` · ${latest.error}` : ""}`
              : "第一次点「立即备份」会在 backups/ 下生成一份带时间戳的 zip。"
          }
          mono={Boolean(latest)}
        />
        <Row
          label="恢复"
          value="预览 → 确认 → 自动快照 → 失败回滚"
          note="默认不删除当前多出来的文件；勾选删除后移进 content/.trash/restore-*。每次恢复前都会先建 pre-restore 快照。"
        />
        <Row
          label="回滚"
          value="在备份页对 pre-restore-* 点「回滚」"
          note="快照与普通备份同格式，能校验、能下载、能再恢复。"
        />
        <Row
          label="清理"
          value="手动：备份保留最近 10 份；回收站保留 90 天"
          note="都在备份页先预览、再勾选并输入「清理」；没有后台自动删除。"
        />
      </Section>

      <Section title="外观">
        <Row label="主题" value="深色（MVP 唯一主题）" note="令牌在 app/globals.css；组件里没有硬编码颜色。" />
        <Row label="中文" value="中文标题直接当文件名" note="见 ADR D7；资源/任务 id 沿用同一套规则。" />
      </Section>

      <details className="mt-6 rounded-lg border border-border bg-surface px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">开发者信息</summary>
        <div className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            设计令牌来源：<code>docs/需求书.md §6</code>；十个色值落在{" "}
            <code>app/globals.css</code> 的 CSS 变量里。
          </p>
          <p>
            写入链路：Server Action → <code>features/*/service.ts</code> →{" "}
            <code>lib/content/*</code>；只有 service 能 import 写入模块（源码闸门守着）。
          </p>
          <p>
            文件系统：只有 <code>lib/fs</code>、<code>lib/security/paths.ts</code>、
            <code>lib/content</code> 能 import node:fs；客户端组件不许 import 带 fs 的模块。
          </p>
          <p>
            备份格式：zip + <code>manifest.json</code>（每文件 sha256）；不包含{" "}
            <code>.env.local</code>。恢复是「校验 → 快照 → 预检 → 原子写 → 重扫 → 失败回滚」。
          </p>
          <p>
            安全响应头：X-Frame-Options、X-Content-Type-Options、Referrer-Policy、
            Permissions-Policy、COOP/CORP。CSP 暂未启用（Next 内联启动脚本，需要 nonce；
            记在 ADR 残余风险）。
          </p>
          <p>
            文档：<code>docs/架构决策.md</code>（D1–D14）、<code>README.md</code> 的阶段表、「测试与发布」与
            「已知问题」；闸门是 <code>npm run verify</code> + <code>npm run test:e2e</code>。
          </p>
        </div>
      </details>

      {config.allowLan && session ? (
        <form action="/api/auth/logout" method="post" className="mt-6">
          <Button type="submit" variant="outline" size="sm">
            <LogOut aria-hidden />
            退出登录
          </Button>
        </form>
      ) : null}
    </>
  );
}
