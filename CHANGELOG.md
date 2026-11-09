# Changelog

本文件记录项目的**显著变更**，格式基于 [Keep a Changelog 1.1.0](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/spec/v2.0.0.html)。

原则：

- 写给人看，**不是 git log 的堆砌**（一个版本通常跨多次提交）
- 六分类：Added / Changed / Deprecated / Removed / Fixed / Security
- 新版本在前，旧版本在后；日期用 ISO 格式
- 未发布的改动先记在 `Unreleased`，发版时整体搬进新版本段

每次变更的详细过程见 `docs/changes/NNNN-xxx/`，决策见 `docs/decisions/`。

## 0.2.0 - 2026-10-24

详见变更包 [`docs/changes/0002-多账号运营/`](docs/changes/0002-多账号运营/README.md)，决策见 [ADR-0015](docs/decisions/0015-多账号运营按账号串行且默认不并发.md)。

### Added

- 多账号运营：账号可新建 / 切换 / 删除，每个账号独立额度、会话与发布队列
- 顶栏账号下拉（显示登录态、当日额度、队列深度）与设置页「账号列表」卡片
- 账号资源接口：`GET/POST /api/accounts`、`POST /api/accounts/:id/activate`、`DELETE /api/accounts/:id`
- 可调项「同时发布的账号数」（`accountConcurrencyLimit`），默认 1 —— 同一账号永远串行，只有这一项放开才会跨账号并行
- 明细页任务表在多账号时显示「账号」列

### Changed

- 发布队列不再是进程级单例：每个账号一条独立队列，跨账号并发由 `PublishScheduler` 收口（ADR-0015）
- `/api/summary` 返回值增加 `accounts[]` 与 `activeAccountId`；WS `account` / `pipeline` 消息携带账号 id
- 素材池、任务列表、一键开始、采集、登录与熔断接口均支持可选 `accountId`（不传即当前账号）
- 当前账号持久化在 `app_config.activeAccountId`，无需数据迁移；`ACCOUNT_NAME` 仍被尊重

### Fixed

- 切换账号时释放上一个账号的浏览器上下文，避免多账号常驻占内存（登录态在硬盘，切回来不用重扫）

## 0.3.0 - 2026-10-29

详见变更包 [`docs/changes/0003-账号独立页面与一键发布/`](docs/changes/0003-账号独立页面与一键发布/README.md)。

### Added

- 独立「账号」页面（`/accounts`）：每个账号行显示登录态 / 额度 / 队列深度 / 发布中数 / 待质检数 / 失败数
- 每个账号行带「条数」输入与「一键发布」按钮，各自走全自动流程
- 「一键发布」在该账号处于发布中（queueDepth / reviewing / publishing 任一 >0）时禁用，避免重复发起（红线 9 同账号串行）

### Changed

- 账号操作（登录 / 切换 / 删除 / 新建 / 一键发布）从设置页整体迁到「账号」页；设置页回归纯配置
- 后端 `AccountOverview` 增加 `publishing` 字段（来自 `countByStatus`），支撑发布中判据

## 0.4.0 - 2026-10-30

详见变更包 [`docs/changes/0004-统一启动主界面/`](docs/changes/0004-统一启动主界面/README.md)。

### Added

- 统一启动主界面（合并原「工作台」与「账号」页）：程序启动即进入，以卡片集中展示每个账号的在线/离线、可用/异常、近期发布情况（今日已发/剩余、最后发布时间、队列/发布中/待质检/失败数）
- 每个账号卡片带独立「发布」按钮，点哪个只触发那个账号的全自动发布流程（采集→改写→配图→质检→发布）；发布中 / 离线 / 异常（熔断或登录失效）/ 当日额度耗尽时按钮禁用或替换为「扫码登录」，并保留最小发布间隔闸门

### Changed

- 流水线轨、风险告警、合规说明从原工作台迁入设置页；账号管理（新建 / 删除 / 切换 / 检查登录态 / 退出登录）从启动主界面迁入设置页，主界面只保留账号状态展示与发布操作
- 端到端配置迁入 `e2e/playwright.config.ts`，`npm run e2e` 改为 `playwright test --config e2e/playwright.config.ts`（相对路径与 `webServer.cwd` 显式指回仓库根）
- 根目录清理：删除遗留的 `.dev-*.log` / `.selftest*.log` / `output/`，`.gitignore` 补显式忽略规则

