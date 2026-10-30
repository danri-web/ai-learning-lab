import { nextHeadingId, slugifyHeading } from "@/lib/markdown/heading-ids";

/**
 * 文章目录（TOC）。
 *
 * 为什么不用插件自动收集：目录必须在**渲染之前**就算好（侧栏要先排版），
 * 而 react-markdown 的组件回调是渲染期才执行的。所以这里直接扫 markdown 原文，
 * 但**锚点 id 的分配逻辑与渲染器共用同一份**（`lib/markdown/heading-ids.ts`）——
 * 审计 v3 的 F4 就是这两边各写了一套、后缀规则不一致，导致同名标题的目录链接没有落点。
 */

export { slugifyHeading };

export type TocEntry = { id: string; text: string; level: 2 | 3 };

/** 标题文字里的行内语法（链接/图片）要还原成纯文字，否则 slug 会带上 URL */
function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
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

    const text = plainInline(match[2]);
    entries.push({
      id: nextHeadingId(text, seen),
      text,
      level: match[1].length === 2 ? 2 : 3,
    });
  }

  return entries;
}
