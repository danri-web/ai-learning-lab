import { promises as fs } from "node:fs";
import path from "node:path";

import { formatLocalDate, formatLocalStamp } from "@/lib/content/clock";
import { revisionOf } from "@/lib/content/revision";
import {
  resourceFileSchema,
  resourceRevision,
  resourceSchema,
  resourcesFile,
  readResources,
  type Resource,
  type ResourceType,
} from "@/lib/content/resources";
import { writeFileAtomic } from "@/lib/fs/atomic-write";
import { serialize } from "@/lib/fs/mutex";
import { uniqueIdForTitle } from "@/lib/content/unique-id";

/**
 * 资源收藏的**写**（阶段 4）。和笔记一样的三条规矩：
 *   1. 写操作进程内串行（`serialize`）—— 否则两个并发新建会算出同一个 id、后写的顶掉前一份
 *   2. 原子写（`writeFileAtomic`）—— 断电/崩溃时要么旧文件、要么新文件，不留半截 JSON
 *   3. 写前自检 + 删除留档（`content/.trash/resources-deleted.jsonl`）
 *
 * 与笔记的区别：资源共用**一个** JSON 文件，所以"改一条"= 重写整个文件。
 * 单用户、几百条的规模下这是最简单也最不容易出错的形态（D1 的直接推论）；
 * 真到几千条要索引时，再按 D1 的"缓存可重建"原则加缓存，而不是换真相来源。
 */

export type ResourceInput = {
  title: string;
  url: string;
  type: ResourceType;
  category: string;
  tags: string[];
  description: string;
  articleId?: string;
};

export type StoreFailureReason = "invalid" | "not-found" | "stale" | "io";

export type StoreFailure = { ok: false; reason: StoreFailureReason; error: string };

export type CreateResult = { ok: true; id: string; revision: string } | StoreFailure;
export type UpdateResult = { ok: true; id: string; revision: string } | StoreFailure;
export type DeleteResult = { ok: true; id: string; trashFile: string } | StoreFailure;

export type StoreOptions = { root: string; now?: Date };

export type UpdateOptions = StoreOptions & {
  /** 编辑页打开时那条资源的指纹（`resourceRevision`），对不上就拒绝（同笔记的 D8） */
  expectRevision?: string;
  force?: boolean;
};

