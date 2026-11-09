# 贡献指南

欢迎 issue 与 PR。这是个人维护的项目，所以流程不复杂，但有几条硬规矩需要先知道。

## 开工前请先读这三份

| 顺序 | 文档 | 解决什么 |
| --- | --- | --- |
| 1 | 根 [`README.md`](README.md) 的「快速开始」与「使用边界」 | 这东西干嘛的、怎么跑起来、哪些事不能做 |
| 2 | [`docs/10-architecture/红线与约束.md`](docs/10-architecture/红线与约束.md) | 硬约束清单，绕过一律会被拒 |
| 3 | [`docs/INDEX.md`](docs/INDEX.md) | 51 篇文档的唯一入口与三层模型 |

再补一句最容易踩的：**文档与代码冲突时，以代码和测试为准**，然后按常青层规则把文档同步回来。

## 本地准备

```bash
npm install
npx playwright install chromium
npm run dev
```

Node.js 需要 ≥ 24。后端只监听 `127.0.0.1:8787`，页面与 `/api`、`/ws` 代理由 Vite dev server 提供；后端不托管 `frontend/dist`，别按「前后端分离部署」的思路改启动方式。

## 改代码

- 新功能走一次一个变更包：复制 `docs/templates/` 到 `docs/changes/NNNN-xxx/`，按 [`docs/00-guide/开发流程.md`](docs/00-guide/开发流程.md) 过需求 → 设计 → 开发 → 验证 → 发布 → 沉淀。
- 用 AI 助手协作时，仓库自带 Agent Skill（[`.agents/skills/toutiao-auto-feature/`](.agents/skills/toutiao-auto-feature/SKILL.md)）会自动按这套流程执行；人工贡献者同样以开发流程文档为准。
- **代码与文档同步改**。常青层（`10-architecture/` `20-reference/` `30-operations/` `00-guide/`）随代码更新；决策层 ADR 与已批准的变更包**冻结**，不原地改写，推翻时写新文档、老的标 `superseded`。
- 发现文档与实现不一致，但又不在本次改动范围：登记到 [`docs/20-reference/实现现状与已知差异.md`](docs/20-reference/实现现状与已知差异.md)，别顺手改冻结局。
- 涉及平台选择器或发布流程的改动，务必跑 `npm run selftest`（真实浏览器逐项核对选择器）和 `npm run e2e`。

## 提交前检查

| 命令 | 说明 |
| --- | --- |
| `npm run typecheck` | 全量 TypeScript 类型检查，必过 |
| `npm test` | 各 workspace 单元 / 集成测试，必过 |
| `npm run selftest` | 改动涉及选择器或发布流程时必跑 |
| `npm run e2e` | 改动涉及端到端流程时必跑 |
| `npm run lint` | Prettier 风格检查；仓库有存量文件未格式化，别把存量问题算进自己的 PR |

CI 只跑 `typecheck` 与 `test`——这两项不依赖浏览器和目标平台登录态，适合在干净环境里守护。

## PR 里请写清

1. 改了什么、为什么这么改（有取舍的话，把被否掉的方案也提一句）。
2. 验证做了哪些、结果如何。
3. 文档同步到了哪一层，有没有新增差异登记。
4. 有没有碰到红线；如果碰了，说明为什么非碰不可。

## 安全与合规

- 涉及登录态、Cookie、API Key、漏洞的问题，走 [`SECURITY.md`](SECURITY.md) 的渠道，**不要**在公开 Issue 里贴原文。
- `data/`、`.env`、`drafts/`、`.workbuddy/`、`.codebuddy/` 都是本地专用且已被忽略，别提交、别在 PR 里贴。
- 本项目是本机自用的自动化工具，不鼓励绕过平台规则；发布内容的真实性与合规性由使用者自行负责。
