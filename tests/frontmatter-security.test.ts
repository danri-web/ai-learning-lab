import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseArticle, readFrontmatter } from "@/lib/content/frontmatter";
import { checkBackupPayload } from "@/lib/content/backup-validate";
import type { BackupManifest } from "@/lib/content/backup-format";
import { createArticle } from "@/lib/content/write";

/**
 * SEC-01 回归：gray-matter 4.0.3 的 `---javascript` / `---js` 会 `eval`。
 * 断言方式不是“看起来被拒绝”，而是**执行标记必须保持 0**：
 * 只要解析器真的跑了 payload，标记就会变成 1，测试立刻红。
 */

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const markerHolder = globalThis as typeof globalThis & { __aiLabFrontmatterMarker?: number };

function marker(): number {
  return markerHolder.__aiLabFrontmatterMarker ?? 0;
}

const FIELDS =
  'id: "hello", title: "你好", category: "测试", tags: [], createdAt: "2026-10-01", updatedAt: "2026-10-02"';

const JAVASCRIPT = `---javascript
(globalThis.__aiLabFrontmatterMarker = 1, { ${FIELDS} })
---
正文`;

const JS_ALIAS = `---js
(globalThis.__aiLabFrontmatterMarker = 2, { ${FIELDS} })
---
正文`;