function fail(reason: StoreFailureReason, error: string): StoreFailure {
  return { ok: false, reason, error };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 写整个文件：先序列化，再用同一份 schema 读回来（写进去的必须读得回来） */
async function writeList(root: string, resources: Resource[]): Promise<string> {
  const body = `${JSON.stringify({ version: 1, resources }, null, 2)}\n`;
  const check = resourceFileSchema.safeParse(JSON.parse(body));
  if (!check.success) {
    throw new Error(
      `生成的 resources.json 不合法：${check.error.issues[0]?.message ?? "未知原因"}`,
    );
  }

  await fs.mkdir(root, { recursive: true });
  await writeFileAtomic(resourcesFile(root), body);
  return revisionOf(body);
}

/** 读当前列表；文件坏了就**拒绝写入**（宁可报错，也不要把用户的坏文件覆盖掉） */
async function loadForWrite(root: string): Promise<Resource[] | StoreFailure> {
  const current = await readResources(root);
  if (current.problem) {
    return fail(
      "invalid",
      `${current.problem}（先修好这个文件再改；应用不会覆盖它，免得连坏掉的内容一起丢）`,
    );
  }
  return current.resources;
}

export function createResource(input: ResourceInput, options: StoreOptions): Promise<CreateResult> {
  return serialize(() => createResourceUnlocked(input, options));
}

async function createResourceUnlocked(
  input: ResourceInput,
  options: StoreOptions,
): Promise<CreateResult> {
  const { root } = options;
  const today = formatLocalDate(options.now ?? new Date());

  if (!input.title.trim()) return fail("invalid", "标题不能为空");

  try {
    const existing = await loadForWrite(root);
    if (!Array.isArray(existing)) return existing;

    const taken = new Set(existing.map((item) => item.id.toLowerCase()));
    const id = uniqueIdForTitle(input.title, taken);
    if (!id) return fail("invalid", "同名资源太多，换个标题再建");

    const record = {
      ...input,
      title: input.title.trim(),
      url: input.url.trim(),
      category: input.category.trim(),
      id,
      createdAt: today,
      updatedAt: today,
    };
    const parsed = resourceSchema.safeParse(record);
    if (!parsed.success) {
      return fail("invalid", parsed.error.issues.map((issue) => issue.message).join("；"));
    }

    await writeList(root, [...existing, parsed.data]);
    return { ok: true, id, revision: resourceRevision(parsed.data) };
  } catch (error) {
    return fail("io", `写入失败：${message(error)}`);
  }
}

export function updateResource(
  id: string,
  input: ResourceInput,
  options: UpdateOptions,
): Promise<UpdateResult> {
  return serialize(() => updateResourceUnlocked(id, input, options));
}

async function updateResourceUnlocked(
  id: string,
  input: ResourceInput,
  options: UpdateOptions,
): Promise<UpdateResult> {
  const { root } = options;
  const today = formatLocalDate(options.now ?? new Date());

  try {
    const existing = await loadForWrite(root);
    if (!Array.isArray(existing)) return existing;

    const index = existing.findIndex((item) => item.id.toLowerCase() === id.toLowerCase());
    if (index === -1) return fail("not-found", `没有这条资源：${id}`);

    const before = existing[index];
    if (options.expectRevision && !options.force) {
      if (resourceRevision(before) !== options.expectRevision) {
        return fail(
          "stale",
          "这条资源在你打开之后被改过（另一个标签页、或别的编辑器）。为避免覆盖，这次没有保存。",
        );
      }
    }

    const record = {
      ...before,
      ...input,
      title: input.title.trim(),
      url: input.url.trim(),
      category: input.category.trim(),
      id: before.id,
      createdAt: before.createdAt,
      updatedAt: today,
    };
    const parsed = resourceSchema.safeParse(record);
    if (!parsed.success) {
      return fail("invalid", parsed.error.issues.map((issue) => issue.message).join("；"));
    }

    const next = [...existing];
    next[index] = parsed.data;
    await writeList(root, next);
    return { ok: true, id: before.id, revision: resourceRevision(parsed.data) };
  } catch (error) {
    return fail("io", `写入失败：${message(error)}`);
  }
}

/** 删除 = 从 JSON 里移除 + 把这条记录追加到 `content/.trash/resources-deleted.jsonl` */
export function deleteResource(id: string, options: StoreOptions): Promise<DeleteResult> {
  return serialize(() => deleteResourceUnlocked(id, options));
}

async function deleteResourceUnlocked(id: string, options: StoreOptions): Promise<DeleteResult> {
  const { root } = options;
  const now = options.now ?? new Date();

  try {
    const existing = await loadForWrite(root);
    if (!Array.isArray(existing)) return existing;

    const index = existing.findIndex((item) => item.id.toLowerCase() === id.toLowerCase());
    if (index === -1) return fail("not-found", `没有这条资源：${id}`);

    const removed = existing[index];
    const next = existing.filter((_, i) => i !== index);
    await writeList(root, next);

    const trashDir = path.join(root, ".trash");
    const trashFile = path.join(trashDir, "resources-deleted.jsonl");
    const relative = path.relative(path.resolve(root), path.resolve(trashFile));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return fail("invalid", "回收站路径跑出了内容目录，已取消删除");
    }

    await fs.mkdir(trashDir, { recursive: true });
    let previous = "";
    try {
      previous = await fs.readFile(/*turbopackIgnore: true*/ trashFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const line = `${JSON.stringify({
      deletedAt: formatLocalStamp(now),
      resource: removed,
    })}\n`;
    await writeFileAtomic(trashFile, `${previous}${line}`);

    return { ok: true, id: removed.id, trashFile };
  } catch (error) {
    return fail("io", `删除失败：${message(error)}`);
  }
}
