# AI Learning Lab

一个本地优先的 AI 学习、知识管理与资源收藏工作台。

**当前状态：阶段 6 完成（知识库 + 资源收藏 + 全文搜索 + 学习任务与总览）。** 笔记能新建/编辑/删除（中文标题直接当文件名）；资源收藏能增删改、按类型/分类/标签筛选、三种排序，并能挂到某篇笔记上。链接只接受 http/https，应用**从不抓取**你填的地址。`Ctrl+K` 能搜全部笔记与资源：分组、摘要、高亮、`↑↓`/`Enter`/`Esc` 键盘操作，**不建索引**（每次搜都读文件，所以永远不会有"索引过期"）。学习任务有 Todo / 进行中 / 已完成三档、截止日期（会算逾期）、可关联多篇笔记与多条资源；总览页的数字全部从文件现算。

![总览](docs/screenshot-dashboard.png)

![学习任务](docs/screenshot-learning.png)

![知识库](docs/screenshot-article.png)

![编辑器](docs/screenshot-editor.png)

![资源收藏](docs/screenshot-resources.png)

![搜索](docs/screenshot-search.png)

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
- 内部链接就是普通 Markdown 链接：`[另一篇](/knowledge/transformer-basics)`（`[[双向链接]]` 属于 P1，本阶段不做）；外链自动加 `target="_blank" rel="noopener noreferrer"`

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
| 搜索 | 直接扫 `content/` + 纯函数子串匹配（**无索引**，见 [docs/架构决策.md](docs/架构决策.md) D6 / D10） |
| 计划中 | SQLite（只在搜索/列表真慢到 >300ms 时才考虑，且只当可重建的缓存） |

## 目录

