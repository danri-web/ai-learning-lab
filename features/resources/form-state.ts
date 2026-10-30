/**
 * 资源表单的状态（Server Action 的返回值）。
 * 同 articles 的 form-state：`"use server"` 模块只能导出 async 函数，所以常量和类型放这里。
 */

export type ResourceFormState = {
  status: "idle" | "error";
  error?: string;
  fieldErrors?: Record<string, string>;
  code?: "stale";
};

export const INITIAL_RESOURCE_FORM_STATE: ResourceFormState = { status: "idle" };
