import { promises as fs } from "node:fs";
import path from "node:path";

import { isSafeArticleId } from "@/lib/security/article-id";

/**
 * 文章 id ↔ 文件路径的唯一入口（阶段 3 的 CRUD 必须只走这里）。
 *
 * 为什么单独一个文件：文章正文是「权威数据」，路径一旦能被外部输入影响，
 * 一条 `../` 就能写到项目外面去。这种校验散落在各处迟早漏一处，所以集中在这里，
 * 并由 tests/security-paths.test.ts 拿恶意样本挨个撞。
 *
 * ⚠️ 两个入口，别用错：
 *   - `resolveArticlePath`：**纯字符串**校验，同步、不碰文件系统。只防 `../` 这类字面穿越，
 *     防不住符号链接 / 目录联接（Windows 的 junction 不需要管理员权限就能建）。
 *   - `resolveArticleFile`：**读写文件时唯一该用的**。在字符串校验之上再查一遍物理路径
 *     （正文目录不能是链接、目标文件不能是链接），由 tests/security-links.test.ts 用真实
 *     junction 验证过。外部审计（P2-F2）指出的正是前者的局限。
 */

/** 正文目录（相对仓库根，见需求书 §4） */
export const ARTICLES_DIR = path.join("content", "articles");

/** 删除时把文件挪进这个子目录（`_` 与 `.` 开头的名字不进列表，所以它天然不可见） */
export const TRASH_DIR_NAME = ".trash";

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

/**
 * id 的形状规则住在 `lib/security/article-id.ts`（路径闸门、frontmatter 校验、slug 生成共用一份）。
 * 这里重新导出，是为了让调用方只需要认识「路径」这一个模块。
 */
export { isSafeArticleId };

export function assertSafeArticleId(id: string): string {
  if (!isSafeArticleId(id)) {
    throw new UnsafePathError(`不安全的文章 id：${JSON.stringify(id)}`);
  }
  return id;
}

/**
 * id → 绝对路径（**纯字符串**校验，同步）。
 *
 * 扩展名固定 `.md`，不接受外部传入 —— 之前留了个 `ext` 参数，外部审计（P3-F4）指出
 * 它的测试描述和断言互相矛盾（名字说"拒绝 .exe"，断言却是"不抛错"）。干脆去掉这个口子：
 * 少一个能传错的地方，就少一类说不清的测试。
 */
export function resolveArticlePath(articlesRoot: string, id: string): string {
  assertSafeArticleId(id);
  const root = path.resolve(articlesRoot);
  const full = path.resolve(root, `${id}.md`);
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

/**
 * 读写文件时**唯一**该用的入口：在字符串校验之上再加一层物理校验。
 *
 * 外部审计（P2-F2）指出 `resolveArticlePath` 只在词法层面成立：正文目录如果是个
 * 目录联接（Windows junction，不需要管理员权限就能建），路径字符串看着在目录里，
 * 实际写到别处去了。所以这里额外做三件事：
 *   ① 正文目录必须存在、必须是真目录、不能是链接；
 *   ② 目标文件如果已存在且是链接，拒绝（避免写穿）；
 *   ③ 目标文件真实路径必须仍在正文目录的真实路径之内。
 *
 * 已知残余风险（文档化，不再假装解决）：
 *   - 检查与使用之间仍有竞态窗口（TOCTOU）：如果另一个进程在这两步之间把目录换成链接，
 *     本函数挡不住。本地单用户应用接受这个前提。
 *   - 硬链接无法用 realpath 区分（同一份数据有两个名字），但它不能把写入"搬"到目录外，
 *     所以不在防线范围内。
 */
/**
 * Windows / macOS 的常见文件系统大小写不敏感：`fs.realpath()` 返回的是**规范大小写**，
 * 而调用方传进来的可能是别的写法（同一路径全大写 vs 全小写）。
 * 用大小写敏感的比较去判等，会把合法目录误判成"被链接过的目录"直接拒绝。
 * 这是外部审计 v2 的 F1 指出的问题 —— 修好后别再改回 `!==`。
 */
const CASE_INSENSITIVE_FS = process.platform === "win32" || process.platform === "darwin";

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return CASE_INSENSITIVE_FS ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export async function resolveArticleFile(articlesRoot: string, id: string): Promise<string> {
  const full = resolveArticlePath(articlesRoot, id);
  const realRoot = await assertArticlesRoot(articlesRoot);

  await assertNotLinkAndInside(realRoot, full);
  return full;
}

/**
 * 正文目录的物理校验：存在、是真目录、不是链接、真实路径与预期一致。
 * 返回**真实路径**（`resolveArticleFile` 与 `.trash` 的路径都用它当基准）。
 */
async function assertArticlesRoot(articlesRoot: string): Promise<string> {
  const root = path.resolve(articlesRoot);
  const rootStat = await fs.lstat(root).catch(() => null);
  if (!rootStat) throw new UnsafePathError(`正文目录不存在：${root}`);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new UnsafePathError(`正文目录不是普通目录，不支持（可能是 junction/symlink）：${root}`);
  }

  const realRoot = await fs.realpath(root);
  if (!samePath(realRoot, root)) {
    throw new UnsafePathError(`正文目录解析后与预期不一致：${realRoot}`);
  }
  return realRoot;
}

