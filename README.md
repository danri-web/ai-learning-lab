# AI Learning Lab

一个本地优先的 AI 学习、知识管理与资源收藏工作台。

**当前状态：阶段 3a 完成（只读笔记）。** 现在能读你自己的 Markdown 笔记了：列表、详情、GFM 表格、代码高亮、公式、文章目录。**还不能写** —— 新建 / 编辑 / 删除是阶段 3b，按钮仍是禁用的占位。

![仪表盘](docs/screenshot-dashboard.png)

![笔记详情](docs/screenshot-article.png)

> 完整需求、验收标准与八阶段路线在 **[docs/需求书.md](docs/需求书.md)**（原始需求书，内容保持原样）。

## 写一篇笔记（现在就可用）

把 `.md` 文件放进 `content/articles/`，刷新 `/knowledge` 就能看到。**文件名就是文章 id**，frontmatter 里的 `id` 必须与它一致：

```markdown
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

正文从这里开始。支持 GFM 表格、```代码块```、$行内公式$、$$块级公式$$。
```

规则（都有测试守着）：
- `id`：小写字母/数字/连字符，1–64 位，且必须是文件名去掉 `.md` 之后的部分
- `updatedAt` 不能早于 `createdAt`；日期格式 `YYYY-MM-DD`
- `tags` 可以省略（等于空数组），其余字段必填
- 以 `_` 开头的文件被当作模板/草稿，**不进列表**
- frontmatter 写错的笔记只会单独报错（列表顶上会提示），不会让整页崩掉

> `content/articles/` **不在这个仓库里**（主仓库是公开的，笔记属于你自己的私有仓库 —— 见 [docs/架构决策.md](docs/架构决策.md) D5）。

## 设计原则

- **Local-first**：内容与数据库都在自己电脑上，不依赖云
- **Knowledge-first**：先保证笔记、资源与搜索好用
- **Secure by default**：默认只监听 `127.0.0.1`，局域网访问须显式开启并保护
- **AI-ready, not AI-dependent**：为将来的 AI 功能留口子，MVP 不依赖任何模型服务

## 快速开始

```powershell
git clone https://github.com/danri-web/ai-learning-lab.git
cd ai-learning-lab
npm install
npm run dev
```

打开 <http://127.0.0.1:3000>。

环境：Windows 10 + Node.js 24.21 + npm 11.19（实测版本）。环境变量示例见 `.env.example`，复制为 `.env.local` 后修改。

## 已实现的脚本

```powershell
npm run dev          # 开发服务器（127.0.0.1:3000）
npm run build        # 生产构建
npm run start        # 运行生产构建
npm run lint         # ESLint 9
npm run typecheck    # next typegen && tsc --noEmit
npm run test         # Vitest
npm run test:watch   # Vitest 监听
npm run format       # Prettier 写入
npm run format:check # Prettier 只检查
```

端到端测试（Playwright）尚未提供，按需求书放在阶段 8 —— 所以这里没有 `test:e2e` 脚本，避免出现「看起来有、跑就报错」的假入口。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 框架 | Next.js 16.4.3（App Router、Turbopack） |
| UI | React 19.3、Tailwind CSS 4、shadcn/ui（`radix-nova`）、Lucide |
| 语言 | TypeScript 5（`strict: true`） |
| 测试 | Vitest 5 |
| 格式化 | Prettier 3 |
| 计划中 | SQLite + Drizzle ORM + FTS5 全文搜索（阶段 3 起） |

## 目录

```text
app/(workspace)/   页面：总览 / 知识库（含 [id] 详情）/ 资源收藏 / 学习任务 / 设置
components/layout/ 外壳：侧栏、顶栏、手机抽屉、页面标题
components/ui/     shadcn 组件 + 空状态
components/knowledge/  Markdown 渲染器
lib/content/       读笔记（唯一碰「正文文件」的地方）
lib/markdown/      目录提取、正文整形
lib/               工具函数（目前只有 shadcn 的 cn()）
tests/             Vitest 单元测试（15 条）
docs/              需求书与截图
public/            静态资源
```

`features/`、`data/`、`content/articles/` 在对应阶段创建，不提前建空壳。

## 阶段进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 工程初始化 | ✅ 2026-10-29 |
| 2 | 设计系统与页面框架 | ✅ 2026-10-29 |
| 3a | Markdown 知识库：只读（列表 / 详情 / 渲染） | ✅ 2026-10-29 |
| 3b | Markdown 知识库：写入（编辑器 / 保存 / 删除） | ⬜ 未开始 |
| 4 | 资源收藏中心 | ⬜ 未开始 |
| 5 | 全文搜索 | ⬜ 未开始 |
| 6 | 学习任务与 Dashboard | ⬜ 未开始 |
| 7 | 备份、安全与局域网访问 | ⬜ 未开始 |
| 8 | 测试与本地发布 | ⬜ 未开始 |

