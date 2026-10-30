import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  daysBetween,
  dueInfo,
  filterTasks,
  isOverdue,
  isRealDate,
  readTasks,
  sortTasks,
  summarizeTasks,
  taskRevision,
  type Task,
} from "@/lib/content/tasks";

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "tasks");
const TODAY = "2026-10-30";

/** 临时目录：落在 node_modules 里（`mkdtemp` 在受限沙箱会 EPERM，见交接 §7） */
async function tempRoot(name: string): Promise<string> {
  const dir = path.join(process.cwd(), "node_modules", ".vitest-tmp", "tasks", name);
  await mkdir(dir, { recursive: true });
  return dir;
}

const VALID = {
  id: "task-demo",
  title: "演示任务",
  status: "todo",
  dueDate: "2026-11-05",
  note: "",
  articleIds: [],
  resourceIds: [],
  createdAt: "2026-10-01",
  updatedAt: "2026-10-02",
};

describe("任务文件的读与校验", () => {
  it("合法文件读出全部任务", async () => {
    const result = await readTasks(FIXTURES);
    expect(result.problem).toBeNull();
    expect(result.missing).toBe(false);
    expect(result.tasks).toHaveLength(4);
    // 关联是数组，且按原样读出来
    const first = result.tasks[0];
    expect(first.articleIds).toEqual(["注意力机制"]);
    expect(first.resourceIds).toEqual(["attention-paper"]);
  });

  it("文件不存在 = missing，不是错误（第一次用本来就该是空的）", async () => {
    const result = await readTasks(path.join(FIXTURES, "definitely-not-here"));
    expect(result).toMatchObject({ tasks: [], problem: null, missing: true });
  });

  it("带 UTF-8 BOM 的文件照样能读（记事本 / PowerShell 手改出来的都带）", async () => {
    const root = await tempRoot("bom");
    const body = JSON.stringify({ version: 1, tasks: [VALID] }, null, 2);
    // \uFEFF 就是 BOM：JSON.parse 自己不认，入口必须剥掉
    await writeFile(path.join(root, "tasks.json"), `\uFEFF${body}`, "utf8");

    const result = await readTasks(root);
    expect(result.problem).toBeNull();
    expect(result.tasks.map((task) => task.id)).toEqual(["task-demo"]);
  });

  it.each([
    ["不是合法 JSON", "{ 这不是 json"],
    ["结构不对（缺 version）", JSON.stringify({ tasks: [] })],
  ])("%s → 报出问题，而不是抛异常", async (_label, source) => {
    const root = await tempRoot(Buffer.from(_label).toString("hex").slice(0, 12));
    await writeFile(path.join(root, "tasks.json"), source, "utf8");
    const result = await readTasks(root);
    expect(result.problem).toBeTruthy();
    expect(result.tasks).toEqual([]);
  });

  it.each([
    ["状态不在三档里", { ...VALID, status: "paused" }],
    ["截止日期格式不对", { ...VALID, dueDate: "2026/11/05" }],
    ["截止日期不存在（2026-02-30）", { ...VALID, dueDate: "2026-02-30" }],
    ["updatedAt 早于 createdAt", { ...VALID, createdAt: "2026-10-05", updatedAt: "2026-10-01" }],
    ["关联的 id 带路径穿越", { ...VALID, articleIds: ["../etc/passwd"] }],
    ["标题空白", { ...VALID, title: "   " }],
  ])("坏记录被拒绝：%s", async (label, record) => {
    const root = await tempRoot(
      `bad-${label.replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "x"}`,
    );
    await writeFile(
      path.join(root, "tasks.json"),
      JSON.stringify({ version: 1, tasks: [record] }),
      "utf8",
    );
    const result = await readTasks(root);
    expect(result.problem).toBeTruthy();
    expect(result.tasks).toEqual([]);
  });

  it.each([
    ["闰年 2024-02-29", "2024-02-29", true],
    ["平年 2026-02-29", "2026-02-29", false],
    ["月份 13", "2026-13-01", false],
    ["格式对但日 32", "2026-01-32", false],
    ["正常日期", "2026-10-30", true],
  ])("日期存在性：%s", (_label, value, expected) => {
    expect(isRealDate(value)).toBe(expected);
  });
});

