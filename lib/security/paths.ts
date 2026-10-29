import path from "node:path";

/**
 * 文章 id ↔ 文件路径的唯一入口（阶段 3 的 CRUD 必须只走这里）。
 *
 * 为什么单独一个文件：文章正文是「权威数据」，路径一旦能被外部输入影响，
 * 一条 `../` 就能写到项目外面去。这种校验散落在各处迟早漏一处，所以集中在这里，
 * 并由 tests/security-paths.test.ts 拿恶意样本挨个撞。
 */

/** 正文目录（相对仓库根，见需求书 §4） */
export const ARTICLES_DIR = path.join("content", "articles");

/**
 * 允许的 id：小写字母/数字开头，允许中间有连字符，总长 1–64。
 * 故意要窄 —— id 由我们生成，不需要容纳任意标题。
 */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Windows 保留设备名：`con.md` 这种文件名在 Windows 上会出怪事 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

export function isSafeArticleId(id: string): boolean {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return false;
  if (WINDOWS_RESERVED.test(id)) return false;
  return true;
}

export function assertSafeArticleId(id: string): string {
  if (!isSafeArticleId(id)) {
    throw new UnsafePathError(`不安全的文章 id：${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * id → 绝对路径。
 * 两道防线：① id 白名单；② 解析后必须仍落在 articles 目录内。
 * 第二道是为了「即便第一道哪天被放宽，也不会立刻变成路径穿越」。
 */
export function resolveArticlePath(articlesRoot: string, id: string, ext = ".md"): string {
  assertSafeArticleId(id);
  const root = path.resolve(articlesRoot);
  const full = path.resolve(root, `${id}${ext}`);
  const relative = path.relative(root, full);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes(`..${path.sep}`)
  ) {
    throw new UnsafePathError(`文章路径跑出了正文目录：${relative}`);
  }
  return full;
}

/** 从文件路径反推 id（用于读目录时拿到 id，保证读回来的 id 一定合法） */
export function articleIdFromPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return assertSafeArticleId(base);
}
