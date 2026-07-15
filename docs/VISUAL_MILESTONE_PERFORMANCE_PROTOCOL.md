# CANOPY 原创雨林视觉里程碑与性能协议

日期：2026-07-14

状态：**视觉实施的唯一执行口径；当前被 gameplay gate 阻挡**

适用范围：Three.js 世界生成、地形、实例、光照、天气、音景和视觉资产；不授权公开发布、引擎迁移或存档破坏性迁移。

`VALHEIM_VISUAL_WORLD_STUDY.md` 是参考研究，`VALHEIM_VISUAL_TECHNICAL_AUDIT.md` 是代码审计。本文件取代两者中互相冲突的预算和实施门槛。Valheim 只提供方法启发；CANOPY 不复制其资产、shader、配色、模型、地图、构图或其他独特表达。

## 1. 前置 gameplay gate

视觉研究、文档和纯诊断可以继续；任何改变运行时画面的 V0+ 工作必须等以下证据齐全：

- 树、岩石、资源植物满足“相似外形 → 相同基础动词”，工具不足只改变效率或明确阻挡，不制造真假景物。
- 世界操作经过 windup / hit window / recovery，并能因目标丢失、暂停或失去可见性中断；一次输入至多提交一次结果。
- 至少一种非脚本动物能被预判、攻击、死亡、留下可收集尸体，并在离开区块和重载后保持正确状态。
- 树木、岩石、尸体、建筑和关键进度的 sparse delta 能存档、重载，旧世界不会被新生成器静默改写。
- 30 分钟 `PLAYTEST_RUBRIC.md` 路线没有同形异义、纯距离伤害、不可解释阻挡或视觉反馈与模拟结果分裂。
- `npm run typecheck`、`npm test`、`npm run lint`、`npm run build` 全部通过。

只要其中一项没有证据，视觉工作保持在研究/诊断，不用更漂亮的雾、黑夜、粒子或材质掩盖玩法问题。

## 2. 证据分级

后续文档、PR 和里程碑报告统一使用四类标签：

- **[F] 可证事实**：官方一手资料的公开陈述，或当前仓库中可定位、可重复运行的代码行为。
- **[I] 工程推断**：由事实推导出的风险或方向，必须写出前提，不能冒充 Valheim 的私有实现。
- **[D] CANOPY 设计选择**：我们为原创热带雨林、玩法可读性和 Web 约束做的决定。
- **[M] 实测结果**：固定硬件、浏览器、build、seed、路线和采样协议所得数据；静态估算、HUD 瞬时读数和主观感受不能标为 [M]。

本文实际依赖的 Valheim 公开事实只有：官方 FAQ 对其风格的公开描述；官方商店对程序生成世界、差异群系和玩法循环的描述；官方资产管理 FAQ 对特定版本的说明。连续噪声场、LOD 距离、实例池结构、shader 算法和群落生成细节没有本文可引用的官方证据，均不能写成“Valheim 就是这样实现的”。

## 3. 红队代码基线

### 3.1 棋盘式群系是代码事实

**[F]** `generateChunkDescriptor` 对每个整数区块分别散列 elevation、moisture 和 canopy，再用阈值选群系；它没有连续世界场。当前两组明确的本地代码基线是：

| 41×41 seed | 同群系正交边 | elevation 平均/最大边跳差 | 单格群系岛 |
|---|---:|---:|---:|
| 默认新游戏 `1` | 29.9085% | 0.329917 / 0.998833 | 32.0842% |
| renderer 初始占位 `canopy-living-forest-v1` | 30.2439% | 0.342626 / 0.979764 | 30.7035% |

复现：

```powershell
node --import tsx scripts/visual-world-audit.ts --seed 1 --grid-radius 20 --active-radius 2 --detail standard
```

旧审计的 `30.24% / 0.343 / 0.980` 来自第二行，不是 `createInitialState()` 的默认新游戏 seed。以后报告必须显式写 seed。

### 3.2 存在 dual terrain truth

**[F]** 世界至少有三组没有统一的地理真相：

1. `semanticGeneration.ts` 暴露 `SemanticTerrainIntent`（biome/elevation/moisture/canopy/waterPresence）。
2. `RainforestRenderer.terrainHeight` 用全局正弦、固定山脊、气象站平台和固定河切计算高度；移动、建筑、动物、语义对象 Y 值和地形网格都调用它。
3. `RainforestRenderer.riverCenter` 固定一条正弦河；它不消费 `SemanticTerrainIntent.waterPresence`。

