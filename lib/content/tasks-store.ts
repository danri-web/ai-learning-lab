import { promises as fs } from "node:fs";
import path from "node:path";

import { formatLocalDate, formatLocalStamp } from "@/lib/content/clock";
import { revisionOf } from "@/lib/content/revision";
import {
  readTasks,
  taskFileSchema,
  taskRevision,
  taskSchema,
  tasksFile,
  type Task,
} from "@/lib/content/tasks";
import type { TaskStatus } from "@/lib/content/task-types";
import { uniqueIdForTitle } from "@/lib/content/unique-id";
import { writeFileAtomic } from "@/lib/fs/atomic-write";
import { serialize } from "@/lib/fs/mutex";

/**
 * 学习任务的**写**（阶段 6），和资源收藏（D9）同一套地基：
 *   1. 写操作进程内串行（`serialize`）—— 两个并发新建不会算出同一个 id
 *   2. 原子写（`writeFileAtomic`）—— 要么旧文件、要么新文件，不留半截 JSON
 *   3. 写前自检 + 删除留档（`content/.trash/tasks-deleted.jsonl`）
 *   4. 单条指纹做"过期保存"检查（D8 同款）
 *
 * 一个 JSON 文件是真相（D1/D11）：改一条 = 重写整个文件。几百条以内这仍然是最便宜、
 * 备份最容易做对的形态。
 */

export type TaskInput = {
  title: string;
  status: TaskStatus;
  dueDate?: string;
  note: string;
  articleIds: string[];
  resourceIds: string[];
};

export type StoreFailureReason = "invalid" | "not-found" | "stale" | "io";

export type StoreFailure = { ok: false; reason: StoreFailureReason; error: string };

export type CreateResult = { ok: true; id: string; revision: string } | StoreFailure;
export type UpdateResult = { ok: true; id: string; revision: string } | StoreFailure;
export type DeleteResult = { ok: true; id: string; trashFile: string } | StoreFailure;

export type StoreOptions = { root: string; now?: Date };