describe("frontmatter 不允许执行代码（SEC-01）", () => {
  beforeEach(() => {
    markerHolder.__aiLabFrontmatterMarker = 0;
  });

  afterEach(() => {
    delete markerHolder.__aiLabFrontmatterMarker;
  });

  it("---javascript 被拒绝，payload 从未执行", () => {
    const result = parseArticle(JAVASCRIPT, "hello");
    expect(result.ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("---js 别名同样被拒绝", () => {
    const result = parseArticle(JS_ALIAS, "hello");
    expect(result.ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("readFrontmatter（保存时读旧字段）也不会执行", () => {
    expect(() => readFrontmatter(JAVASCRIPT)).toThrow(/可执行语言/);
    expect(marker()).toBe(0);
  });

  it("普通 YAML 仍然能正常解析", () => {
    const source = `---
id: hello
title: 你好
category: 测试
createdAt: "2026-10-01"
updatedAt: "2026-10-02"
---
正文`;
    const result = parseArticle(source, "hello");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.article.title).toBe("你好");
  });
});

describe("写笔记时不解析正文里的 ---javascript（SEC-01 写入路径）", () => {
  let dir: string;

  beforeEach(async () => {
    await fs.mkdir(TMP, { recursive: true });
    dir = await fs.mkdtemp(path.join(TMP, "frontmatter-security-"));
    markerHolder.__aiLabFrontmatterMarker = 0;
  });

  afterEach(async () => {
    delete markerHolder.__aiLabFrontmatterMarker;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("正文首行是 ---javascript 时，只把它当正文，不执行", async () => {
    const root = path.join(dir, "articles");
    const body = "---javascript\n(globalThis.__aiLabFrontmatterMarker = 3, {})\n---\n正文";
    const created = await createArticle(
      { title: "安全写入", category: "测试", tags: [], body },
      { root },
    );
    expect(created.ok).toBe(true);
    expect(marker()).toBe(0);

    const text = await fs.readFile(path.join(root, "安全写入.md"), "utf8");
    expect(text).toContain("---javascript");
    expect(text).toContain("正文");
  });
});

/**
 * v2 外部审计（V2-SEC-01）：`---javascript\u00a0` 这类 Unicode 空白能绕过旧的正则。
 * 旧守卫只认 `[ \t]`，不匹配就**直接放行**，而 gray-matter 用 `String.trim()` 判语言，
 * 会把 NBSP / EM SPACE / BOM / 垂直制表符都 trim 掉，于是 `javascript` 引擎照样被选中并执行。
 *
 * 现在的契约：**开头不是严格的 `---`（可带 yaml/yml/json）就直接拒绝**，并且把语言标记
 * 从 opener 上抹掉再交给 gray-matter —— 解析器根本没有“语言”可选。
 */
const UNICODE_GAPS: [string, string][] = [
  ["NBSP (U+00A0)", "\u00a0"],
  ["EM SPACE (U+2003)", "\u2003"],
  ["NARROW NBSP (U+202F)", "\u202f"],
  ["IDEOGRAPHIC SPACE (U+3000)", "\u3000"],
  ["BOM (U+FEFF)", "\ufeFF"],
  ["VERTICAL TAB (U+000B)", "\u000b"],
];

function jsPayload(gap: string, where: "trailing" | "leading"): string {
  const opener = where === "trailing" ? `---javascript${gap}` : `---${gap}javascript`;
  return `${opener}\n(globalThis.__aiLabFrontmatterMarker = 7, { ${FIELDS} })\n---\n正文`;
}

describe("frontmatter 守卫不能被 Unicode 空白绕过（V2-SEC-01）", () => {
  beforeEach(() => {
    markerHolder.__aiLabFrontmatterMarker = 0;
  });

  afterEach(() => {
    delete markerHolder.__aiLabFrontmatterMarker;
  });

  for (const [label, gap] of UNICODE_GAPS) {
    it(`---javascript + ${label}：拒绝，payload 未执行`, () => {
      const result = parseArticle(jsPayload(gap, "trailing"), "hello");
      expect(result.ok).toBe(false);
      expect(marker()).toBe(0);
    });

    it(`--- + ${label} + javascript（前置空白）：拒绝，payload 未执行`, () => {
      const result = parseArticle(jsPayload(gap, "leading"), "hello");
      expect(result.ok).toBe(false);
      expect(marker()).toBe(0);
    });
  }

  it("文件开头 BOM + 尾部 NBSP：拒绝，payload 未执行", () => {
    const result = parseArticle(`\uFEFF${jsPayload("\u00a0", "trailing")}`, "hello");
    expect(result.ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("两个前导 BOM 也不能绕过（v3b 复核）", () => {
    const result = parseArticle(`\uFEFF\uFEFF${jsPayload("", "trailing")}`, "hello");
    expect(result.ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("两个前导 BOM + 没有换行：检测器截断也不能拿到 javascript", () => {
    const payload = `\uFEFF\uFEFF---javascriptX\n(globalThis.__aiLabFrontmatterMarker = 9, { ${FIELDS} })\n---\n正文`;
    const result = parseArticle(payload, "hello");
    expect(result.ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("readFrontmatter（保存旧笔记）同样拒绝且不执行", () => {
    expect(() => readFrontmatter(jsPayload("\u00a0", "trailing"))).toThrow();
    expect(marker()).toBe(0);
  });

  it("元数据本身不合法时也不会先执行（校验失败不能掩盖执行）", () => {
    const payload = `---javascript\u00a0\n(globalThis.__aiLabFrontmatterMarker = 8, { id: "wrong" })\n---\n正文`;
    expect(parseArticle(payload, "hello").ok).toBe(false);
    expect(marker()).toBe(0);
  });

  it("备份 payload 校验（恢复预览）同样不会执行", () => {
    const payload = jsPayload("\u00a0", "trailing");
    const bytes = Buffer.from(payload, "utf8");
    const manifest = {
      files: [{ path: "content/articles/hello.md", size: bytes.length, sha256: "0".repeat(64) }],
    } as unknown as BackupManifest;

    const check = checkBackupPayload(manifest, new Map([["content/articles/hello.md", bytes]]));

    // 单篇笔记坏掉只给 warning（不阻止恢复），但绝不能执行
    expect(check.ok).toBe(true);
    expect(marker()).toBe(0);
    if (check.ok) expect(check.warnings.join("\n")).toContain("hello.md");
  });

  it("白名单写法仍然按数据解析：--- / ---yaml / ---json / 尾部空格", () => {
    const body = `id: hello
title: 你好
category: 测试
createdAt: "2026-10-01"
updatedAt: "2026-10-02"`;

    for (const opening of ["---", "---yaml", "---json", "---   "]) {
      const source = `${opening}\n${body}\n---\n正文`;
      const result = parseArticle(source, "hello");
      expect(result.ok, `opening=${JSON.stringify(opening)}`).toBe(true);
    }
    expect(marker()).toBe(0);
  });
});
