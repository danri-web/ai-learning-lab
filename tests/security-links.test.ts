import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UnsafePathError, resolveArticleFile, resolveArticlePath } from "@/lib/security/paths";

/**
 * 外部审计（P2-F2）指出：`path.resolve` / `path.relative` 只在字符串层面工作，
 * 不解析符号链接。Windows 上「目录联接（junction）」不需要管理员权限就能建，
 * 所以只要正文目录本身是一个指向别处的 junction，白名单就形同虚设。
 *
 * 这组测试用真实文件系统证明这件事，并锁住修复后的行为。
 */
const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");
let dir: string;

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  dir = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "links-"));
});

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

/** 尝试建一个 junction；受限环境建不出来就跳过（不假装通过） */
async function makeJunction(linkPath: string, targetPath: string): Promise<boolean> {
  try {
    await fs.symlink(targetPath, linkPath, "junction");
    return true;
  } catch {
    return false;
  }
}

describe("正文目录是链接时", () => {
  it("纯字符串校验会被骗过（记录漏洞的存在，防止有人以为它够用）", async () => {
    const outside = path.join(dir, "outside");
    const articles = path.join(dir, "articles");
    await fs.mkdir(outside, { recursive: true });
    const ok = await makeJunction(articles, outside);
    if (!ok) return; // 环境建不出 junction，本机不适用

    // 同步的字符串校验：认为路径"在正文目录里"，实际上指向 outside
    const lexicallyFine = resolveArticlePath(articles, "article-001");
    expect(lexicallyFine).toBe(path.join(articles, "article-001.md"));

    // 写下去的物理位置其实是 outside —— 这就是审计说的"词法包含 ≠ 物理包含"
    await fs.writeFile(lexicallyFine, "会被写到外面去");
    const physically = await fs.readFile(path.join(outside, "article-001.md"), "utf8");
    expect(physically).toBe("会被写到外面去");
  });

  it("resolveArticleFile 拒绝链接形态的正文目录", async () => {
    const outside = path.join(dir, "outside");
    const articles = path.join(dir, "articles");
    await fs.mkdir(outside, { recursive: true });
    const ok = await makeJunction(articles, outside);
    if (!ok) return;

    await expect(resolveArticleFile(articles, "article-001")).rejects.toBeInstanceOf(
      UnsafePathError,
    );
  });
});

describe("正常的正文目录", () => {
  it("返回真实路径，且落在目录内", async () => {
    const articles = path.join(dir, "articles");
    await fs.mkdir(articles, { recursive: true });

    const full = await resolveArticleFile(articles, "article-001");
    expect(full).toBe(path.join(articles, "article-001.md"));
  });

  it("目录不存在时抛错，而不是随便建一个", async () => {
    await expect(resolveArticleFile(path.join(dir, "nope"), "article-001")).rejects.toBeInstanceOf(
      UnsafePathError,
    );
  });

  it("目标文件是符号链接时拒绝（避免写穿到链接指向的地方）", async () => {
    const articles = path.join(dir, "articles");
    const outsideFile = path.join(dir, "outside.md");
    await fs.mkdir(articles, { recursive: true });
    await fs.writeFile(outsideFile, "外部文件");

    let linked = false;
    try {
      await fs.symlink(outsideFile, path.join(articles, "article-001.md"), "file");
      linked = true;
    } catch {
      linked = false; // 文件级符号链接通常要开发者模式/管理员
    }
    if (!linked) return;

    await expect(resolveArticleFile(articles, "article-001")).rejects.toBeInstanceOf(
      UnsafePathError,
    );
  });
});
