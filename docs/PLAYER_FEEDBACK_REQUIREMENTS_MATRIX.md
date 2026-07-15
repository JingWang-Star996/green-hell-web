# CANOPY 玩家反馈与需求追踪矩阵

> 最后更新：2026-07-15
> 范围：本 Codex 任务中用户截至本次更新提出的全部产品、玩法、交互、视觉、存档与发布反馈。
> 用途：这是“用户反馈是否被处理”的唯一追踪账本；它不替代 `PROJECT_BRIEF.md`、系统规格、测试报告或发布记录。

## 1. 使用规则

### 1.1 状态只有四种

| 状态 | 含义 |
| --- | --- |
| **完成** | 当前工作区已有实现，并有代码、自动化测试或可复核文档证据。它不自动表示已经发布到 Toy/GitHub。 |
| **部分** | 已有可玩的系统纵切或技术底座，但仍未覆盖用户要求的完整范围。 |
| **未做** | 当前没有可交付实现；即使已有研究或设计文档也仍记为未做。 |
| **待实机验证** | 自动化或静态实现已经存在，但用户感知、真实浏览器、真实设备或 Toy 宿主行为尚未被充分验证。 |

### 1.2 发布处置

- **文档基线**：不需要运行时发布，但必须随仓库保存。
- **审核候选**：冻结候选已提交 Toy；审核通过后仍要对生产 URL 复测。
- **下一候选**：当前工作区在冻结候选之后发生了变化，必须重新构建、验证、提交 Toy，并同步 GitHub。
- **实机门禁**：先取得浏览器、设备或 Toy 宿主证据，再允许宣称完成或发布。
- **后续里程碑**：不冒充当前纵切片内容；进入对应路线图后再排期。

任何行从“部分 / 未做 / 待实机验证”改为“完成”时，必须同时补充可观察验收结果和证据。稳定 ID 不删除、不复用；被取消的需求应保留并注明决策。

## 2. 流程、范围与团队

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| PROC-001 | 首版“一点都不好玩”，要求系统复盘问题而非继续堆功能 | 首版把宣传页当游戏，缺少空间、因果、反馈、经济和可复现门禁 | 复盘明确可复现循环、十大问题、保留/重写项和量化门禁 | **完成** | `docs/POSTMORTEM.md` | 文档基线 |
| PROC-002 | 要求建立从资料收集、设计到制作和发布的完整体系 | 研发必须先证明体验循环，再扩内容，并把研究、灰盒、纵切、QA、发布分阶段 | 流程覆盖 S0–S9、每阶段输入/输出/失败信号/完成闸门 | **完成** | `docs/PRODUCTION_PLAYBOOK.md`、`docs/RESEARCH.md` | 文档基线 |
| PROC-003 | 要求组建 Agent 团队，并应用另一任务中讨论的协作模式 | 长任务需要一个用户接口、动态临时角色、任务契约、文件边界和独立红队 | Brief、Agent 规则、决策日志和试玩量表存在；任务有负责人、验收和停止条件 | **完成** | `AGENTS.md`、`PROJECT_BRIEF.md`、`PLAYTEST_RUBRIC.md`、`DECISIONS.md` | 文档基线 |
| PROC-004 | 项目应脱离《绿色地狱》IP，吸收雨林生存精神而非复刻 | 机制研究可以借鉴，但资产、剧情、地图、商标化表达必须原创 | 游戏、README 和发布说明均有非官方声明；运行时不含原作受保护资产 | **完成** | `README.md`、`docs/GAME_DESIGN.md`、`public/assets/licenses.json` | 审核候选；持续审查新资产 |
| PROC-005 | 不要“挤牙膏”，要从一只“蟑螂”反推整套系统 | 单点 Bug 必须进入对象、交互、反馈、持久化和实机验收的系统审计 | 新反馈进入本矩阵；世界对象和 UI 有独立一致性审计，完成边界可追踪 | **完成** | 本文件、`docs/WORLD_OBJECT_AUDIT.md`、`docs/INTERACTION_CONSISTENCY_AUDIT.md`、`docs/SURVIVAL_UI_UX_AUDIT.md` | 文档基线 |

## 3. 任务引导、模型、碰撞与动作反馈

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| GUIDE-001 | 任务写“前往气象站”，玩家交互建筑却只收到“不稳固”，真实条件不清楚 | 主目标不能只给地点；必须显示下一事实、前置条件、工具和明确 blocker | 每个主线阶段显示一个可执行动作、进度与阻塞原因；气象站链明确为调查控制柜→准备/装备石斧→拆电池 | **完成** | `src/game/ui/viewModel.ts`、`src/game/sim/affordances.ts`、`tests/ui/navigationAndObjectives.test.ts`、`tests/sim/affordances.test.ts` | 审核候选；生产 URL 复测 |
| GUIDE-002 | 气象控制柜和气象站模型尺寸导致永远无法交互 | 渲染模型、碰撞体、焦点锚点和模拟目标必须共享几何语义 | 控制柜与电池有不同的正面锚点；从可见正面可分别聚焦，建筑实体不会吞掉目标 | **待实机验证** | `src/game/world/interactionGeometry.ts`、`tests/render/interactionGeometry.test.ts` | 实机门禁；桌面 Pointer Lock 路线复测 |
| GUIDE-003 | “岩石棚”像一座岩石山，只有穿模后才发现箱子 | 地标轮廓必须表达入口、内腔和交互所有权，不能靠穿模发现目标 | 岩棚为 U 型顶棚、侧/后支撑、开放入口、暗内腔和可见箱体；箱体独占焦点 | **待实机验证** | `src/game/world/interactionGeometry.ts`、`src/game/render/RainforestRenderer.ts`、`tests/render/interactionGeometry.test.ts` | 实机门禁；盲测入口可读性 |
| GUIDE-004 | 制作界面遮住系统提示，操作结果看不见 | 命令结果需要高于面板的全局回执层，并去重、区分成功/危险/阻塞 | 面板打开时仍看得到唯一一次命令回执；危险副作用优先；不会被制作菜单遮挡 | **完成** | `src/game/ui/ActionFeedbackLayer.tsx`、`src/game/ui/actionReceipt.ts`、`tests/ui/actionReceipt.test.ts` | 审核候选；生产 URL 复测 |
| GUIDE-005 | 相似可交互/不可交互对象难以判断；靠近后需要高亮、描边或提示 | “同形同基础动词”与唯一焦点必须成为全世界契约；微型杂物则明确永不聚焦 | 抽查对象只产生一个焦点；目标高亮并显示动词、工具、时间和阻塞原因；遮挡目标不可隔物互动 | **待实机验证** | `src/game/sim/affordances.ts`、`src/game/render/RainforestRenderer.ts`、`tests/render/affordanceInteraction.test.ts`、`PLAYTEST_RUBRIC.md` | 实机门禁；10树+10岩+5植物盲测 |
| GUIDE-006 | 添柴、点火等操作缺少可见效果，篝火持续时间也不可读 | 营地维护应在世界局部完成，并由权威事件同步光、火、余烬、火星、声音与数值 | 聚焦篝火可见燃料阶段/余量；添柴后模型、光照、音效和 HUD 同步变化，无需打开总制作菜单 | **完成** | `src/game/render/CampfireFeedbackRig.ts`、`src/game/render/campfireFeedback.ts`、`tests/render/campfireFeedbackRig.test.ts`、`tests/ui/hudAffordance.test.ts` | 下一候选；夜间实机复测 |
| GUIDE-007 | 开局找不到干叶，原模型与绿色药草混淆，可能卡死营火流程 | 开局关键资源需要地理上可信的冗余、独立轮廓和任务缺口提示 | 三处开局干叶总量足够营火、火把和一次容错；模型是贴地浅褐色扇形；目标给出生态地标；导演优先已到期干叶 | **完成** | `src/game/sim/content.ts`、`src/game/render/RainforestRenderer.ts`、`src/game/ui/viewModel.ts`、`tests/render/dryLeafVisibility.test.ts`、`tests/sim/initialResourceDistribution.test.ts`、`tests/sim/resourceDirector.test.ts` | 下一候选；未包含在冻结审核包 |
| GUIDE-008 | 玩家会“莫名其妙死掉”，伤害、恶化状态和临界危险提示太弱 | 状态反馈需要从注意、警告、危险到致命分级，并同时说明来源、数值变化和可执行反制，不能只靠血条或颜色 | 受伤/感染/寄生虫/饥渴/潮湿等变化显示严重级别、来源、伤害值和下一动作；死亡页保留最终因果链 | **完成** | `src/game/sim/playerStatus.ts`、`src/game/ui/PlayerStateFeedback.tsx`、`src/game/ui/DeathReview.tsx`、`tests/sim/playerStatus.test.ts`、`tests/ui/playerStateFeedback.test.ts` | 下一候选；真人死亡路径复测 |

