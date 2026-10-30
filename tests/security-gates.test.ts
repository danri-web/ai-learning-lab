import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARTICLES_DIR } from "@/lib/security/paths";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_DIRS = ["app", "components", "lib", "features"];
const EXT = /\.(ts|tsx)$/;

/**
 * 源码级护栏。
 *
 * ⚠️ 这是**护栏，不是沙箱**。它靠正则扫源码，抓不到的形态请见文件末尾那条"已知抓不到"的测试 ——
 * 别把它当成"只要绿了就安全"。外部审计（P2-F3）指出：旧版只匹配函数名，
 * 一句 `import { writeFile as save }` 就能绕过去。现在改成**扫 import 语句本身**（别名改不掉模块名）。
 *
 * 每条规则都配假样本自检：先证明扫描器抓得到，才信它"没抓到"。
 */
type Rule = {
  name: string;
  pattern: RegExp;
  /** 允许出现的文件（相对仓库根）：只有这两个文件可以碰文件系统 */
  allow: string[];
};

const FS_IMPORT = /from\s+["'](?:node:)?fs(?:\/promises)?["']|require\(\s*["'](?:node:)?fs/;

const RULES: Rule[] = [
  {
    name: "禁止 dangerouslySetInnerHTML（Markdown/收藏内容里的 HTML 不能直接塞进 DOM）",
    pattern: /dangerouslySetInnerHTML/,
    allow: [],
  },
  {
    name: "禁止 eval 与 new Function（含把 eval 赋给变量再调用）",
    pattern: /\beval\b|new\s+Function\s*\(/,
    allow: [],
  },
  {
    name: "只允许 lib/fs、lib/security/paths、lib/content 接触文件系统（扫 import，别名绕不过）",
    pattern: FS_IMPORT,
    // 以 "/" 结尾 = 整个目录放行。lib/content 是 docs/架构决策.md D4 指定的"唯一读正文的地方"。
    allow: ["lib/fs/atomic-write.ts", "lib/security/paths.ts", "lib/content/"],
  },
  {
    name: "禁止绕过原子写入（写函数名直接调用）",
    pattern: /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/,
    allow: ["lib/fs/atomic-write.ts"],
  },
  {
    name: "只有 service 能 import 写入模块（页面不许直接写文件）",
    pattern: /from\s+["']@\/lib\/content\/(?:write|resources-store|tasks-store)["']/,
    allow: [
      "features/articles/service.ts",
      "features/resources/service.ts",
      "features/tasks/service.ts",
    ],
  },
  {
    // 阶段 7：备份/恢复也会改 content/，同样只能由 backup service 调。
    // 例外是 restore-store 自己复用 backup-store 的快照函数（lib 内部依赖，不是页面绕过）。
    name: "只有 backup service 能 import 备份/恢复写入模块",
    pattern: /from\s+["']@\/lib\/content\/(?:backup-store|restore-store)["']/,
    allow: ["features/backup/service.ts", "lib/content/restore-store.ts"],
  },
  {
    // P1：回收站清理会真删 content/ 里的文件，只允许 backup service 调。
    name: "只有 backup service 能 import 回收站清理模块",
    pattern: /from\s+["']@\/lib\/content\/trash-store["']/,
    allow: ["features/backup/service.ts"],
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

type SourceFile = { path: string; text: string };

const FILES: SourceFile[] = SOURCE_DIRS.flatMap((dir) =>
  collect(join(ROOT, dir)).map((full) => ({
    path: relative(ROOT, full).replaceAll("\\", "/"),
    text: readFileSync(full, "utf8"),
  })),
);

function isAllowed(file: SourceFile, rule: Rule): boolean {
  return rule.allow.some((entry) =>
    entry.endsWith("/") ? file.path.startsWith(entry) : file.path === entry,
  );
}

function scan(files: SourceFile[], rule: Rule): string[] {
  return files
    .filter((file) => !isAllowed(file, rule))
    .flatMap((file) =>
      Array.from(file.text.matchAll(new RegExp(rule.pattern.source, "g"))).map(
        (match) => `${file.path}:${match[0]}`,
      ),
    );
}

const rule = (fragment: string) => RULES.find((item) => item.name.includes(fragment))!;

describe("源码闸门（功能未实现也先锁住）", () => {
  it("扫描器本身有效：假样本必须被抓到（含外部审计给出的别名写法）", () => {
    const cases: { fixture: SourceFile; target: string }[] = [
      {
        fixture: {
          path: "app/fake.tsx",
          text: "<div dangerouslySetInnerHTML={{ __html: html }} />",
        },
        target: "dangerouslySetInnerHTML",
      },
      {
        fixture: { path: "app/fake2.ts", text: "const e = eval; e(input)" },
        target: "eval",
      },
      {
        // 外部审计 P2-F3 的原话：别名导入绕过了旧版正则
        fixture: {
          path: "lib/fake3.ts",
          text: 'import { writeFile as save } from "node:fs/promises";\nawait save(p, data);',
        },
        target: "文件系统",
      },
      {
        fixture: {
          path: "lib/fake4.ts",
          text: 'import * as io from "fs";\nio.writeFileSync(p, data);',
        },
        target: "文件系统",
      },
      {
        fixture: {
          path: "lib/fake5.ts",
          text: 'import fs from "node:fs";\nawait fs.writeFile(p, data);',
        },
        target: "文件系统",
      },
      {
        fixture: { path: "lib/fake6.ts", text: "await fs.writeFile(p, data);" },
        target: "绕过原子写入",
      },
      {
        // D4 的写入链路：页面绕过 service 直接调写入模块
        fixture: {
          path: "app/(workspace)/knowledge/actions.ts",
          text: 'import { createArticle } from "@/lib/content/write";',
        },
        target: "只有 service",
      },
      {
        // 同一个闸门要覆盖阶段 4 的资源写入模块
        fixture: {
          path: "app/(workspace)/resources/page.tsx",
          text: 'import { createResource } from "@/lib/content/resources-store";',
        },
        target: "只有 service",
      },
      {
        // 阶段 6 的任务写入模块同样不能被页面直接 import
        fixture: {
          path: "app/(workspace)/learning/page.tsx",
          text: 'import { createTask } from "@/lib/content/tasks-store";',
        },
        target: "只有 service",
      },
      {
        // 阶段 7：备份页绕过 service 直接调 backup-store
        fixture: {
          path: "app/(workspace)/backup/page.tsx",
          text: 'import { createBackup } from "@/lib/content/backup-store";',
        },
        target: "备份/恢复",
      },
      {
        // 阶段 7：action 绕过 service 直接调 restore-store
        fixture: {
          path: "app/(workspace)/backup/actions.ts",
          text: 'import { applyRestore } from "@/lib/content/restore-store";',
        },
        target: "备份/恢复",
      },
      {
        // P1：页面/组件绕过 service 直接用回收站清理模块
        fixture: {
          path: "app/(workspace)/backup/cleanup-cards.tsx",
          text: 'import { previewTrashCleanup } from "@/lib/content/trash-store";',
        },
        target: "回收站清理",
      },
    ];

    for (const item of cases) {
      expect(
        scan([item.fixture], rule(item.target)),
        `扫描器没抓到：${item.fixture.text}`,
      ).not.toEqual([]);
    }
  });

  for (const item of RULES) {
    it(item.name, () => {
      expect(scan(FILES, item)).toEqual([]);
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

  /**
   * 诚实记录护栏的边界。这些写法现在的扫描器抓不到：
   *   - 经第三方包间接写文件（比如某个库内部用了 fs）
   *   - `globalThis["wri"+"teFile"]` 这类计算成员访问
   *   - 把 fs 句柄作为参数传进来（调用方不在扫描范围内）
   * 真正的强制手段是"import 白名单 + code review + 阶段 8 的集成测试"，不是这条正则。
   *
   * 如果哪天扫描器变强、能抓到这两条了，这条测试会红 —— 那是好事，
   * 请更新上面的注释再让它变绿，不要直接把测试删掉。
   */
  it("已知抓不到的形态（一旦能抓到这条会红，提醒更新注释）", () => {
    const escapes: SourceFile[] = [
      { path: "lib/x1.ts", text: 'const key = "writeFile"; await fs[key](p, d);' },
      { path: "lib/x2.ts", text: 'import fsp from "node:" + "fs"; await fsp.writeFile(p, d);' },
    ];
    const caught = escapes.filter(
      (file) =>
        scan([file], rule("文件系统")).includes(`${file.path}:`) ||
        scan([file], rule("文件系统")).length > 0,
    );
    expect(caught).toEqual([]); // 抓不到 —— 这就是我们要记住的边界
  });
});
