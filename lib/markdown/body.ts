/**
 * 正文整形：把与标题重复的首个 H1 去掉。
 *
 * 为什么：详情页的页头已经显示了标题，正文里再写一次 `# 标题` 就会渲染两遍
 * （绝大多数笔记都会这么写，因为 Markdown 习惯第一行写标题）。
 * 只去掉「和标题一致的那一个」，正文里其它 H1 不动 —— 不做聪明的猜测。
 */
export function stripLeadingDuplicateH1(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") index += 1;

  const first = lines[index];
  if (!first) return markdown;

  const heading = /^#\s+(.+?)\s*#*$/.exec(first.trim());
  if (!heading) return markdown;

  const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalize(heading[1]) !== normalize(title)) return markdown;

  return lines
    .slice(index + 1)
    .join("\n")
    .replace(/^\n+/, "");
}
