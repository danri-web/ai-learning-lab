import { createHash } from "node:crypto";

/**
 * 正文的「版本号」（审计 v3 F2）。
 *
 * 用途只有一个：编辑器打开时把当时的正文指纹带在表单里提交回来，保存前比对 ——
 * 不一致说明**这次提交的稿子是基于旧版本的**，直接写就会把别人的改动静默顶掉
 * （两个标签页、或者你在 VS Code 里改过还没刷新页面，都会这样）。
 *
 * 为什么用内容哈希而不是 mtime：
 *   - mtime 在某粒文件系统上精度只有 2 秒，快速连续保存会漏判；
 *   - 复制/同步工具会改 mtime 但不改内容（误报冲突）；
 *   - 内容哈希只认"内容真的变了"，两个方向的误判都少。
 *
 * sha256 取前 32 位十六进制：本地单用户场景，碰撞概率可以忽略，表单字段还短。
 */
export function revisionOf(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex").slice(0, 32);
}