```text
app/(workspace)/   页面：总览 / 知识库（列表、[id] 详情、new 新建、[id]/edit 编辑）
                  knowledge/actions.ts = Server Action（只做 FormData ↔ 对象 + 跳转）
features/articles/  service.ts = 业务规则（唯一决定"能不能写"的地方）
features/resources/ 资源收藏的 service 与表单状态
features/tasks/     学习任务的 service 与表单状态
components/layout/ 外壳：侧栏、顶栏、手机抽屉、页面标题
components/ui/     shadcn 组件 + 空状态
components/knowledge/  Markdown 渲染器 + 编辑器 + 删除确认
components/resources/  收藏表单 + 删除确认
components/tasks/      任务表单（多选关联）+ 状态切换 + 删除确认
lib/content/       笔记读写（articles/write）、资源读写（resources/resources-store）、
                   任务读写（tasks/tasks-store）、id 与校验、BOM 处理
lib/markdown/      目录提取、标题锚点分配、正文整形
lib/search/        搜索：纯函数（匹配/摘要/高亮区间）、取数（笔记+资源归一）、接口类型
lib/security/      文章 id 规则、路径闸门、资源 URL 白名单
lib/fs/            原子写入（临时文件 + fsync + rename）、进程内写锁
tests/             Vitest 单元测试（234 条，其中 1 条在本机会 skipped）
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
| 4 | 资源收藏中心 | ✅ 2026-10-30 |
| 5 | 全文搜索 | ✅ 2026-10-30 |
| 6 | 学习任务与 Dashboard | ✅ 2026-10-30 |
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

### 外部审计 v3：4 条发现全部为真，已修（2026-10-30）

审计是外部模型做**静态审查**（不跑代码），4 条都附了 `文件:行号`。我逐条写了复现，**先看着它失败，再修**：

| # | 发现 | 复现结果 | 修法 | 回归断言 |
| --- | --- | --- | --- | --- |
| F1 | 并发新建会互相覆盖 | 同一标题 **8 路并发创建 → 只活下来 1 个 id**（8 个请求都报成功） | 写操作进程内串行（[write.ts](lib/content/write.ts) 的 `serialize`） | 8 路并发必须得到 8 个不同 id、8 份内容都在 |
| F2 | 过期保存静默覆盖新内容 | 两个编辑器先后保存 → 旧稿覆盖新稿，两次都返回成功 | 编辑器带正文指纹（sha256）提交，写入前比对；不一致就拒绝并给「仍然覆盖」（ADR **D8**） | 旧指纹保存被拒且磁盘不变；`force` 可覆盖 |
| F3 | 正文 `trim()` 破坏 Markdown 语义 | 以 4 空格开头的缩进代码块被压平（读一次就丢） | 只归一两端空行（[body-text.ts](lib/content/body-text.ts)），并加**正文等式检查** | 缩进 / 行尾空格 / 代码块原样往返 |
| F4 | 同名标题的目录锚点没有落点 | 目录给 `example-1`，渲染器两个都是 `example`（重复 id） | 目录与渲染共用一套分配逻辑（[heading-ids.ts](lib/markdown/heading-ids.ts)） | 每个目录锚点都恰好对应一个标题 id |

> 断言从 116 条增至 **130 条**；F1/F2/F3 的复现都先跑出失败输出，再改代码。

### 阶段 4 具体做了什么（资源收藏）

- **一个 JSON 就是全部资源**：`content/resources.json`（`{ version: 1, resources: [...] }`），和笔记一样文件是真相；主仓库 gitignore，跟笔记一起进那个私有仓库
- **URL 只认 http / https**（[resource-url.ts](lib/security/resource-url.ts)）：`javascript:`、`data:`、`file:`、相对路径、裸域名、带凭据的地址全拒；**服务端从不 fetch 用户给的地址**，所以没有 SSRF 面
- **写入沿用笔记的地基**：进程内写锁 + 原子写 + 写前自检；单条资源的指纹做「过期保存」检查（D8 同款），冲突时给「仍然覆盖」
- **文件坏了不覆盖**：`resources.json` 解析失败时，页面报出具体原因，应用**拒绝任何写入**（宁可停手，也不要把用户的坏文件连同修复机会一起覆盖掉）
- **删除可恢复**：从数组移除的同时，把这条记录追加到 `content/.trash/resources-deleted.jsonl`（带删除时间），贴回 JSON 就回来
- **筛选 / 排序**：类型 / 分类 / 标签三组 chips（带计数）+ 三种排序（最近更新 / 最近添加 / 按标题），全部用 URL 参数，刷新与分享都能保留
- **关联笔记**：表单里从现有笔记里选，列表上显示成可点的链接（逻辑关联，不校验对方是否还存在）
- 断言：149 条（新增 URL 白名单 4 条、资源读写 15 条；1 条文件级符号链接的断言在本机 skipped）
- **实测踩到的坑**：客户端表单从带 `node:fs` 的模块里 import 常量 → Turbopack 报 "does not support external modules (request: node:fs)"，构建直接失败；把纯常量拆到 `lib/content/resource-types.ts` 后正常

### 阶段 5 具体做了什么（全文搜索）

- **不建索引**（D6 的落地形态，记为 **D10**）：每次搜索都直接扫 `content/articles/*.md` + `content/resources.json`。实测 2 篇笔记 / 1 条资源 **6–16ms**（界面上就写着「已扫描 N 篇笔记 / M 条资源 · X ms」）。文件是真相，所以**不存在"索引过期"**：新建、改标题、删掉，下一次搜索立刻就是对的
- **三层分开**：`lib/search/query.ts`（纯函数：匹配 / 摘要 / 高亮区间，完全不碰文件系统，可以脱离磁盘测）→ `lib/search/sources.ts`（把笔记与资源归一成同一形状，笔记走 `resolveArticleFile`，所以 junction/symlink、`_`/`.` 开头、`.trash/` 一律进不来）→ 只读 Server Action（`app/(workspace)/search-actions.ts`）
- **中文友好**：子串匹配，`模型`、`机制` 这类 2 字词直接命中；FTS5 的 `unicode61` 对中文 0 命中、`trigram` 搜不到 2 字词，这也是不上它的原因
- **大小写不敏感用正则的 `i` 标志**，而不是把两边都 `toLowerCase()` —— 大小写折叠会改变字符串长度（`İ` → 两个码元），长度一变高亮下标全错
- **摘要只回片段**：命中点前 40 / 后 80 个码元，尽量切在空白处，且**不劈开 UTF-16 代理对**（emoji 落在窗口边界时整个保留）。断言直接钉了「摘要长度 < 140」——搜索不该把整个库吐给浏览器
- **高亮不拼 HTML**：后端只返回区间 `{start, end}`，前端切片 + `<mark>`；用户正文里的 `<script>` 永远只是文字（源码闸门禁往 DOM 塞 HTML）
- **多词是 AND**：「注意力 RNN」只要两者都有的那篇；词序不影响结果；`.*`、`(a+b)` 这类按字面匹配，不会变成正则
- **弹窗**：`Ctrl+K` / `⌘K` 开关，结果按**笔记 / 资源分组**；`↑↓` 选择、`Enter` 打开、`Esc` 关闭、焦点由 Radix 圈在弹窗里；**中文输入法组字期间的回车不算"打开"**（`isComposing` / `keyCode 229`）；加载 / 空 / 错误 / 查询过长 / 结果截断 五种状态都有话说
- **「索引重建」的落点**：没有索引可重建，所以做成弹窗底部的「重新扫描」——点一下重扫并刷新「已扫描 N/M · X ms」，这同时就是需求书验收项「增删改后索引更新」的证明
- **搜索是只读的，有断言**：跑两次搜索前后，夹具目录里每个文件的大小与 mtime 必须一模一样
- 断言：186 条（新增 37：纯函数 24、取数 13；1 条文件级符号链接的断言在本机 skipped）
- **实测踩到的坑**：① 新文件的注释里顺手写了源码闸门禁掉的那个标识符，闸门当场把这个文件抓红 —— 闸门对注释一视同仁，是对的；② 摘要把 Markdown 表格的分隔行（`| --- | --- |`）原样带出来了，补了「分隔行整行去掉、竖线当空格」；③ 第一次输入到结果返回之间（防抖 140ms + 一次往返）界面会闪一下「没有找到」——那不是"没找到"，是"还没回来"，改成「搜索中…」

### 阶段 6 具体做了什么（学习任务与总览）

- **一个 JSON 就是全部任务**：`content/tasks.json`（`{ version: 1, tasks: [...] }`），和资源同一个形态（D9 的地基，记为 **D11**）。主仓库 gitignore，跟笔记一起进那个私有仓库
- **只有三档状态**：待办 / 进行中 / 已完成。需求书 §7 明确说"不要甘特图、复杂项目管理、AI 排课"，所以一个字段就够
- **截止日期可选，逾期会自己算**：`dueInfo()` 把日期翻成人话（`逾期 2 天` / `今天到期` / `还剩 3 天` / `截止 2026-12-01`），**已完成的任务不喊逾期**（做完的事，日期过了不是问题）；日期用 UTC 算差，夏令时不影响
- **关联是多选**：一篇任务可以挂多篇笔记 + 多条资源（"学 Transformer Attention" 就是论文 + 教程 + 自己那篇笔记）。关联是**逻辑关联**：只存 id，断链在列表上显示成「笔记已失效：xxx」而不是崩掉
- **列表上直接改状态**：原生 `<select>`（键盘/读屏/手机都免费做对），走的是专门的 `updateTaskStatus` —— **只动 status 与 updatedAt**，不会把别处的草稿覆盖掉
- **写入沿用前三个阶段的地基**：进程内串行 + 原子写 + 写前自检 + 单条指纹（D8）；删除进 `content/.trash/tasks-deleted.jsonl`，贴回去就能恢复
- **总览页接真数据**：笔记 / 资源 / 任务 / 可搜索条目四个数字 + 最近笔记 + 进行中的任务 + 最近资源。**每个数字都是现读文件算的**，没有缓存也没有假值；某个数据文件坏掉时，顶部明确说"只统计了能读的部分"
- **统计口径只写一处**：`summarizeTasks()` 同时喂给总览和任务页的 chips，不各算各的
- 断言：234 条（新增 48：任务模型 31、任务写入 16、资源 BOM 1）
- **实测踩到的坑**：① **UTF-8 BOM** —— 用 PowerShell/记事本手改 `tasks.json` 会带上 BOM，`JSON.parse` 不认，界面报"不是合法 JSON"并拒绝写入（保护是对的，但文件其实没坏）。修法是在解析入口统一 `stripBom`，而不是要求用户"别用 BOM"；给任务和资源各补了一条断言，并先看着它失败；② 日期输入框不能"填"，只能逐个字段敲 —— 第一次敲成了 `0026-10-28`，表单当场把非法日期拦下来了（顺带证明校验生效）