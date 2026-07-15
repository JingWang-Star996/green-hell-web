# CANOPY 玩家反馈闭环发布执行记录（2026-07-15）

状态：已完成本轮候选的审计、GitHub 推送、Toy 提审与飞书通知；Toy 当前为 `auditing`（尚未上线）
协调者：主 Agent（唯一对用户沟通、集成、质量判定与发布负责）

## 1. 本轮交付定义

本轮不是把“十小时完整商业游戏”误报为完成，而是把截至 2026-07-15 的玩家反馈转换为可追踪需求，关闭本次候选版本的提审阻断项，并为仍需多个里程碑的系统建立明确验收与后续顺序。

本轮只有同时满足以下条件才可以提交 Toy：

1. `docs/PLAYER_FEEDBACK_REQUIREMENTS_MATRIX.md` 覆盖线程内全部反馈，每项有状态、证据和验收条件。
2. 最新明确复现的四项问题——本地保存失败、干叶/开局资源投放、同键关闭菜单、建造缺料反馈——通过自动化与浏览器验收。
3. 三个独立审计域没有未处理的 P0 阻断项；P1 若延期，必须有明确原因和玩家可见降级说明。
4. TypeScript、全量测试、Lint、生产构建、Toy 专用构建和静态包检查全部通过。
5. Toy 预览在桌面与移动视口完成首屏、进入游戏、菜单、存档和关键交互抽查；控制台无本项目阻断错误。
6. 预览证据核验后，按用户本轮已给出的明确授权直接提交审核，不再二次询问。

## 2. Agent 拓扑与所有权

| 角色 | 任务边界 | 写权限 | 交付物 | 停止条件 |
| --- | --- | --- | --- | --- |
| 主协调 / 集成 | 需求冻结、任务拆分、冲突处理、实现集成、全量验证、GitHub/Toy/飞书 | 全仓库；耦合状态机唯一最终写者 | 可玩候选、发布证据、诚实状态 | 发布与通知闭环完成，或外部系统形成可证实阻塞 |
| 需求基线 Agent | 将全部玩家反馈映射为系统需求和验收 | 仅 `docs/PLAYER_FEEDBACK_REQUIREMENTS_MATRIX.md` | 追踪矩阵、遗漏自检 | 每项反馈可追踪且“完成”均有证据 |
| UX/存档红队 Agent | 存档、导入导出、死亡恢复、移动端、快捷键、UI 层级、材料反馈 | 只读 | P0/P1/P2 复现报告 | 负面路径与提审阻断项明确 |
| 世界玩法红队 Agent | 导演、资源、树石、生物生态、建造、主线、Valheim 视觉真实性 | 只读 | 完成度审计与最小高价值里程碑建议 | 设计稿、代码存在和可玩完成被清楚区分 |

耦合规则：审计阶段不允许边查边改；实现阶段按模块分配临时写者，`types/content/simulation/GameClient` 等高耦合文件由主协调统一集成。任何 Agent 都不能自行发布或发送外部通知。

## 3. 质量基线

执行前工作树基线（2026-07-15）：

- `npm run typecheck`：通过。
- `npm test`：587 / 587 通过。
- `npm run lint`：通过。
- 基线提交：`e2496eb feat: stream the living rainforest`；本轮及此前未提交的研发改动保留在同一工作树，禁止重置或覆盖。

这组结果只证明自动化基线，不替代浏览器可玩性、Toy SDK、移动端布局和三小时真人时长验证。

## 4. 阶段门禁

### Gate A：需求冻结

- 全部反馈进入唯一矩阵。
- 每项标明：本次阻断、后续里程碑或需实机验证。
- 禁止用“已有代码”代替玩家可观察验收。

### Gate B：独立审计

- UX/存档和世界玩法由非实现者复核。
- P0 必须关闭；P1 必须修复或给出不误导玩家的明确范围。
- 视觉规范、研究文档和测试 fixture 不能被计为正式画面实装。

### Gate C：实现与回归

- 每个修复必须有失败前可复现条件、实现、自动化测试和玩家可见结果。
- 资源导演不得在玩家视野内凭空补给；存档本地成功不得被 Toy 云失败回滚。
- 交互状态必须由共享规则投影到键鼠、触控和 UI，不允许多个入口各自猜测。

### Gate D：可玩候选

- 生产构建和 Toy 构建通过。
- 至少执行桌面与移动视口的关键路径试玩。
- 包体低于 140 MiB，嵌套路径下资源可加载。

### Gate E：外部发布

- 先生成 Toy 预览，不带最终提交确认参数。
- 主协调独立核验预览；本轮用户已预授权，核验通过后直接执行最终提交。
- GitHub 更新必须对应同一候选内容；飞书通知只在 Toy 命令返回成功后发送。

## 5. 审计结论与发布证据

本节只记录已经能由当前工作树代码和自动化测试复核的事实。它不把第 3 节的执行前基线外推为当前候选的全量结果，也不填写尚未取得的 Toy 发布/审核 ID。

### 5.1 本轮已证实的实现

