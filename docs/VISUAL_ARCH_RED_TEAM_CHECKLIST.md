# CANOPY 视觉/世界流送架构红队清单

日期：2026-07-15
状态：审计完成；只提出约束与测试，不修改 renderer/world 生产代码
适用 gate：V1A 活跃环实例池，以及其后的 V1B 版本化连续世界

## 证据边界

- 已审阅 `VALHEIM_VISUAL_WORLD_STUDY.md`、`VALHEIM_VISUAL_TECHNICAL_AUDIT.md`、`VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md`、`visual-world-audit.ts`、`SemanticInstanceLayer`、`RainforestRenderer`、semantic generation/render/save/streaming 与相关测试。
- 本轮实跑语义实例、倒木、流送、长距离差分存档测试：11/11 通过。
- seed `1`、标准 5×5 静态审计复核为：1093 个语义对象、284 个已知 main-pass draw inventory、170,152 个 main-pass triangle inventory；潜在语义 shadow inventory 另有 250 submissions / 162,288 triangles。
- 上述 draw/triangle 是源码 inventory，不是浏览器 GPU profile；地标、动物、建筑、手持物、粒子、UI 与透明 overdraw 都未计入。
- Valheim 官方 1.0 FAQ 可证的是：官方把减少 zone load/unload microstutter 与更快保存列为优化项；旧存档可保留，但已探索区域不会完整获得新的 biome generation，官方建议最佳体验使用新世界。这里仅把它转译为 CANOPY 的测试与版本约束，不推测其 Unity 私有实现。

## P0：V1A 前必须锁死

### 1. 对象池不是“只影响画面”

当前模拟层负责最终 physical-hit 结算，但 renderer 的语义 collider 同时参与：

- 玩家移动碰撞；
- 视线遮挡与焦点选择；
- 建筑放置阻挡；
- 掠食者接触阻挡；
- 语义对象的 focus/impact 实例颜色。

因此必须先定义以下池协议：

- 活跃对象的 `id -> slot` 与 `slot -> id` 始终双射；一个 ID 只能有一个 live record。
- ID 是权威，slot 只是短生命周期渲染地址；交互、存档和 collider 不得持久化 slot。
- 对象在活跃环内时保持 slot，离环后才释放；复用槽之前先清 matrix、color、focus、impact、collider 与 lifecycle binding。
- `playImpact` 的延迟回调必须携带 record generation/epoch。旧对象的 170ms 回调不得染色刚复用该槽的新对象。
- focus 继续由 simulation 投影的 `entityViews`/anchor 决定，不能改成依赖 `InstancedMesh.instanceId` 的第二套玩法身份。
- standing tree、fallen capsule、stump、full/partial/exhausted rock 的 collider 必须从逻辑 ID/lifecycle 重算，不能从槽中残留。
- 每个可交互对象的 instance matrix、interaction anchor、focus marker 与 collider 必须落在同一地形查询上。
- collider 查询不能暴露可变的 pool 内部数组，但也不能继续在每个候选上深拷贝整圈 collider；应提供只读迭代/空间邻域查询，并以行为等价测试保护结果。

V1A 的池键应是实际渲染资源签名，例如 `geometry + material + component + LOD + shadowPolicy`，不能直接使用当前 semantic `batchKey`。后者已经包含 species/material/growth/size/visualVariant；在几何尚未真正分化的 V1A 用它分池，会无意义地把 6 种树和 8 种岩石标签乘成额外 draw calls。

### 2. 必须有确定的容量、回收与 bounds 策略

- 不可把固定最大 capacity 直接留在 `InstancedMesh.count`；缩到 `0.001` 的槽仍会被统计为三角面并可能进入 shadow submission。
- 优先使用 dense live range；若 swap-remove，必须原子更新被搬对象的双向索引和所有 component binding。
- 若使用 free-list/high-water mark，必须证明 hole 不增长、`count` 可收缩、长距离往返后 buffer 不持续变大。
- pool resize 必须是可观测的低频事件；正常 5×5/3×3 上限应预分配，不能在跨区热路径反复替换 `InstancedMesh`。
- `instanceMatrix`/`instanceColor` 只标记实际 dirty buffer；单次采集不能全池重传，至少不能重建 Object3D/geometry/material。
- 全局 InstancedMesh 的 aggregate bounding sphere 必须在 slot 移动/复用后更新且覆盖全部 live instance。关闭 `frustumCulled` 只能作为诊断，不是默认修复，因为它会把整圈实例送入 main/shadow pass。

