import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("同一属性的 Tailwind 类名冲突时，后写的胜出", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });

  it("丢弃假值条件类名，保留真值类名", () => {
    const active = false;
    expect(cn("p-2", active && "hidden", undefined, "text-sm")).toBe("p-2 text-sm");
  });

  it("重复的类名只出现一次，不会输出两遍", () => {
    const result = cn("rounded-md", "border", "rounded-md");
    expect(result.split(" ").sort()).toEqual(["border", "rounded-md"]);
  });
});
