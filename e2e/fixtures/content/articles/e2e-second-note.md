---
id: e2e-second-note
title: E2E 第二篇（英文 id）
category: 测试夹具
tags:
  - E2E
  - 检索
createdAt: '2026-01-06'
updatedAt: '2026-01-06'
---
## 用来验证列表与删除

这篇夹具的 id 是 ASCII，标题是中文。正文里也出现一次 **E2E检索标记**，用来验证搜索的「多结果」分组。

- 列表里应该能看到两篇夹具笔记
- 删除测试只删这一篇（或者测试自己新建的那篇）

## 代码块

```ts
const fixture = "e2e-second-note";
```
