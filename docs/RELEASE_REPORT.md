# CANOPY: First Night — Release report

> 状态：本轮玩家反馈闭环候选已冻结；619 项测试、类型检查、Lint、生产构建、Toy 构建、双重静态预检与本地桌面/移动 smoke 已通过。Toy ID `10228414336000` 的本轮预览、审核提交、GitHub 更新与飞书通知仍须填写真实外部返回值。
> 记录日期：2026-07-15
> 目的：把当前可交付内容、设计蓝图、已取得证据和仍缺少的真人/线上证据分开记录，避免把计划或自动化结果当成发布事实。

## 1. 发布结论

当前仓库包含一条从受伤醒来、采集与发现、净水、建营、远征取电池、返营发报到胜负结算的完整规则路径。它不是《Green Hell》的复刻，也不是 [GAME_DESIGN.md](GAME_DESIGN.md) 全量愿景的实现；它是一段使用原创世界、资产和文本验证“知识—准备—风险—后果—恢复”循环的浏览器纵切片。

当前版本不声明固定的真人游玩时长。确定性“完整采集至求救”关键路径测试把游戏状态时钟约束在 **1,500–1,950 秒**。该测试直接设置规则层位置以验证资源经济、门槛和任务因果，未计入真人行走、找路、阅读、指针锁操作和失败重试，因此 **1,500–1,950 秒不是完整真人墙钟通关时长**。截至本报告记录时，尚无从标题页开始、使用真实第一人称移动并连续玩到结算页的完整墙钟计时样本，更没有真人连续十小时游玩样本。

- **已证实：** 619 项自动化测试全部通过；确定性规则、空间化建筑、具身动物与 authored 蛇、树木倒伏及分阶段再生、岩石辨识/开采、四类资源植物差异几何、状态/死因、检查点时间线、导入导出、清档隔离和 Toy 配额协议均有代码级回归；Vinext 与 Toy 生产构建通过，Toy 包的文件数与字节数已经核对；本地桌面、390×844 竖屏和 844×390 短横屏完成入口与布局抽查，抽查期间控制台无本项目 error/warning。
- **尚未证实：** 完整三小时内容和真人墙钟节奏；广泛真实设备矩阵；审核通过后的生产 URL、Toy 云存档与线上刷新恢复；A3–A5 章节仍未实现。上述项目不得由自动化结果替代。

## 2. 已实现范围与代码证据

