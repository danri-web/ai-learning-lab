/**
 * 文章 id 的**形状**规则（纯字符串，不碰文件系统）。
 *
 * 单独一个文件的原因：id 同时是**文件名**（docs/架构决策.md D3），
 * 所以「什么算合法 id」会被三个地方同时用到 —— 路径闸门（`lib/security/paths.ts`）、
 * frontmatter 校验（`lib/content/frontmatter.ts`）、新建时的 slug 生成（`lib/content/id.ts`）。
 * 三处各写一份正则，迟早有一处漂移，而漂移的那一次就是写到目录外面的那一次。
 *
 * 2026-10-30 起允许中文（ADR D7）：字母/数字开头，之后可以有 `-` 和 `_`。
 * 放宽的是**字符集**，不是**结构**：
 *   - 仍然禁止路径分隔符、点号、空格、控制字符 → `../`、`a.md.md`、`CON ` 这类都进不来
 *   - 仍然禁止 Windows 保留设备名（`con.md` 在 Windows 上会变成设备文件）
 *   - 仍然有 64 位上限（文件名离 255 还远，但列表页与 URL 都要能用）
 */

export const MAX_ID_LENGTH = 64;

/**
 * 允许：字母或数字开头，之后字母/数字/连字符/下划线，总计 1–64 位。
 *
 * `\p{L}` / `\p{N}` 覆盖中日韩等所有语言的「文字」，中文标题因此能直接当文件名；
 * 点号、斜杠、反斜杠、空格、制表符、零宽字符（Cf 类）全在字符集之外，天然被拒。
 */
const ID_SOURCE = String.raw`[\p{L}\p{N}][\p{L}\p{N}\-_]{0,63}`;

export const ARTICLE_ID_PATTERN = new RegExp(`^${ID_SOURCE}$`, "u");

/** 给 zod 用的同一份规则（两处共用一个字符串，改一处就够） */
export const ARTICLE_ID_REGEX_SOURCE = `^${ID_SOURCE}$`;

export const ARTICLE_ID_MESSAGE =
  "id 只能由字母、数字、连字符和下划线组成（中文可用），1–64 位，且必须以字母或数字开头";

/**
 * 与文件内容无关、但会让「文件明明在、却开不了」的名字。
 *
 * Windows 设备名：`con.md` 这样的文件在 Windows 上会被当成设备，写进去的东西读不回来。
 * `new`：`/knowledge/new` 是新建页的路由，任何笔记叫 `new` 都会被它遮住、永远打不开。
 * 这些名字改成 `note-con`、`new-2` 之类都能正常工作（`curl` 之类的事不在本应用范围）。
 */
const RESERVED_IDS = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
  "new",
]);

export function isReservedArticleId(name: string): boolean {
  return RESERVED_IDS.has(name.toLowerCase());
}

export function isSafeArticleId(id: unknown): boolean {
  if (typeof id !== "string") return false;
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  if (!ARTICLE_ID_PATTERN.test(id)) return false;
  return !isReservedArticleId(id);
}
