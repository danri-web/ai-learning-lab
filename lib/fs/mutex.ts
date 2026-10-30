/**
 * 进程内写锁（审计 v3 F1 的产物，阶段 4 复用）。
 *
 * 为什么需要：写入都是「读现状 → 算出新内容 → 落盘」三步，两步之间如果插进另一个请求，
 * 两边会基于同一份旧快照各写一份，后落盘的把前一份**静默覆盖**（实测：8 路并发新建笔记
 * 只活下来 1 个 id，其余内容全丢）。
 *
 * 为什么一把锁够用：单用户、单进程的本地应用，所有写入都来自同一个 Next 进程的 Server Action。
 * 已知不覆盖：两个独立进程（同时开两个 `next dev`、或另跑 CLI）之间不共享这把锁 ——
 * 属于 `docs/架构决策.md` 残余风险里的 TOCTOU 一类，已明确接受。
 *
 * 用法：`return serialize(() => doWork(...))`。锁只管顺序，不管成败：
 * 前一个任务抛错，后一个照样会跑。
 */
let queue: Promise<unknown> = Promise.resolve();

export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}
