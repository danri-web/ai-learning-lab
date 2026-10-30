/**
 * 本地日期/时间字符串。
 *
 * 为什么不用 `toISOString()`：那是 UTC。用户在 UTC+8 的晚上 11 点写的笔记，
 * `toISOString()` 会记成**前一天** —— frontmatter 的日期是给人看的，不是给机器排序的。
 *
 * 全部接受 `now` 参数，测试里注入固定时间，不依赖「跑测试的那一天」。
 */

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** `YYYY-MM-DD`（frontmatter 的 createdAt / updatedAt 格式） */
export function formatLocalDate(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `YYYYMMDD-HHmmss`（删除时进 `.trash` 的文件名前缀，按时间一眼能排） */
export function formatLocalStamp(now = new Date()): string {
  return `${formatLocalDate(now).replaceAll("-", "")}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
}
