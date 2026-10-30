import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 外部复核用的探针套件（不属于 `npm run verify` 的交付门槛）。
 * 单独一份 config，因为主套件只收 `tests/**` 下的 `*.test.ts`；
 * 探针用 `.probe.ts`，不改变 536 条断言的计数。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/probes/**/*.probe.ts",
      "tests/frontmatter-security.test.ts",
      "tests/restore-lookup-failure.test.ts",
      "tests/restore-discard.test.ts",
      "tests/service-write-gate.test.ts",
      "tests/restore-recovery.test.ts",
      "tests/backup-recovery-cache.test.ts",
    ],
    testTimeout: 30_000,
    // 让 console.log 直接进 stdout（不带 Vitest 的 "stdout | ..." 包装），
    // 这样 `npm run audit:probes > 06-复核探针.log` 出来就是一页能读的表。
    disableConsoleIntercept: true,
  },
});
