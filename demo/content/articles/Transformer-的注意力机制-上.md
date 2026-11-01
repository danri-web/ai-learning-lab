---
id: Transformer-的注意力机制-上
title: Transformer 的注意力机制（上）· 修订版
category: Deep Learning
tags:
  - Transformer
  - Attention
  - 注意力
createdAt: '2026-10-30'
updatedAt: '2026-10-30'
---
## 为什么需要它

RNN 顺序处理，长距离依赖会衰减；注意力一次看全序列。

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

> 引用：Attention Is All You Need (2017)
## 补充：为什么要除以 √d_k

点积随维度增大而变大，softmax 会变得极端，梯度消失；除以 √d_k 把方差拉回 1。
