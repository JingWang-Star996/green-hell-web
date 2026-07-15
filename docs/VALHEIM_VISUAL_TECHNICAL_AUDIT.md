# CANOPY：Valheim 启发的视觉技术审计

日期：2026-07-14
状态：研究与代码审计完成；等待 gameplay gate 后实施；执行预算与停止条件已移交 `VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md`

## 1. 结论

CANOPY 现在缺的不是“更多三角面”，而是四件更基础的事：

1. 连续地貌，而不是逐区块跳变的群系标签。
2. 树群、林隙、林缘、岩台与水道构成的中观空间节奏。
3. 真正兑现树种、年龄、岩性和 `visualVariant` 的轮廓差异。
4. 天空、太阳、环境光、雾、雨、湿润、火光与音景之间的统一关系。

Valheim 官方可证的 **[F]** 是：其风格把低分辨率纹理、稀疏多边形细节与现代材质、光照、后处理结合，而不是单独依靠低多边形。“有限资产、强规则、强构图、强氛围”是 CANOPY 对公开结果的 **[I] 工程归纳**，不是其私有实现的公开事实。

参考：

- [Valheim 官方 FAQ](https://valheim.com/zh/faq/)
- [Valheim Steam 页面](https://store.steampowered.com/app/892970/Valheim/)
- [Valheim 1.0 FAQ](https://valheim.com/support/valheim-1-0-faq/)
- [Valheim Asset Bundle FAQ](https://www.valheimgame.com/support/modding-faq-for-the-asset-bundle-update-0-217-40/)
- [Valheim Ashlands 世界更新说明](https://valheim.com/support/getting-ready-for-the-ashlands/)

体积必须并列写清时间和口径：当前 Steam Windows 系统需求仍显示 `1 GB available space`；官方 2026-07-01 的 1.0 FAQ 则预计未来 1.0 多数平台下载约 4.3GiB。前者是当前商店存储需求字段，后者是 1.0 预计下载量，不能互相替代，也都不是 CANOPY 的设计目标。

## 2. 当前代码事实 [F]

### 2.1 值得保留的基础

- 树、岩石和植物已经共享稳定语义 ID 与生成计划。
- 已有 `InstancedMesh`、sRGB、ACES、指数雾和 1024² 方向光阴影。
- 标准档 5×5、低端档 3×3 活跃区块。
- 已有 rolling frame median/p95/p99、draw call、triangle 诊断。
- 当前基础几何便宜，仍有轮廓升级的三角面余量。

### 2.2 P0：群系不是连续地理区域

`generateChunkDescriptor` 目前对每个区块的 elevation、moisture、canopy 独立散列，再由阈值决定群系。旧审计对 renderer 初始占位 seed `canopy-living-forest-v1` 的 41×41、共 1681 区块代码抽样得到：

- 相邻边同群系比例仅 30.24%。
- 相邻 elevation descriptor 平均跳差 0.343。
- 最大跳差 0.980。

这些数字是确定性代码抽样，不是视觉主观判断。它会生成棋盘式群系，而不是山脉、河谷、沼泽带或森林腹地。

红队复核发现该 seed 不是 `createInitialState()` 的默认新游戏 seed。对默认新游戏 seed 字符串 `1` 的同规格结果为：相邻同群系 `29.9085%`、平均 elevation 跳差 `0.329917`、最大跳差 `0.998833`、单格群系岛 `32.0842%`。以后必须显式报告 seed；复现命令见执行协议。

实际地形高度又来自 `RainforestRenderer.terrainHeight` 的全局正弦、硬编码山脊、平台和固定河流，没有消费 `SemanticTerrainIntent`；固定 `riverCenter` 也不读取 semantic `waterPresence`。`generateChunkVisualPlan` 仍生成 trees/shrubs/rocks，但 `createChunkView` 当前只消费 ground/water。当前结果是：玩法/配色群系随机跳变，地形却始终是另一张正弦地毯，且旧视觉 spawn 计划成为未兑现数据。

### 2.3 P0：语义形态存在，交互对象渲染没有兑现

`semanticGeneration.ts` 已经生成树种、年龄、岩性、植物类型和 `visualVariant`；但 `SemanticInstanceLayer` 目前仍是：

- 所有树共享 Cylinder + Icosahedron。
- 所有岩石共享 Dodecahedron。
- 所有植物共享 Cone。
- 所有微型地被共享小 Dodecahedron。

`visualVariant` 进入了 batch key，却没有真正为树、岩石或可采植物选择不同几何；它目前只对 micro-clutter 的前缀颜色/pebble cluster 有实际分支。当前“三角面森林”的核心问题不是面数，而是交互对象轮廓语义没有兑现。

### 2.4 P1：缺少中观构图与负空间

对象仍主要在区块矩形内均匀随机撒点，缺少：

- 树群、林隙和林缘。
- 倒木带、岩石露头和沿河植被。
- 山脊稀疏带和可通行视线走廊。
- 跨区块连续的群落中心。

因此画面没有“压迫—发现空地—进入新群落”的前景/中景/远景节奏，也不能用构图帮助导航和资源预判。

### 2.5 P1：当前更接近 draw-call 受限（红队重算）

旧估算的约 125 语义 draw / 161 总 draw / 61,176 triangles 已被最近的树木和岩石生命周期池推翻。当前每个非空区块固定创建：树 5 个 mesh、岩石 3 个（body/accent/rubble）、植物 1 个、clutter 1 个，即 10 个语义 mesh。

运行：

```powershell
node --import tsx scripts/visual-world-audit.ts --seed 1 --grid-radius 20 --active-radius 2 --detail standard
```

当前 5×5、seed `1` 的**静态源模型 inventory**为：

- 1093 个语义对象。
- 250 个语义 main-pass draw inventory。
- 加 25 ground、4 puddle、5 river 后，已知 main-pass draw inventory 284。
- 已知 main-pass triangle inventory 170,152，其中语义实例 162,288。
- 标准档语义 mesh 全部投影时，阴影最坏还可能增加 250 submissions / 162,288 triangles。

这不是浏览器 GPU profiling，也不是“当前画面一定绘制 534 calls”：静态 inventory 不考虑主/阴影视锥裁剪，并排除了地标、动物、建筑、手持物、粒子和 UI。它包含缩放到 `0.001` 的生命周期预留实例。它只证明在增加轮廓前必须先重构活跃环实例池。

另外，任一 sparse semantic state signature 改变都会 remove/recreate 整个区块语义 mesh，而不是只更新一个 slot；连续采集和跨区时必须专门测分配、Long Task 和 GC。

### 2.6 P2：还没有真正的距离层级

当前只有启动时的低端/标准二分，没有：

- 0–8m 的焦点交互细节层。
- 8–35m 的完整近景。
- 35–90m 的简化中景。
- 90–180m 的冠层/地貌代理。
- LOD 滞回和运行时动态质量控制。

CANOPY 是第一人称。第三人称游戏可以接受的近景简化，在 0–3m 的砍树和采矿中会直接暴露。

## 3. 研究阶段实施顺序 [D]（已被执行协议细化）

本节是 CANOPY 的工程设计，不是 Valheim 实现事实。当前实际顺序拆为 gameplay G0 → 测量 V0 → 实例池 V1A → 版本化连续世界 V1B → 原创剪影/群落/天气；以 `VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md` 为准。

### V1：连续世界与渲染底座

1. 版本化世界生成器。
   - 老存档固定使用 v1。
   - 新世界显式使用 v2。
   - 不对已有世界静默替换生成器。
2. 新增唯一连续世界场 `worldFields.ts`。
   - elevation、ridge/valley、moisture、canopy、slope、curvature、waterDistance、biome weights 一次查询。
   - 生成、碰撞、移动、水体和渲染共同消费。
3. 先重构实例池。
   - 从“每区块每家族一批”改为“活跃环内每个 variant/LOD 一池”。
   - 单个资源变化只更新对应 slot，不重建整块。
4. 建立近中远三环与滞回。
5. 建立低成本天空穹顶、移动日月、群系/天气/冠层雾和夜间可读性底线。

V1 门槛：

- v2 共享区块边高度误差 `<1e-4`，边界法线夹角 `<3°`。
- 41×41 样本相邻同群系边比例 65%–85%，单区块孤岛 `<5%`。
- 世界基础 draw calls `≤90`；总场景 median `≤140`、p95 `≤180`。
- 固定 12 张前后对照截图。
- HUD 关闭后，评审者两秒内能识别至少 4/5 群系。

### V2：群落构图与原创形态

程序化负责：

- 候选网格、空间哈希、跨区 halo。
- 群落中心、树群、林隙、林缘、倒木带、岩石露头和视线走廊。
- 年龄、倾斜、色偏、风相位和刚度。
- 资源与危险沿坡度、湿度、水道和群落边缘分布。

少量原创资产负责：

- 三个树种，每种 2–3 个核心剪影。
- 板根、叉干、细高棕榈和倒木构件。
- 每种岩性两个轮廓。
- 重点植物各两个叶片/花型。
- 一张 256–512px 植被图集和一张地表/mask 图集。

V2 门槛：

- 每个 `visualVariant` 在剪影上真实可区分。
- 20 个固定 seed 的眼平 contact sheet 无连续三棵完全相同组合。
- 抽样 30 个树/石，100% 满足“相似外形 → 相同基础动词”。
- 连续穿越十区块无整块 pop 或 GC 卡顿。
- 热身后无 `>50ms` Long Task；跨区挂载每帧 `≤4ms`。

### V3：地表、天气与感官闭环

- 世界空间 UV、坡度/曲率/湿度混合和低清地表图集。
- 统一 wetness 参数驱动粗糙度、压暗、水边和低地反馈。
- 从 `waterDistance` 生成连续河流 strip，而不是区块水面圆片。
- 雨滴响应风向、冠层遮蔽和地面 splash。
- 树冠轻量风摆；树干和硬岩不摆。
- 单一轻量后处理 pass；不先上 SSR、SSAO 或重体积光。
- 群系/昼夜/天气音景与有限空间声源。

## 4. 性能预算（已被执行协议取代）

下表是早期提案，与 `VALHEIM_VISUAL_WORLD_STUDY.md` 曾存在 draw-call 冲突，不再作为 gate。当前唯一预算、相对回退、采样方法和停止条件位于 `VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md` 第 6–8 节。

| 指标 | 标准桌面 1080p | 低端 720p / DPR 1 |
|---|---:|---:|
| frame median / p95 / p99 | ≤16.7 / 22 / 33ms | ≤33.3 / 40 / 55ms |
| 世界基础 draw | ≤90 | ≤70 |
| 总 draw median / p95 | ≤140 / 180 | ≤100 / 120 |
| 可见三角面 typical / peak | ≤250k / 500k | ≤150k / 200k |
| 阴影三角面 | ≤120k | ≤40k 或关闭 |
| GPU 纹理估算 | ≤64MB | ≤32MB |
| 热身后 JS heap | ≤220MB，10 分钟增长 <10% | ≤180MB |
| `>50ms` Long Task | 0 | 0 |
| 首屏关键资源 | ≤8MB | ≤8MB |
| Toy 总包目标 | ≤30MB | ≤30MB |

当前 rolling p95/p99 只能作 HUD 提示，不能作发布证据。里程碑测量必须固定硬件、Chrome、build、seed、路线、天气和分辨率；迭代跑 3×90 秒，里程碑跑 5×10 分钟。

## 5. 明确不做

- 不复制 Valheim 的资产、shader、配色、模型或独特构图。
- 不把“低多边形”理解为所有树共享一个几何。
- 不用浓雾、全黑夜晚或 bloom 掩盖平地形和重复资产。
- 不照搬 Unity Asset Bundle；当前先做 Web 资产注册表和缓存。
- 不在已有存档上静默替换世界生成器。
- 不先做 SSR、SSAO、重体积光和大量透明叶片。
- 不用无限面积替代群系质量。

## 6. 当前边界

本审计完成了代码分布抽样、draw-call/triangle 推导和工程方案；没有完成浏览器截图、GPU profiling 或视觉盲测。所有 FPS、GPU、内存和截图门槛仍必须在可用浏览器环境中实测后才能宣称通过。
