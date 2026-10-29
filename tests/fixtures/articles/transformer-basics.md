---
id: transformer-basics
title: Transformer 基础
category: Deep Learning
tags:
  - Transformer
  - Attention
createdAt: "2026-10-20"
updatedAt: "2026-10-27"
---

# Transformer 基础

注意力机制的核心是「让每个位置自己决定看哪里」。

## 为什么需要它

RNN 顺序处理，长距离依赖会衰减；注意力一次看全序列。

### 缩放点积注意力

$$
\text{Attention}(Q,K,V) = \mathrm{softmax}\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
$$

## 代码

```python
import torch

def attention(q, k, v):
    return torch.softmax(q @ k.transpose(-2, -1) / q.size(-1) ** 0.5, dim=-1) @ v
```

## 对比

| 结构 | 并行 | 长依赖 |
| --- | --- | --- |
| RNN | 否 | 弱 |
| Transformer | 是 | 强 |

> 引用：Attention Is All You Need (2017)
