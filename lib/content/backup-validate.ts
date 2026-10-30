import path from "node:path";

import { z } from "zod";

import { parseArticle } from "@/lib/content/frontmatter";
import { stripBom } from "@/lib/content/encoding";
import type { BackupFileMeta, BackupManifest } from "@/lib/content/backup-format";
import { resourceFileSchema } from "@/lib/content/resources";
import { taskFileSchema } from "@/lib/content/tasks";

/**
 * 恢复前对**备份内容**的语义检查（纯函数，不碰磁盘）。
 *
 * 两类文件区别对待：
 *   - `resources.json` / `tasks.json` 是应用管理的全局文件。备份里这份坏了，
 *     恢复后整个应用会拒绝写入 —— 所以**拒绝恢复**，而不是把坏文件铺进去。
 *   - 单篇笔记坏掉只影响那一篇（应用本来就允许"某篇读不出来，其它照常"）。
 *     这种情况给 warning，不阻止恢复 —— 否则用户连一份含坏笔记的备份都恢复不了。
 *
 * 这也是「坏备份不该毁掉现有数据」的一部分：坏的不只是 zip，还包括 zip 里的 JSON。
 */

export type BackupPayloadCheck = { ok: true; warnings: string[] } | { ok: false; error: string };

function parseJsonFile<T>(
  label: string,
  bytes: Buffer | undefined,
  schema: z.ZodType<T>,
): { ok: true } | { ok: false; error: string } {
  if (!bytes) return { ok: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(bytes.toString("utf8")));
  } catch (error) {
    return { ok: false, error: `${label} 不是合法 JSON：${(error as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true };
  const issue = result.error.issues[0];
  return {
    ok: false,
    error: `${label} 结构不对：${issue ? `${issue.path.join(".") || "根"} ${issue.message}` : "未知原因"}`,
  };
}

function articleIdFromEntry(entry: string): string {
  return path.basename(entry, ".md");
}

/** 检查 manifest 声明的文件内容；`files` 是已验过 sha256 的字节 */
export function checkBackupPayload(
  manifest: BackupManifest,
  files: Map<string, Buffer>,
): BackupPayloadCheck {
  const resources = parseJsonFile(
    "备份里的 resources.json",
    files.get("content/resources.json"),
    resourceFileSchema,
  );
  if (!resources.ok) return resources;

  const tasks = parseJsonFile(
    "备份里的 tasks.json",
    files.get("content/tasks.json"),
    taskFileSchema,
  );
  if (!tasks.ok) return tasks;

  const warnings: string[] = [];
  const brokenNotes: string[] = [];

  for (const meta of manifest.files) {
    if (!meta.path.startsWith("content/articles/")) continue;
    if (meta.path.includes("/.trash/")) continue;
    if (!meta.path.endsWith(".md")) continue;

    const bytes = files.get(meta.path);
    if (!bytes) continue;
    const id = articleIdFromEntry(meta.path);
    const parsed = parseArticle(bytes.toString("utf8"), id);
    if (!parsed.ok) brokenNotes.push(`${path.basename(meta.path)}（${parsed.error}）`);
  }

  if (brokenNotes.length > 0) {
    const shown = brokenNotes.slice(0, 3).join("、");
    const more = brokenNotes.length > 3 ? ` 等 ${brokenNotes.length} 个` : "";
    warnings.push(
      `备份里有 ${brokenNotes.length} 篇笔记解析失败：${shown}${more}（恢复后它们会像现在一样单独报错）`,
    );
  }

  return { ok: true, warnings };
}

/** 给界面用：manifest.files 之外还有没有别的东西（正常情况下没有，loadVerifiedBackup 会挡住） */
export function countByKind(files: BackupFileMeta[]): {
  notes: number;
  resources: number;
  tasks: number;
  trash: number;
} {
  let notes = 0;
  let resources = 0;
  let tasks = 0;
  let trash = 0;
  for (const file of files) {
    if (file.path === "content/resources.json") resources += 1;
    else if (file.path === "content/tasks.json") tasks += 1;
    else if (file.path.includes("/.trash/") || file.path.startsWith("content/.trash/")) trash += 1;
    else notes += 1;
  }
  return { notes, resources, tasks, trash };
}
