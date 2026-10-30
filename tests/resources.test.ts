import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  filterResources,
  readResources,
  resourceFacets,
  resourceRevision,
  resourcesFile,
  sortResources,
  type Resource,
} from "@/lib/content/resources";
import {
  createResource,
  deleteResource,
  updateResource,
  type ResourceInput,
} from "@/lib/content/resources-store";
import { revisionOf } from "@/lib/content/revision";

/**
 * 资源收藏的读写（阶段 4）。和笔记一样：全部用真实临时目录，断言的是**磁盘上的状态**。
 *
 * 借了审计 v3 的教训：写入类断言必须覆盖「并发 / 旧版本 / 坏输入」三类，
 * 否则下一次外部审计还会再逮一次。
 */

const TMP = path.join(process.cwd(), "node_modules", ".vitest-tmp");
const NOW = new Date(2026, 9, 30, 15, 30, 12);
const LATER = new Date(2026, 10, 2, 9, 0, 0);

let root: string;

function input(patch: Partial<ResourceInput> = {}): ResourceInput {
  return {
    title: "Attention Is All You Need",
    url: "https://arxiv.org/abs/1706.03762",
    type: "paper",
    category: "Deep Learning",
    tags: ["Transformer", "Attention"],
    description: "Transformer 的原始论文",
    ...patch,
  };
}

beforeEach(async () => {
  await fs.mkdir(TMP, { recursive: true });
  root = await fs.mkdtemp(path.join(TMP, "resources-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

describe("新建", () => {
  it("第一次新建会建出 resources.json（version 1），读回来内容一致", async () => {
    const created = await createResource(input(), { root, now: NOW });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.id).toBe("Attention-Is-All-You-Need");

    const raw = JSON.parse(await fs.readFile(resourcesFile(root), "utf8")) as {
      version: number;
      resources: Resource[];
    };
    expect(raw.version).toBe(1);
    expect(raw.resources).toHaveLength(1);

    const read = await readResources(root);
    expect(read.problem).toBeNull();
    expect(read.resources[0]).toMatchObject({
      id: "Attention-Is-All-You-Need",
      type: "paper",
      tags: ["Transformer", "Attention"],
      createdAt: "2026-10-30",
      updatedAt: "2026-10-30",
    });
  });

  it("中文标题 → 中文 id；重名加 -2", async () => {
    const first = await createResource(input({ title: "注意力机制论文" }), { root, now: NOW });
    const second = await createResource(input({ title: "注意力机制论文" }), { root, now: NOW });
    expect(first.ok && first.id).toBe("注意力机制论文");
    expect(second.ok && second.id).toBe("注意力机制论文-2");
  });

  it("非法 URL 被拒绝，且不写文件（应用不会去抓这个地址，但也不许存）", async () => {
    const created = await createResource(input({ url: "javascript:alert(1)" }), {
      root,
      now: NOW,
    });
    expect(created).toMatchObject({ ok: false, reason: "invalid" });
    expect(await fs.stat(resourcesFile(root)).catch(() => null)).toBeNull();
  });

  it("同一标题 8 路并发创建：必须 8 个不同 id、8 条都在（审计 v3 F1 的同款断言）", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        createResource(input({ title: "并发资源", description: `第 ${index} 条` }), {
          root,
          now: NOW,
        }),
      ),
    );
    const ids = results.map((result) => (result.ok ? result.id : `FAIL:${result.reason}`));
    expect(ids.filter((id) => id.startsWith("FAIL:"))).toEqual([]);
    expect(new Set(ids).size).toBe(8);

    const read = await readResources(root);
    expect(read.resources).toHaveLength(8);
    expect(new Set(read.resources.map((item) => item.description))).toEqual(
      new Set(Array.from({ length: 8 }, (_, index) => `第 ${index} 条`)),
    );
  });
});

