/**
 * 标题锚点的**唯一分配逻辑**（审计 v3 F4）。
 *
 * 之前有两套：
 *   - 侧栏目录（`extractToc`）会给同名标题加后缀：`example`、`example-1`
 *   - 渲染器（`ArticleMarkdown` 的 h2/h3 覆盖）每遇到一个标题就 `slugifyHeading(children)` —— 不加后缀
 * 于是正文里出现两个 `## Example` 时，DOM 里是两个同名 id，目录里第二个链接（`#example-1`）没有落点。
 *
 * 现在两边都走 `nextHeadingId(text, seen)`：同一份文档、同一个顺序、同一张 seen 表 → 同一个结果。
 * 分配状态必须**按文档**（每次渲染新建 Map），不能跨文档复用。
 */

export type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
};

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
 * 分配一个不重复的锚点 id。
 *
 * `seen` 必须按文档建一次（`new Map()`），在整篇文档的标题上**按出现顺序**调用 ——
 * 目录与渲染器各自建一次，但走的是同一份逻辑与同一个顺序，所以结果一致。
 */
export function nextHeadingId(text: string, seen: Map<string, number>): string {
  const base = slugifyHeading(text);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

export type AssignedHeading = { id: string; text: string; level: 2 | 3 };

/** 把标题里的文字拼出来（`<code>`、`<strong>`、`<a>` 里的文字都算） */
export function headingTextOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(headingTextOf).join("");
}

/**
 * 给 hast 树里的 h2/h3 写上 id（就地把 `properties.id` 填好），返回分配结果。
 *
 * 只处理 h2/h3：目录只收这两级，h1 若也参与分配，会让后缀编号和目录对不上
 * （详情页还会把重复的 H1 去掉，两边顺序就更不一致了）。
 */
export function assignHeadingIds(tree: HastNode): AssignedHeading[] {
  const seen = new Map<string, number>();
  const assigned: AssignedHeading[] = [];

  const walk = (node: HastNode) => {
    if (node.type === "element" && (node.tagName === "h2" || node.tagName === "h3")) {
      const text = headingTextOf(node).trim();
      const id = nextHeadingId(text, seen);
      node.properties = { ...(node.properties ?? {}), id };
      assigned.push({ id, text, level: node.tagName === "h2" ? 2 : 3 });
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(tree);
  return assigned;
}

/**
 * rehype 插件：把上面这套逻辑接进 react-markdown 的渲染管线。
 *
 * 这里用宽松类型（`unknown`）是为了不把 hast 的类型定义拖进依赖；真正的结构由
 * `assignHeadingIds` 的那一层保证，且有测试用手搭的 hast 树覆盖。
 */
export function rehypeHeadingIds() {
  return (tree: unknown) => {
    assignHeadingIds(tree as HastNode);
  };
}
