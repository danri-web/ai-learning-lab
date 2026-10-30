/**
 * 任务表单的状态（Server Action 的返回值）。
 * 同 articles / resources 的 form-state：`"use server"` 模块只能导出 async 函数，
 * 所以常量与类型放这里。
 */

export type TaskFormState = {
  status: "idle" | "error";
  error?: string;
  fieldErrors?: Record<string, string>;
  code?: "stale";
};

export const INITIAL_TASK_FORM_STATE: TaskFormState = { status: "idle" };