### Removed

- 独立的「工作台」与「账号」页面；启动主界面统一承载账号状态展示与发布入口
- 原工作台「一键开始（当前账号）」入口，改为每个账号独立的「发布」按钮

## 0.5.0 - 2026-10-31

详见变更包 [`docs/changes/0005-启动页行列布局与去账号信息头/`](docs/changes/0005-启动页行列布局与去账号信息头/README.md)。

### Changed

- 启动页由卡片改为「每行一个账号」的表格：行内集中展示数据看板、状态、登录按钮、发布条数、发布按钮，以及切换 / 删除 / 退出等必要操作（CHG-0005）
- 统一头部去掉账号相关信息（信用分、今日已发、账号切换下拉），仅保留标题与实时日志按钮（CHG-0005）
- 明细页：列表不变，账号切换控件移到页面最上方左侧（CHG-0005）
- 设置页瘦身：删除与设置参数无关的内容（账号管理、流水线状态、风险告警、合规说明），仅保留可调设置 / 提示词模板 / 锁定项 / 外部账号与登录 / 实现红线（CHG-0005）

## Unreleased

### Added

- **零大模型费用**：新增 [`docs/30-operations/免费大模型获取指南.md`](docs/30-operations/免费大模型获取指南.md)（常青层操作文档）——各家免费模型官网入口、三步拿 Key、报错对照与换模型步骤，标注核对日期，不替厂商承诺永久免费；`docs/INDEX.md` 已挂入口
- 新增 [ADR-0016](docs/decisions/0016-默认改写走免费api并保留网页兜底.md)「默认改写走免费 API 并保留网页兜底」，取代 legacy ADR-13 的技术前提（「付费路径不许默认打开」这条继续有效）
- 设置页新增「免费大模型」卡片：三步引导、免费模型预设一键填充地址 / 模型名、老用户 `web` 模式的温和切换提示
- README 新增「零大模型费用」章节与徽章；根文档地图、ADR 索引同步更新
- 账号看板新增「今日失败」条数（`AccountOverview.failedToday`）：按任务 `updated_at` 落在当天且状态为 `failed` 统计，与累计「失败」并列展示（CHG-0005 后续优化）
- 新增常青层参考文档 [`docs/20-reference/实现现状与已知差异.md`](docs/20-reference/实现现状与已知差异.md)（REF-0001）：登记文档与代码不一致的事实、真源与处置，附「改代码要同步哪些文档」清单；`docs/INDEX.md` 已挂入口
- 新增 `backend/src/scripts/seed.ts`：`npm run seed` 现在可灌入 20 条本地模拟素材，纯离线、可重复执行、不动账号与登录态

### Changed

- **设置页引导改为面向非技术运营者**：卡片更名「免费 AI 改写」，三步全用大白话、技术网址与服务商对照表收进折叠区、主按钮改「填好了，测试一下」、新增「钥匙填没填」的状态提示；配置项说明、全部中文报错与 README / 指南的按钮名同步，功能与 `data-testid` 不变，CSS 一个字节未动
- **默认改写方式由 `web` 改为 `api`**，同时把默认地址 / 模型改成智谱免费档 `https://open.bigmodel.cn/api/paas/v4` + `glm-4.7-flash`；配一把免费 Key 即零大模型费用，不再依赖网页登录与页面选择器。`web` / `manual` / `simulated` 全部保留作兜底；老库里已存的 `llm.mode` 只提示、不强制迁移（ADR-0016）
- 设置页删掉「按 token 计费，改写一条通常几厘钱」的旧口径；401 / 402 / 429 / 404 的中文报错回指免费模型引导
- `README.md` 按当前实现全面校对：界面只剩三条路由、账号操作收口到启动主界面、后端不托管 `frontend/dist`、扫码以弹出的有头浏览器窗口为准、`nextPublishAt` 当前无界面倒计时；「文档与流程」「贡献」补充「以代码与测试为准」的约定

