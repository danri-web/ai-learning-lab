/**
 * 恢复结果的类型（纯类型，不 import 任何运行时代码）。
 *
 * 单独放一份的原因：`lib/content/restore-startup.ts` 要跨 bundle 传这个类型，
 * 而源码闸门只允许 backup service 出现 `restore-store` 的字符串（连 type-only import 也算）。
 * 类型放在这里，两边都用它，谁也不用从 restore-store 借。
 */

export type RestoreRecovery =
  | { state: "none" }
  | { state: "recovered"; snapshot: string }
  | { state: "already-complete"; snapshot: string }
  | { state: "failed"; snapshot: string | null; error: string };