export type UpdateOptions = StoreOptions & {
  /** 编辑页打开时那条任务的指纹，对不上就拒绝（D8） */
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
async function writeList(root: string, tasks: Task[]): Promise<string> {
  const body = `${JSON.stringify({ version: 1, tasks }, null, 2)}\n`;
  const check = taskFileSchema.safeParse(JSON.parse(body));
  if (!check.success) {
    throw new Error(`生成的 tasks.json 不合法：${check.error.issues[0]?.message ?? "未知原因"}`);
  }

  await fs.mkdir(root, { recursive: true });
  await writeFileAtomic(tasksFile(root), body);
  return revisionOf(body);
}

/** 读当前列表；文件坏了就**拒绝写入**（不覆盖用户的坏文件） */
async function loadForWrite(root: string): Promise<Task[] | StoreFailure> {
  const current = await readTasks(root);
  if (current.problem) {
    return fail(
      "invalid",
      `${current.problem}（先修好这个文件再改；应用不会覆盖它，免得连坏掉的内容一起丢）`,
    );
  }
  return current.tasks;
}

/** 把输入整成要落盘的记录（新建与保存共用，免得两处校验不一致） */
function buildRecord(input: TaskInput, base: { id: string; createdAt: string }, today: string) {
  const record = {
    ...input,
    title: input.title.trim(),
    note: input.note.trim(),
    // 空的截止日期 = 没有截止日期，不要写成空字符串（schema 是 optional）
    dueDate: input.dueDate && input.dueDate.trim() ? input.dueDate.trim() : undefined,
    articleIds: [...new Set(input.articleIds)],
    resourceIds: [...new Set(input.resourceIds)],
    id: base.id,
    createdAt: base.createdAt,
    updatedAt: today,
  };
  const parsed = taskSchema.safeParse(record);
  if (!parsed.success) {
    return fail("invalid", parsed.error.issues.map((issue) => issue.message).join("；"));
  }
  return { ok: true as const, task: parsed.data };
}

export function createTask(input: TaskInput, options: StoreOptions): Promise<CreateResult> {
  return serialize(() => createTaskUnlocked(input, options));
}

async function createTaskUnlocked(input: TaskInput, options: StoreOptions): Promise<CreateResult> {
  const { root } = options;
  const today = formatLocalDate(options.now ?? new Date());

  if (!input.title.trim()) return fail("invalid", "标题不能为空");

  try {
    const existing = await loadForWrite(root);
    if (!Array.isArray(existing)) return existing;

    const taken = new Set(existing.map((task) => task.id.toLowerCase()));
    const id = uniqueIdForTitle(input.title, taken);
    if (!id) return fail("invalid", "同名任务太多，换个标题再建");

    const built = buildRecord(input, { id, createdAt: today }, today);
    if (!built.ok) return built;

    await writeList(root, [...existing, built.task]);
    return { ok: true, id, revision: taskRevision(built.task) };
  } catch (error) {
    return fail("io", `写入失败：${message(error)}`);
  }
}

export function updateTask(
  id: string,
  input: TaskInput,
  options: UpdateOptions,
): Promise<UpdateResult> {
  return serialize(() => updateTaskUnlocked(id, input, options));
}

async function updateTaskUnlocked(
  id: string,
  input: TaskInput,
  options: UpdateOptions,
): Promise<UpdateResult> {
  const { root } = options;
  const today = formatLocalDate(options.now ?? new Date());

  try {
    const existing = await loadForWrite(root);
    if (!Array.isArray(existing)) return existing;

    const index = existing.findIndex((task) => task.id.toLowerCase() === id.toLowerCase());
    if (index === -1) return fail("not-found", `没有这条任务：${id}`);

    const before = existing[index];
    if (options.expectRevision && !options.force) {
      if (taskRevision(before) !== options.expectRevision) {
        return fail(
          "stale",
          "这条任务在你打开之后被改过（另一个标签页，或你在列表上换过状态）。为避免覆盖，这次没有保存。",
        );
      }
    }

    const built = buildRecord(input, { id: before.id, createdAt: before.createdAt }, today);
    if (!built.ok) return built;

    const next = [...existing];
    next[index] = built.task;
    await writeList(root, next);
    return { ok: true, id: before.id, revision: taskRevision(built.task) };
  } catch (error) {
    return fail("io", `写入失败：${message(error)}`);
  }
}

/**
 * 只改状态（列表上的三档按钮）。单独一条路径，不是"图省事的 UPDATE"：
 * 它**只动 status 与 updatedAt**，不重写用户正在编辑的其它字段，
 * 所以列表上点一下状态不会把别处的草稿覆盖掉。
 */
export function updateTaskStatus(
  id: string,
  status: TaskStatus,
  options: StoreOptions,
): Promise<UpdateResult> {
  return serialize(() => updateTaskStatusUnlocked(id, status, options));
}

async function updateTaskStatusUnlocked(
  id: string,
  status: TaskStatus,
  options: StoreOptions,
): Promise<UpdateResult> {
  const { root } = options;
  const today = formatLocalDate(options.now ?? new Date());

  try {
    const existing = await loadForWrite(root);
    if (!Array.isArray(existing)) return existing;

    const index = existing.findIndex((task) => task.id.toLowerCase() === id.toLowerCase());
    if (index === -1) return fail("not-found", `没有这条任务：${id}`);

    const before = existing[index];
    const parsed = taskSchema.safeParse({ ...before, status, updatedAt: today });
    if (!parsed.success) {
      return fail("invalid", parsed.error.issues.map((issue) => issue.message).join("；"));
    }

    const next = [...existing];
    next[index] = parsed.data;
    await writeList(root, next);
    return { ok: true, id: before.id, revision: taskRevision(parsed.data) };
  } catch (error) {
    return fail("io", `改状态失败：${message(error)}`);
  }
}

/** 删除 = 从 JSON 里移除 + 把这条记录追加到 `content/.trash/tasks-deleted.jsonl` */
export function deleteTask(id: string, options: StoreOptions): Promise<DeleteResult> {
  return serialize(() => deleteTaskUnlocked(id, options));
}

async function deleteTaskUnlocked(id: string, options: StoreOptions): Promise<DeleteResult> {
  const { root } = options;
  const now = options.now ?? new Date();

  try {
    const existing = await loadForWrite(root);
    if (!Array.isArray(existing)) return existing;

    const index = existing.findIndex((task) => task.id.toLowerCase() === id.toLowerCase());
    if (index === -1) return fail("not-found", `没有这条任务：${id}`);

    const removed = existing[index];
    const next = existing.filter((_, i) => i !== index);
    await writeList(root, next);

    const trashDir = path.join(root, ".trash");
    const trashFile = path.join(trashDir, "tasks-deleted.jsonl");
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
    const line = `${JSON.stringify({ deletedAt: formatLocalStamp(now), task: removed })}\n`;
    await writeFileAtomic(trashFile, `${previous}${line}`);

    return { ok: true, id: removed.id, trashFile };
  } catch (error) {
    return fail("io", `删除失败：${message(error)}`);
  }
}