## 4. 时间、休息、腐烂与资源刷新

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| TIME-001 | 游戏时间流速太快，物品刚获得就腐烂 | 所有时间系统必须共享“游戏分钟/小时”换算，不能各写魔法倍率 | 一游戏日为 48 个真实分钟；HUD、天气、事件时间和腐败共用统一换算 | **完成** | `src/game/sim/time.ts`、`src/game/ui/viewModel.ts`、`tests/sim/timeEconomy.test.ts` | 审核候选 |
| TIME-002 | 休息没有流逝时间；休息后 UI 应关闭 | 休息必须运行普通固定步模拟，而不是只恢复数值；面板只能在休息后恢复点验证和状态提交成功后关闭，失败时保留可理解的恢复路径 | 一次休息推进 8 个游戏小时，饥渴/天气/火/加工同步推进；休息前后恢复点均验证成功后关闭面板并恢复控制；失败不会发布半完成状态 | **完成** | `src/game/sim/simulation.ts`、`src/game/GameClient.tsx`、`src/game/ui/Panels.tsx`、`tests/sim/timeEconomy.test.ts`、`tests/persistence/checkpointBarrier.test.ts`、`tests/ui/saveUiIntegrationPolicies.test.ts` | 下一候选；自动化已覆盖事务和面板收尾，仍需实机检查控制权恢复 |
| TIME-003 | 食物腐坏节奏不符合生存游戏体验 | 食物应逐件记录期限，并区分生肉、熟肉、烟熏肉与植物食物 | 每个批次独立腐败；休息快进不会绕过腐败；熟制与烟熏显著延长寿命 | **完成** | `src/game/sim/lifecycle.ts`、`src/game/sim/content.ts`、`tests/sim/inventoryLifecycle.test.ts`、`tests/sim/smokingRack.test.ts` | 审核候选 |
| TIME-004 | 所有物资定时定点一起刷新，破坏收集感 | 普通资源需按节点、种子、周期与批次错峰；稀有/目标物不刷新 | 同种节点具有不同随机窗口和批次；不会全图同刻弹出；目标/稀有资源无再生计划 | **完成** | `src/game/sim/resourceDirector.ts`、`src/game/sim/simulation.ts`、`tests/sim/simulation.test.ts`、`tests/sim/resourceDirector.test.ts` | 审核候选；下一候选含干叶窗口调整 |
| TIME-005 | 树木应数个游戏日后先长成小树，再成长为大树 | 树木恢复必须是持久世界状态机，不应被普通物资导演瞬间补回 | 普通可再生树完整加工后保留树桩，随后依次进入树苗、幼树和成树；总周期由稳定身份确定并限制在约 7–10 个游戏日；离开区块、长休息与存档往返结果一致；稀有/任务/不可再生树排除 | **完成** | `src/game/sim/treeRegrowth.ts`、`src/game/sim/treeRegrowthRuntime.ts`、`src/game/sim/treeHarvest.ts`、`src/game/sim/state.ts`、`src/game/render/SemanticTreePool.ts`、`tests/sim/treeRegrowth.test.ts`、`tests/sim/treeRegrowthIntegration.test.ts` | 下一候选；自动化已覆盖阶段、休息、流式加载和存档，仍需实机复核阶段可读性 |

## 5. 初期分布与资源导演

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| DIR-001 | 初期藤条、石头等只在飞机附近，河边反而没有；需要类似《求生之路》的导演 | 导演应先尊重生态与既有节点，再依据任务缺口调整“哪一个已到期节点先恢复”，不能在脚边作弊生成 | 每 0.5 游戏小时最多结算一个已到期节点；评分含任务缺口、群系适宜度、逾期和确定性抖动 | **部分** | `src/game/sim/resourceDirector.ts`、`tests/sim/resourceDirector.test.ts` | 下一候选；完整威胁导演仍是后续里程碑 |
| DIR-002 | 动态刷新不能在玩家眼前出现，也不能粗暴增产 | 导演只负责合法结算，不改变节点容量、批次或不可再生对象 | 活动节点距玩家至少 48m 且在视野后方；优先未加载区块；树、岩、稀有和任务物始终排除 | **完成** | `src/game/sim/resourceDirector.ts`、`tests/sim/resourceDirector.test.ts` | 审核候选 |
| DIR-003 | 初级物资应丰富且与地图关系合理 | 开局需要“冗余但不直接塞背包”的地理化供给，河岸、倒木、棕榈落叶等各自承担材料教学 | 多个种子中，营地—河流路线存在可达石头、藤条、植物食物和干叶；节点不生成在玩家脚下 | **部分** | `src/game/sim/content.ts`、`src/game/world/semanticGeneration.ts`、`tests/sim/initialResourceDistribution.test.ts`、`tests/world/semanticGeneration.test.ts` | 下一候选；45分钟真人路线复核 |
| DIR-004 | 刷新和动态世界必须可存档、可重放，不能刷新后读档重置 | 导演纪元、节点周期和差量必须进入确定性存档 | 同种子/同纪元决策一致；插入顺序不改变结果；读档不会重复结算同一纪元 | **完成** | `src/game/sim/resourceDirector.ts`、`src/game/world/saveDelta.ts`、`tests/sim/resourceDirector.test.ts` | 审核候选 |
| DIR-005 | 用户期待完整“资源+危险+进度”节奏导演 | 当前导演只重排已到期资源，不创造新节点，也不统筹敌人、治疗、天气和章节压力 | 导演能在明确公平约束下统筹资源与遭遇，并由真人试玩证明既不保送也不卡死 | **未做** | 路线约束见 `docs/LIVING_RAINFOREST_GAMEPLAY_SPEC.md`；当前边界见 `src/game/sim/resourceDirector.ts` | 后续里程碑；不属于当前审核候选 |

