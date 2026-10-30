import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import ReactMarkdown from "react-markdown";

import { rehypeHeadingIds } from "@/lib/markdown/heading-ids";

/**
 * Markdown 渲染器。
 *
 * 安全要点（都是刻意的）：
 * - **不装 rehype-raw**：正文里的原始 HTML 一律按文本处理，不会执行。
 * - 外部链接一律 `target="_blank" rel="noopener noreferrer"`。
 * - 表格外面套可横向滚动的容器：宽表格在手机上不能把整页撑宽。
 *
 * ⚠️ 代码高亮用 rehype-highlight（highlight.js），**不是需求书写的 Shiki**。
 * 原因是实测出来的硬故障，不是偏好：
 *   Shiki 在 Turbopack 下会被当成外部包，生成 `.next/dev/node_modules/shiki-<hash>`
 *   这样的目录联接（junction）；而 Turbopack 下次启动会对它调 unlink —— Windows 上对
 *   junction 调 unlink 必然 EPERM，于是**第二次 dev / 第二次 build 都起不来**
 *   （只能每次手动 rmdir .next）。换 highlight.js 后：同步、无 wasm、无 junction。
 * 代价：主题靠 CSS 类（颜色在 app/globals.css 里映射到设计令牌），
 * 不是 VS Code 的 TextMate 主题。已记入 docs/架构决策.md 的"偏离记录"。
 */

/**
 * 标题的 id 由 rehype 插件分配（`lib/markdown/heading-ids.ts`），与侧栏目录共用同一套
 * 去重规则 —— 同名标题在正文里是 `example` / `example-1`，目录里也是（审计 v3 F4）。
 */
export function ArticleMarkdown({ body }: { body: string }) {
  return (
    <div className="prose prose-lab max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeKatex,
          rehypeHeadingIds,
          // ignoreMissing：不认识的语言按普通文本渲染，不让整页 500
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={{
          // `id` 是 rehype 插件写到 hast properties 上的；组件覆盖必须显式接住它
          // （不能整个 `{...props}` 摊开：react-markdown 会把 `node` 一起塞进 props，最后变成 DOM 属性）
          h2: ({ id, children }) => (
            <h2 id={id} className="scroll-mt-20">
              {children}
            </h2>
          ),
          h3: ({ id, children }) => (
            <h3 id={id} className="scroll-mt-20">
              {children}
            </h3>
          ),
          a: ({ href, children }) => {
            const external = typeof href === "string" && /^https?:\/\//i.test(href);
            return (
              <a
                href={href}
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="my-4 w-full overflow-x-auto rounded-lg border border-border">
              <table className="my-0">{children}</table>
            </div>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
