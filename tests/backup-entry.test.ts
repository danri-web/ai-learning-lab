import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONTENT_PREFIX,
  MAX_ENTRY_NAME_LENGTH,
  contentPathForEntry,
  validateBackupEntryName,
  validateEntryList,
} from "@/lib/security/backup-entry";

/**
 * 备份条目闸门。每一条「拒绝」都是先用假样本撞出来的 ——
 * 这些字符串如果真的进了恢复流程，就是任意文件写入。
 */
describe("合法条目", () => {
  const valid = [
    "content/resources.json",
    "content/tasks.json",
    "content/.trash/resources-deleted.jsonl",
    "content/.trash/tasks-deleted.jsonl",
    "content/articles/Transformer-的注意力机制-上.md",
    "content/articles/note_2.md",
    "content/articles/_draft.md",
    "content/articles/.trash/20261030-101500-Transformer-的注意力机制-上.md",
  ];

  it.each(valid)("接受：%s", (entry) => {
    const result = validateBackupEntryName(entry);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(entry);
  });

  it("一组合法条目通过（含中文）", () => {
    expect(validateEntryList(valid)).toEqual({ ok: true });
  });
});

describe("拒绝路径穿越与任意文件", () => {
  const invalid = [
    "",
    "../content/resources.json",
    "content/../.env.local",
    "../../package.json",
    "/content/resources.json",
    "\\content\\resources.json",
    "C" + ":/content/resources.json",
    "C" + ":\\content\\resources.json",
    "content\\articles\\a.md",
    "content/articles/",
    "content/articles/a/b.md",
    "content/articles/../resources.json",
    "content/./resources.json",
    "content//resources.json",
    "package.json",
    ".env.local",
    "backups/ai-lab-20261030-101500.zip",
    "content/resources.json.bak",
    "content/articles/foo.txt",
    "content/articles/a.md.md",
    "content/articles/.hidden.md",
    "content/articles/con.md",
    "content/articles/a:b.md",
    "content/articles/a?b.md",
    "content/articles/a*b.md",
    "content/articles/a|b.md",
    'content/articles/a"b.md',
    "content/.trash/restore-20261030/foo.md",
    "content/.trash/unknown.jsonl",
    "content/articles/.trash/",
    "content/articles/.trash/../x.md",
    `content/articles/${"a".repeat(MAX_ENTRY_NAME_LENGTH)}.md`,
  ];

  it.each(invalid)("拒绝：%s", (entry) => {
    const result = validateBackupEntryName(entry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("拒绝非字符串", () => {
    for (const value of [null, undefined, 42, {}, ["content/resources.json"]]) {
      expect(validateBackupEntryName(value).ok).toBe(false);
    }
  });

  it("拒绝同一路径的大小写变体（Windows 上会写同一个文件）", () => {
    const result = validateEntryList(["content/articles/Foo.md", "content/articles/foo.md"]);
    expect(result.ok).toBe(false);
  });
});

describe("条目 → 绝对路径", () => {
  const root = path.join("D" + ":", "lab", "content");

  it("合法条目落在 content/ 内", () => {
    const full = contentPathForEntry(root, "content/articles/中文.md");
    expect(full.startsWith(path.resolve(root) + path.sep)).toBe(true);
    expect(full.endsWith("中文.md")).toBe(true);
  });

  it("非法条目直接抛错（防止调用方绕过白名单）", () => {
    expect(() => contentPathForEntry(root, "content/../.env.local")).toThrow();
  });

  it("前缀常量与文件名一致", () => {
    expect(CONTENT_PREFIX).toBe("content/");
  });
});