## 6. 树木、岩石、植物与具身采集

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| HARVEST-001 | 树不应分“能砍/不能砍”，差异最多来自工具和时间 | 所有离散语义树共享基础砍伐动词；树种、年龄和大小只改变工具、工时、耐久和产量 | 任取 10 棵离散树都能聚焦并给出可理解动词/阻塞；合适工具能砍，错误工具不偷偷结算 | **完成** | `src/game/world/semanticGeneration.ts`、`src/game/sim/treeHarvest.ts`、`tests/sim/treeFelling.test.ts` | 审核候选；仍需实机抽查手感 |
| HARVEST-002 | 石头外观相似却有的能捡、有的完全无反应 | 散石、矿体和微型碎石需要互斥尺度与动作语义；所有离散矿体应可被当前可达石镐处理 | 拾取石堆、可开采岩体、永不聚焦微杂物轮廓不重叠；岩体大小改变工时/体力/耐久 | **完成** | `src/game/sim/rockHarvest.ts`、`src/game/render/rockVisualSemantics.ts`、`tests/sim/rockMiningVerticalSlice.test.ts`、`tests/render/rockVisualSemantics.test.ts` | 审核候选；仍需实机抽查可读性 |
| HARVEST-003 | 草、藤和植物也应遵循同样的一致性 | 可采植物必须是稳定语义实体；环境叶幕/地表杂物只能作为明确的非交互层；不同资源语义不能继续共享同一个误导性通用轮廓 | 可采植物有稳定 ID、物种、工具和产出；四类现有资源植物使用互异的几何家族并按物种实例化；ambient/micro clutter 永不进入焦点候选 | **完成** | `src/game/world/semanticGeneration.ts`、`src/game/render/plantVisualSemantics.ts`、`src/game/render/plantGeometryCatalog.ts`、`src/game/render/SemanticInstanceLayer.ts`、`tests/sim/semanticHarvest.test.ts`、`tests/render/plantVisualSemantics.test.ts`、`tests/render/plantGeometryCatalog.test.ts`、`tests/render/plantGeometryRuntimeIntegration.test.ts` | 下一候选；完成的是现有四类资源植物的可读性纵切，不代表完整植物生态 |
| HARVEST-004 | 砍树、挖石、攻击不应是按键后立即判定 | 动作需具备可中断 windup、命中窗和 recovery，由相机前方扫掠几何权威结算 | 转身、离开范围、被遮挡或切换状态会中断；只有命中窗中的首个合法目标受影响 | **完成** | `src/game/render/actionTransaction.ts`、`src/game/world/hitGeometry.ts`、`tests/render/actionTransaction.test.ts`、`tests/sim/physicalHitValidation.test.ts` | 下一候选；实机调节动作节奏 |
| HARVEST-005 | 砍树应有完整产物与世界反馈 | 一棵树需要从站立实体转为倒木、枝条、木段、原木、劈柴和树桩，而非直接加背包数字 | 砍击可见受损；倒伏后可拾枝、截段、搬原木、劈柴；状态读档保持 | **完成** | `src/game/sim/treeHarvest.ts`、`src/game/render/RainforestRenderer.ts`、`tests/sim/treeFelling.test.ts`、`tests/render/treeFellingRender.test.ts` | 审核候选 |
| HARVEST-006 | “同形同规则”仍需要真人验证理解成本 | 自动化证明语义一致，但不能证明玩家能从轮廓预判行为 | 无解释测试者对至少 90% 抽查对象在 5 秒内说对对象、动词和阻塞原因 | **待实机验证** | `PLAYTEST_RUBRIC.md`、`docs/WORLD_OBJECT_AUDIT.md` | 实机门禁 |

## 7. 生物、生态与战斗

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| ECO-001 | 地图中移动的东西若是生物，就应有自己的雨林逻辑 | 生物不能只是装饰动画；近处是稳定个体，远处由种群账本低频演化 | 个体有位置、生命、警觉、目标、状态和受伤记忆；离开活动泡后不会无解释重置 | **完成** | `src/game/ecology/`、`src/game/sim/wildlifeProjection.ts`、`tests/ecology/ecologyPresence.test.ts` | 审核候选 |
| ECO-002 | 生物应可攻击、杀死并产生资源后果 | 战斗、尸体、掉落、烹饪和存档必须形成闭环 | 所有激活生物可受击/死亡；尸体保留，未收取掉落不丢；肉可烹饪或烟熏 | **完成** | `src/game/sim/simulation.ts`、`tests/sim/wildlifeCombat.test.ts`、`tests/sim/proceduralCarcass.test.ts` | 审核候选 |
| ECO-003 | 地上的蛇不能靠进入半径自动判定伤害，应能提前攻击 | 蛇需要可见预警、扑咬时间窗、抢攻、受击、死亡和恢复，而不是碰撞税 | 玩家可在扑咬前观察、绕开或命中；蛇咬只在动作窗口与有效接触中发生 | **完成** | `src/game/sim/authoredSnakes.ts`、`src/game/world/predatorContact.ts`、`tests/sim/embodiedSnake.test.ts`、`tests/sim/predatorContactValidation.test.ts` | 审核候选；实机验证警告可读性 |
| ECO-004 | 雨林应存在动态种群，而非固定几个动物 | 生物数量应由群系、天气、时间和承载力低频演化，并保持确定性 | 同种子可重放；种群可补充、迁移和下降；天气改变活跃/可读性而非凭空删出生物 | **完成** | `src/game/ecology/population.ts`、`tests/ecology/ecology.test.ts` | 审核候选 |
| ECO-005 | 火把/营火应影响捕食者，而不只是照明 | 火焰强度和距离需要成为连续生态输入，并服从多火源与存档权威 | 活捕食者在有效火源范围持续退避；尸体不移动；重复/非法火源不叠加作弊 | **完成** | `src/game/ecology/projection.ts`、`tests/ecology/fireDeterrence.test.ts`、`tests/sim/fireDeterrenceIntegration.test.ts` | 下一候选；实机验证遭遇手感 |
| ECO-006 | 用户要求生态循环、生态链 | 当前已有种群、尸体和火焰反应，但捕食—被捕食、食腐、植物压力和承载力回写尚未形成完整可见链 | 至少一条“植物→猎物→捕食者/尸体→食腐/资源恢复”链可被玩家观察并改变 | **部分** | 当前底座：`src/game/ecology/`；未完成项：`docs/LIVING_RAINFOREST_EXECUTION_BACKLOG.md` | 后续里程碑 |
| ECO-007 | 生物应在复杂雨林中移动、追踪、撤退，而非局部状态切换 | 需要有预算的路径选择、地形/建筑遮挡和跨区记忆 | 跟踪同一动物 60 秒，可观察到觅食/饮水/警戒/逃跑或追踪，且不穿越实体障碍 | **部分** | `src/game/ecology/projection.ts`、`src/game/world/predatorContact.ts`、`PLAYTEST_RUBRIC.md` | 后续里程碑并需实机证据 |
| ECO-008 | 雨林生存还应有鱼类、更多疾病和更完整食物生态 | 当前纵切只有首批陆生动物、肉类加工和有限疾病 | 捕鱼、生食疾病、食腐者和群系专属威胁形成可玩闭环 | **未做** | 设计边界见 `docs/RELEASE_REPORT.md`、`docs/GAME_DESIGN.md` | 后续里程碑 |