`createChunkGround` 用 renderer 高度塑形，却按逐区块 biome profile 着色。因此高度可跨边连续，玩法/配色群系仍会在 48m 边界跳变。`generateChunkVisualPlan` 还生成 trees/shrubs/rocks，但 `createChunkView` 当前只消费 ground/water；这些 spawn 是未兑现的旧视觉计划，不能作为场景事实。

**[I]** 如果直接“把地形做漂亮”，碰撞、导航、河流、资源分布、存档身份和渲染会继续分裂。视觉 V1B 必须先建立版本化的共享 world field，并由所有消费者读取。

### 3.3 `visualVariant` 对交互对象基本未消费

**[F]** 语义生成器为树、岩石、植物各产生多个 `visualVariant`，render plan 也把它放进 `batchKey`；但 `SemanticInstanceLayer` 对交互对象仍固定使用：

- 树：一套 Cylinder trunk + Icosahedron crown，以及同几何的 stump/branch/log 生命周期预留池。
- 岩石：一套 Dodecahedron body + Box accent + Dodecahedron rubble。
- 植物：一套 Cone。

`visualVariant` 在该文件中只对 micro-clutter 的前缀颜色/pebble cluster 有实际分支。它没有为树、岩石或可采植物选择不同剪影；`batchKey` 也没有驱动 mesh 分组。

**[D]** V2 的目标不是增加字符串变体，而是让每个交互变体在 0–3m 第一人称距离拥有可辨剪影，同时继续满足“同形同基础动词”。

### 3.4 当前先受 draw submission 结构限制

**[F]** 最近的树木生命周期和岩石 partial/exhausted 表达增加了固定实例池：每个非空区块为树 5 个 mesh、岩石 3 个、植物 1 个、clutter 1 个，共 10 个语义 mesh。当前 5×5 静态源模型为：

| seed | 语义对象 | main draw inventory | main triangle inventory | 最坏 shadow 语义 submission / triangles |
|---|---:|---:|---:|---:|
| 默认新游戏 `1` | 1093 | 284 | 170,152 | 250 / 162,288 |
| renderer 初始占位 `canopy-living-forest-v1` | 1104 | 286 | 172,402 | 250 / 164,556 |

main draw 包含语义池、25 ground 和当前命中的 puddle/river 批次；两行都来自同一可重复脚本。

低端 3×3、seed `1` 的对应 inventory 为 403 个语义对象、104 main draws、45,024 main triangles，且当前低端档关闭语义阴影。复现时改用 `--active-radius 1 --detail low`。

这是**静态源模型上界**，不是 GPU profile：它包含缩放到 `0.001` 的生命周期预留实例，不考虑主/阴影视锥裁剪，也不计地标、动物、建筑、手持物、粒子和 UI。旧文档中的约 125 语义 draw、161 总 draw、61,176 triangles 已经过时。

**[F]** 任一 semantic runtime signature 改变时，`SemanticInstanceLayer.sync` 会 remove/recreate 整个受影响区块，而不是只改一个 slot；这是跨区和连续采集的分配/卡顿风险。

**[I]** 在增加任何树/岩剪影前，V1A 必须把“每区块每类别多池”改为活跃环级 variant/LOD 池，并让对象状态只更新稳定 slot。否则美术变体会继续乘 draw call。

### 3.5 当前 HUD 不是性能证据

**[F]** `updateDiagnostics` 只保留最近 90 个 rAF delta，每 500ms 取一次当前 `renderer.info`；它没有保存逐帧 draw/triangle、跨区事件、Long Task、GPU 时间或内存序列。

**[I]** HUD 适合发现异常，不足以验收。V0 必须先建立可下载的 benchmark JSON 或等价浏览器 trace，再允许性能结论标为 [M]。

## 4. 原创热带雨林方向

CANOPY 的视觉目标不是“热带版 Valheim”，而是让玩家能读出水、冠层、坡度、湿度、动物活动和人造痕迹之间的因果。

### 4.1 五条原创支柱

1. **垂直湿润层次**：板根/浅根、树干、藤本、附生层、冠层缺口共同塑造 0–30m 的垂直空间，而不是锥体树阵。
2. **水塑地貌**：河漫、黑水洼地、冲沟、湿坡和岩脊决定路线、材料、危险和雾，不把水当随机圆片。
3. **压迫—释放—再压迫**：密下木、林缘、林隙、河岸和高地远眺交替出现，为导航和营地选择服务。
4. **生态痕迹先于实体**：足迹、啃食、折枝、叫声、泥印和食物残迹提示动物链；不是只让模型在地面移动。
5. **可交互语言优先**：材质、尺度、破损、轮廓和局部运动帮助判断“是什么、能做什么、当前状态如何”，装饰层永不伪装成离散资源。

