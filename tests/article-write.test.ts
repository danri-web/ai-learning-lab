import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listArticles, readArticle } from "@/lib/content/articles";
import type { ArticleInput } from "@/lib/content/write";
import { createArticle, saveArticle, trashArticle } from "@/lib/content/write";
import { TRASH_DIR_NAME } from "@/lib/security/paths";

/**
 * 写入的断言（阶段 3b）。
 *
 * 全部用**真实的临时目录**、真实的文件系统 —— 这一层的 bug 不是逻辑错，而是
 * "磁盘上现在到底有什么"。所以每条断言都读回文件本身，而不是只信返回值。
 */

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const NOW = new Date(2026, 9, 30, 15, 30, 12);
const LATER = new Date(2026, 10, 2, 9, 0, 0);

let dir: string;

const root = () => path.join(dir, "articles");

function input(patch: Partial<ArticleInput> = {}): ArticleInput {
  return {
    title: "注意力机制",
    category: "Deep Learning",
    tags: ["Transformer", "Attention"],
    body: "# 注意力机制\n\n正文。",
    ...patch,
  };
}

beforeEach(async () => {
  await fs.mkdir(TMP, { recursive: true });
  dir = await fs.mkdtemp(path.join(TMP, "write-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("新建", () => {
  it("中文标题 → 文件名就是中文，读回来内容一致", async () => {
    const created = await createArticle(input(), { root: root(), now: NOW });
    expect(created).toEqual({ ok: true, id: "注意力机制" });

    const file = path.join(root(), "注意力机制.md");
    const read = await readArticle("注意力机制", root());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.article.title).toBe("注意力机制");
    expect(read.article.category).toBe("Deep Learning");
    expect(read.article.tags).toEqual(["Transformer", "Attention"]);
    expect(read.article.body).toBe("# 注意力机制\n\n正文。");
    // 日期是本地日期，不是 UTC
    expect(read.article.createdAt).toBe("2026-10-30");
    expect(read.article.updatedAt).toBe("2026-10-30");
    // 文件真的存在（不是只在内存里成功）
    expect((await fs.stat(file)).isFile()).toBe(true);
  });

  it("正文目录不存在时自己建出来（第一次用不该报错）", async () => {
    expect(await fs.stat(root()).catch(() => null)).toBeNull();
    const created = await createArticle(input(), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    expect((await fs.stat(root())).isDirectory()).toBe(true);
  });

  it("重名自动加 -2、-3，不覆盖已有文件（D3）", async () => {
    const first = await createArticle(input(), { root: root(), now: NOW });
    const second = await createArticle(input({ body: "第二篇" }), { root: root(), now: NOW });
    const third = await createArticle(input({ body: "第三篇" }), { root: root(), now: NOW });

    expect([first, second, third].map((item) => item.ok && item.id)).toEqual([
      "注意力机制",
      "注意力机制-2",
      "注意力机制-3",
    ]);

    const firstRead = await readArticle("注意力机制", root());
    if (firstRead.ok) expect(firstRead.article.body).toContain("正文。");
  });

  it("只在大小写上不同的标题也当成重名（Windows 文件系统不分大小写）", async () => {
    await createArticle(input({ title: "Model" }), { root: root(), now: NOW });
    const second = await createArticle(input({ title: "model" }), { root: root(), now: NOW });
    expect(second).toEqual({ ok: true, id: "model-2" });
  });

  it("同一标题 8 路并发创建：必须 8 个不同 id，8 份内容都在（审计 v3 F1）", async () => {
    const bodies = Array.from({ length: 8 }, (_, index) => `正文 ${index}`);
    const results = await Promise.all(
      bodies.map((body) => createArticle(input({ body }), { root: root(), now: NOW })),
    );

    const ids = results.map((result) => (result.ok ? result.id : `FAIL:${result.reason}`));
    // 每个请求都成功、且 id 互不相同 —— 否则就是「两个请求都报成功，但只有一份内容活下来」
    expect(ids.filter((id) => id.startsWith("FAIL:"))).toEqual([]);
    expect(new Set(ids).size).toBe(8);

    const files = (await fs.readdir(root())).filter((name) => name.endsWith(".md"));
    expect(files).toHaveLength(8);

    // 8 份内容都能读回来（不是被后写的顶掉）
    const bodiesOnDisk: string[] = [];
    for (const id of ids) {
      const read = await readArticle(id, root());
      expect(read.ok, id).toBe(true);
      if (read.ok) bodiesOnDisk.push(read.article.body);
    }
    expect(bodiesOnDisk.sort()).toEqual([...bodies].sort());
  });

  it("标题里带 YAML 特殊字符也能读回来（引号由 stringify 决定，不是手拼）", async () => {
    const title = '他说："注意力" #1: 是的';
    const created = await createArticle(input({ title }), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const read = await readArticle(created.id, root());
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.article.title).toBe(title);
  });

  it("全符号标题退回时间戳 id，而不是写个空文件名", async () => {
    const created = await createArticle(input({ title: "???" }), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.id).toMatch(/^note-20261030-[0-9a-f]{4}$/);
    expect((await fs.stat(path.join(root(), `${created.id}.md`))).isFile()).toBe(true);
  });

  it("再长的标题也不会生成超长文件名", async () => {
    const created = await createArticle(input({ title: "很长".repeat(100) }), {
      root: root(),
      now: NOW,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(Array.from(created.id).length).toBeLessThanOrEqual(64);
  });

  it("空标题直接拒绝，并且不在磁盘上留文件", async () => {
    const created = await createArticle(input({ title: "   " }), { root: root(), now: NOW });
    expect(created).toMatchObject({ ok: false, reason: "invalid" });
    const left = await fs.readdir(root()).catch(() => []);
    expect(left.filter((name) => name.endsWith(".md"))).toEqual([]);
  });
});

describe("保存", () => {
  it("改标题不改文件名，createdAt 保留，updatedAt 变今天", async () => {
    const created = await createArticle(input(), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const saved = await saveArticle(
      created.id,
      input({ title: "多头注意力", body: "# 多头注意力\n\n新正文。" }),
      { root: root(), now: LATER },
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved).toMatchObject({ createdAt: "2026-10-30", updatedAt: "2026-11-02" });

    // 文件名还是创建时的那个（D3：id 定下就不改）
    const files = await fs.readdir(root());
    expect(files).toEqual(["注意力机制.md"]);

    const read = await readArticle(created.id, root());
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.article.title).toBe("多头注意力");
      expect(read.article.body).toBe("# 多头注意力\n\n新正文。");
      expect(read.article.createdAt).toBe("2026-10-30");
    }
  });

  it("保留用户自己加的 frontmatter 字段（我们不能悄悄删掉他的数据）", async () => {
    const created = await createArticle(input(), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const file = path.join(root(), `${created.id}.md`);
    const original = await fs.readFile(file, "utf8");
    await fs.writeFile(file, original.replace("updatedAt:", "reviewed: true\nupdatedAt:"), "utf8");

    const saved = await saveArticle(created.id, input({ body: "改过" }), {
      root: root(),
      now: LATER,
    });
    expect(saved.ok).toBe(true);
    expect(await fs.readFile(file, "utf8")).toContain("reviewed: true");
  });

  it("不存在的 id → not-found，不新建文件", async () => {
    await fs.mkdir(root(), { recursive: true });
    const saved = await saveArticle("没这篇", input(), { root: root(), now: NOW });
    expect(saved).toMatchObject({ ok: false, reason: "not-found" });
    expect(await fs.readdir(root())).toEqual([]);
  });

  it("标题超长 → 拒绝保存，旧文件内容不变", async () => {
    const created = await createArticle(input(), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const file = path.join(root(), `${created.id}.md`);
    const before = await fs.readFile(file, "utf8");
    const saved = await saveArticle(created.id, input({ title: "长".repeat(201) }), {
      root: root(),
      now: LATER,
    });
    expect(saved.ok).toBe(false);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("8 个并发保存：最终文件一定是完整的某一版，不会是半截", async () => {
    const created = await createArticle(input(), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const bodies = Array.from({ length: 8 }, (_, index) => `版本 ${index}`);
    const results = await Promise.all(
      bodies.map((body) => saveArticle(created.id, input({ body }), { root: root(), now: LATER })),
    );
    expect(results.every((result) => result.ok)).toBe(true);

    const read = await readArticle(created.id, root());
    expect(read.ok).toBe(true);
    if (read.ok) expect(bodies).toContain(read.article.body);

    // 不留临时文件（原子写入的正常结束状态）
    const leftovers = (await fs.readdir(root())).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("正文保真（审计 v3 F3）", () => {
  it("开头的缩进代码块不会被 trim 吃掉（4 个空格就是 Markdown 的语义）", async () => {
    const body = "    const x = 1;\n    console.log(x);";
    const created = await createArticle(input({ body }), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const read = await readArticle(created.id, root());
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.article.body).toBe(body);
  });

  it("保存回来的正文与提交的一字不差（只允许末尾换行归一）", async () => {
    const body = "行尾两个空格是硬换行  \n第二行\n\n```python\nprint(1)\n```\n\n";
    const created = await createArticle(input({ body }), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const read = await readArticle(created.id, root());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.article.body).toBe(body.replace(/\n+$/, ""));
  });
});

describe("过期保存（审计 v3 F2）", () => {
  it("拿旧版本去保存 → 拒绝，磁盘上别人的改动不动", async () => {
    const created = await createArticle(input({ body: "版本 A" }), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await readArticle(created.id, root());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const base = first.sourceHash;

    // 别处（另一个标签页 / VS Code）先保存了 B
    const other = await saveArticle(created.id, input({ body: "版本 B" }), {
      root: root(),
      now: LATER,
    });
    expect(other.ok).toBe(true);

    // 旧稿带着打开时的指纹提交
    const stale = await saveArticle(created.id, input({ body: "版本 A 的草稿" }), {
      root: root(),
      now: LATER,
      expectRevision: base,
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale" });

    const onDisk = await fs.readFile(path.join(root(), `${created.id}.md`), "utf8");
    expect(onDisk).toContain("版本 B");
    expect(onDisk).not.toContain("版本 A 的草稿");
  });

  it("用户明确选择覆盖（force）时能写进去 —— 决定权在用户手里", async () => {
    const created = await createArticle(input({ body: "版本 A" }), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await readArticle(created.id, root());
    if (!first.ok) throw new Error("读不回来");
    await saveArticle(created.id, input({ body: "版本 B" }), { root: root(), now: LATER });

    const forced = await saveArticle(created.id, input({ body: "我的草稿" }), {
      root: root(),
      now: LATER,
      expectRevision: first.sourceHash,
      force: true,
    });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.revision).toMatch(/^[0-9a-f]{32}$/);

    const onDisk = await fs.readFile(path.join(root(), `${created.id}.md`), "utf8");
    expect(onDisk).toContain("我的草稿");
  });

  it("不带指纹（CLI 之类直接调用）不做检查 —— 这是刻意的，检查只在界面链路开启", async () => {
    const created = await createArticle(input({ body: "版本 A" }), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const saved = await saveArticle(created.id, input({ body: "版本 B" }), {
      root: root(),
      now: LATER,
    });
    expect(saved.ok).toBe(true);
  });
});

describe("删除", () => {
  it("移到 .trash，原文一字不差地留着（可恢复），列表里不再出现", async () => {
    const created = await createArticle(input(), { root: root(), now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const file = path.join(root(), `${created.id}.md`);
    const original = await fs.readFile(file, "utf8");

    const trashed = await trashArticle(created.id, { root: root(), now: NOW });
    expect(trashed.ok).toBe(true);
    if (!trashed.ok) return;

    expect(await fs.stat(file).catch(() => null)).toBeNull();
    expect(await fs.readFile(trashed.trashedTo, "utf8")).toBe(original);
    expect(path.basename(trashed.trashedTo)).toBe(`20261030-153012-注意力机制.md`);
    expect(path.basename(path.dirname(trashed.trashedTo))).toBe(TRASH_DIR_NAME);

    const listed = await listArticles(root());
    expect(listed.articles).toEqual([]);
    expect(listed.problems).toEqual([]);
  });

  it("同一个 id 删两次不互相覆盖（第二次会加随机后缀）", async () => {
    await createArticle(input(), { root: root(), now: NOW });
    const first = await trashArticle("注意力机制", { root: root(), now: NOW });
    await createArticle(input(), { root: root(), now: NOW });
    const second = await trashArticle("注意力机制", { root: root(), now: NOW });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.trashedTo).not.toBe(first.trashedTo);
    expect((await fs.stat(first.trashedTo)).isFile()).toBe(true);
    expect((await fs.stat(second.trashedTo)).isFile()).toBe(true);
  });

  it("删不存在的笔记 → not-found", async () => {
    await fs.mkdir(root(), { recursive: true });
    expect(await trashArticle("没这篇", { root: root(), now: NOW })).toMatchObject({
      ok: false,
      reason: "not-found",
    });
  });
});