describe("编辑", () => {
  it("id 与 createdAt 不变，updatedAt 变今天；单条指纹也跟着变", async () => {
    const created = await createResource(input(), { root, now: NOW });
    if (!created.ok) throw new Error(created.error);

    const before = (await readResources(root)).resources[0];
    const saved = await updateResource(
      created.id,
      input({ title: "Attention（改名）", description: "改过" }),
      { root, now: LATER },
    );
    expect(saved.ok).toBe(true);

    const after = (await readResources(root)).resources[0];
    expect(after.id).toBe(created.id);
    expect(after.createdAt).toBe("2026-10-30");
    expect(after.updatedAt).toBe("2026-11-02");
    expect(after.title).toBe("Attention（改名）");
    expect(resourceRevision(after)).not.toBe(resourceRevision(before));
  });

  it("旧指纹保存被拒（stale），磁盘不变；force 可以覆盖（D8 同款）", async () => {
    const created = await createResource(input(), { root, now: NOW });
    if (!created.ok) throw new Error(created.error);
    const base = resourceRevision((await readResources(root)).resources[0]);

    // 别处先改了
    const other = await updateResource(created.id, input({ description: "别处改的" }), {
      root,
      now: LATER,
    });
    expect(other.ok).toBe(true);

    const stale = await updateResource(created.id, input({ description: "我的旧稿" }), {
      root,
      now: LATER,
      expectRevision: base,
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale" });
    expect((await readResources(root)).resources[0].description).toBe("别处改的");

    const forced = await updateResource(created.id, input({ description: "我的旧稿" }), {
      root,
      now: LATER,
      expectRevision: base,
      force: true,
    });
    expect(forced.ok).toBe(true);
    expect((await readResources(root)).resources[0].description).toBe("我的旧稿");
  });

  it("不存在的 id → not-found", async () => {
    const saved = await updateResource("没有这条", input(), { root, now: NOW });
    expect(saved).toMatchObject({ ok: false, reason: "not-found" });
  });
});

describe("删除", () => {
  it("从列表移除，同时把记录追加到 .trash/resources-deleted.jsonl（可恢复）", async () => {
    const created = await createResource(input(), { root, now: NOW });
    if (!created.ok) throw new Error(created.error);

    const deleted = await deleteResource(created.id, { root, now: NOW });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;

    expect((await readResources(root)).resources).toEqual([]);

    const lines = (await fs.readFile(deleted.trashFile, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as { deletedAt: string; resource: Resource };
    expect(entry.deletedAt).toBe("20261030-153012");
    expect(entry.resource.id).toBe(created.id);

    // 真正"恢复"一次：把那条记录贴回去，应用就认得
    await fs.writeFile(
      resourcesFile(root),
      JSON.stringify({ version: 1, resources: [entry.resource] }, null, 2) + "\n",
      "utf8",
    );
    const restored = await readResources(root);
    expect(restored.resources.map((item) => item.id)).toEqual([created.id]);
  });

  it("删两次同一条：第二次 not-found（不会重复写回收站）", async () => {
    const created = await createResource(input(), { root, now: NOW });
    if (!created.ok) throw new Error(created.error);

    expect((await deleteResource(created.id, { root, now: NOW })).ok).toBe(true);
    expect(await deleteResource(created.id, { root, now: NOW })).toMatchObject({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("坏输入不能把文件搞坏", () => {
  it("resources.json 是坏 JSON 时：读出来有 problem，写入被拒绝且文件原样不动", async () => {
    const broken = '{ "version": 1, "resources": [ {: 坏 ] }';
    await fs.writeFile(resourcesFile(root), broken, "utf8");

    const read = await readResources(root);
    expect(read.problem).toContain("不是合法 JSON");

    const created = await createResource(input(), { root, now: NOW });
    expect(created).toMatchObject({ ok: false, reason: "invalid" });
    expect(await fs.readFile(resourcesFile(root), "utf8")).toBe(broken);
  });

  it("结构不对（少字段 / 未知类型）也读出来是 problem", async () => {
    await fs.writeFile(
      resourcesFile(root),
      JSON.stringify({
        version: 1,
        resources: [{ id: "x", title: "只有标题", type: "unknown", url: "https://a.com" }],
      }),
      "utf8",
    );
    const read = await readResources(root);
    expect(read.problem).toContain("结构不对");
    expect(read.resources).toEqual([]);
  });

  it("文件不存在 ≠ 坏文件：missing 为真、problem 为空", async () => {
    const read = await readResources(path.join(root, "nope"));
    expect(read).toMatchObject({ resources: [], problem: null, missing: true });
    expect(read.fileRevision).toBe(revisionOf(""));
  });
});

describe("筛选 / 排序 / 统计（纯函数）", () => {
  const sample: Resource[] = [
    {
      id: "a",
      title: "B 论文",
      url: "https://a.com",
      type: "paper",
      category: "DL",
      tags: ["t1"],
      description: "",
      createdAt: "2026-10-01",
      updatedAt: "2026-10-05",
    },
    {
      id: "b",
      title: "A 工具",
      url: "https://b.com",
      type: "tool",
      category: "Infra",
      tags: ["t2"],
      description: "",
      createdAt: "2026-10-10",
      updatedAt: "2026-10-10",
    },
  ];

  it("按类型/分类/标签过滤", () => {
    expect(filterResources(sample, { type: "paper" }).map((item) => item.id)).toEqual(["a"]);
    expect(filterResources(sample, { category: "Infra" }).map((item) => item.id)).toEqual(["b"]);
    expect(filterResources(sample, { tag: "t1" }).map((item) => item.id)).toEqual(["a"]);
  });

  it("三种排序：最近更新 / 最近添加 / 标题", () => {
    expect(sortResources(sample, "updated").map((item) => item.id)).toEqual(["b", "a"]);
    expect(sortResources(sample, "created").map((item) => item.id)).toEqual(["b", "a"]);
    expect(sortResources(sample, "title").map((item) => item.id)).toEqual(["b", "a"]); // A 工具 < B 论文
  });

  it("统计出的类型/分类/标签带计数", () => {
    const facets = resourceFacets(sample);
    expect(facets.types).toEqual([
      { value: "paper", count: 1 },
      { value: "tool", count: 1 },
    ]);
    expect(facets.categories.map((facet) => facet.value).sort()).toEqual(["DL", "Infra"]);
    expect(facets.tags.map((facet) => facet.value).sort()).toEqual(["t1", "t2"]);
  });
});