### 阶段 2 具体做了什么

- **设计令牌**：需求书 §6 的十个色值全部落到 `app/globals.css` 的 CSS 变量，组件里零硬编码颜色（有测试守着）
- **外壳**：桌面 = 侧栏 + 顶栏 + 主区；手机 = 顶栏 + 抽屉导航 + 单列（Esc 关闭、焦点由 Radix Dialog 管住）
- **五个页面骨架**：都有空状态，并写明「哪个阶段接入真实数据」，不放假数据
- **只绑定本机**：`next dev/start` 显式 `-H 127.0.0.1`（Next 默认绑 `0.0.0.0`，实测过）
- **断言**：令牌 ↔ 需求书、导航 ↔ 页面文件、脚本 ↔ 安全要求，共 19 条
- **自查修掉的 6 处问题**（生产构建 + DevTools 协议实测，不是看代码猜的）：五个页面标题重复、404 页沿用 Next 默认样式且没有导航、404 页 React 水合错误 `#418`、次要文字对比度只有 4.58:1、跳过导航链接不移动焦点、长字符串（如长 URL）横向溢出 542px

### 阶段 3 的闸门（功能还没写，先把门锁上）

阶段 3 才开始读写文件，但三条防线已经先落地，并且每条都用恶意样本撞过：

| 防线 | 实现 | 断言 |
| --- | --- | --- |
| 路径穿越 | [lib/security/paths.ts](lib/security/paths.ts)：`resolveArticlePath` 做字符串校验（id 白名单）；`resolveArticleFile` 再加物理校验（正文目录不能是链接、目标文件不能是链接、真实路径仍在目录内） | 26 个恶意 id 全部拒绝；真实 junction 夹具证明"只做字符串校验会被骗过"，而 `resolveArticleFile` 会拒绝 |
| 半截文件 | [lib/fs/atomic-write.ts](lib/fs/atomic-write.ts)：临时文件 + fsync + rename（Windows 上带退避重试），失败时连同关闭句柄一起清理 | 并发 8 个写入者不互相踩、失败时原文件不变、不留 `.tmp`；**故障注入**让 `close()` 失败，验证仍会清理 |
| XSS 面 | [tests/security-gates.test.ts](tests/security-gates.test.ts)：源码级禁令 | 禁止 `dangerouslySetInnerHTML`、`eval`/`new Function`、`rehype-raw`、以及**在 `lib/fs` 与 `lib/security/paths` 之外 import 任何 fs 模块**（扫 import，别名绕不过）；扫描器有假样本自检，并明确记录它抓不到的形态 |

> 2026-10-29 外部审计（4 条 P2/P3）已全部处理：`close()` 失败漏临时文件（故障注入证实并修复）、
> 路径校验是词法而非物理（junction 实证 + 新增 `resolveArticleFile`）、扫描器漏别名导入（改为扫 import）、
> 一条测试的描述与断言矛盾（删掉 `ext` 参数，从根上消除）。断言从 37 条增至 45 条。
>
> 同日第二轮外部审计（3 条 P2）也已处理：Windows 路径大小写会让合法目录被误拒（`fs.realpath` 返回规范大小写，
> 改成平台感知的比较）、`.gitignore` 漏了 `/content/articles/`（ADR 说已保护但没有落地 —— 文档撒谎比没写更危险）、
> 链接夹具建不出来时测试会**静默通过**（改为 `it.skipIf`：跳过就是跳过，有 1 条在受本机限制时会显示 skipped）。

## 安全

- 默认只监听 `127.0.0.1`，不自动开放局域网或公网
- `.env*`、`data/`、`backups/` 已排除在 git 之外，仓库里不会有数据库、备份或密钥
- 不提供服务端抓取任意 URL 的能力（避免 SSRF），外部链接只允许安全协议
- 详细条目见 [docs/需求书.md](docs/需求书.md) §8

## License

[MIT](LICENSE) © 2026 Daniel Riviera

### 阶段 3a 具体做了什么

- **读文件，不建库**：`content/articles/*.md` 每次请求都扫一遍（D1），没有数据库、没有索引、没有缓存
- **frontmatter 用 Zod 校验**：写错的笔记单独报错并在列表顶部提示，不让整页崩；`id` 必须与文件名一致
- **渲染**：react-markdown + remark-gfm（表格/任务列表）+ remark-math & rehype-katex（公式）+ rehype-highlight（代码高亮）+ 自动目录
- **不执行正文里的 HTML**（不装 rehype-raw，源码闸门守着）
- **手机上不横向溢出**：宽表格套横向滚动容器；实测 390px 溢出 0
- **两个页面都是动态渲染**（`force-dynamic`），刷新即读到文件最新内容
- 断言：81 条（frontmatter 好坏样本 21 条、目录提取 8 条、路径/原子写/源码闸门等）