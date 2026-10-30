/**
 * 资源 URL 的白名单（阶段 4；需求书 §8「外部链接仅允许安全协议」+ 避免 SSRF）。
 *
 * 两条铁律：
 *   1. **只认 http / https**。`javascript:`、`data:`、`file:`、`vbscript:` 一律拒绝 ——
 *      前两者是 XSS 的门，后者会让浏览器去碰本机文件系统。
 *   2. **服务端永远不去 fetch 用户给的 URL**。这里只做字符串校验，不做可达性探测，
 *      所以没有 SSRF 面（将来要抓标题/封面图的话，那是另一个决定，得单独评估）。
 *
 * 也不接受相对路径 / 裸域名：资源收藏是"指向外面的东西"，写 `example.com/x` 的人
 * 以为点得开，实际会被当成站内相对路径。
 */

export const MAX_RESOURCE_URL_LENGTH = 2048;

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function isSafeResourceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_RESOURCE_URL_LENGTH) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
  // 没有主机名（`https:///x`）或带用户名密码（`https://user:pass@h/`）都不收：
  // 前者不是可用的链接，后者会在界面上泄露凭据、也没必要
  if (!parsed.hostname) return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

/** 展示用的域名（`github.com`），拿不到就返回空串 —— 界面不因为一个畸形 URL 崩掉 */
export function resourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
