import type { Metadata } from "next";
import { Archive, Download, RotateCcw, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { formatBytes, isBackupFileName, type RestorePlanEntry } from "@/lib/content/backup-format";
import { loadBackupOverview, previewRestoreByName } from "@/features/backup/service";
import { applyRestoreAction, createBackupAction, verifyBackupAction } from "./actions";

export const metadata: Metadata = { title: "备份" };
export const dynamic = "force-dynamic";

type Params = {
  created?: string;
  verified?: string;
  restored?: string;
  deleted?: string;
  restore?: string;
  includeDeletes?: string;
  error?: string;
};

function Notice({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const classes =
    tone === "ok"
      ? "border-success/40 bg-success/10 text-foreground"
      : tone === "warn"
        ? "border-warning/40 bg-warning/10 text-foreground"
        : "border-danger/40 bg-danger/10 text-foreground";
  return (
    <section role="status" className={`mt-5 rounded-lg border p-3 text-sm ${classes}`}>
      {children}
    </section>
  );
}

function EntryList({
  label,
  entries,
  empty,
}: {
  label: string;
  entries: RestorePlanEntry[];
  empty: string;
}) {
  if (entries.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <details className="rounded-lg border border-border bg-surface px-3 py-2">
      <summary className="cursor-pointer text-xs font-medium text-foreground">
        {label}（{entries.length}）
      </summary>
      <ul className="mt-2 grid gap-1">
        {entries.slice(0, 50).map((entry) => (
          <li key={entry.path} className="font-mono text-[11px] break-all text-muted-foreground">
            {entry.path}
            {entry.backup && entry.current && entry.status === "overwritten" ? (
              <span className="ml-2 font-sans">
                {formatBytes(entry.current.size)} → {formatBytes(entry.backup.size)}
              </span>
            ) : null}
          </li>
        ))}
        {entries.length > 50 ? (
          <li className="text-[11px] text-muted-foreground">还有 {entries.length - 50} 个…</li>
        ) : null}
      </ul>
    </details>
  );
}

function decodeError(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, 300);
  } catch {
    return "操作失败（错误信息无法解析）";
  }
}

