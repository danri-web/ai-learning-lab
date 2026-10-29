import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/**
 * README §8 第 1 条：默认只监听 127.0.0.1，不自动开放局域网。
 * Next.js 默认绑 0.0.0.0 / ::（实测过），所以必须由脚本显式钉死。
 * 这条断言就是「安全要求 ↔ 启动命令」的关系；谁把 -H 删了，这里立刻红。
 */
describe("启动命令只绑定本机", () => {
  for (const script of ["dev", "start"]) {
    it(`npm run ${script} 显式绑定 127.0.0.1`, () => {
      const command = pkg.scripts[script] ?? "";
      expect(command).toContain("-H 127.0.0.1");
      expect(command).not.toContain("0.0.0.0");
    });
  }

  it("没有把局域网监听写进任何脚本", () => {
    const offenders = Object.entries(pkg.scripts).filter(
      ([, command]) => command.includes("0.0.0.0") || command.includes("--hostname 0.0.0.0"),
    );
    expect(offenders).toEqual([]);
  });
});