### Fixed

- 修正默认免费模型名：`glm-4-flash` 已不在智谱官方当前免费清单（2026-11-14 核对[定价页](https://docs.bigmodel.cn/cn/guide/start/pricing)与[模型概览](https://docs.bigmodel.cn/cn/guide/start/model-overview)），改为 `glm-4.7-flash`；常量、预设、设置页对照表、README、获取指南与 ADR-0016 修订节同步。该模型默认开启「深度思考」，请求体仅在「智谱域名 + 默认模型」时附加 `thinking: { type: 'disabled' }`，换服务商 / 换型号自动不附加，避免别家不认这个私有字段而报错；已补单元测试锁定边界
- 修正注册引导里「按页面提示完成实名认证」的强制表述：智谱[官方实名认证 FAQ](https://docs.bigmodel.cn/cn/faq/authentication-issues) 明确「目前调用 API 并不强制要求实名认证」，设置页、README、免费模型获取指南同步改为「不强制、页面要求再照做」，附官方链接与核对日期
- 修复已登录会话点「扫码登录」仍显示未登录：startLogin 识别已登录界面不再抛 SELECTOR_TIMEOUT（否则后台 waitForLogin 不会被调度、状态永远停在 logged_out），checkSession 检出已登录后写回 DB 状态（CHG-0005 回归修复）
- 优化「一键发布 N 条」的反馈：当素材池+补采拿不到 N 条新素材时，提示明确缺口（如「请求 20 条，但仅拿到 9 条新素材」），避免「设 20 只发 9」的困惑
- 修复 RATE_LIMITED 被直接判失败：改写/质检环节遇到 LLM 网关 429 等瞬时限流时，不再永久标 failed，改为带预算（默认 3 次）自动重试，超预算再转人工确认（§4.3 防误判）。已补 `backend/tests/unit/rateLimitRetry.test.ts` 锁定「预算内自动重试 / 超预算转 failed」两种分支
- 修复 `npm run seed` 指向不存在的 `src/scripts/seed.ts`、执行必报错（REF-0001 D3）
- 修复 `shared/src/types.ts` 中 `WsMessage` 的 `qr` 载荷落后于运行时：补齐 `accountId` / `name`（REF-0001 D4）
- 修复 `backend/tests/unit/rateLimitRetry.test.ts` 把 `publishedAt` 写成 `null` 导致的全量 `npm run typecheck` 失败（REF-0001 D10）

## 0.1.0 - 2026-10-23

首个版本基线（此前 21 次提交未打标签，此处统一归口）。

### Added

- 文档治理体系：三层文档模型（常青 / 决策 / 变更 / 归档）、ADR 冻结与取代机制、变更包模板、`docs/INDEX.md` 文档地图
- 失败列表展示中文失败原因（含阶段前缀、实际相似度、悬停处理建议），不再只显示英文错误码
- 失败任务支持删除：`DELETE /api/tasks/:id`，二次确认，连同改写稿 / 发布记录 / 配图 / 日志 / 指纹事务清库

### Changed

- 历史设计文档（2026-09 ~ 2026-10）整体冻结到 `docs/archive/legacy/`，原文一字未改，仅以新文档取代
- 项目文档入口统一到 `docs/INDEX.md`

### Fixed

- 发布并发误判自愈：已发布成功的内容被并发标失败后，重试不再重复发布，直接纠正回 `published`
- 改写链报错时若任务已被并发推进（发布中/已发布），不再拉回 `failed`
- 任务级互斥：`runUntilReview` 同一任务同时只允许一个流程推进
- 设置项 `select`（如 `llm.mode`）下拉不再为空：接口合并代码常量里的候选项

> **关于版本链接**：本仓库于 2026-11-09 做了一次干净重建，对外只保留 1 条初始提交，历史版本标签（`v0.1.0` ~ `v0.5.0`）未随仓库迁移，因此不再提供版本对比链接。各版本改了什么以本文正文为准；想逐条追溯请看 `docs/changes/` 与 `docs/decisions/`。