### 3. 跨区微卡顿必须测“总路径”，不能只测语义池

V1A 即使消除 `SemanticInstanceLayer.removeChunk/createChunk`，`RainforestRenderer.syncWorldChunks` 仍会在边界创建/销毁新 ground 与 puddle/river geometry/material。标准 5×5 横移一格会替换一整列 5 个 chunk；这些分配、法线计算、材质与 shader 首用仍可能产生 GC/Long Task。

所以 S1 crossing 必须同时记录：

- 总 `syncWorldChunks` CPU slice 与其中 semantic/ground/water 子阶段；
- 每次边界进入/返回的 frame p95/p99、最大帧、`>50ms` Long Task、GC/heap 趋势；
- Object3D、InstancedMesh、geometry、material、buffer capacity 的前后计数；
- 首次出发与热缓存返程，不能只报静止场景平均 FPS。

只要总路线仍有热身后 `>50ms` Long Task，就不能以“语义池完成”宣称 V1A 通过；应把残余 ground/water churn 明确列为下一项阻塞优化。

### 4. V1B 目前被存档结构硬阻挡

当前 `WorldState` 与 compact world snapshot 没有 world-generator/world-field version。只有运行时 semantic metadata 带单实体 `generatorVersion`，而 pristine chunk 根本不序列化实体。若直接替换生成器、地形或河流：

- 旧世界会按新 baseline 重生；
- 旧 sparse delta ID 可能找不到对应 baseline；
- 已探索区域的高度、河流、建筑落点、尸体和资源位置可能分裂；
- renderer 的 `worldSeed` 也无法选择 v1/v2 terrain 查询。

V1B 实施前必须先经用户的世界身份 gate，并满足：

- world save 显式持有 `worldGeneratorVersion`/`worldFieldVersion`；缺失字段按 v1 解释。
- generation、terrain height/slope、river/water、movement、placement、ecology、renderer 与 delta materialization 都按同一版本 dispatch。
- v1 存档永久继续使用 v1 baseline；新世界显式创建 v2。不得因代码升级静默把旧世界改成 v2。
- 首版不要做“只改未探索区”的混合世界，除非先设计边界接缝、每区版本和 delta 归属；安全默认是旧世界全局 v1，新世界全局 v2。
- v1 改动物体与 pristine 远区在升级后都保持相同 ID、位置、数量、lifecycle 与高度；v2 另有自己的稳定 round-trip。
- 保存速度也进入长路线基线，不能只验证 payload 小于 Toy key budget。

## P0：必须新增或改写的回归测试

1. `activeRingPoolIdentity.test.ts`
   - 20 seed、标准/低端、连续十区块往返；每帧验证 live ID 集合、record 集合、双向槽表与生成计划完全一致。
   - 离环 ID 全部释放，回返后同一 ID 的 matrix/morphology/lifecycle 与首次一致；不要求跨离环保留同一 slot。
2. `activeRingPoolTargetedUpdate.test.ts`
   - 只改变一个 tree/rock 的 quantity/lifecycle；geometry/material/mesh 对象身份不变，未变 ID 的 matrix/color/collider 不变，只更新受影响 component slots。
3. `activeRingPoolReuseGuard.test.ts`
   - 聚焦并触发 impact，随即移出 chunk 并复用槽；旧 timeout 完成后新 ID 不高亮、不闪击中色，旧 collider 不残留。
4. `activeRingPoolColliderParity.test.ts`
   - standing tree circle、fallen tree capsule、stump、partial rock 与 exhausted rock 在 full -> partial/felled -> depleted、离环、回返全过程中，与 interaction geometry 的预期一致。
   - 同一断言覆盖 player collision、LOS、placement blocker、predator-contact blocker 的入口。
   - 对优化前后的固定 candidate/collider 矩阵做 winner/occluded 快照对照，保证空间索引或只读迭代不会改变最近遮挡物与焦点结果。