| 主题 | 真实状态 | 代码证据 | 自动化证据 | 仍需门禁 |
| --- | --- | --- | --- | --- |
| 普通树木分阶段恢复 | **完成（代码纵切）**：完整加工后的普通可再生树按稳定身份进入树桩→树苗→幼树→成树，约 7–10 个游戏日；稀有、任务和不可再生树排除，资源导演不能加速 | `src/game/sim/treeRegrowth.ts`、`src/game/sim/treeRegrowthRuntime.ts`、`src/game/sim/treeHarvest.ts`、`src/game/sim/state.ts`、`src/game/render/SemanticTreePool.ts` | `tests/sim/treeRegrowth.test.ts`、`tests/sim/treeRegrowthIntegration.test.ts` | 浏览器中观察阶段轮廓、聚焦文案和长休息后的可读性；进入下一发布候选后再核验包内代码 |
| 四类资源植物差异几何 | **完成（窄范围视觉/交互可读性纵切）**：四种现有资源植物拥有互异几何家族，按物种实例化并共享几何；区块卸载不提前销毁共享资源 | `src/game/render/plantGeometryCatalog.ts`、`src/game/render/SemanticInstanceLayer.ts`、`src/game/render/plantVisualSemantics.ts` | `tests/render/plantGeometryCatalog.test.ts`、`tests/render/plantGeometryRuntimeIntegration.test.ts`、`tests/render/plantVisualSemantics.test.ts` | 实机盲测四类轮廓；完整植物物种、加工链、群系构图和正式画面重构仍未完成 |
| 本地优先保存与 Toy 云状态竞态 | **完成（代码与自动化）**：本地验证完成即返回，异步云失败不会回滚本地档；较慢的旧云完成不能覆盖较新保存的 UI 状态或 payload | `src/game/persistence/saveCoordinator.ts`、`src/game/persistence/saveRepository.ts` | `tests/persistence/saveCoordinator.test.ts`、`tests/persistence/saveRepository.test.ts` | 生产 Toy 宿主中验证保存→刷新→跨设备读取以及失败降级；在此之前不能宣称线上云同步已验收 |
| 新周目初始化、休息事务与 modal 收尾 | **完成（代码与自动化）**：云发现结束前禁用继续；新周目立即建立 verified 恢复点；休息由前/后恢复点事务拥有且只在成功提交后关闭面板；加载中的恢复对话框消费 Esc | `src/game/GameClient.tsx`、`src/game/ui/StartScreen.tsx`、`src/game/ui/Panels.tsx`、`src/game/ui/menuShortcuts.ts`、`src/game/persistence/checkpointBarrier.ts` | `tests/ui/startScreen.test.ts`、`tests/ui/saveUiIntegrationPolicies.test.ts`、`tests/ui/menuShortcuts.test.ts`、`tests/persistence/checkpointBarrier.test.ts` | 桌面/移动浏览器实测控制权、焦点、Pointer Lock 和失败提示 |

本次文档审计复跑上述主题的定向集合，结果为 **46 / 46 通过**。这只是定向证据，不是当前候选的全量测试、构建、浏览器或 Toy 发布门禁结果。

### 5.2 明确未被本轮“完成”覆盖的长期需求

| 主题 | 保持状态 | 未完成边界 |
| --- | --- | --- |
| 完整资源/威胁/章节导演 | **部分 / 未完成** | 当前资源导演只在生态与视野约束下排序合法、已到期节点；没有统筹敌人、治疗、天气和章节压力，也没有真人证明三小时内既不保送也不卡死 |
| 完整生态链 | **部分** | 已有个体、战斗、尸体和火焰反应底座；捕食—被捕食、食腐、植物压力、承载力回写、鱼类与更完整疾病生态尚未形成玩家可观察闭环 |
| A3–A5 与三小时章节 | **未做** | A3 黑水、A4 岩岭、A5 信号选择仍是设计目标；没有可完成实现，也没有真人三小时证据 |
| Valheim 启发的正式画面升级 | **未做** | 研究、视觉规范、实例池、密度底座和四植物差异几何不等于最终画面重构；连续世界、自然群系过渡、统一材质/顶点色、灯光雾效、构图盲测和真实 GPU profiling 尚未闭环 |

### 5.3 当前发布判定

- Gate A/B 已通过：96 个稳定需求 ID 已逐项记录，三路审计没有遗留 P0；完整导演、完整生态、A3–A5 与 Valheim 正式画面升级仍明确为部分或未做。
- Gate C 已通过：`npm run verify` 完成 TypeScript、**619 / 619** 自动化测试、ESLint 与 Vinext 生产构建，全部通过。
- Gate D 的本地部分已通过：`build:toy`、项目验包器与官方 `toy_doctor.py` 全部通过；最终候选 `toy-out/` 为 **19 文件 / 3,984,151 bytes（3.80 MiB）**。桌面、390×844 与 844×390 做了本地关键入口抽查，未发现文档横向溢出或本项目控制台错误。
- Gate E 已完成本轮授权范围内的外部闭环：预提交预览 `preview_A5hgExGh` 经桌面、390×844、844×390 和关键存档交互复核后，`toy update 10228414336000 toy-out --yes --json` 返回 `auditing`，最终审核预览为 `preview_RJ49vklQ`；候选提交 `7a3b21d601f39be76af1e4306a68f1633f5fa615` 已推送 GitHub 分支 `agent/living-forest-foundation`；23:30（UTC+8）已向飞书“王鲸Codex”发送准确状态。`auditing` 不等于已经上线，生产 URL 与 Toy 云跨设备恢复仍须审核通过后复测。

本地浏览器验收额外抓到并关闭了两个自动化基线未暴露的缺口：新周目把外部随机种子哈希后，却在异步清档回调中与未哈希种子比较，导致首个恢复点被跳过；短横屏 WebView 未报告粗指针时会误隐藏触控入口。两项均已修复并加入回归约束。
