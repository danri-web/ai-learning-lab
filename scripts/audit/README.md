# 复核探针（`npm run audit:probes`）

给外部复核者的只读入口。它不属于 `npm run verify` 的交付门槛，也不会改变 519 条断言的计数
（探针文件是 `*.probe.ts`，主套件只收 `*.test.ts`）。

## 跑什么

```powershell
npm ci
npm run audit:probes
```

输出 33 行 `PASS/FAIL` + 最后一行 `结果：33/33 PASS`，退出码 0 表示全过。
同一条命令还会跑 6 个命名回归套件（frontmatter-security / restore-lookup-failure / restore-discard /
service-write-gate / restore-recovery / backup-recovery-cache），合计 7 个文件、57 条 ——
不用信任主套件的 536 条汇总。

## 覆盖什么

| 组 | 样例 |
|---|---|
| frontmatter 开头 | 六种 Unicode 空白（NBSP / EM SPACE / 窄 NBSP / 全角空格 / BOM / 垂直制表符）× 前置/后置、文件头 BOM、**两个前导 BOM**（含无换行的 `---javascriptX`）、`---js`、`!!js/function` |
| 三个入口 | `parseArticle`（读/搜索）、`readFrontmatter`（保存旧笔记）、`checkBackupPayload`（恢复预览） |
| 数据格式 | 普通 YAML、`---json`、正文对象序列化 |
| 写入闸门 | 无日志 / `applying` / `verified` / 坏日志 / `verified` 不回滚 |
| 恢复状态机 | `applying` 回滚到快照并删日志、坏日志 fail closed、快照缺失保留日志、快照名不能是路径 |

## 边界（别当成安全审计）

- **只读、不联网**：临时目录在 `node_modules/.vitest-tmp/probes`，跑完自动删；不读写真实
  `content/` 与 `backups/`，不构造 zip、不起服务、不监听端口。
- **不是渗透测试**：验证的是"内容不会被执行"和"恢复状态机不丢数据"，不是找新的攻击面。
- 断言方式是**执行标记保持 0**（每个样例先清零全局标记），不是"看起来被拒绝"。

## 想自己加样例

在 `tests/probes/v3-probes.probe.ts` 的 `cases` 里追加一条 `{ title, run }`，
`run` 返回 `true/false` 即可；保持只读、每个样例先 `reset()`。