describe("统计与逾期口径", () => {
  it("四个数字由同一份数据算出来；**已完成的任务不算逾期**", async () => {
    const { tasks } = await readTasks(FIXTURES);
    expect(summarizeTasks(tasks, TODAY)).toEqual({
      total: 4,
      todo: 2,
      doing: 1,
      done: 1,
      overdue: 1, // 只有 doing 那条（10-28）逾期；done 那条（10-20）不算
    });
  });

  it("空列表的统计全是 0（总览页第一次打开不能崩）", () => {
    expect(summarizeTasks([], TODAY)).toEqual({
      total: 0,
      todo: 0,
      doing: 0,
      done: 0,
      overdue: 0,
    });
  });

  it.each([
    ["逾期", { dueDate: "2026-10-28", status: "todo" as const }, "逾期 2 天", "overdue"],
    ["今天到期", { dueDate: TODAY, status: "todo" as const }, "今天到期", "soon"],
    ["还剩 3 天", { dueDate: "2026-11-02", status: "doing" as const }, "还剩 3 天", "soon"],
    ["还早", { dueDate: "2026-12-01", status: "todo" as const }, "截止 2026-12-01", "normal"],
    ["已完成喊什么逾期", { dueDate: "2026-10-01", status: "done" as const }, "截止 2026-10-01", "normal"],
    ["没有截止日期", { status: "todo" as const }, "没有截止日期", "none"],
  ])("截止日期说人话：%s", (_label, task, text, tone) => {
    expect(dueInfo(task, TODAY)).toEqual({ text, tone });
  });

  it("isOverdue 与 dueInfo 同一个口径（两处各写一遍迟早会漂）", async () => {
    const { tasks } = await readTasks(FIXTURES);
    for (const task of tasks) {
      expect(isOverdue(task, TODAY)).toBe(dueInfo(task, TODAY).tone === "overdue");
    }
  });

  it("跨月/跨年算天数（用 UTC，夏令时不影响）", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-30", "2026-10-28")).toBe(-2);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // 闰年
  });
});

describe("筛选与排序", () => {
  it("按状态筛选；不传状态就是全部", async () => {
    const { tasks } = await readTasks(FIXTURES);
    expect(filterTasks(tasks, { status: "todo" })).toHaveLength(2);
    expect(filterTasks(tasks, { status: "done" }).map((task) => task.id)).toEqual(["task-rnn-notes"]);
    expect(filterTasks(tasks, {})).toHaveLength(4);
  });

  it("按截止日期：已完成沉底、有日期的在前、没日期的在最后", async () => {
    const { tasks } = await readTasks(FIXTURES);
    expect(sortTasks(tasks, "due").map((task) => task.id)).toEqual([
      "task-transformer-attention", // 10-28 逾期，最急
      "task-python-basics", // 11-02
      "task-agent-survey", // 没有日期
      "task-rnn-notes", // 已完成，沉底
    ]);
  });

  it("按更新 / 按创建都是倒序", async () => {
    const { tasks } = await readTasks(FIXTURES);
    expect(sortTasks(tasks, "updated")[0].id).toBe("task-transformer-attention");
    expect(sortTasks(tasks, "created")[0].id).toBe("task-agent-survey");
  });

  it("排序是稳定的：同样的数据排两次结果完全一致", async () => {
    const { tasks } = await readTasks(FIXTURES);
    for (const sort of ["due", "updated", "created"] as const) {
      expect(sortTasks(tasks, sort).map((task) => task.id)).toEqual(
        sortTasks(tasks, sort).map((task) => task.id),
      );
    }
  });
});

describe("指纹（过期保存检查用）", () => {
  it("同一个对象指纹稳定，改一个字段就变", () => {
    const base = VALID as unknown as Task;
    expect(taskRevision(base)).toBe(taskRevision({ ...base }));
    expect(taskRevision(base)).not.toBe(taskRevision({ ...base, status: "done" as const }));
    expect(taskRevision(base)).not.toBe(taskRevision({ ...base, title: "改个名" }));
  });
});
