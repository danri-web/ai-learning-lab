import { formatLocalDate } from "@/lib/content/clock";
import { ARTICLE_ID_PATTERN, MAX_ID_LENGTH, isReservedArticleId } from "@/lib/security/article-id";

/**
 * 标题 → 文件名（docs/架构决策.md D7：**中文标题直接当文件名**）。
 *
 * 规则（按顺序）：
 *   1. NFKC 归一：全角字母数字折成半角（`ＡＩ` → `AI`），免得同一个词出现两种写法
 *   2. 除了「字母/数字/`-`/`_`」以外的一切连续字符 → 一个 `-`（空格、冒号、括号、斜杠都在内）
 *      —— 用「替换成连字符」而不是「删掉」，是为了 `注意力：机制` 不会粘成 `注意力机制`
 *   3. 去掉首尾的 `-`，截到 64 位
 *   4. 落在保留名上（`con` / `new` …）就加 `note-` 前缀
 *   5. 还是不合格（标题全是符号）→ 时间戳兜底 `note-20261030-ab12`
 *
 * 这样 `Transformer 的注意力机制（上）` → `Transformer-的注意力机制-上`，
 * 在资源管理器里一眼能认出是什么，URL 里也不会出现空格和控制字符。
 *
 * 注意：本函数只保证「名字合法」，**不保证唯一** —— 重名加 `-2` 是写文件时的事
 * （要读目录，见 lib/content/write.ts）。
 */

/** 白名单之外的一切（空格、冒号、括号、斜杠、emoji…）都折成连字符；`-` 和 `_` 原样保留 */
const NOT_ALLOWED = /[^\p{L}\p{N}_-]+/gu;

export function slugifyTitle(title: string, options: { fallback?: string } = {}): string {
  let slug = title
    .normalize("NFKC")
    .replace(NOT_ALLOWED, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "");
  slug = Array.from(slug).slice(0, MAX_ID_LENGTH).join("").replace(/-+$/, "");

  if (isReservedArticleId(slug)) slug = `note-${slug}`;

  if (!ARTICLE_ID_PATTERN.test(slug)) return options.fallback ?? fallbackNoteId();
  return slug;
}

/**
 * 兜底 id：`note-20261030-ab12`。
 *
 * 只有在标题里一个可用的字都没有（全是 `？？？`、`!!!`、纯 emoji）时才会用到；
 * 可读性差，但永不冲突、零依赖，而且**至少能看出是哪天写的**。
 */
export function fallbackNoteId(now = new Date(), random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `note-${formatLocalDate(now).replaceAll("-", "")}-${suffix}`;
}

/**
 * 路由参数 → 文章 id。
 *
 * 实测（Next 16.4.3）：动态段交给页面的 `params.id` 是**没解码的原始值** ——
 * 访问 `/knowledge/Transformer-%E7%9A%84...` 拿到的是那串 `%E7%9A%84`，不是「的」。
 * 中文 id 因此全被判成非法 id（白名单里没有 `%`），页面直接报「读不出来」。
 *
 * 因为 id 字符集里根本没有 `%`，「含 % 就一定是编码过的」是个安全判据；
 * 解码失败（畸形转义）就原样返回，交给路径闸门去拒绝，而不是在这里抛异常。
 */
export function articleIdFromParam(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