### 4.2 视觉签名必须服务玩法

每个群系都要有地形轮廓、冠层高度、下木密度、水关系、主导剪影、湿润响应、昼夜声场、危险预告、资源预测和夜间可读下限。一个差异若只换颜色、不能服务导航/交互/生态/天气中的至少一项，就不进入生产。

原创审查使用 silhouette、value grouping、路线可读性和生态因果，不用与 Valheim 截图做像素或配色相似度目标。任何生成资产都要保留提示词、来源、授权状态、人工修改记录和包体成本；禁止输入或重制 Valheim 受保护资产。

## 5. 分阶段最小纵切

### G0 — 玩法可信度（当前阶段）

交付：第 1 节 gameplay gate 的全部证据。

停止：任一同形异义、动作重复提交、尸体/世界状态重载丢失，继续玩法修复，不进入视觉 runtime。

### V0 — 基线与 Visual Bible（玩法 gate 后）

最小纵切：不改变成片画面；固定 20 个 seed、12 个机位、5 条性能路线和标准/低端两个档，保存 before contact sheet 与 benchmark JSON。

当前离线 fixture/静态诊断入口已经实现，命令、字段和真实性边界见 `VISUAL_V0_REPRODUCIBLE_BASELINE.md`。它只完成可复现协议与静态/仿真 JSON；`browserCapture` 明确为 `not-captured`，不能作为下述 production 浏览器性能与截图交付的替代。

交付：

- 原创雨林 Visual Bible：五群系签名、三档距离、昼夜/雨、交互轮廓和禁止项。
- production build 的帧、draw、triangle、Long Task、JS heap、纹理估算、包体基线。
- route/save/weather/time fixture 的版本和哈希；测试者能重跑同一路线。

通过：三次 90 秒同场景采样的 frame median 变异系数 ≤5%，p95 变异系数 ≤10%；字段齐全且无 seed/设置歧义。

停止：无法复现、浏览器仍不可用、或基线已经超出第 6 节硬目标；此时只做诊断/优化，不做视觉增量。

### V1A — 活跃环实例池（不改变世界身份）

最小纵切：只迁移 tree/rock 两类到活跃环级共享池，维持现有几何、颜色、ID、碰撞、命中和存档结果。

通过：

- 采集一次只更新相应 slot，不重建整区块 mesh。
- 十区块往返无整块 pop；热身后无 `>50ms` Long Task。
- 固定路线总 draw p95 ≤180；若未达标，至少比 V0 降低 35%，且不得继续加视觉变体。
- 同一存档前后对象 ID、位置、quantity、tree/rock lifecycle 完全一致。

停止：slot 复用导致错物高亮/命中、跨区对象串位、GPU buffer 持续增长或存档身份变化，回退并修正池协议。

### V1B — 版本化连续世界场（用户/存档决策 gate）

最小纵切：一个 evergreen → river-wetland 的两区块边界；共享 elevation/ridge/valley/moisture/canopy/waterDistance/biome weights，地形、移动、河流、生成、碰撞和渲染读取同一查询。

通过：

- v1 世界保持 v1；新世界显式选择 v2，不静默迁移。
- 共享边高度误差 `<1e-4`，边界法线夹角 `<3°`。
- 41×41 多 seed 样本相邻同群系边目标 65%–85%，单格岛 `<5%`；这些是 CANOPY 设计阈值，不是 Valheim 事实。
- 河道、水存在、湿度和资源分布不再互相矛盾。

停止：需要破坏旧存档、同一点被不同系统查询成不同高度、或 v2 规则尚未版本化。此 gate 涉及世界身份，必须由用户确认迁移策略。

### V2 — 第一组原创剪影

最小纵切：板根硬木 2 个年龄剪影 + 一种岩性 2 个破碎态 + 一种阔叶药草 2 个生长态，只覆盖一个固定林隙。

通过：

- 眼平 0–3m、10m、35m 三距离都能读出类别/状态；`visualVariant` 实际选择几何或组合，不只换字符串/颜色。
- 30 个树/石盲测 100% 满足同形同基础动词；两秒内预测基础 verb ≥90%。
- 20 seed contact sheet 不出现连续三棵完全相同的剪影/比例/倾斜组合。
- 相对 V1A 同路线：frame p95 回退 ≤5%，draw p95 不增加超过 10%，Toy 包增量 ≤4MB。