/** 目标文件不能是链接；已存在时真实路径必须仍在给定目录里 */
async function assertNotLinkAndInside(realDir: string, full: string): Promise<void> {
  const targetStat = await fs.lstat(full).catch(() => null);
  if (targetStat?.isSymbolicLink()) {
    throw new UnsafePathError(`目标文件是链接，拒绝写入：${full}`);
  }
  if (targetStat) {
    const realTarget = await fs.realpath(full);
    const relative = path.relative(realDir, realTarget);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new UnsafePathError(`目标文件真实路径跑出了目录：${realTarget}`);
    }
  }
}

/**
 * 回收站里那个文件的目标路径（删除 = 移动，不是真删）。
 *
 * `fileName` 是**我们自己拼的**（`20261030-153012-注意力机制.md`），但仍然走一遍校验：
 * 「内部生成所以一定安全」这种假设，一旦哪天有人加了个参数就会破。
 */
export async function resolveTrashFile(articlesRoot: string, fileName: string): Promise<string> {
  if (
    typeof fileName !== "string" ||
    fileName.length === 0 ||
    fileName.length > 200 ||
    fileName.startsWith(".") ||
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\") ||
    !fileName.toLowerCase().endsWith(".md")
  ) {
    throw new UnsafePathError(`不合法的回收站文件名：${JSON.stringify(fileName)}`);
  }

  const realRoot = await assertArticlesRoot(articlesRoot);
  const trashDir = path.join(path.resolve(articlesRoot), TRASH_DIR_NAME);
  await fs.mkdir(trashDir, { recursive: true });

  const dirStat = await fs.lstat(trashDir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new UnsafePathError(`回收站不是普通目录，拒绝写入：${trashDir}`);
  }
  const realTrash = await fs.realpath(trashDir);
  if (!samePath(realTrash, trashDir)) {
    throw new UnsafePathError(`回收站解析后与预期不一致：${realTrash}`);
  }

  // 回收站本身也必须在正文目录里（防止有人把 .trash 换成指到外面的 junction）
  const relativeTrash = path.relative(realRoot, realTrash);
  if (relativeTrash.startsWith("..") || path.isAbsolute(relativeTrash)) {
    throw new UnsafePathError(`回收站跑出了正文目录：${realTrash}`);
  }

  const full = path.join(trashDir, fileName);
  await assertNotLinkAndInside(realTrash, full);
  return full;
}

/** 从文件路径反推 id（用于读目录时拿到 id，保证读回来的 id 一定合法） */
export function articleIdFromPath(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath));
  return assertSafeArticleId(base);
}
