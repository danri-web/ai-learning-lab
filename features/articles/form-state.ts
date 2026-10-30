/**
 * 表单状态（Server Action 的返回值）。
 *
 * 单独一个文件，不放在 actions.ts 里：`"use server"` 模块**只能导出 async 函数**，
 * 导出一个常量会让构建直接报错（"A 'use server' file can only export async functions"）。
 * 类型与初始值放这里，服务端和客户端都能 import。
 */

export type FormState = {
  status: "idle" | "error";
  error?: string;
  fieldErrors?: Record<string, string>;
  /** "stale" = 这篇笔记在你打开后被改过（编辑器据此多显示一个「覆盖保存」） */
  code?: "stale";
};

export const INITIAL_FORM_STATE: FormState = { status: "idle" };