停止：近距离砍树/采矿反馈变差、剪影与碰撞不一致、或需要为每对象独立材质/draw。

### V3 — 中观群落与路线

最小纵切：一个 3×3 区域中的树群—林缘—林隙—河岸走廊；资源和危险只沿共享地貌/生态字段分布。

通过：HUD 关闭后 2 秒内可指出可走方向、水方向和一个资源机会；十区块路线无区块矩形边、重复棋盘或全块 pop。

停止：构图只改变装饰、不改变导航/预测，或群落算法生成不可交互的“资源替身”。

### V4 — 天气与感官闭环

最小纵切：同一林隙的晴 → 强雨 → 雨后湿润；天空、雾、冠层摆动、雨向、落地、水面、湿润参数和声场共享天气状态。

通过：夜间路径可读但火把仍有价值；雨不穿透明确遮蔽；低端档关闭可选效果后仍保留天气信息。

停止：靠浓雾、全黑、bloom 掩盖重复/平坦；或先引入 SSR、SSAO、重体积光和大量透明叶片。

### V5 — 扩到五群系

只有 V2–V4 单一走廊通过玩家审查和性能 gate 后，才扩充五群系、完整音景和更多资产。这是审美/规模 gate；若两条原创方向没有客观优胜，返回用户选择。

## 6. 性能预算

这些是 V1A 后的设计/发布目标，不是当前实测状态。

| 指标 | 标准档 | 低端档 |
|---|---:|---:|
| drawing buffer / 有效 DPR | 1920×1080 / 1.0 | 1280×720 / 1.0 |
| frame median / p95 / p99 | ≤16.7 / 22 / 33ms | ≤33.3 / 40 / 55ms |
| Three.js `render.calls` median / p95 | ≤140 / 180 | ≤100 / 120 |
| Three.js `render.triangles` typical / peak | ≤250k / 500k | ≤150k / 200k |
| shadow triangles | ≤120k | ≤40k 或关闭 |
| resident texture byte estimate | ≤64MB | ≤32MB |
| JS heap（分钟 2→10） | ≤220MB，增长 <10% | ≤180MB，增长 <10% |
| `>50ms` Long Task（热身后） | 0 | 0 |
| chunk sync CPU slice p95 / max | ≤4 / 12ms | ≤8 / 20ms |
| 首屏关键传输（实际压缩） | ≤8MB | ≤8MB |
| Toy 解包总包目标 / 硬上限 | ≤30MB / <140MB | ≤30MB / <140MB |

约束：

- 若 V0 已超目标，后续只允许降低成本的 V1A，不允许以“相对没有更差”为由继续加内容。
- 另跑一次 DPR 1.5 作为 HiDPI 压力场景，但不把它和 1080p 参考档混在同一分布。
- 每个视觉 slice 必须同时满足绝对预算和相对回退：frame p95 ≤+5%、draw p95 ≤+10%、JS heap ≤+10%、Toy 包单阶段 ≤+4MB。
- `renderer.info` 是否包含阴影 pass 必须在 V0 用 shadows on/off 对照确认；报告沿用同一 Three.js 版本和口径。
- texture MB 是按尺寸、格式、mip、cube/layer 计算的 resident estimate，不得写成实测 GPU 总内存。
- rAF frame interval 不是 GPU time。只有 `EXT_disjoint_timer_query_webgl2` 可用且无 disjoint 时才报告 GPU time；否则标 `unavailable`。

## 7. 固定采样协议

### 7.1 记录环境

每个结果必须附：commit、production build hash、OS、Chrome 完整版本、CPU/GPU/RAM、电源模式、窗口尺寸、DPR、质量档、seed、save/fixture hash、玩家坐标/朝向、时间、天气、建筑/动物数量、扩展是否禁用。CPU throttle 只标“压力测试”，不能冒充低端 GPU。

### 7.2 场景

- `S0 forest-still`：新游戏 seed `1`，正午晴，林内固定机位 90 秒。
- `S1 crossing`：固定输入穿越 10 个区块并原路返回，覆盖语义变更和 chunk sync。
- `S2 camp-50`：50 个建筑、火与三盏局部灯的营地环视。
- `S3 ecology`：达到当前上限的动物/尸体/掉落物，包含一次战斗和收集。
- `S4 weather-night`：同一机位晴、强雨、雨后、黄昏和夜各一段。