5. `activeRingPoolBounds.test.ts`
   - 正负远坐标、swap-remove、扩容/收缩后，所有 live matrix 均在 aggregate bounds 内；空池不产生 draw，NaN/Infinity fail closed。
6. `activeRingPoolResourceLifetime.test.ts`
   - 1000 次边界移动后 mesh/geometry/material 数固定，live count 有界，capacity 回到上限内；没有每区 material clone。
7. 改写现有 per-chunk 断言
   - `semanticInstanceLayer.test.ts` 与 `treeFellingRender.test.ts` 目前验证“每区块固定池”；V1A 后应改为“每 render-resource/LOD 活跃环固定池”，同时保留 identity、低档不删交互对象、生命周期与 collider 断言。
8. 浏览器 S1 性能 gate
   - production build，固定 Chrome/硬件/seed/路线；60s 热身，3×90s；保存逐帧数据、边界 mark、Long Task、heap、draw/triangles，而不是只读 90 帧 HUD。
9. shadow on/off 口径校准
   - 同一 build/机位对照，确认当前 Three.js `renderer.info.render.calls/triangles` 是否包含 shadow pass；此后所有报告沿用同一口径。
10. V1B 版本测试（V1A 不得顺手实施）
    - 缺失 version 的旧 save => v1；v1 explored/pristine/changed delta 升级后不漂移；新 v2 round-trip；v1/v2 ID 永不碰撞；旧世界绝不调用 v2 terrain。

## P1：静态审计未覆盖的隐形成本

| 来源 | 当前代码风险 | 验证/处理 |
|---|---|---|
| 动物 | 最多 24 个 view；单体约 3–7 个独立 Mesh，geometry/material 按个体新建，源码上界约 72–168 个 main submissions，且多数 cast shadow | S3 单独记录动物 main/shadow；后续按 species/component 实例化 |
| 建筑 | smoking rack 最多约 14 个 Mesh，rain collector 约 10 个；50 建筑压力场会远高于世界静态 inventory | S2 必须实测；同类构件共享几何/材质并按结构类型批处理 |
| 生命周期预留 | tree 5 池、rock 3 池中的 `0.001` matrix 仍占实例 count/triangle/shadow inventory | 报告 logical-live 与 submitted-instance 两个计数；必要时对 component 使用 dense live range |
| 地面/水 | 每 chunk 独立 geometry/material，跨区 dispose/recreate | 在 S1 单独标记 ground/water allocation 与 shader warm-up |
| 透明层 | 河水、水洼、雨、火焰、烟、萤火虫、focus marker 的 overdraw 不体现在 triangle 数 | S4 使用 GPU query（可用且无 disjoint）或浏览器 trace；低档控制屏幕覆盖率 |
| 灯 | 场景源码常驻 1 Hemisphere、1 Directional、6 PointLight（fire、signal、night、3 waymark）；强度为 0 不等于没有 shader/light-list 成本 | V0 明确“常驻灯/启用灯/可见灯”三种口径；限制同时生效的局部灯 |
| 阴影 | semantic tree/rock 全组件 cast shadow；动物和大量建筑也投影。全局池的 aggregate bounds 可能让整池进入 shadow pass | 近环 caster policy + shadow on/off 实测；micro/rubble/远环默认不投影 |
| 太阳阴影空间 | 方向光和 shadow camera 当前固定看向世界原点；玩家远行后可能失去近身阴影 | 后续把 shadow rig 量化跟随玩家并做 texel snapping；先固定截图验证无游泳/闪烁 |
| 每帧分配 | `updateEnvironment` 每帧创建多枚 `THREE.Color`；雨滴 CPU 更新 520/1100 点且 `frustumCulled=false` | performance allocation trace；改用复用对象/统一天气 uniform |
| 装备/预览 | 切装备和切建筑预览会创建/销毁 geometry/material，可能触发短时 GC/shader compile | 在实际交互路线采样，不只测静止场景 |
| batch key 维度 | 未来把 variant、biome、wetness、focus、shadow 都做成材质键会组合爆炸 | 每阶段提交 batch/material key 矩阵与理论最大批次数；wetness/focus 优先 instance attribute/global uniform |
| focus/LOS CPU | `updateTarget` 会对每个可交互 entity 调用 `focusOccluders`；后者反复构建数组，并由 `getColliders` 深拷贝整圈 semantic collider，还会重复解析 structures。当前是候选数 × blocker 数的扫描与分配，未出现在 draw/triangle 审计中 | 先按 range/alignment 做 cheap reject，再对少量候选查询邻域 collider；S0/S1 记录 target-update CPU 与 allocation，保留固定焦点/遮挡等价测试 |