## 8. 背包、装备、第一人称工具与配方信息

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| INV-001 | 背包过于混乱，需要像《森林》系列那样降低搜索成本 | 背包应按玩家意图分区，并提供紧急/筛选视图，而不是一张平铺表 | 空分区不显示；食物/饮水、工具、医疗、材料清晰分组；紧急项优先 | **完成** | `src/game/ui/inventoryOrganization.ts`、`tests/ui/inventoryOrganization.test.ts` | 审核候选 |
| INV-002 | 工具虽存在但没有真正装备，也不透明哪个会先损坏 | 持有数量、装备实例、逐件耐久与消耗顺序必须分离并可见 | 每件耐久单独保存；装备具体实例有标记；最弱优先等规则在 UI 与模拟一致 | **完成** | `src/game/sim/lifecycle.ts`、`src/game/ui/inventoryLifecycleView.ts`、`tests/ui/inventoryLifecyclePresentation.test.ts` | 审核候选 |
| INV-003 | 第一人称中看不到武器/工具 | 常用工具需要显式装备、快捷切换和相机内模型，动作与当前持有物一致 | 斧、矛、石刃、石镐和火把可装备/收起；第一人称模型与动作/耐久同步 | **完成** | `src/game/render/HeldItemRig.ts`、`src/game/render/HeldTorchModel.ts`、`src/game/ui/EquipmentBar.tsx` | 审核候选 |
| INV-004 | 建造、睡觉、维护全部塞在同一菜单，没有分类 | 制作表面应按“工具/生存/建造”等意图分组，世界维护优先局部交互 | 菜单分组稳定；睡觉、添柴等不会混进建筑列表；放置型配方进入预览 | **完成** | `src/game/ui/actionUx.ts`、`src/game/ui/Panels.tsx`、`tests/ui/actionUx.test.ts` | 审核候选 |
| INV-005 | 配方/建造界面不知道已有多少、还缺多少、工具是否消耗 | 材料提示应直接投影模拟权威数据，并能解释上游制作或生态来源 | 每项显示“已有/所需”；够用/缺失有文字和颜色；工具注明不消耗；缺失项可展开来源提示 | **完成** | `src/game/ui/recipeRequirements.ts`、`src/game/ui/Panels.tsx`、`tests/ui/recipeRequirements.test.ts` | 下一候选；冻结审核包之后完成 |
| INV-006 | 正经生存建造还需要负重、储存与装载规划 | 当前分类背包解决查找，不等于完成空间/重量取舍 | 有明确容量/重量、超重后果、地面/营地储物和可预测装载规则 | **未做** | 设计方向见 `docs/GAME_DESIGN.md`、当前边界见 `docs/RELEASE_REPORT.md` | 后续里程碑 |

## 9. 夜晚、火把与营地感官反馈

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| LIGHT-001 | 夜晚过黑且持续很久，需要最低可玩亮度 | 基础导航光不应占手；更强光源可以占手、耗材并受雨影响 | 无火把时手表/基础夜光可读近处；不会照亮整片森林；日长已统一 | **完成** | `src/game/render/NightLightRig.ts`、`src/game/ui/Hud.tsx`、`tests/sim/nightLighting.test.ts`、`tests/render/nightLightRig.test.ts` | 审核候选 |
| LIGHT-002 | 火把照明范围太小，基本无法使用 | 火把需保障 10–15m 导航，同时保留燃烧、占手和雨淋限制 | 干/雨夜同种子中能辨认 10m 资源和 15m 地形方向；燃料耗尽/暴雨状态可见 | **待实机验证** | `src/game/render/HeldTorchModel.ts`、`src/game/render/NightLightRig.ts`、`tests/sim/torchOwnership.test.ts`、`PLAYTEST_RUBRIC.md` | 实机门禁 |
| LIGHT-003 | 营火是持续系统，应显示剩余时间并支持快速添柴 | 火、余烬、遮雨和燃料阶段是世界状态，不只是菜单数字 | 聚焦营火即显示燃料；快速添柴/重燃反馈明确；暴雨和棚顶覆盖按真实位置结算 | **完成** | `src/game/sim/campfireIgnitionRules.ts`、`src/game/render/CampfireFeedbackRig.ts`、`tests/sim/campfireIgnitionRules.test.ts` | 下一候选 |
| LIGHT-004 | 长夜的整体体验仍需保障，不只是提高一个灯光参数 | 亮度、反差、雨、雾、路线标记、危险预警和移动速度需要联合试玩 | 完成一条营地—河岸—返回夜间路线，既不迷失到无法操作，也不消除夜间压力 | **待实机验证** | `PLAYTEST_RUBRIC.md`、`docs/VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md` | 实机门禁 |

