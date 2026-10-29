import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UnsafePathError, resolveArticleFile, resolveArticlePath } from "@/lib/security/paths";

/**
 * 外部审计（v1 的 F2）指出：`path.resolve` / `path.relative` 只在字符串层面工作，
 * 不解析符号链接。Windows 上「目录联接（junction）」不需要管理员权限就能建，
 * 所以只要正文目录本身是一个指向别处的 junction，白名单就形同虚设。
 *
 * 这组测试用真实文件系统证明这件事，并锁住修复后的行为。
 *
 * v2 的 F3 指出：夹具建不出来时原来的写法是 `if (!ok) return` —— **测试会显示通过**，
 * 实际上一条断言都没跑。现在改成模块加载时探测能力 + `it.skipIf`：
 * 跑不了就显示 skipped（诚实的跳过），跑得了就必须真的断言，且夹具出错就是失败。
 */
const TEST_TMP_ROOT = path.join(process.cwd(), "node_modules", ".vitest-tmp");

/** 探测一次：这台机器能不能建 junction / 文件级符号链接（探测失败 = 不支持） */
async function probe(kind: "junction" | "file"): Promise<boolean> {
  const probeDir = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "probe-"));
  try {
    if (kind === "junction") {
      await fs.mkdir(path.join(probeDir, "target"), { recursive: true });
      await fs.symlink(path.join(probeDir, "target"), path.join(probeDir, "link"), "junction");
    } else {
      await fs.writeFile(path.join(probeDir, "target.md"), "x");
      await fs.symlink(path.join(probeDir, "target.md"), path.join(probeDir, "link.md"), "file");
    }
    return true;
  } catch {
    return false;
  } finally {
    await fs.rm(probeDir, { recursive: true, force: true });
  }
}

await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
const JUNCTION_OK = await probe("junction");
const FILE_LINK_OK = await probe("file");

const itJunction = it.skipIf(!JUNCTION_OK);
const itFileLink = it.skipIf(!FILE_LINK_OK);
const itWindows = it.skipIf(process.platform !== "win32");

let dir: string;

beforeEach(async () => {
  await fs.mkdir(TEST_TMP_ROOT, { recursive: true });
  dir = await fs.mkdtemp(path.join(TEST_TMP_ROOT, "links-"));
});

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

describe("正文目录是链接时", () => {
  itJunction("纯字符串校验会被骗过（记录漏洞的存在，防止有人以为它够用）", async () => {
    const outside = path.join(dir, "outside");
    const articles = path.join(dir, "articles");
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, articles, "junction");

    // 同步的字符串校验：认为路径"在正文目录里"，实际上指向 outside
    const lexicallyFine = resolveArticlePath(articles, "article-001");
    expect(lexicallyFine).toBe(path.join(articles, "article-001.md"));

    // 写下去的物理位置其实是 outside —— 这就是审计说的"词法包含 ≠ 物理包含"
    await fs.writeFile(lexicallyFine, "会被写到外面去");
    expect(await fs.readFile(path.join(outside, "article-001.md"), "utf8")).toBe("会被写到外面去");
  });

  itJunction("resolveArticleFile 拒绝链接形态的正文目录", async () => {
    const outside = path.join(dir, "outside");
    const articles = path.join(dir, "articles");
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, articles, "junction");

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

  /**
   * 外部审计 v2 的 F1：`fs.realpath()` 返回的是**规范大小写**，
   * 用大小写敏感比较判等，会把 `D:\DSH_WORK` 这种写法当成"被链接过"直接拒绝。
   */
  itWindows("路径大小写不同不应被误拒", async () => {
    const articles = path.join(dir, "articles");
    await fs.mkdir(articles, { recursive: true });

    const shouted = articles.toUpperCase();
    const full = await resolveArticleFile(shouted, "article-001");

    expect(full.toLowerCase()).toBe(path.join(articles, "article-001.md").toLowerCase());
  });
});

describe("目标文件是链接时", () => {
  itFileLink("拒绝写入（避免写穿到链接指向的地方）", async () => {
    const articles = path.join(dir, "articles");
    const outsideFile = path.join(dir, "outside.md");
    await fs.mkdir(articles, { recursive: true });
    await fs.writeFile(outsideFile, "外部文件");
    await fs.symlink(outsideFile, path.join(articles, "article-001.md"), "file");

    await expect(resolveArticleFile(articles, "article-001")).rejects.toBeInstanceOf(
      UnsafePathError,
    );
  });
});