## P1：V1A 的最低诊断面板

现有 diagnostics 只有 chunks/instances/colliders 与间歇 renderer.info，不足以判定池泄漏。V1A 至少临时导出：

- 每 pool 的 resource key、capacity、live count、high-water、free count、resize count；
- ID/slot 冲突与 stale-generation 拦截次数；
- 本次 sync 的 added/removed/moved/updated 数；
- matrix/color 上传字节估算；
- chunk sync 总耗时及 semantic/ground/water 子阶段；
- target update 的候选数、实际 LOS 查询数、blocker 扫描数与临时分配估算；
- main/shadow draw 口径校准结果。

这些字段可以只进 benchmark JSON/开发诊断，不进入正式玩家 HUD。

## P2：WebGL 下高收益、低资源的原创层次感路线

按收益/风险排序：

1. **先修 submission 与跨区分配**：V1A 完成前不增加树种网格、透明叶片或后处理。
2. **少量构件兑现剪影**：每个树种用 2–3 个 trunk/crown/buttress 组合、实例 scale/yaw/tilt/color 扩展；岩石用 2 个主体 + 破碎构件。用共享 opaque 材质和顶点色，不给每对象独立材质。
3. **中观负空间胜过面数**：连续密度/湿度场组织树群、林缘、林隙、岩脊、河岸和视线走廊；离散资源必须继续来自同一 semantic plan，ambient 层永久 never-focus。
4. **近中远三环**：近环保留 collider/交互/关键阴影，中环低面实例，远环冠层/山脊代理；用雾和滞回藏切换，禁止同一个语义 ID 同时出现两个可见实体。
5. **单一光雾关系**：一盏方向光、半球环境光、按 canopy/雨/时段调整的雾；近环量化跟随阴影相机。先建立 value grouping 和夜间可读性，再考虑 bloom/AO。
6. **GPU 驱动的小动作**：冠层风摆用共享 shader + per-instance phase/stiffness；树干、岩石不摆。wetness 用天气 uniform/世界空间 mask，禁止 CPU 每对象更新或材质 clone。
7. **小图集与实色优先**：64–256px 原创图集、顶点色、少透明；alpha foliage 只在 profiling 证明 fill-rate 有余量后加入。
8. **感知线索按字节收益排序**：风向、雨声/滴水、林缘亮度、动物痕迹、局部空间声通常比额外几何更能建立雨林存在感，但仍须服务导航、生态或交互可读性。

## 结论

- V1A 可以做，但它是 renderer-interaction 边界重构，不是单纯“把 250 个 draw 合成 8 个 draw”。先锁 identity/collider/focus/async/bounds，再谈性能收益。
- V1A 完成仍不代表跨区卡顿解决；ground/water 与动态动物/建筑是已知残余来源，必须用 S1/S2/S3 浏览器数据拆分。
- V1B 在当前存档模型下不可安全实施。必须先加入 world generator version、全消费者版本 dispatch，并由用户决定旧世界 v1 保留与新世界 v2 的策略。
- Valheim 可迁移的是“有限资产 + 程序规则 + 构图 + 氛围”的方法，不是其未公开的 Unity 算法；CANOPY 应以原创热带雨林语义和 WebGL 实测预算落地。
