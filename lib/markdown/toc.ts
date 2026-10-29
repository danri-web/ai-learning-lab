/**
 * 文章目录（TOC）。
 *
 * 为什么不用插件自动收集：目录必须在**渲染之前**就算好（侧栏要先排版），
 * 而 react-markdown 的组件回调是渲染期才执行的。所以这里直接扫 markdown 原文，
 * 并且和渲染器用**同一个** slugify，保证"标题的 id" 与 "目录的锚点" 永远一致。
 */

export type TocEntry = { id: string; text: string; level: 2 | 3 };

/** 标题 → 锚点 id。允许中文（HTML5 的 id 可以是非 ASCII） */
export function slugifyHeading(text: string): string {
  const cleaned = text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[*_~]/g, "")
    .trim()
    .toLowerCase();
  const slug = cleaned.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  return slug || "section";
}

/**
 * 从 markdown 原文提取 h2 / h3。
 * 会跳过 ``` 代码块里的 "## 看起来像标题" 的行（这是最容易出错的边界）。
 */
export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{2,3})\s+(.+?)\s*#*$/.exec(trimmed);
    if (!match) continue;

    const text = match[2].trim();
    const base = slugifyHeading(text);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    entries.push({
      id: count === 0 ? base : `${base}-${count}`,
      text,
      level: match[1].length === 2 ? 2 : 3,
    });
  }

  return entries;
}
