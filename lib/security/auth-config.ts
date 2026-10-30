/**
 * 访问边界的配置读取（纯函数，不碰文件、不碰 cookie）。
 *
 * 两种模式：
 *   - 本机模式（默认）：只监听 127.0.0.1，不需要登录。`ALLOW_LAN` 不设或不是 1/true。
 *   - 局域网模式：`ALLOW_LAN=1`，**所有**受保护请求都要会话；没配好口令/密钥就 fail closed。
 *
 * 这里只回答「该不该要认证」「配置齐不齐」，具体放行由 proxy.ts 决定。
 * 单独拆出来是为了能在测试里注入 env，不用真的改进程环境。
 */

export type AccessMode = "local" | "lan";

export type AuthConfig = {
  allowLan: boolean;
  hasPassword: boolean;
  hasSecret: boolean;
  /** 局域网模式下配置是否齐全；本机模式恒为 true（不需要口令） */
  ready: boolean;
  problems: string[];
};

const PASSWORD_HASH_SHAPE = /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;

/** 会话密钥至少 32 字符（set-password 会生成 32 字节随机数的 base64url） */
export const MIN_SECRET_LENGTH = 32;

export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const allowLan = env.ALLOW_LAN === "1" || env.ALLOW_LAN?.toLowerCase() === "true";
  const hasPassword = PASSWORD_HASH_SHAPE.test(env.LAB_PASSWORD_HASH ?? "");
  const hasSecret = (env.SESSION_SECRET ?? "").length >= MIN_SECRET_LENGTH;

  const problems: string[] = [];
  if (allowLan && !hasPassword)
    problems.push("缺少 LAB_PASSWORD_HASH（先运行 npm run auth:set-password）");
  if (allowLan && !hasSecret)
    problems.push("缺少 SESSION_SECRET（先运行 npm run auth:set-password）");

  return {
    allowLan,
    hasPassword,
    hasSecret,
    ready: !allowLan || (hasPassword && hasSecret),
    problems,
  };
}

export function accessMode(config: AuthConfig): AccessMode {
  return config.allowLan ? "lan" : "local";
}

/**
 * Host 是不是本机（用于「本机模式却发现有人从局域网访问」的 fail closed）。
 *
 * 注意：这是**纵深防御**，不是安全边界 —— Host 头可以伪造。真正的保证是绑定地址
 * （scripts/start-lan.mjs 之外没有任何脚本绑 0.0.0.0），这条只在「有人绕过脚本手动绑了
 * 0.0.0.0」时拦住诚实的误配置。
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  const raw = (host ?? "").trim().toLowerCase();
  if (!raw) return false;

  let hostname = raw;
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end === -1) return false;
    // `[::1].evil.com` 这种前缀骗不过去：右括号后面只能是空或 `:端口`
    const rest = raw.slice(end + 1);
    if (rest !== "" && !/^:\d{1,5}$/.test(rest)) return false;
    hostname = raw.slice(1, end);
  } else {
    const firstColon = raw.indexOf(":");
    const lastColon = raw.lastIndexOf(":");
    // 只有一个冒号 = host:port；多个冒号是未加括号的 IPv6，交给下面的白名单判
    if (firstColon !== -1 && firstColon === lastColon) hostname = raw.slice(0, firstColon);
  }

  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0:0:0:0:0:0:0:1" ||
    hostname === "::ffff:127.0.0.1"
  );
}

/**
 * 登录后跳回哪里：只接受站内绝对路径。
 * 拒绝 `//evil.com`、`\`、控制字符、`/login` 自己（避免登录后又回登录页）。
 */
export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string") return "/";
  const next = value.trim();
  if (next.length === 0 || next.length > 500) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.includes("\\")) return "/";
  if (/[\u0000-\u001f]/.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}

/**
 * 表单 POST 的 Origin 检查。
 *
 * 不能只跟 `new URL(request.url).origin` 比：`next start -H 0.0.0.0` 时，框架构造的
 * request.url 可能是 `http://0.0.0.0:3100`，而浏览器发的是 `http://localhost:3100` ——
 * 两者都是这台机器，直接比会把合法登录拒掉。所以再接受一次「协议 + Host 头」。
 *
 * Origin 缺失（curl、某些隐私设置）时不拦截：这条是 CSRF 防线，不是身份认证；
 * 口令本身仍然必须对。
 */
export function isAllowedOrigin(
  origin: string | null | undefined,
  host: string | null | undefined,
  requestUrl: string,
): boolean {
  // `Origin: null` 是浏览器对「不透明来源」的写法（沙箱 iframe、某些代理/扩展环境）。
  // 这台实例只有一个账号，登录仍要口令；把它当缺失处理，比把合法登录拒掉更合理。
  if (!origin || origin === "null") return true;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return false;
  }

  const allowed = new Set<string>([url.origin]);
  if (host) allowed.add(`${url.protocol}//${host}`);
  return allowed.has(origin);
}

/**
 * 由 Host 头还原浏览器看到的 origin。
 *
 * `next start -H 0.0.0.0` 时 `request.url` 可能是 `http://0.0.0.0:3100`，
 * 直接拿它做 `new URL(path, request.url)` 会把浏览器送到 0.0.0.0。
 * 有 Host 时一律用 Host；没有才退回 request.url。
 */
export function requestOrigin(host: string | null | undefined, requestUrl: string): string {
  const url = new URL(requestUrl);
  return host ? `${url.protocol}//${host}` : url.origin;
}
