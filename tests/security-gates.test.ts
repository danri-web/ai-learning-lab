import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARTICLES_DIR } from "@/lib/security/paths";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_DIRS = ["app", "components", "lib"];
const EXT = /\.(ts|tsx)$/;

/**
 * 这几条是「先把门锁上」的闸门：功能还没写，但已经能保证以后不会用错写法。
 * 每条都配一个假样本自检（先证明扫描器真的能抓到，否则就是假通过）。
 */
type Rule = {
  name: string;
  pattern: RegExp;
  /** 允许出现的文件（相对仓库根） */
  allow: string[];
};

const RULES: Rule[] = [
  {
    name: "禁止 dangerouslySetInnerHTML（Markdown/收藏内容里的 HTML 不能直接塞进 DOM）",
    pattern: /dangerouslySetInnerHTML/,
    allow: [],
  },
  {
    name: "禁止 eval / new Function",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    allow: [],
  },
  {
    name: "禁止绕过原子写入（写文件只能走 lib/fs/atomic-write.ts）",
    pattern: /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/,
    allow: ["lib/fs/atomic-write.ts"],
  },
];

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collect(full));
    else if (EXT.test(entry)) out.push(full);
  }
  return out;
}

const FILES = SOURCE_DIRS.flatMap((dir) => collect(join(ROOT, dir)));

function scan(files: { path: string; text: string }[], rule: Rule) {
  return files
    .filter((file) => !rule.allow.includes(file.path))
    .flatMap((file) =>
      Array.from(file.text.matchAll(new RegExp(rule.pattern.source, "g"))).map(
        (match) => `${file.path}:${match[0]}`,
      ),
    );
}

const REPO_FILES = FILES.map((full) => ({
  path: relative(ROOT, full).replaceAll("\\", "/"),
  text: readFileSync(full, "utf8"),
}));

describe("源码闸门（功能未实现也先锁住）", () => {
  it("扫描器本身有效：假样本必须被抓到", () => {
    const fake = [
      { path: "app/fake.tsx", text: "dangerouslySetInnerHTML={{ __html: x }}" },
      { path: "app/fake2.ts", text: "const r = eval(input)" },
      { path: "lib/fake3.ts", text: "await fs.writeFile(p, data)" },
    ];
    for (const rule of RULES) {
      const hits = scan(fake as { path: string; text: string }[], rule);
      expect(hits.length, `扫描器没抓到：${rule.name}`).toBeGreaterThan(0);
    }
  });

  for (const rule of RULES) {
    it(rule.name, () => {
      expect(scan(REPO_FILES, rule)).toEqual([]);
    });
  }

  it("不允许装 rehype-raw（Markdown 里执行 HTML 就等于开了 XSS 的门）", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const all = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };
    expect(Object.keys(all).filter((name) => name === "rehype-raw")).toEqual([]);
  });

  it("正文目录常量与需求书 §4 一致（content/articles）", () => {
    // 只断言「常量值对不对」。别去扫源码里有没有出现 content/articles 字样 ——
    // 页面文案里也会提到它，那种扫描只会误报。
    expect(ARTICLES_DIR).toBe(join("content", "articles"));
  });
});