| 能力 | 当前实现 | 主要证据 |
|---|---|---|
| 完整任务链 | 处理伤口 → 安全饮水 → 火/棚/床营地 → 调查三处地标 → 气象站电池 → 返营修复信标并发报；包含胜利和生命/理智归零失败 | `src/game/sim/content.ts`、`src/game/sim/simulation.ts`、`tests/sim/simulation.test.ts` |
| 确定性规则 | 30 Hz 固定步长、分频道种子随机、不可变状态推进、稳定事件与因果码 | `src/game/sim/rng.ts`、`src/game/sim/simulation.ts`、确定性与 10,000 tick 测试 |
| 知识发现 | 首局不公开全部配方；观察材料和完成行动解锁配方；本机保留已学知识 | `src/game/sim/selectors.ts`、`src/game/GameClient.tsx`、材料观察测试 |
| 显式装备、树木处理与调查门槛 | 持有与装备分离；石斧、石矛、石刃和石镐具有第一人称持有表现、耐久和明确用途。树木形成砍击、倒伏、拾枝、截段、搬取原木、劈柴和树桩持久化闭环；拆取电池也要求显式装备石斧并完成调查链 | `src/game/render/HeldItemRig.ts`、`src/game/sim/treeHarvest.ts`、`tests/sim/treeFelling.test.ts`、`tests/render/treeFellingRender.test.ts` |
| 岩石辨识与开采 | 散石、可开采岩体和微型碎石拥有互斥尺度与动作；所有离散岩体可由当前石镐处理，尺寸决定时间、体力和耐久；破裂与耗尽状态改变模型、碰撞和聚焦。勘测岩棚使用独立顶棚—入口—内腔—箱体布局 | `src/game/sim/rockHarvest.ts`、`src/game/render/rockVisualSemantics.ts`、`tests/sim/rockMiningVerticalSlice.test.ts`、`tests/render/interactionGeometry.test.ts` |
| 生理与资源压力 | 生命、耐力、能量、理智、碳水、脂肪、蛋白质、水分、伤口、感染、潮湿、寄生虫；移动与冲刺进入模拟消耗 | `src/game/sim/types.ts`、`src/game/sim/simulation.ts` |
| 水与营地因果 | 脏水可能导致寄生虫；煮水或接雨获得净水；露天火会被暴雨熄灭；遮雨棚按实际屋顶范围保护火；床用饥渴换恢复 | `src/game/sim/simulation.ts`、`tests/sim/structureSemantics.test.ts` |
| 自由放置与空间化建筑语义 | 营火、棚和床使用可旋转、可取消的世界预览；模拟层复核距离、地形、碰撞和重叠后才消耗材料。休息、加柴、遮雨、火光舒适、移动碰撞都跟随存档中的建筑位置与朝向，而不是营地中心捷径 | `src/game/render/PlacementPreview.ts`、`src/game/sim/structureGeometry.ts`、`tests/render/structureGeometry.test.ts`、`tests/sim/structureSemantics.test.ts` |
| 时间、休息与错峰刷新 | 一日为 48 个真实分钟；一次休息通过普通固定步模拟完整推进 8 个游戏小时。普通资源按节点使用种子确定的随机再生窗口和批次，并只在玩家离开后物化；目标/稀有物不会再生 | `src/game/sim/time.ts`、`tests/sim/timeEconomy.test.ts`、`tests/sim/simulation.test.ts` |
| 威胁与反制 | authored 蛇是可警告、扑咬、抢攻、受击、死亡、留尸和重生的动作实体；程序化动物拥有警觉/逃跑/盯防、生命、受伤记忆、掉落与烹饪闭环 | `src/game/sim/authoredSnakes.ts`、`src/game/ecology/`、`tests/sim/embodiedSnake.test.ts`、`tests/sim/wildlifeCombat.test.ts` |
| 3D 表现 | 第一人称移动与视角、程序化地形/植被/水体、天气、昼夜、营火、营地、气象站及资源实体 | `src/game/render/RainforestRenderer.ts` |
| UI 与诊断 | HUD、手表、分类背包、制作、身体检查、逐步任务、纸图、事件日志、暂停和胜负结算；命令级全局回执在面板上方保持可见且只播报一次，危险副作用优先；键鼠与基础触摸共用动作路径 | `src/game/ui/`、`src/game/GameClient.tsx`、`tests/ui/actionReceipt.test.ts` |
| 音频与无声兜底 | 程序化雨林、雨、火和危险提示；蛇预警同时有 HUD 文本 | `src/game/audio/AudioEngine.ts`、`src/game/GameClient.tsx` |
| 本地优先存档与新周目隔离 | 每个 checkpoint 先写校验过的本地主/备份，再异步同步云端；损坏存档隔离。`runEpoch` 优先于 revision/tick 比较，防止云清理失败后旧周目在刷新时复活；标题页等待有界云发现完成后才允许继续 | `src/game/persistence/`、`tests/persistence/saveRepository.test.ts`、`tests/ui/startScreen.test.ts` |
| Toy 配额内云存档 | 逻辑键透明映射为 Toy 合法物理键；存档优先 gzip 后 base64，严格按 1024 UTF-8 bytes 分块，使用含版本、编码、块数、原字节数和校验和的 manifest；一次批量发布后清理旧块，支持真实删除和旧宿主 tombstone 降级。超过 128 键、缺块或损坏时云同步以失败状态关闭（fail closed），本地 checkpoint 保持可用 | `src/game/persistence/cloud.ts`、`src/game/platform/toyBridge.ts`、`tests/persistence/toyCloudChunks.test.ts` |
| 社交分享资产 | 原创 AI 生成 OG 图用于 Open Graph/Twitter 卡片，不含原作素材、角色、文字或标志 | `public/og-canopy-first-night.png`、`app/layout.tsx`、`public/assets/licenses.json` |
| 静态发布 | Next.js 可导出根路径 `out/`；GitHub Pages 工作流使用仓库子路径配置上传 Pages artifact | `next.config.ts`、`.github/workflows/deploy-pages.yml` |