## 10. 存档、Toy 云、导入导出与死亡读档

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| SAVE-001 | 刷新后回到开局，本地存档不可信 | 存档必须本地优先、带版本和校验，并保留主/备份与损坏隔离 | 写入后回读校验；主档损坏时隔离并恢复备份；云失败不回滚本地成功 | **完成** | `src/game/persistence/saveEnvelope.ts`、`src/game/persistence/saveRepository.ts`、`tests/persistence/saveRepository.test.ts` | 审核候选 |
| SAVE-002 | 需要手动存档、多自动档位，并能自己选择回到什么时候 | 单一 autosave 不足以支持生存游戏失败恢复 | 提供 3 个手动档和轮转的 10 个自动恢复点；列表显示日期、任务、状态和位置 | **完成** | `src/game/persistence/checkpointTimeline.ts`、`src/game/ui/DeathReview.tsx`、`tests/persistence/checkpointTimeline.test.ts`、`tests/ui/checkpointTimeline.test.ts` | 审核候选 |
| SAVE-003 | 休息和任务进度没有自动存档 | 关键动作必须在因果边界保存，休息还需要前/后双恢复点；已由休息事务拥有的完成事件不能再被通用自动存档重复轮转 | 休息前先写可启动恢复点，成功后再写休息后点；同一休息只占用预期档位，同行任务事件仍独立保存；任务、地标和关键建造触发自动点 | **完成** | `src/game/persistence/checkpointBarrier.ts`、`src/game/persistence/saveCoordinator.ts`、`src/game/GameClient.tsx`、`tests/persistence/checkpointBarrier.test.ts`、`tests/persistence/saveCoordinator.test.ts`、`tests/ui/saveUiIntegrationPolicies.test.ts` | 下一候选；事务、去重和失败路径已有自动化证据 |
| SAVE-004 | 莫名死亡后应引导读档，而不是只让玩家重开 | 死亡界面要解释死因、最近状态和恢复点，新周目是次级显式选择 | 死亡页以恢复时间线为主；选择档位后恢复对应状态；新周目不会误触 | **完成** | `src/game/ui/DeathReview.tsx`、`src/game/ui/PlayerStateFeedback.tsx`、`tests/ui/playerStateFeedback.test.ts` | 审核候选；死亡路径实机复测 |
| SAVE-005 | 本地存档需要导出文件、导入文件保存 | 导入是不可信且破坏性操作，必须限制、预览、校验和保留回滚点 | 导出可下载；导入限制大小/深度，校验 checksum/版本，确认前预览；成功前保留 preimport | **完成** | `src/game/persistence/saveFile.ts`、`src/game/ui/SaveTransferControls.tsx`、`tests/persistence/saveFile.test.ts`、`tests/persistence/saveImport.test.ts` | 下一候选；浏览器下载/文件选择实测 |
| SAVE-006 | 需要同步 Toy 云存档 | Toy 单值/键数约束要求压缩、分片、清单和 fail-closed；UI 还必须把本地耐久与异步云结果分开，较慢的旧云完成不能覆盖较新的保存状态 | 每物理项≤1024字节、总键≤128；缺块/损坏拒绝采用；本地档仍可用；时间线可跨设备合并；旧云回调不能把新保存的状态或 payload 改旧 | **完成** | `src/game/persistence/cloud.ts`、`src/game/persistence/saveCoordinator.ts`、`src/game/platform/toyBridge.ts`、`tests/persistence/toyCloudChunks.test.ts`、`tests/persistence/checkpointCloudTimeline.test.ts`、`tests/persistence/saveCoordinator.test.ts` | 下一候选；异步状态竞态已有自动化证据，生产 Toy 宿主仍待验证 |
| SAVE-007 | 玩到后面刷新却恢复旧周目/开局 | 新周目和导入需要 `runEpoch` 隔离；标题页在有界云发现结束前不能允许继续旧本地候选；新周目必须立即建立已验证恢复点 | 清档/导入后旧云档无法覆盖新周目；晚到 SDK 和旧写入不会回滚新状态；“继续”在云发现完成前禁用；新周目产生一个可立即载入的 `new-game` 恢复点 | **完成** | `src/game/persistence/saveRepository.ts`、`src/game/GameClient.tsx`、`src/game/ui/StartScreen.tsx`、`tests/persistence/saveImport.test.ts`、`tests/persistence/saveRepository.test.ts`、`tests/ui/startScreen.test.ts`、`tests/ui/saveUiIntegrationPolicies.test.ts` | 下一候选；自动化已覆盖初始化竞态与首个恢复点，生产 Toy 刷新仍待实机验证 |
| SAVE-008 | 自动化通过不等于 Toy 真云可用 | Toy SDK、登录态、网络、宿主配额和跨设备恢复只能在线上验证 | 生产 Toy 中完成保存→刷新→恢复→第二设备读取→云失败本地降级，全程记录状态 | **待实机验证** | `docs/RELEASE_REPORT.md`、`PLAYTEST_RUBRIC.md` | 生产审核通过后的强制门禁 |
| SAVE-009 | 用户明确表示研发阶段不用照顾旧存档 | 可以不做内容迁移，但世界生成器 ID、schema 和云数据必须版本化并 fail closed，避免旧数据静默污染新世界 | 不兼容存档给出明确提示或开启新周目；生成规则身份变化时显式 bump version/namespace；不进行猜测式迁移 | **完成** | `PROJECT_BRIEF.md`、`docs/WORLD_GENERATOR_VERSIONING_GATE.md`、`src/game/persistence/saveEnvelope.ts` | 文档/架构决策；每次生成器变更复核 |

## 11. 自由建造、建筑网络与材料反馈

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| BUILD-001 | 原建造线性、枯燥，需要自由放置 | 建筑必须有世界预览、旋转、取消、地形/碰撞/重叠检查，并保存变换 | 玩家在合法位置自由放置；红/绿预览和失败原因清楚；非法放置不扣材料 | **完成** | `src/game/render/PlacementPreview.ts`、`src/game/sim/structureGeometry.ts`、`tests/sim/freeBuilding.test.ts` | 审核候选 |
| BUILD-002 | 每种建筑只能建一个，不符合沙盒乐趣 | 配方解锁与实例上限必须解耦；普通建筑可多实例 | 营火、棚、床、雨水架、烟熏架和火把路标可重复建造，并各自保存状态 | **完成** | `src/game/sim/campStructures.ts`、`tests/sim/freeBuilding.test.ts`、`tests/render/multiStructureProjection.test.ts` | 下一候选 |
| BUILD-003 | 睡觉、遮雨、添柴等不应永远绑定“营地中心” | 建筑效果必须由实际位置、朝向和几何覆盖决定 | 只在真实床附近可休息；棚顶只保护覆盖范围；每个营火独立维护与碰撞 | **完成** | `src/game/sim/structureGeometry.ts`、`tests/sim/structureSemantics.test.ts` | 审核候选 |
| BUILD-004 | 建造内容应服务雨林不同情况 | 建筑需要连接饮水、食物保存、夜路和远征，而非只完成主线检查框 | 雨水收集架、烟熏架和火把路标分别改变供水、腐败与夜间路线规则 | **完成** | `src/game/sim/rainCollectorRules.ts`、`src/game/sim/smokingRackRules.ts`、`src/game/sim/torchWaymarkRules.ts` | 下一候选 |
| BUILD-005 | 建筑应可拆除并合理返还材料 | 自由放置只有“建”没有“拆”仍会惩罚试验和迁营 | 每个普通建筑可确认拆除；返还比例明确；加工物/燃料/存档状态安全处理 | **未做** | 未完成边界：`docs/THREE_HOUR_CAMPAIGN_PLAN.md` | 后续里程碑 |
| BUILD-006 | 不同群系、材料和建筑应形成收集—建设中循环 | 目前只有首批跨系统建筑，群系材料身份和多个前哨网络仍不完整 | 至少三个群系各有一座改变世界规则的建筑，且材料来源/理由可被玩家解释 | **部分** | `docs/BIOME_BUILDING_MIDLOOP.md`、`tests/sim/smokingRack.test.ts`、`tests/sim/rainCollector.test.ts` | 后续里程碑；不阻塞当前纵切片 |
| BUILD-007 | 复杂地势需要绳索、高脚平台、储物和多个营地 | 当前自由建筑底座尚未提供垂直通行和成熟基地网络 | 绳索或慢速绕路均可达；高脚前哨改变湿地风险；营地储物与多个营地可持续运作 | **未做** | 设计目标：`docs/RAINFOREST_DENSITY_PLANT_VERTICALITY_PLAN.md`、`docs/THREE_HOUR_CAMPAIGN_PLAN.md` | 后续里程碑 |

