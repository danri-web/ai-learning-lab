import { Eraser } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type {
  BackupPruneFailure,
  BackupPrunePreview,
  TrashCleanupFailure,
  TrashPreview,
} from "@/features/backup/service";
import { formatBytes } from "@/lib/content/backup-format";
import { pruneBackupsAction, pruneTrashAction } from "./actions";

/**
 * `/backup` 的两张清理卡（P1）。
 *
 * 共同约定：先预览（只读）→ 勾选 + 输入「清理」→ 执行。
 * 执行动作在 actions.ts；候选重算 / 加锁 / journal 闸门在 lib/content 的 store 里。
 */

function formatDate(date: Date): string {
  return date.toLocaleString("zh-CN", { hour12: false });
}

function ConfirmForm({
  action,
  planHash,
  submitLabel,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  planHash: string;
  submitLabel: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action} className="grid gap-3 rounded-lg border border-danger/30 p-3">
      <input type="hidden" name="planHash" value={planHash} />
      {children}
      <label className="flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" required className="mt-0.5" />
        我确认这些条目会被真删（不是移进回收站）。
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        输入「清理」两个字再确认
        <input
          name="confirm"
          required
          pattern="清理"
          autoComplete="off"
          className="h-9 w-40 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>
      <div>
        <Button type="submit" variant="destructive" size="sm">
          <Eraser aria-hidden />
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function BackupPruneBody({ preview }: { preview: BackupPrunePreview | BackupPruneFailure }) {
  if (!preview.ok) {
    return (
      <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs break-words">
        {preview.error}
      </p>
    );
  }

  return (
    <div className="mt-3 grid gap-3">
      <p className="text-xs text-muted-foreground">
        保留 {preview.keep.length} 份 · 可清理 {preview.expired.length} 份
        {preview.expired.length > 0 ? `（共 ${formatBytes(preview.totalBytes)}）` : ""}
        {preview.damaged.length > 0 ? ` · 超期但损坏 ${preview.damaged.length} 份（不删）` : ""}
      </p>

      {preview.expired.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          没有可清理的备份：保留的 {preview.keep.length} 份都在，损坏的也不会删。
        </p>
      ) : (
        <>
          <ul className="grid gap-1">
            {preview.expired.map((item) => (
              <li
                key={item.name}
                className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs"
              >
                <span className="font-mono break-all">{item.name}</span>
                <span className="ml-2 break-words text-muted-foreground">
                  {formatDate(item.modifiedAt)} · {formatBytes(item.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>

          <ConfirmForm
            action={pruneBackupsAction}
            planHash={preview.planHash}
            submitLabel="执行清理"
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              这次会真删上面 {preview.expired.length} 份 zip。最新 10 份、恢复前快照和恢复日志不会动。
            </p>
          </ConfirmForm>
        </>
      )}

      {preview.damaged.length > 0 ? (
        <details className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">
            超期但损坏，不删（{preview.damaged.length}）
          </summary>
          <ul className="mt-2 grid gap-1">
            {preview.damaged.map((item) => (
              <li key={item.name} className="text-[11px] break-all text-muted-foreground">
                <span className="font-mono">{item.name}</span> · {item.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {preview.ignored.length > 0 ? (
        <details className="rounded-lg border border-border bg-background px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">
            没动的文件（{preview.ignored.length}）
          </summary>
          <ul className="mt-2 grid gap-1">
            {preview.ignored.slice(0, 50).map((item) => (
              <li key={item.name} className="text-[11px] break-all text-muted-foreground">
                <span className="font-mono">{item.name}</span> · {item.reason}
              </li>
            ))}
            {preview.ignored.length > 50 ? (
              <li className="text-[11px] text-muted-foreground">
                还有 {preview.ignored.length - 50} 个…
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function BackupPruneCard({
  preview,
}: {
  preview: BackupPrunePreview | BackupPruneFailure | null;
}) {
  return (
    <section
      aria-label="清理旧备份"
      className="mt-6 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">清理旧备份</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            只清理手动备份（<code>ai-lab-*.zip</code>），保留最新 10 份。恢复前快照、
            恢复日志、名字不认识的文件、链接/目录都不动；损坏的 zip 只标出来，不删。
          </p>
        </div>
        <Link href="/backup?prune=backups" className="text-xs text-muted-foreground underline">
          预览清理
        </Link>
      </div>
      {preview ? <BackupPruneBody preview={preview} /> : null}
    </section>
  );
}

function TrashPruneBody({ preview }: { preview: TrashPreview | TrashCleanupFailure }) {
  if (!preview.ok) {
    return (
      <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs break-words">
        {preview.error}
      </p>
    );
  }

  const droppedLines = preview.jsonl.reduce((sum, item) => sum + item.dropped, 0);
  const total = preview.articles.length + preview.restoreDirs.length + preview.jsonl.length;

  return (
    <div className="mt-3 grid gap-3">
      <p className="text-xs text-muted-foreground">
        保留 {preview.days} 天（截止 {formatDate(preview.cutoff)}） · 可清理{" "}
        {preview.articles.length} 个笔记 · {preview.restoreDirs.length} 个恢复副本 ·{" "}
        {preview.jsonl.length} 个 JSONL（共 {droppedLines} 行）
      </p>

      {total === 0 ? (
        <p className="text-xs text-muted-foreground">90 天内没有可清理的条目。</p>
      ) : (
        <>
          <ul className="grid gap-1">
            {preview.articles.map((item) => (
              <li
                key={item.path}
                className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs"
              >
                <span className="font-mono break-all">{item.path}</span>
                <span className="ml-2 text-muted-foreground">{formatDate(item.deletedAt)}</span>
              </li>
            ))}
            {preview.restoreDirs.map((item) => (
              <li
                key={item.path}
                className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs"
              >
                <span className="font-mono break-all">{item.path}/</span>
                <span className="ml-2 text-muted-foreground">恢复副本 · {formatDate(item.deletedAt)}</span>
              </li>
            ))}
            {preview.jsonl.map((item) => (
              <li
                key={item.file}
                className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs"
              >
                <span className="font-mono break-all">{item.file}</span>
                <span className="ml-2 text-muted-foreground">
                  删 {item.dropped} 行 · 留 {item.kept} 行
                </span>
              </li>
            ))}
          </ul>

          <ConfirmForm action={pruneTrashAction} planHash={preview.planHash} submitLabel="执行清理">
            <p className="text-xs leading-relaxed text-muted-foreground">
              笔记与恢复副本会整份删除；JSONL 只裁超期行，文件本身保留。解析不出时间的行不会动。
            </p>
          </ConfirmForm>
        </>
      )}

      {preview.skipped.length > 0 ? (
        <details className="rounded-lg border border-border bg-background px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium">
            没动的条目（{preview.skipped.length}）
          </summary>
          <ul className="mt-2 grid gap-1">
            {preview.skipped.slice(0, 50).map((item) => (
              <li key={`${item.path}:${item.reason}`} className="text-[11px] break-all text-muted-foreground">
                <span className="font-mono">{item.path}</span> · {item.reason}
              </li>
            ))}
            {preview.skipped.length > 50 ? (
              <li className="text-[11px] text-muted-foreground">
                还有 {preview.skipped.length - 50} 个…
              </li>
            ) : null}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function TrashPruneCard({
  preview,
}: {
  preview: TrashPreview | TrashCleanupFailure | null;
}) {
  return (
    <section
      aria-label="清理回收站"
      className="mt-6 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">清理回收站</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            默认清理 90 天前的笔记回收站、资源/任务删除留档（JSONL 只裁行）与恢复副本目录。
            解析不出时间的、白名单外的、链接/目录一个字节都不动，只在预览里列出。
          </p>
        </div>
        <Link href="/backup?prune=trash" className="text-xs text-muted-foreground underline">
          预览清理
        </Link>
      </div>
      {preview ? <TrashPruneBody preview={preview} /> : null}
    </section>
  );
}

export function CleanupCards({
  backupPreview,
  trashPreview,
}: {
  backupPreview: BackupPrunePreview | BackupPruneFailure | null;
  trashPreview: TrashPreview | TrashCleanupFailure | null;
}) {
  return (
    <>
      <BackupPruneCard preview={backupPreview} />
      <TrashPruneCard preview={trashPreview} />
    </>
  );
}