## 3. 设计蓝图中尚未实现的内容

以下内容仍可出现在 [GAME_DESIGN.md](GAME_DESIGN.md) 中作为设计方向，但不属于本次发布承诺：

- 完整路径追逐、火焰恐惧、复杂投掷武器和返程追猎高潮；当前捕食者仍是第一版具身遭遇。
- 独立的毒素、发热、蚂蟥、清创与多类敷料治疗链；当前蛇咬复用开放伤口后果。
- 幻觉、假声音和假资源等低理智感知干扰。
- 鱼类、捕鱼、生食疾病与更完整的食物生态；肉类烹饪、烟熏和真实腐坏批次已经存在。
- 七个强分区的手工地图、长短双路线的完整空间取舍和大型地标集；当前世界提供一条可探索、可通关的紧凑路线。
- 承重、超重惩罚、装载规划、投掷武器与复杂战斗动画。
- 第二日结构、硬时间挑战、动态难度补偿和固定真人时长保证。
- 多人、生存沙盒、排行榜、大型开放世界和原作故事内容；这些仍是明确反目标。

基础触摸控件已经存在，但“有触摸控件”不等于已经完成多设备认证。移动端性能、横竖屏、浏览器手势冲突和无障碍读屏仍需要真实设备矩阵验证。

## 4. 自动化证据

仓库包含 **619 项 Node 自动化测试，619/619 通过**。证据跨越以下边界：

- 确定性模拟、完整任务经济、10,000 tick 不变量、生态区块与种群投影。
- 显式装备、工具耐久、砍树、建筑自由放置和空间语义、48 分钟日长、8 小时休息、食物寿命及节点随机错峰再生。
- 本地主/备份、损坏隔离、`runEpoch`、有界云发现、云冲突保护，以及 Toy 1024 字节/128 键压缩分块协议。
- UI 行为、目标引导、动作完成反馈、导航坐标、渲染几何和程序化世界稳定性。

完整资源经济测试不是只给背包塞满物品的捷径：它从初始世界采集材料、发现并制作工具、治疗伤口、净水、建造营地、休息、调查地标、处理路线危险、拆取电池、返营修复信标并发报。它证明规则与内容经济存在可达解，但不证明真人第一人称路线的墙钟节奏或乐趣。

## 5. 最终本地门禁结果

以下结果均已在 2026-07-15 当前最终依赖锁和工作区上完成：

| 门禁 | 结果 | 证据边界 |
|---|---|---|
| `npm ci` | 本轮未重跑 | 依赖锁未变；不把此前安装结果冒充本轮证据 |
| `npm run typecheck` | 通过 | TypeScript 静态检查无错误 |
| `npm test` | **619/619 通过** | 模拟、生态、世界生成、渲染几何、UI、存档与 Toy 桥接回归全部通过 |
| `npm audit --omit=dev` | 本轮未重跑 | 不属于本次 Toy 审核门禁的已验证事实 |
| `npm run lint` | 通过 | ESLint 无错误 |
| `npm run build` | 通过 | Sites/Vinext 构建成功 |
| `npm run build:pages` | 本轮未重跑 | GitHub Pages 不在本次外部写入范围内 |
| `npm run build:toy` | 通过 | 生成位置无关的单页入口闭包；验证脚本通过 |
| `toy-out/` 包核对 | **19 文件 / 3,984,105 bytes（3.80 MiB）** | 项目验包器通过；官方 `toy_doctor.py` 为 `ok: true`、0 findings；远低于 140 MiB 上限 |
| 本地 HTTP 入口检查 | 通过 | IPv6 本地入口返回标题 `CANOPY: First Night｜雨林第一夜` 并渲染 WebGL 游戏场景 |
| 交互式浏览器 smoke | **本地候选通过；Toy 预览待执行** | 桌面完成同键开关、缺料标红/来源引导、暂停/存档；390×844 可达 7 个系统入口及装备；844×390 无文档横向溢出；console 抽查无本项目 error/warning |