## 12. 移动端、快捷键、UI 布局与缩放

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| UI-001 | 手机版少很多功能，没有入口 | 多端可以有不同信息层级，但必须暴露相同核心动词、面板和装备能力 | 触控可进入手表、背包、制作、身体、笔记、地图、暂停/存档和装备栏 | **完成** | `src/game/ui/TouchControls.tsx`、`src/game/ui/types.ts`、`tests/ui/touchControls.test.ts` | 审核候选 |
| UI-002 | 移动端 UI 堆满画面，无法操作 | 移动 HUD 应保留准星净空、使用安全区和动态视口，只让面板正文滚动 | 小屏隐藏次要常驻信息；关闭按钮可见；无横向溢出；主触控目标≥44px | **待实机验证** | `app/globals.css`、`tests/ui/mobileResponsiveContract.test.ts`、`PLAYTEST_RUBRIC.md` | 实机门禁：390×844、844×390、667×375 |
| UI-003 | 1080P 默认字体太小；ESC 设置中需要 UI 大小滑杆 | UI 缩放应调整尺寸 token，不能整体 CSS zoom 导致准星/点击坐标错位 | 80%–140% 以 5% 步进保存；1920×1080 下三档不遮挡关键 HUD/准星 | **完成** | `src/game/ui/uiSettings.ts`、`src/game/ui/Panels.tsx`、`tests/ui/uiSettings.test.ts` | 下一候选；1080P 人工检查 |
| UI-004 | Tab/C/B/N/M/F 与 Esc 打开后不能稳定关闭、菜单互相叠 | 菜单键应同键切换、异键互斥；Esc 先取消局部状态再逐层退出；顶层恢复对话框在加载期间必须消费 Esc，不能向下传播并意外关闭游戏面板 | 所有快捷键同键关闭；异键替换当前面板；Esc 按输入焦点→顶层对话框→放置→面板→暂停顺序退层；恢复加载期间不被关闭 | **完成** | `src/game/ui/menuShortcuts.ts`、`src/game/GameClient.tsx`、`tests/ui/menuShortcuts.test.ts`、`tests/ui/saveUiIntegrationPolicies.test.ts` | 下一候选；快捷键和顶层 modal 规则已有自动化证据 |
| UI-005 | 移动操作和桌面操作不能走两套不同规则 | 输入层只选择同一 affordance/command，阻塞原因、动作阶段和结果必须一致 | 触控按钮显示与 HUD 相同动词/目标/阻塞；动作期间显示进度并防重复输入 | **完成** | `src/game/ui/TouchControls.tsx`、`tests/ui/actionPhase.test.ts`、`tests/ui/touchControls.test.ts` | 下一候选 |
| UI-006 | 自动化 CSS 契约不等于真机可用 | 浏览器地址栏、手势、横竖屏、触摸延迟和 GPU 性能需要设备矩阵 | 至少覆盖目标三种视口和一台真实手机，完成所有面板、装备、建造、导入与死亡读档路线 | **待实机验证** | `PLAYTEST_RUBRIC.md`、`docs/RELEASE_REPORT.md` | 实机门禁 |

## 13. 雨林群系、动态地图、地形与植物

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| WORLD-001 | 地图大但空旷，需要动态扩展并支持不同生态环境 | 世界应由种子+区块坐标确定，近处物化、远处只保留语义/差量 | 任意方向跨区块生成稳定 5 群系；活动泡有界；返回后改变对象保持 | **完成** | `src/game/world/generation.ts`、`src/game/world/semanticGeneration.ts`、`tests/world/semanticStreaming.test.ts` | 审核候选 |
| WORLD-002 | 雨林不像雨林：树太少、太小，中远景空 | 密度要分为可交互近景、叶幕中景、树冠远景和地表杂物，不能全靠昂贵实体树 | 每个主视角含前景遮挡、中景叶/藤体量和远景树冠；不会制造可交互植物的假相似物 | **部分** | `src/game/world/semanticGeneration.ts`、`src/game/render/SemanticInstanceLayer.ts`、`docs/RAINFOREST_DENSITY_PLANT_VERTICALITY_PLAN.md` | 下一候选；视觉盲测前不能记为完成 |
| WORLD-003 | 地形过于平坦，缺少高差、岩壁、绳索等路线乐趣 | 需要连续宏观地形场、坡度/水系约束和至少一条慢绕路；不是随机把地面抖凹凸 | 玩家在路线选择中读到高差、坡度、河岸和遮蔽差异；垂直障碍不会造成无解 | **部分** | 当前地形：`src/game/world/terrain.ts`；计划：`docs/RAINFOREST_DENSITY_PLANT_VERTICALITY_PLAN.md` | 后续里程碑；绳索仍未做 |
| WORLD-004 | 雨林植物贫乏，连芭蕉都没有；植物应有吃/加工用途 | 植物物种、轮廓、群系倾向、采集动词和产出需同时进入语义生成 | 可识别野生芭蕉在湿润/棕榈群系更常见，采集得到可食热带果实和宽叶；药草/藤本各有用途 | **部分** | 已实现的语义/轮廓底座：`src/game/world/semanticGeneration.ts`、`src/game/render/plantVisualSemantics.ts`、`src/game/render/plantGeometryCatalog.ts`、`src/game/render/SemanticInstanceLayer.ts`、`tests/sim/semanticHarvest.test.ts`、`tests/render/plantGeometryRuntimeIntegration.test.ts` | 四类现有资源植物已差异化；更多物种、群系关系与加工链仍是后续内容 |
| WORLD-005 | 河边反而没有石头等合理资源；雨林地理与资源脱节 | 水系应是连续地理规则，并影响河岸净空、石/藤适宜度、水位和任务 | 河岸有连续可取水表面；河石/藤适宜度高；暴雨经延迟径流改变水位趋势 | **完成** | `src/game/world/terrain.ts`、`src/game/world/riverHydrology.ts`、`src/game/sim/resourceDirector.ts`、`tests/sim/continuousRiverWater.test.ts` | 下一候选；真人河岸路线复核 |
| WORLD-006 | 地图应像沙盒世界一样随探索扩展 | 纸图只记录已探索区块；世界本体不依赖一张固定手工边界图 | 跨过区块边界后新区域稳定生成并加入探索记录；未改变区块不写入主存档 | **完成** | `src/game/world/generation.ts`、`src/game/ui/viewModel.ts`、`tests/world/generation.test.ts`、`tests/world/semanticStreaming.test.ts` | 审核候选 |
| WORLD-007 | 动态世界不能因探索范围增大而撑爆 Toy 存档 | 程序化基线不保存，只保存耗尽、受损、死亡、建造等稀疏差量 | 访问 1000 个原始区块后运行时有界、没有原始差量；改变对象可往返保存 | **完成** | `src/game/world/saveDelta.ts`、`tests/world/semanticStreaming.test.ts`、`tests/persistence/worldDeltaBudget.test.ts` | 审核候选 |
| WORLD-008 | 需要更系统的植物特性、食用与加工体系 | 当前只有首批药草、藤本、棕榈果/芭蕉与肉类加工，尚不是完整雨林植物学循环 | 多种群系植物提供生食、烹饪、药用、纤维、建筑或风险，并有可读加工链 | **未做** | 方向见 `docs/LIVING_RAINFOREST_GAMEPLAY_SPEC.md` | 后续里程碑 |

