import type { ReactNode } from "react";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import ReactMarkdown from "react-markdown";

import { slugifyHeading } from "@/lib/markdown/toc";

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

/** 标题的 id 与侧栏目录用同一个 slugify，保证锚点对得上 */
function toPlainText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(toPlainText).join("");
  if (typeof node === "object" && "props" in node) {
    return toPlainText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

export function ArticleMarkdown({ body }: { body: string }) {
  return (
    <div className="prose prose-lab max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeKatex,
          // ignoreMissing：不认识的语言按普通文本渲染，不让整页 500
          [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ]}
        components={{
          h2: ({ children }) => (
            <h2 id={slugifyHeading(toPlainText(children))} className="scroll-mt-20">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 id={slugifyHeading(toPlainText(children))} className="scroll-mt-20">
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
