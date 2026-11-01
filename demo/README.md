# demo/ —— 演示数据

这个目录是**给新 clone 的人看效果用的示例内容**，不是作者本人的笔记。

`content/` 在 `.gitignore` 里（D5：主仓库公开，笔记属于私有仓库），所以刚 clone 下来打开应用是空的 —— 这是预期。

## 怎么用

```powershell
npm install
npm run seed:demo   # 把 demo/content/ 铺到 content/
npm run dev
```

`seed:demo` 只在 `content/` 还没有数据时工作；已经有笔记 / `resources.json` / `tasks.json` 时它会拒绝并退出，不会覆盖。

## 里面有什么

| 文件 | 内容 |
| --- | --- |
| `content/articles/` | 3 篇笔记（中文标题、一篇带公式和表格） |
| `content/resources.json` | 2 条资源（论文 + 仓库），其中一条挂在笔记上 |
| `content/tasks.json` | 2 个任务（进行中 / 待办），都带截止日期 |

想清干净重来：删掉 `content/` 再跑一次 `npm run seed:demo`。
