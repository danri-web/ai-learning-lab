import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 不把 "X-Powered-By: Next.js" 之类的实现细节发给局域网里的设备。
   */
  poweredByHeader: false,
  /**
   * 安全响应头（阶段 7）。CSP 故意没加：Next 的启动脚本是内联的，要做严格 CSP 得走 nonce，
   * 这会把 middleware/proxy 与所有页面都卷进来；而本项目不渲染用户 HTML（源码闸门禁掉了
   * 往 DOM 塞 HTML），局域网 HTTP 也不面对公网。先加不依赖 nonce 的几条，CSP 记在 ADR 残余风险。
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  /**
   * 本地数据应用：每次请求都必须读盘，不做任何隐式缓存。
   *
   * ⚠️ shadcn init 默认把它打开了（连同 partialPrefetching），但它一开，
   * "动态渲染"就只能写成 <Suspense> + connection() 的流式模型，
   * 和我们要的"整页 force-dynamic"互斥（构建会直接报
   * "connection() accessed outside of <Suspense>"）。
   * 结论见 docs/架构决策.md D4 —— 这个项目关掉它。
   */
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