## 14. 主线、三层循环与三小时目标

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| STORY-001 | 原主线太短，只能算新手序章 | “第一夜—电池—发报”应明确为序章，完成后继续沙盒并引出新的生态问题 | 发报后收到延迟回执而非永久结束；玩家保留营地和世界状态继续行动 | **完成** | `src/game/sim/campaignContent.ts`、`tests/sim/campaignContent.test.ts` | 审核候选 |
| STORY-002 | 先实现约 3 小时内容，不靠重复收集灌时长 | 章节应由观察事实、准备、世界改变和上报组成，小/中/大循环互相嵌套 | P0 序章、A1 河流在上升、A2 林冠没有风拥有可完成事实链并支持提前发现 | **部分** | `src/game/sim/campaignContent.ts`、`src/game/sim/canopyJunction.ts`、`tests/sim/riverCampaignVerticalSlice.test.ts`、`tests/sim/canopyWindDomain.test.ts` | 下一候选；仍不是完整三小时章 |
| STORY-003 | 需要完整三小时故事，与雨林生态串联 | A3 黑水、A4 岩岭和 A5 信号选择承担湿地、垂直路线、章节决策与总结 | A3–A5 均可完成；选择改变后续回应/资源；结束后继续沙盒 | **未做** | 仅设计：`docs/THREE_HOUR_CAMPAIGN_PLAN.md` | 后续里程碑 |
| STORY-004 | 要用小循环套中循环套大循环，而非线性任务清单 | 微操作、营地维护、远征准备和章节事实应互相提供资源/安全/知识 | 20–90秒动作、5–15分钟远征、25–45分钟章节各有选择和持久后果 | **部分** | `docs/THREE_HOUR_CAMPAIGN_PLAN.md`、现有 P0/A1/A2 与烟熏/集雨/路标测试 | 后续持续扩展 |
| STORY-005 | 最初提出至少 10 小时，后调整为先做 3 小时 | 自动化关键路径不能替代真人墙钟和乐趣验证 | 5 名首次玩家产生 2.5–3.5 小时中位数记录；无连续 12 分钟单一重复采集 | **未做** | `docs/THREE_HOUR_CAMPAIGN_PLAN.md`、`docs/RELEASE_REPORT.md` | 后续里程碑；10小时不属于当前承诺 |

## 15. Valheim 启发的程序化画面方向

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| VIS-001 | 当前简单三角面够用但缺少层次、艺术感和沉浸；要求深度研究 Valheim | 借鉴的是小体量程序化世界方法：宏观轮廓、群系构图、低模材质、光雾天气和性能纪律，不复制资产 | 研究区分可借鉴原则、不可复制表达、当前差距和执行顺序 | **完成** | `docs/VALHEIM_VISUAL_WORLD_STUDY.md`、`docs/VALHEIM_VISUAL_TECHNICAL_AUDIT.md`、`docs/CANOPY_VISUAL_BIBLE.md` | 文档基线 |
| VIS-002 | 画面升级不能先把性能和交互搞坏 | 视觉重构前要有可复现 V0 基线、对象预算、截图路线和停止条件 | 固定种子/相机/路线/质量档；记录 draw call/三角面/帧时间/内存字段，不把静态估算写成 GPU 实测 | **完成** | `scripts/visual-v0-baseline.ts`、`docs/VISUAL_V0_REPRODUCIBLE_BASELINE.md`、`tests/diagnostics/visualV0Baseline.test.ts` | 文档/工具基线 |
| VIS-003 | 先用“欺骗的艺术”提升树叶密度和中远景 | 已建立语义对象、树/岩跨活动环实例池、环境叶幕与微型地表层，并让四类资源植物使用独立、低预算、可复用的实例几何；完整构图仍未过盲测 | 近中远层次有界生成；离散交互对象与视觉杂物不会语义冲突；性能诊断可读 | **部分** | `src/game/render/SemanticInstanceLayer.ts`、`src/game/render/SemanticTreePool.ts`、`src/game/render/SemanticRockPool.ts`、`src/game/render/plantGeometryCatalog.ts`、`src/game/world/semanticGeneration.ts`、`tests/render/plantGeometryCatalog.test.ts`、`tests/render/plantGeometryRuntimeIntegration.test.ts` | 四植物差异几何是可读性纵切；视觉盲测、GPU 实测和整体构图仍未完成，不等于 Valheim 画面升级 |
| VIS-004 | 用户询问“Valheim 画面改造是否已经做了” | 研究、底座和局部表现不等于最终画面升级；连续世界、自然群系过渡、材质、灯光与构图仍未实施完 | 玩家仅凭截图能区分群系/资源倾向；地形、近中远景、顶点色/材质、光雾天气形成统一原创风格 | **未做** | 未完成边界：`docs/LIVING_RAINFOREST_EXECUTION_BACKLOG.md`、`docs/VALHEIM_VISUAL_TECHNICAL_AUDIT.md` | 后续里程碑；不得在当前发布文案宣称完成 |
| VIS-005 | 可以调用图像生成制作难以用简单资源完成的游戏资产；用户指定优先使用已授权的公司 AI 图片流程和内置浏览器 | 生成资产也需要按批准的 skill/浏览器流程执行，并进行原创提示、来源、许可、包体和运行时价值审查 | 每个运行时资产有生成平台/提示摘要/用途/尺寸/许可记录，并通过视觉与性能门禁；不使用来源不明网页或用户桌面代替授权流程 | **部分** | 已有仅社交 OG 图：`public/og-canopy-first-night.png`、`public/assets/licenses.json` | 游戏内资产仍属后续；使用批准流程且禁止复制参考游戏表达 |
| VIS-006 | 画面升级需要真实性能和视觉验收 | 静态测试不能证明 GPU、移动端内存、截图层次和玩家辨识 | 桌面/移动记录 p50/p95 帧时间、draw calls、三角面、内存与截图盲测；不过线则回滚 | **未做** | `docs/VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md`、`PLAYTEST_RUBRIC.md` | 实机门禁；阻塞正式 V1 画面宣称 |

