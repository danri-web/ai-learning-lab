import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/**
 * 需求书 §8：默认只监听 127.0.0.1；局域网必须显式开启、用生产构建、受保护配置。
 *
 * 这些断言钉的是「安全要求 ↔ 启动方式 / 门禁文件」的关系：
 *   - dev/start 永远钉 127.0.0.1
 *   - 0.0.0.0 只准出现在 scripts/start-lan.mjs 这一个文件里
 *   - start-lan 必须检查口令哈希与会话密钥，缺了就退出
 *   - 工作区布局必须有第二道会话门
 */
describe("启动命令只绑定本机", () => {
  for (const script of ["dev", "start"]) {
    it(`npm run ${script} 显式绑定 127.0.0.1`, () => {
      const command = pkg.scripts[script] ?? "";
      expect(command).toContain("-H 127.0.0.1");
      expect(command).not.toContain("0.0.0.0");
    });
  }

  it("没有把局域网监听写进普通脚本", () => {
    const offenders = Object.entries(pkg.scripts).filter(
      ([, command]) => command.includes("0.0.0.0") || command.includes("--hostname 0.0.0.0"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("局域网模式只有一个受控入口", () => {
  it("npm run start:lan 指向 scripts/start-lan.mjs", () => {
    expect(pkg.scripts["start:lan"]).toBe("node scripts/start-lan.mjs");
  });

  it("start-lan.mjs 绑定 0.0.0.0、设置 ALLOW_LAN=1，并检查口令/密钥", () => {
    const source = readFileSync(join(ROOT, "scripts", "start-lan.mjs"), "utf8");
    expect(source).toContain('"0.0.0.0"');
    expect(source).toContain('env.ALLOW_LAN = "1"');
    expect(source).toContain("LAB_PASSWORD_HASH");
    expect(source).toContain("SESSION_SECRET");
    expect(source).toContain("process.exit(1)");
    expect(source).toContain(".next");
  });

  it("0.0.0.0 不出现在 start-lan.mjs 之外的脚本里", () => {
    const source = readFileSync(join(ROOT, "scripts", "start-lan.mjs"), "utf8");
    expect(source).toContain("0.0.0.0");
    expect(pkg.scripts.dev).not.toContain("0.0.0.0");
    expect(pkg.scripts.start).not.toContain("0.0.0.0");
  });

  it("口令由脚本生成，不要求用户手写", () => {
    expect(pkg.scripts["auth:set-password"]).toBe("node scripts/set-password.mjs");
    const envExample = readFileSync(join(ROOT, ".env.example"), "utf8");
    expect(envExample).toContain("LAB_PASSWORD_HASH");
    expect(envExample).toContain("SESSION_SECRET");
  });
});

describe("认证门的文件关系", () => {
  it("存在 proxy.ts，且 matcher 排除静态资源", () => {
    expect(existsSync(join(ROOT, "proxy.ts"))).toBe(true);
    const source = readFileSync(join(ROOT, "proxy.ts"), "utf8");
    expect(source).toContain("_next/static");
    expect(source).toContain("/api/auth/login");
  });

  it("工作区布局调用 requirePageAuth（proxy 之外的第二道门）", () => {
    const source = readFileSync(join(ROOT, "app", "(workspace)", "layout.tsx"), "utf8");
    expect(source).toContain("requirePageAuth");
  });

  it("登录页存在，并且是独立于工作区的页面", () => {
    expect(existsSync(join(ROOT, "app", "login", "page.tsx"))).toBe(true);
    const source = readFileSync(join(ROOT, "app", "login", "page.tsx"), "utf8");
    expect(source).toContain('title: "登录"');
    expect(source).toContain('action="/api/auth/login"');
  });
});
