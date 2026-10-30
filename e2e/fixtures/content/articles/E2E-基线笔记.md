---
id: E2E-基线笔记
title: E2E 基线笔记：注意力与检索
category: 测试夹具
tags:
  - E2E
  - 注意力
createdAt: '2026-01-05'
updatedAt: '2026-01-05'
---
## 为什么需要它

这是端到端测试的固定夹具，不是真实笔记。它故意用了中文文件名（ADR D7）和唯一的检索词 **E2E检索标记**。

### 缩放点积

$$
\text{Attention}(Q,K,V) = \mathrm{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
$$

| 结构 | 并行 | 长依赖 |
| --- | --- | --- |
| RNN | 否 | 弱 |
| Transformer | 是 | 强 |

```python
def attention(q, k, v):
    return softmax(q @ k.T / q.size(-1) ** 0.5) @ v
```

> 夹具正文结束。改这段文字可以用来测恢复。
