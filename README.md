# AI Learning Lab

一个本地优先的 AI 学习、知识管理与资源收藏工作台。

**当前状态：阶段 1 完成（工程初始化）。** 仓库里现在是一个能跑起来的骨架：深色主题还没做，笔记、收藏、搜索、任务都还没有。进度见下方表格，别把未实现的部分当成可用。

> 完整需求、验收标准与八阶段路线在 **[docs/需求书.md](docs/需求书.md)**（原始需求书，内容保持原样）。

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
app/          页面与 Route Handlers（目前只有模板首页）
lib/          工具函数（目前只有 shadcn 的 cn()）
tests/        Vitest 单元测试
docs/         需求书
public/       静态资源
```

`components/`、`features/`、`data/`、`content/articles/` 等目录在对应阶段创建，不提前建空壳。

## 阶段进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 工程初始化 | ✅ 2026-10-29 |
| 2 | 设计系统与页面框架 | ⬜ 未开始 |
| 3 | Markdown 知识库 | ⬜ 未开始 |
| 4 | 资源收藏中心 | ⬜ 未开始 |
| 5 | 全文搜索 | ⬜ 未开始 |
| 6 | 学习任务与 Dashboard | ⬜ 未开始 |
| 7 | 备份、安全与局域网访问 | ⬜ 未开始 |
| 8 | 测试与本地发布 | ⬜ 未开始 |

## 安全

- 默认只监听 `127.0.0.1`，不自动开放局域网或公网
- `.env*`、`data/`、`backups/` 已排除在 git 之外，仓库里不会有数据库、备份或密钥
- 不提供服务端抓取任意 URL 的能力（避免 SSRF），外部链接只允许安全协议
- 详细条目见 [docs/需求书.md](docs/需求书.md) §8

## License

[MIT](LICENSE) © 2026 Daniel Riviera
