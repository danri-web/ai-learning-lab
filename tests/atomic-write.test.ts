import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listTempLeftovers, writeFileAtomic } from "@/lib/fs/atomic-write";

/**
 * 临时目录放在 node_modules 下：已被 git 忽略，且本机 %TEMP% 在受限环境下
 * 会 EPERM（实测），所以不用 os.tmpdir()。
 */
const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");

let dir: string;

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  dir = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "atomic-"));
});

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe("原子写入", () => {
  it("新建文件后内容正确，且不留下临时文件", async () => {
    const target = path.join(dir, "article-001.md");
    await writeFileAtomic(target, "# 标题\n\n正文\n");

    expect(await fs.readFile(target, "utf8")).toBe("# 标题\n\n正文\n");
    expect(await listTempLeftovers(dir)).toEqual([]);
  });

  it("覆盖已有文件时替换内容（Windows 上 rename 覆盖是关键路径）", async () => {
    const target = path.join(dir, "article-001.md");
    await writeFileAtomic(target, "旧内容");
    await writeFileAtomic(target, "新内容");

    expect(await fs.readFile(target, "utf8")).toBe("新内容");
    expect(await listTempLeftovers(dir)).toEqual([]);
  });

  it("父目录不存在时自动创建", async () => {
    const target = path.join(dir, "nested", "deeper", "article-002.md");
    await writeFileAtomic(target, "x");

    expect(await fs.readFile(target, "utf8")).toBe("x");
  });

  it("中文与 emoji 不丢字节（按 UTF-8 写，不做任何转码）", async () => {
    const target = path.join(dir, "cn.md");
    const text = "注意力机制 · Transformer 🚀\n第二行";
    await writeFileAtomic(target, text);

    expect(await fs.readFile(target, "utf8")).toBe(text);
  });

  it("失败时抛出错误，并且不留下临时文件（目标文件保持原样）", async () => {
    const target = path.join(dir, "article-003.md");
    await writeFileAtomic(target, "原文");

    // data 传一个不能写的东西：Buffer 之外的类型会在 writeFile 阶段炸
    await expect(
      writeFileAtomic(target, { toString: null } as unknown as string),
    ).rejects.toBeTruthy();

    expect(await fs.readFile(target, "utf8")).toBe("原文");
    expect(await listTempLeftovers(dir)).toEqual([]);
  });

  it("查残留时读不了目录要抛错，不能假装「没有残留」（否则断言会假绿）", async () => {
    const notADir = path.join(dir, "not-a-dir.md");
    await writeFileAtomic(notADir, "x");
    await expect(listTempLeftovers(notADir)).rejects.toBeTruthy();
  });
  it("并发写同一个文件不会互相踩，最终内容一定是其中一次的完整结果", async () => {
    const target = path.join(dir, "article-004.md");
    const payloads = Array.from({ length: 8 }, (_, index) => `内容-${index}-`.repeat(200));
    await Promise.all(payloads.map((payload) => writeFileAtomic(target, payload)));

    const finalText = await fs.readFile(target, "utf8");
    expect(payloads).toContain(finalText);
    expect(await listTempLeftovers(dir)).toEqual([]);
  });
});
