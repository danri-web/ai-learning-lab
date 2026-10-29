import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
