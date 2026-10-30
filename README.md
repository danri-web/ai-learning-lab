# AI Learning Lab

一个本地优先的 AI 学习、知识管理与资源收藏工作台。

**当前状态：阶段 3 完成（知识库可读可写）。** 能在界面里新建、编辑、删除自己的 Markdown 笔记：双栏预览编辑器、未保存提醒、删除进回收站；列表、详情、GFM 表格、代码高亮、公式、文章目录都在。**中文标题直接当文件名。**

![知识库](docs/screenshot-article.png)

![编辑器](docs/screenshot-editor.png)

> 完整需求、验收标准与八阶段路线在 **[docs/需求书.md](docs/需求书.md)**（原始需求书，内容保持原样）。

## 写笔记（两种方式都行）

**方式一：界面** —— `/knowledge` → 新建笔记 → 写 → 保存。文件名由标题生成（中文照抄），创建后不再改名；重名自动加 `-2`。

**方式二：任何编辑器** —— 把 `.md` 文件放进 `content/articles/`，刷新 `/knowledge` 就能看到。**文件名就是文章 id**，frontmatter 里的 `id` 必须与它一致：

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
- `id`：字母/数字开头，可含 `-`、`_` 与中文，1–64 位，且必须是文件名去掉 `.md` 之后的部分；`con`/`nul`/`new` 这些保留名不能用（界面会自动加 `note-` 前缀）
- `updatedAt` 不能早于 `createdAt`；日期格式 `YYYY-MM-DD`（本地时区，不是 UTC）
- `tags` 可以省略（等于空数组），其余字段必填；自己加的额外 frontmatter 字段会被保留
- 以 `_` 开头或以 `.` 开头的文件/目录被跳过（模板、草稿、`.trash/`）
- frontmatter 写错的笔记只会单独报错（列表顶上会提示），不会让整页崩掉
- 删除 = 移到 `content/articles/.trash/`，不是真删；想找回来直接拖回来

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

![总览](docs/screenshot-dashboard.png)

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
app/(workspace)/   页面：总览 / 知识库（列表、[id] 详情、new 新建、[id]/edit 编辑）
                  knowledge/actions.ts = Server Action（只做 FormData ↔ 对象 + 跳转）
features/articles/  service.ts = 业务规则（唯一决定"能不能写"的地方）
components/layout/ 外壳：侧栏、顶栏、手机抽屉、页面标题
components/ui/     shadcn 组件 + 空状态
components/knowledge/  Markdown 渲染器 + 编辑器 + 删除确认
lib/content/       读主体（articles.ts）、frontmatter 校验、写入（write.ts）、id 生成
lib/markdown/      目录提取、正文整形
lib/security/      文章 id 规则、路径闸门（唯一的 id → 路径入口）
lib/fs/            原子写入（临时文件 + fsync + rename）
tests/             Vitest 单元测试（116 条，其中 1 条在本机会 skipped）
docs/              需求书、架构决策、截图
public/            静态资源
```

`data/` 与 `content/articles/` 在对应阶段创建/由你自己维护，仓库里不建空壳。

## 阶段进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 工程初始化 | ✅ 2026-10-29 |
| 2 | 设计系统与页面框架 | ✅ 2026-10-29 |
| 3a | Markdown 知识库：只读（列表 / 详情 / 渲染） | ✅ 2026-10-29 |
| 3b | Markdown 知识库：写入（编辑器 / 保存 / 删除） | ✅ 2026-10-30 |
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
| 路径穿越 | [lib/security/paths.ts](lib/security/paths.ts)：`resolveArticlePath` 做字符串校验（id 白名单）；`resolveArticleFile` 再加物理校验（正文目录不能是链接、目标文件不能是链接、真实路径仍在目录内） | 32 个恶意 id 全部拒绝；真实 junction 夹具证明"只做字符串校验会被骗过"，而 `resolveArticleFile` 会拒绝 |
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

### 阶段 3b 具体做了什么（写入）

- **写入链路只有一条**：`Server Action → features/articles/service.ts → lib/content/write.ts`。源码闸门断言"只有 service 能被 import 到这个写入模块"，页面想绕过就红
- **写之前先证明读得回来**：生成的 frontmatter 先过一遍自己的解析器（`parseArticle`），过不了就不落盘 —— 宁可保存失败，也不留一个应用自己打不开的文件
- **保存保留用户数据**：`createdAt` 不变、文件名不变（改标题不改名）、用户自己加的 frontmatter 字段原样保留
- **删除进回收站**：移到 `content/articles/.trash/20261030-153012-<id>.md`，内容一字不差；`.trash` 是以 `.` 开头的目录，列表天然跳过
- **编辑器**：左写右看（窄屏切"写/看"）、实时预览（`useDeferredValue`，打字不卡）、未保存提醒（`beforeunload`）、保存失败时字段不丢且错误回到字段旁边
- **中文文件名**（ADR D7）：`Transformer 的注意力机制（上）` → `Transformer-的注意力机制-上.md`；重名 `-2`；全符号标题退回 `note-YYYYMMDD-xxxx`
- **实测踩到的坑**：Next 16 把动态段原样（未 URL 解码）交给页面，中文 id 会全被判非法 → 统一走 `articleIdFromParam()`
- 断言：116 条（新增 id/文件名生成 18 条、写入 16 条；1 条文件级符号链接的断言在本机 skipped）