已执行的命令序列：

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run build:toy
python toy_doctor.py toy-out --slug green-hell-web --json
```

本轮 Toy 发布门禁已通过 Vinext 生产构建、Toy 单页闭包构建和两套静态验包器。这里的“通过”只说明候选产物和本地验证成立；Toy 本轮预览与审核状态必须由后续 CLI 返回值填写，不能提前表述为已经提交或上线。

本地 smoke 完成了桌面 HUD、同键菜单、制作缺料、移动端生存菜单与暂停/存档设置入口的可见点击检查；没有把短时 smoke 冒充完整真人流程。Toy 预览生成后仍需复核首屏、嵌套资源、390×844、844×390、导出准备与控制台；审核通过后再在生产 URL 复核 Pointer Lock、云存档和跨设备恢复。

## 6. 原创 OG 图与宿主数据披露

`public/og-canopy-first-night.png` 是使用 OpenAI 内置图像生成工具制作的原创社交分享图，画面为风格化低多边形雨林营地、坠毁飞行器、幸存者剪影、暴雨、溪流和远处气象站。生成提示明确排除文字、Logo、官方游戏资产和可识别原作角色；来源、日期与用途记录在 `public/assets/licenses.json`。该图片已接入 Open Graph 与 Twitter 元数据。

页面进入可交互阶段后会从 `https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js` 请求 Toy 平台提供的外部 SDK；该网络请求和 SDK 本身受平台条款约束。项目代码采用本地优先存档：

- 普通网页环境把随机设备标识、已学配方和版本化自动存档保存在浏览器本机。
- Toy 宿主桥接可同步随机设备标识和完整存档，并接收开始、继续、胜利、失败动作事件。
- Toy 云存档把逻辑值压缩、base64 编码并透明拆分为每值不超过 1024 UTF-8 bytes 的物理记录，整套协议不超过 128 键；manifest 校验块数、编码、原始字节数和校验和。
- SDK 不可用、超时、返回无效数据或拒绝请求时，游戏继续使用本地存档；云失败不回滚已成功的本地写入。
- 项目代码不请求姓名、邮箱或精确位置。外部脚本请求本身可能包含浏览器通常发送的网络元数据，适用平台的隐私与服务条款。

## 7. 发布后填写的记录

以下字段只能由真实外部发布结果产生，本地门禁不能预填：

| 字段 | 发布记录 |
|---|---|
| 发布 commit SHA 与 commit URL | `PUBLISH-TIME` |
| GitHub PR URL、编号与最终状态 | `PUBLISH-TIME` |
| GitHub 仓库 URL | `PUBLISH-TIME` |
| GitHub Actions Pages run ID / URL / 结论 | `PUBLISH-TIME` |
| GitHub Pages 最终 URL | `PUBLISH-TIME` |
| Sites 项目 ID、部署 ID 与最终 URL | `PUBLISH-TIME` |
| Toy 项目 ID、版本 ID 与最终 URL | ID `10228414336000`；本轮 preview/status `PUBLISH-TIME`；生产 URL `https://www.bilibili.com/toy/green-hell-web/index.html` 待审核通过后复测 |
| 各线上 URL 的资源加载、直接刷新与控制台 smoke | `PUBLISH-TIME` |
| 线上存档刷新恢复与 Toy 云降级 smoke | `PUBLISH-TIME`；正式 Toy 云同步与跨设备恢复仍需生产版复测 |
| 飞书通知的目标会话、发送时间与消息摘要 | `PUBLISH-TIME` |

若线上 smoke 出现启动、仓库子路径资源或存档回归，应回滚到上一个已知可用版本，而不是直接修改生成文件。

## 8. 权利边界

发布物只包含原创代码、程序化视觉/音频、原创生成社交图和仓库资产清单中已记录的内容。不发布《Green Hell》的截图、地图、剧情、文本、模型、贴图、图标、音乐、录音或商标化包装。研究文档对原作名称的使用仅用于机制比较与来源说明。