V0 固定 fixture 可以由开发/测试入口设置，但不得进入正式玩家 UI，不得改变模拟结果。20 seed × 12 camera 的 contact sheet 用于视觉回归；性能不跑完整笛卡尔积，只跑以上五条最坏/代表路线。

### 7.3 次数与统计

1. 使用 production build；每次启动后热身 60 秒，等待 shader/首批 chunk/音频解码稳定。
2. 日常迭代：每场景 3×90 秒。里程碑：每场景 5×10 分钟。
3. 保存逐帧 frame interval、draw、triangles；保存 Long Task、chunk sync mark、heap 时间序列和场景事件。
4. 每次 run 分别算 median/p95/p99；汇报 run-median 的中位数、最差 run 的 p95/p99和全部异常峰值，不把多次 run 混成一个漂亮分布。
5. 同一候选与 baseline 交替执行，避免热、后台进程或浏览器更新造成单向偏差。

当前 HUD 不满足第 3 项。V0 需要 benchmark capture；在它完成前，可用 Chrome Performance trace 辅助定位，但结果必须写明手工步骤和缺失字段。

### 7.4 内存与包体

- JS heap：优先 `performance.measureUserAgentSpecificMemory()`；不可用时用 Chrome heap timeline 或 `performance.memory.usedJSHeapSize`，并标“Chrome 近似”。比较分钟 2 与分钟 10 的稳定区间和线性趋势。
- GPU/纹理：记录 `renderer.info.memory` 数量；字节由共享 geometry attributes/index、instance buffers、texture format/尺寸/mip 计算。没有 GPU profiler 时不报告“GPU 总内存”。
- Toy 解包体积：

```powershell
$files = Get-ChildItem toy-out -Recurse -File
[pscustomobject]@{ files = $files.Count; bytes = ($files | Measure-Object Length -Sum).Sum }
```

- 首屏传输体积来自 production host 的浏览器 Network/Resource Timing（按实际 content encoding），不能用源码或解包体积替代。

## 8. 全局停止条件

出现任一项，停止视觉扩张并回到前一 gate：

1. gameplay gate 回归：同形异义、动作/碰撞/反馈分裂、世界/尸体/建筑状态不持久。
2. 想在没有 generator version、旧存档策略和用户确认时替换世界场。
3. 三次基线 frame median 变异系数 >5% 或 p95 >10%，无法分辨代码变化与环境噪声。
4. V0 超出硬目标但团队仍试图加资产/效果，而不是先完成 V1A。
5. 热身后出现任意 `>50ms` Long Task、十分钟 heap 增长 ≥10%，或跨区错位/pop。
6. 一个视觉差异不服务交互、导航、生态、天气或明确氛围目标。
7. 近景树/石剪影与 collider/anchor 不一致，或视觉状态领先/滞后模拟状态。
8. 单阶段包体增加 >4MB、总包超过 30MB 目标，或按路线预计接近 140MB 硬上限。
9. 需要复制 Valheim 或其他游戏的受保护资产、shader、配色、地图、模型、音频或独特构图。
10. 两个审美方向都合理而无客观胜负；在扩到五群系前返回用户做视觉 gate。

## 9. 一手来源与边界

- Valheim 官方 FAQ（风格；每群系玩法循环）：https://valheim.com/zh/faq/
- Valheim 官方 Steam 页面（程序生成世界、差异群系、当前系统需求）：https://store.steampowered.com/app/892970/Valheim/
- Valheim 1.0 官方 FAQ（2026-07-01；预计多数平台约 4.3GiB，并提及 zone load/unload microstutter 优化）：https://valheim.com/support/valheim-1-0-faq/
- Valheim 官方 Asset Bundle / Soft Reference FAQ（2024-03-12）：https://www.valheimgame.com/support/modding-faq-for-the-asset-bundle-update-0-217-40/

体积口径必须写清：当前 Steam Windows 系统需求仍显示 `1 GB available space`；2026-07-01 的 1.0 FAQ 描述的是 1.0 在多数平台**预计**约 4.3GiB。两者不是同一个测量对象，也都不能直接成为 CANOPY 的包体目标。

资产管理口径也必须写清：官方 2024 FAQ 说明 Soft Referencable Assets、Asset Bundles 和引用计数，但当时明确只有 Locations/Rooms 动态装卸，ObjectDB/ZNetScene 仍常驻。我们选择 Web 资产注册表、共享缓存和活跃环释放是 [I]/[D]，不是复刻其 Unity 私有系统。