export default async function BackupPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const overview = await loadBackupOverview();

  const restoreName = params.restore && isBackupFileName(params.restore) ? params.restore : null;
  const includeDeletes = params.includeDeletes === "1";
  const preview = restoreName ? await previewRestoreByName(restoreName, includeDeletes) : null;

  const deletedCount = Number(params.deleted ?? "0");
  const errorMessage = decodeError(params.error);

  return (
    <>
      <PageHeader
        title="备份"
        en="Backup"
        description="把 content/ 打成一个带清单的 zip，随时可以校验、预览并恢复。恢复前会先把现状另存一份，出问题能回去。"
        action={
          <form action={createBackupAction}>
            <Button type="submit" size="sm">
              <Archive aria-hidden />
              立即备份
            </Button>
          </form>
        }
      />

      {overview.recovery ? (
        <Notice tone={overview.recovery.tone}>
          <p className="flex items-start gap-2 font-medium">
            {overview.recovery.tone === "ok" ? (
              <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <TriangleAlert
                aria-hidden
                className={`mt-0.5 size-4 shrink-0 ${
                  overview.recovery.tone === "warn" ? "text-warning" : "text-danger"
                }`}
              />
            )}
            <span className="break-words">{overview.recovery.message}</span>
          </p>
          {overview.recovery.detail ? (
            <p className="mt-1 text-xs break-words text-muted-foreground">
              {overview.recovery.detail}
            </p>
          ) : null}
        </Notice>
      ) : null}

      {params.created ? (
        <Notice tone="ok">
          <p className="flex items-center gap-2 font-medium">
            <ShieldCheck aria-hidden className="size-4 text-success" />
            备份已创建并通过自检：<span className="font-mono">{params.created}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            已重读 zip，逐文件比对 sha256 通过。文件在 <code>backups/</code>（不进 Git）。
          </p>
        </Notice>
      ) : null}

      {params.verified ? (
        <Notice tone="ok">
          <p className="font-medium">
            校验通过：<span className="font-mono">{params.verified}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            manifest、条目大小与每个 sha256 都对得上。
          </p>
        </Notice>
      ) : null}

      {params.restored ? (
        <Notice tone="ok">
          <p className="font-medium">
            恢复完成。恢复前快照：<span className="font-mono">{params.restored}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {deletedCount > 0
              ? `有 ${deletedCount} 个当前多出来的文件被移进了 content/.trash/restore-*（不是真删）。`
              : "没有删除任何文件。"}
            想回到恢复前，在下面的列表里对那份 pre-restore 快照点「回滚」。
          </p>
        </Notice>
      ) : null}

      {errorMessage ? (
        <Notice tone="error">
          <p className="flex items-start gap-2 font-medium">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            <span className="break-words">{errorMessage}</span>
          </p>
        </Notice>
      ) : null}

      {overview.error ? (
        <Notice tone="warn">
          <p className="font-medium">有一部分内容读不出来</p>
          <p className="mt-1 text-xs break-words text-muted-foreground">{overview.error}</p>
        </Notice>
      ) : null}

      <section aria-label="概况" className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "备份数量", value: overview.backups.length },
          {
            label: "备份占用",
            value: formatBytes(overview.backups.reduce((sum, item) => sum + item.sizeBytes, 0)),
          },
          { label: "content 文件", value: overview.files.total },
          { label: "未纳入备份", value: overview.skipped.length },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</p>
          </div>
        ))}
      </section>

      <details className="mt-4 rounded-lg border border-border bg-surface px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">存储与实现说明</summary>
        <div className="mt-3 grid gap-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            备份内容：<code>{overview.contentRoot}</code> 下的 Markdown、resources.json、tasks.json
            与 .trash 留档。格式是一个 zip + 根目录 <code>manifest.json</code>（每个文件的
            sha256）。
          </p>
          <p>
            存放位置：<code>{overview.backupsRoot}</code>（已 gitignore）。
            <strong>不含 .env.local</strong>
            ：口令哈希和会话密钥不跟着备份走，换机后重新设置口令即可。
          </p>
          <p>
            恢复只从 backups/ 列表里选（不接受上传）；先预览新增/覆盖/删除，再输入「恢复」确认。
            默认<strong>不删除</strong>当前多出来的文件；勾选删除后它们会移进
            <code>content/.trash/restore-*</code>，不是真删。
          </p>
          <p>
            每次恢复前都会先建一份 <code>pre-restore-*.zip</code>{" "}
            快照并回读校验；写到一半失败会自动回滚。恢复开始前还会在 <code>backups/</code> 写一份
            <code>restore-journal.json</code>
            ：如果进程被强杀，下次打开这一页会自动回到恢复前的快照。 备份是明文
            zip，别放公开同步盘。
          </p>
        </div>
      </details>

      {restoreName && preview ? (
        <section
          aria-label="恢复预览"
          className="mt-6 rounded-lg border border-border bg-surface p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-medium">恢复预览</h2>
              <p className="mt-1 font-mono text-xs break-all text-muted-foreground">
                {restoreName}
              </p>
            </div>
            <Link href="/backup" className="text-xs text-muted-foreground underline">
              取消预览
            </Link>
          </div>

          {!preview.ok ? (
            <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm break-words">
              {preview.error}
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {[
                  ["新增", preview.plan.counts.added],
                  ["覆盖", preview.plan.counts.overwritten],
                  ["相同", preview.plan.counts.unchanged],
                  ["只在当前", preview.plan.counts.deleted],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-lg border border-border bg-background p-3"
                  >
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                备份里 {preview.fileCount} 个文件 ·{" "}
                {includeDeletes ? (
                  <span className="text-danger">
                    会删除 {preview.plan.counts.deleted} 个当前多出来的文件（移进 .trash）
                  </span>
                ) : (
                  <span>当前多出来的 {preview.plan.counts.deleted} 个文件会保留</span>
                )}
                {" · "}
                <Link
                  href={`/backup?restore=${encodeURIComponent(restoreName)}${includeDeletes ? "" : "&includeDeletes=1"}`}
                  className="text-primary underline"
                >
                  {includeDeletes ? "改为不删除" : "改为同时删除"}
                </Link>
              </p>

              {preview.warnings.length > 0 ? (
                <ul className="mt-3 list-disc rounded-lg border border-warning/40 bg-warning/10 p-3 pl-7 text-xs text-muted-foreground">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <EntryList
                  label="新增"
                  entries={preview.plan.entries.filter((entry) => entry.status === "added")}
                  empty="没有新增文件。"
                />
                <EntryList
                  label="覆盖"
                  entries={preview.plan.entries.filter((entry) => entry.status === "overwritten")}
                  empty="没有要覆盖的文件。"
                />
                <EntryList
                  label="只在当前（不勾选删除则保留）"
                  entries={preview.plan.entries.filter((entry) => entry.status === "deleted")}
                  empty="当前没有多出来的文件。"
                />
                <EntryList
                  label="相同（不写盘）"
                  entries={preview.plan.entries.filter((entry) => entry.status === "unchanged")}
                  empty="没有完全相同的文件。"
                />
              </div>

              <form
                action={applyRestoreAction}
                className="mt-5 grid gap-3 rounded-lg border border-danger/30 p-4"
              >
                <input type="hidden" name="name" value={restoreName} />
                <input type="hidden" name="planHash" value={preview.plan.planHash} />
                <input type="hidden" name="includeDeletes" value={includeDeletes ? "1" : "0"} />

                <p className="text-sm font-medium">
                  {includeDeletes
                    ? "确认覆盖，并把当前多出来的文件移进回收站？"
                    : "确认覆盖（不删除当前多出来的文件）？"}
                </p>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" required className="mt-0.5" />
                  我知道这会改动 content/；出问题可以用恢复前快照回滚。
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  输入「恢复」两个字再确认
                  <input
                    name="confirm"
                    required
                    pattern="恢复"
                    autoComplete="off"
                    className="h-9 w-40 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </label>
                <div>
                  <Button type="submit" variant="destructive" size="sm">
                    <RotateCcw aria-hidden />
                    执行恢复
                  </Button>
                </div>
              </form>
            </>
          )}
        </section>
      ) : null}

      <section aria-label="备份列表" className="mt-6">
        <h2 className="text-sm font-medium">备份列表</h2>
        {overview.backups.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-border bg-surface/50 p-6 text-sm text-muted-foreground">
            还没有备份。点右上角「立即备份」；建议在每次大改之前手动备一份。
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {overview.backups.map((item) => {
              const isSnapshot = item.name.startsWith("pre-restore-");
              const created =
                item.manifest?.createdAtLocal ?? item.modifiedAt.toLocaleString("zh-CN");
              const count = item.manifest?.files.length;
              return (
                <li
                  key={item.name}
                  className="rounded-lg border border-border bg-surface p-3 sm:flex sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono break-all">{item.name}</span>
                      <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                        {isSnapshot ? "恢复前快照" : "手动备份"}
                      </span>
                      {item.error ? (
                        <span className="rounded-full border border-danger/40 px-2 py-0.5 text-[11px] text-danger">
                          损坏
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-[11px] break-words text-muted-foreground">
                      {created} · {formatBytes(item.sizeBytes)}
                      {typeof count === "number" ? ` · ${count} 个文件` : ""}
                      {item.error ? ` · ${item.error}` : ""}
                    </p>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1 sm:mt-0 sm:shrink-0">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/backup?restore=${encodeURIComponent(item.name)}${isSnapshot ? "&includeDeletes=1" : ""}`}
                      >
                        {isSnapshot ? "回滚" : "预览恢复"}
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/backup/${encodeURIComponent(item.name)}/download`}>
                        <Download aria-hidden />
                        下载
                      </a>
                    </Button>
                    <form action={verifyBackupAction}>
                      <input type="hidden" name="name" value={item.name} />
                      <Button type="submit" variant="ghost" size="sm">
                        <ShieldCheck aria-hidden />
                        校验
                      </Button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {overview.skipped.length > 0 ? (
        <details className="mt-4 rounded-lg border border-border bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">
            未纳入备份的 {overview.skipped.length} 个条目
          </summary>
          <ul className="mt-2 grid gap-1">
            {overview.skipped.map((item) => (
              <li key={item} className="font-mono text-[11px] break-all text-muted-foreground">
                {item}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        从手机恢复也可以，但恢复期间别在别的设备上编辑。备份与恢复都是本地文件操作，不上传任何地方。
      </p>
    </>
  );
}