## 16. Toy、GitHub 与飞书发布

| ID | 用户症状 / 要求 | 系统性解释 | 可观察验收标准 | 当前状态 | 证据 | 发布处置 |
| --- | --- | --- | --- | --- | --- | --- |
| RELEASE-001 | Toy 生产页丢 CSS/JS、出现宿主 404，怀疑没有遵守托管规范 | Toy 包必须以 `index.html` 为位置无关入口，闭包所有本地资源，不能依赖开发服务器绝对路径 | `build:toy` 生成可搬迁闭包；静态 doctor 0 findings；预览无应用资源 404/JS error | **完成** | `scripts/prepare-toy-build.mjs`、`scripts/verify-toy-build.mjs`、`package.json`、`docs/RELEASE_REPORT.md` | 审核候选；生产 URL 仍需复测 |
| RELEASE-002 | 要求把画面升级前版本先发布 Toy，并在开发继续时冻结候选 | 发布物与开发工作区必须分离，避免开发中改动污染审核包 | Toy ID `10228414336000` 的冻结包已提交，状态记录为 `auditing`；开发分支持续推进 | **部分** | `docs/RELEASE_REPORT.md`、`PLAYTEST_RUBRIC.md` | 等待审核；不能称已上线 |
| RELEASE-003 | Toy 预览能开不代表正式页、Pointer Lock 和云存档正常 | 宿主权限、生产 CDN、直接刷新、OAuth/SDK 和跨设备云只能在正式 URL 验证 | 审核通过后验证首载、刷新、Pointer Lock、触控、控制台、保存/恢复和降级 | **待实机验证** | `docs/RELEASE_REPORT.md` | 生产上线强制 smoke |
| RELEASE-004 | 要求最新版本更新 GitHub | 当前本地开发版本远超已提交 SHA，不能用旧仓库代表最新成果 | 整理变更、通过完整门禁、提交并推送；记录 commit/PR/Actions/Pages URL | **未做** | `docs/RELEASE_REPORT.md` 第7节；当前发布字段仍为 `PUBLISH-TIME` | 下一候选通过后执行；需外部写入授权 |
| RELEASE-005 | 要求安装 Toy CLI、检查 `toy upgrade`、`toy whoami` 和 OAuth | 安装 skill 不等于 CLI 当前可用；历史发布命令也不等于当前登录态仍有效 | 当前执行环境能运行 `toy upgrade`；`toy whoami` 返回 UID/昵称；失效时只打开官方 OAuth 授权页 | **部分** | 历史命令记录：`docs/RELEASE_REPORT.md`；当前会话仍需重新验证 CLI/PATH 与登录态 | 每次发布前置门禁；不得用非官方页面代替授权页 |
| RELEASE-006 | 用户要求完成后提交 Toy 审核并飞书通知 | 通知必须写真实审核状态、测试边界、预览/生产 URL 和待办，不能把审核中说成上线 | 冻结候选审核通知已发送并有回执；最终版本发布后再发一次完成通知 | **部分** | `docs/RELEASE_REPORT.md` 第7节 | 当前候选通知已完成；最终版本通知待下一次发布 |
| RELEASE-007 | Toy 包体上限 140MB，不应浪费空间 | 新资产和程序化表现都要记录包体增量和许可证 | 构建包低于140MB；doctor通过；每项外部/生成资产有清单 | **完成** | `docs/RELEASE_REPORT.md`、`public/assets/licenses.json` | 每个候选重新核对 |
| RELEASE-008 | F12 中 `pointer-lock` feature 警告与 Toy SDK 预载提示可能被误判为游戏错误 | 应区分宿主警告、应用资源错误和真正运行时崩溃；功能验收优先于“控制台绝对零文本” | 应用 CSS/JS 全部加载；Pointer Lock 实际可进入/退出；宿主警告单独记录，不掩盖应用错误 | **待实机验证** | `docs/RELEASE_REPORT.md`、Toy 生产 smoke 待办 | 审核通过后在生产 URL 复测 |

## 17. 当前发布门禁与后续路线的分界

### 17.1 当前/下一候选应收口

- GUIDE-007：干叶分布、轮廓和引导。
- TIME-005：普通树木树桩→树苗→幼树→成树的多日再生；自动化已闭环，仍需实机可读性与候选包核验。
- HARVEST-003 / WORLD-004：四类现有资源植物的差异几何已闭环；完整植物生态和加工仍留在后续路线。
- INV-005：材料“已有/所需”、工具不消耗和来源提示。
- UI-003 至 UI-005：UI 缩放、快捷键退层与触控同源动作。
- LIGHT-002、UI-002、UI-006：桌面/移动实机可玩性证据。
- RELEASE-001、RELEASE-003：重新构建 Toy 包并在审核/生产 URL 完成 smoke。
- RELEASE-004、RELEASE-006：门禁通过后更新 GitHub，并发送与真实状态一致的飞书通知。

### 17.2 不得冒充本次已完成

- DIR-005：完整资源/威胁/章节导演。
- ECO-006 至 ECO-008：完整生态食物网、路径追逐、鱼类与疾病生态。
- BUILD-005 至 BUILD-007：拆除返还、成熟多营地、储物、绳索和高脚平台。
- WORLD-003、WORLD-008：完整垂直地形与系统化植物加工。
- STORY-003 至 STORY-005：A3–A5、真人三小时和十小时内容。
- VIS-004 至 VIS-006：Valheim 启发的正式画面重构、GPU profiling 和视觉盲测。

## 18. 维护检查

每次里程碑、Toy 提交或用户新反馈后，负责人必须执行：

1. 为新反馈分配稳定 ID，或链接已有 ID，禁止只留在聊天中。
2. 更新“当前状态”和“发布处置”，但不因写了方案就标“完成”。
3. 给每个“完成”项补代码/测试/实机证据；纯视觉与手感必须有人类证据。
4. 对照 `PROJECT_BRIEF.md` 判断是当前门禁还是后续路线，防止无限扩张当前候选。
5. 对照 `docs/RELEASE_REPORT.md` 区分本地、预览、审核中和生产上线四种事实。
6. 更新后检查本表中的稳定 ID 无重复、证据路径存在、状态词仅使用四种定义值。
