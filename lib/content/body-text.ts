/**
 * 正文的空白契约（审计 v3 F3）。
 *
 * 之前的写法是 `body.trim()` —— 存也 trim、读也 trim。后果：正文以 4 个空格开头的
 * **缩进代码块**被压平成了普通段落，Markdown 语义变了；行尾两个空格（硬换行）在末尾时也会掉。
 *
 * 现在的契约只有一条：
 *   **只归一两端的空行**（开头的空行、结尾的换行），行首缩进与行尾空格一律原样保留。
 *
 * 这样 `parseArticle` 与 `renderSource` 用同一个函数，写进去什么，读回来就是什么，
 * 并且由 `lib/content/write.ts` 的 round-trip 等式断言守着。
 */
export function normalizeArticleBody(body: string): string {
  return body
    .replace(/^(?:[ \t]*\r?\n)+/, "") // 开头的空行（不动第一行真正内容的缩进）
    .replace(/(?:\r?\n)+$/, ""); // 结尾的换行 / 空行（不动行尾空格）
}
