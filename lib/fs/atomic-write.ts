import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 原子写入：临时文件 + fsync + rename。
 *
 * 为什么必须这么做：文章正文是权威数据，直接 writeFile 一旦在写一半时断电/崩溃，
 * 留下的是**半截正文**，而不是「旧版本」。所以写新内容永远写到同目录的临时文件，
 * 落盘后再一次 rename 顶替 —— rename 在同一个卷上是原子的。
 */

export async function writeFileAtomic(filePath: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    // wx：临时文件必须是我新建的，绝不覆盖别人的同名文件
    handle = await fs.open(tmpPath, "wx");
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
  await handle.close();

  try {
    await renameWithRetry(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Windows 上 rename 覆盖一个「正在被另一个写入者替换」的目标会抛 EPERM
 * （实测：8 个并发写同一路径必现）。真正的解决办法不是加锁，而是退避重试 ——
 * 每次重试前目标要么已经换好，要么已经释放。
 */
const RETRYABLE_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !RETRYABLE_CODES.has(code) || attempt >= attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * 2 ** attempt));
    }
  }
}

/** 测试与维护用：列出目录里残留的临时文件（正常应为空） */
export async function listTempLeftovers(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  return entries.filter((name) => name.endsWith(".tmp") && name.startsWith("."));
}
