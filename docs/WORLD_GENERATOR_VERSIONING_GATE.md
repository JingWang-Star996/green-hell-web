# 连续世界 V1B：世界身份与存档迁移决策门

状态：**待用户决策，禁止实现 V1B**

审计基线：2026-07-15，共享脏工作树当前代码

范围：只审计世界身份、存档和生成路由；本文不授权修改生成器、随机消费顺序、存档结构或发布。

## 1. 结论

当前 V1B gate **未通过**。现有系统可以证明“同一份代码 + 同一 seed”的确定性，却不能证明“升级后的代码 + 旧存档”仍然指向原来的世界。

根因是：运行态和存档没有一个持久化的**整世界生成器版本**。稀疏存档只保存 `seed + 玩家造成的差异`，加载时直接调用当前代码里的生成函数重建基线。直接把区块群系、语义对象、地形或河流改成连续场，会改变旧世界的基线；这不是视觉升级，而是世界身份替换。

在用户选择迁移策略前，允许继续做不改变身份的 V1A 实例池和测量工作；禁止：

- 改写 `generateChunkDescriptor`、`generateSemanticChunkPlan`、`terrainHeight` 或 `riverCenter` 的 v1 结果；
- 改变 v1 随机调用次数、顺序、salt、数量规则或对象排序；
- 把 `SEMANTIC_WORLD_GENERATOR_VERSION` 原地从 1 改成 2 后只保留一套生成函数；
- 将 `CONTENT_VERSION`、envelope `schema`、`GameState.version` 或 world-delta codec 版本当作世界版本；
- 在没有用户确认和回滚副本时清档、静默迁移或发布。

## 2. 当前代码事实

### 2.1 版本并不等于世界身份

| 当前字段/常量 | 现在表达的含义 | 为什么不能代替世界版本 |
| --- | --- | --- |
| `GameState.version = 1` / `SIMULATION_VERSION = 1` | 运行态结构/模拟兼容层 | 所有新旧世界仍都是 1；迁移函数也只接收这一结构 |
| envelope `schema = 1` | 通用保存信封结构 | 信封严格校验固定键；它描述序列化契约，不描述地图算法 |
| `CONTENT_VERSION = canopy-first-night@7` | 当前内容包及其可迁移兼容范围 | @7 同时可以加载 @6/@5/@4/@3；一个内容版本内可能存在多个世界版本 |
| `runEpoch` | 用户明确“新游戏/替换旧周目”的单调身份 | 它解决新周目压过残留云存档，不说明该周目使用哪个生成器 |
| `seed` | 同一生成器内的确定性输入 | 同一个 seed 交给两套算法会生成两个不同世界 |
| `WORLD_DELTA_VERSION = 2` | `canopy-world-delta` 的压缩编码版本 | v1/v2 codec 都会用当前生成器重建世界；它不是生成规则版本 |
| `SEMANTIC_WORLD_GENERATOR_VERSION = 1` | 当前语义对象 ID/metadata 标记 | 没有进入 `GameState` 的世界路由；生成 API 也没有 version 参数 |
| `stableSpawnId(1/2, ...)` | 若干对象家族曾使用的 ID 前缀 | 这些数字已分别用于旧资源/旧树，不是完整世界版本 |
| `water:river:v1:*` | 连续河面临时交互目标的编码版本 | 目标是临时、可逆的焦点地址；地形/河流函数本身仍未按世界版本路由 |

相关事实来源：

- `src/game/sim/types.ts`：`GameState` 只有 `version` 和 `seed`，没有 world-generator 路由字段。
- `src/game/sim/state.ts`：新游戏和 `migrateGameState` 都只按 `seed` 初始化/重建世界与生态。
- `src/game/GameClient.tsx`：仓库使用 `schema: 1`、内容 @7，接受 @6–@3。
- `src/game/persistence/saveEnvelope.ts`：信封键集合严格固定；checksum 覆盖信封和 payload。
- `src/game/persistence/saveRepository.ts`：本地/云候选按 `runEpoch → simTick → revision` 比较，不比较世界版本。
- `src/game/world/saveDelta.ts`：compact world v2 只保存 bounds、explored chunks、deltas 和 custom entities；加载用 `state.seed` 调当前生成器重建。
- `src/game/world/semanticGeneration.ts`：语义对象/plan 标记 generator v1，但入口只有 `(worldSeed, coordinate)`。
- `src/game/world/generation.ts`：区块 descriptor 是逐格 hash；入口同样没有 world version。
- `src/game/world/terrain.ts`：高度和固定河切既不使用 seed，也不使用 version。
- `src/game/world/riverWater.ts`：临时水目标明确编码 v1，但解析仍绑定唯一的当前 `riverCenter`。

### 2.2 当前稀疏存档如何工作

当前正确性依赖下面这个等式永远成立：

```text
当前生成器(seed, chunk) == 玩家第一次进入该 chunk 时的生成器(seed, chunk)
```

存档不会保存每棵树、每块岩石和每株植物。它保存：

```text
seed + exploredChunks + { entityId -> quantity/regeneration/treeHarvest delta }
```

加载/回流某区块时，`createGeneratedChunkEntities(state.seed, coordinate)` 先重建当前 baseline，再按相同 `entityId` 叠加 delta。这正是长距离世界仍能满足 Toy 云配额的原因，也是世界版本不能缺失的原因。

### 2.3 地形、河流、语义与生态目前不是一个版本化场

- `terrainHeight(x,z)` 是固定正弦、固定山脊、固定气象站平台和固定河切；所有 seed 共用。
- `riverCenter(x)` 是固定正弦河；`riverSurfaceHeight`、移动、放置、交互、渲染都直接调用当前函数。
- 区块 biome/elevation/moisture/canopy 来自 `generateChunkDescriptor(seed, chunk)` 的逐格 hash，与 `terrainHeight` 和固定河并非同一连续字段。
- 语义对象由 descriptor 决定类别、数量、位置和物种；其随机消费顺序是身份的一部分。
- 生态、雨水收集器环境、地图/UI、渲染 streaming 也直接读取当前 descriptor/seed；只路由语义对象仍会让旧世界的生态和外观变化。
- `RenderSnapshot` 只携带 `worldSeed`，renderer 也只在 seed 变化时清空区块；未来同 seed 的 v1/v2 必须被视为两个身份。

## 3. P0 阻断项

### P0-1：旧世界会被当前代码静默重写

如果直接修改唯一的 descriptor/terrain/river/semantic 函数，旧存档加载后会出现以下任意后果：

- 玩家、建筑、尸体或地标落到新的地面高度之下/之上，或进入新河道；
- 同一 chunk 的 biome、资源、生态承载力和导航信息改变；
- 已探索区块并没有保存完整 baseline，因此无法从存档恢复原貌；
- 渲染和模拟若迁移速度不同，会对同一点给出不同高度、水体或对象。

### P0-2：稀疏 delta 可能错配或失联

两种“简单升级”都不安全：

1. **继续沿用语义 ID 中的 v1**：`semantic.tree.1:x:z:index` 仍能命中，但 index 可能已代表不同位置、物种、yield 或对象；旧的砍伐量会作用到错误对象。
2. **只把 ID 改成 v2**：v1 delta 找不到 v2 baseline；已砍树/已采岩石可能复活或消失，v1 delta 还可能作为永远无法消费的孤儿留在存档中。

现有 `createLegacyGeneratedChunkEntities` 只认识更早期的 `tree.generated.*` 和 `resource.generated.*`，并不是“语义世界 v1 路由器”，不能保护这次升级。

### P0-3：现有仓库不能安全区分 v1/v2 周目

- repository freshness 不含 world version；同 seed 的两个生成器没有独立比较身份。
- `content` 只决定当前代码愿不愿意解析 payload，不负责选择世界生成器。
- 当前物理 key 是 `canopy_first_night_v2`。若新旧 bundle 共用它，旧标签页/旧客户端看不懂新 content 时会忽略远端候选；现有写入保护不能据此证明它不会覆盖新格式数据。
- 本地 backup 只是上一份有效 checkpoint，Toy 云端也同步 primary/backup；它们不是永久迁移快照。继续保存最终会轮换掉迁移前副本。

因此 P0 总数为 **3**。在三项都有设计与测试闭环前，不得跨过 V1B。

## 4. 建议的世界身份合同（仅设计，不实施）

### 4.1 唯一持久路由字段

未来建议在 `GameState` payload 顶层增加：

```ts
type WorldGeneratorVersion = 1 | 2;

interface GameState {
  // 其他字段不变
  worldGeneratorVersion: WorldGeneratorVersion;
  seed: number;
}
```

世界身份定义为：

```text
WorldIdentity = (worldGeneratorVersion, seed)
RunIdentity   = (runEpoch, worldGeneratorVersion, seed)
```

选择 payload 顶层字段而不是复用 envelope `content` 的理由：

- compact world 替换 `state.world` 时，顶层路由仍会原样进入 checksum；
- 通用 SaveEnvelope 不必理解游戏地图；
- 同一内容构建可以继续 v1 世界，也可以创建 v2 世界；
- 缺失字段可做唯一一次明确兼容规则：**历史存档缺失时固定解释为 v1，绝不能解释为“当前最新版”**；
- 未知值必须 fail closed，保留 primary/backup/cloud 原文并提示版本过新，不能回落为 v1 或 v2。

`worldGeneratorVersion` 与对象 metadata 的 `generatorVersion` 应一致，但两者职责不同：前者选择完整世界规则，后者用于对象审计与 ID 验证。

### 4.2 双路由，不原地改写 v1

未来的版本化入口应类似：

```text
worldGenerator(1) -> 冻结的 descriptor/semantic/terrain/river v1
worldGenerator(2) -> 新 continuous world field v2
```

所有以下消费者必须拿到同一个 `WorldIdentity`，不能各自默认最新版：

- chunk descriptor、semantic plan、对象 ID/yield baseline；
- terrain height/slope、river/water target、放置和移动；
- simulation hit/occlusion、resource lifecycle、wildlife/ecology；
- renderer ground/water/streaming、map/UI 环境判断；
- sparse compact/expand/materialize/dematerialize；
- benchmark fixture、save coordinator 和诊断输出。

v2 新对象 ID 必须含 v2；v1 生成器和其随机消费顺序必须冻结。`RenderSnapshot` 至少要传 generator version，并在 `(version, seed)` 任一变化时清空世界 view。

河流目标应保留严格路由：v1 世界只产生/解析 `water:river:v1:*`，v2 使用新的显式前缀/decoder。即使河目标本身不持久化，也不能让 v2 decoder 在 v1 世界里解释同一地址。

## 5. 用户决策选项

### 选项 A：旧世界永久 v1；新世界显式 v2（**推荐**）

行为：

- 所有现有/缺失字段的存档固定补为 `worldGeneratorVersion: 1`；
- “继续游戏”永远使用该周目保存的版本；
- 决策生效后创建的新游戏使用 v2，标题/新游戏确认页明确显示世界版本；
- 不提供静默升级按钮；玩家若想体验 v2，创建新周目；
- v1 代码进入冻结维护，只修不改变输出的 bug；影响输出的修复必须再升版本。

收益：零歧义保护现有进度；稀疏存档仍成立；回滚最可靠；最符合 `VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md` 已接受的 V1B 条件。

成本：需要同时保留 v1/v2 生成路由；旧周目不会获得 v2 地貌和河道，只能获得不改变世界身份的 UI、性能和表现修复。

建议的发布隔离（后续实施时）：使用新的物理保存命名空间（例如 `canopy_first_night_v3`）承载版本化 payload；首次启动只读导入旧 `canopy_first_night_v2` 的最佳有效候选为 v1，验证新 primary 后仍保留旧 key 作为迁移回滚源。新旧 bundle 因 key 隔离不能互相覆盖。具体 key 名不是世界版本，也不得自动删除旧 key。

### 选项 B：一次性重开，所有玩家进入 v2

行为：发布 v2 前导出/保留旧 primary、backup 和云端副本，随后要求玩家明确确认创建新周目；旧进度不进入 v2。

收益：实现和长期维护最简单，只需一套活跃生成器；平衡、任务和地图从统一起点开始。

代价：这是破坏性产品决策。玩家建筑、任务、背包、生态后果和探索全部丢失；“Demo 正在成长”不能成为静默清档理由。必须有明确确认、备份/恢复路径和发布说明。没有用户再次明确授权，不得选择。

### 选项 C：尝试把旧世界迁移到 v2

行为：建立独立、可重复、可 dry-run 的迁移器，把 v1 玩家/建筑/尸体/delta 映射到 v2；源存档永不原地覆盖，迁移结果使用新 run/storage identity。

收益：理论上能把更多进度带进新地貌。

代价与不确定性最高：

- pristine 区块没有快照，无法“变成 v2 同时仍保持 v1 地貌”；
- entity index/位置/物种匹配不是双射，砍伐/采矿 delta 可能没有唯一归属；
- 建筑、玩家、尸体、河岸和任务点需要落地/避水/碰撞修复；
- 生态与资源生命周期要定义继承还是重算；
- 任何启发式都需要逐存档迁移报告、冲突清单和玩家确认。

建议：目前不选。只有真实存档样本证明长期进度价值高于双路由维护成本，并且迁移准确率有可验收定义时再立项。

## 6. 推荐选项 A 的安全落地顺序（用户确认后才可执行）

1. 先把 v1 输出冻结成 golden fixture；不要先写 v2。
2. 增加 `worldGeneratorVersion`，把缺失值只迁为 1；未知值 fail closed。
3. 让现有所有调用通过 v1 router，证明 seed/对象/地形/河流/save byte fixture 未变化。
4. 建立新的物理存储命名空间和只读导入；验证本地 primary、backup、Toy cloud 与旧 key 回滚。
5. 把 renderer、simulation、ecology、UI、save diagnostics 全部接入 `(version, seed)`。
6. 才实现 v2 continuous field；所有 v2 随机频道按命名 salt/独立 channel 固定，禁止依赖偶然调用顺序。
7. 新游戏明确选择 v2；继续旧游戏仍走 v1。
8. 完成第 8 节验收后，再请求发布决策。

## 7. 回滚合同

- **数据回滚**：迁移前旧物理 key 和云候选只读保留；新 primary 完整校验前不得删除。backup 轮换不能替代此副本。
- **代码回滚**：任何仍可能加载 v2 存档的版本都必须保留 v2 路由或明确拒绝；绝不能用 v1 打开 v2。
- **功能回滚**：可以关闭 v2“新建世界”入口，但已存在 v2 周目必须继续可读，或在 UI 明确标为需要更新版本。
- **失败隔离**：未知 world version、checksum 错误、delta/版本不一致时，保留 primary/backup/cloud 原文并 fail closed；不自动新建覆盖。
- **无降级转换**：不支持 v2 → v1；若要尝试迁移，只能产生新副本和报告。
- **回滚演练**：版本化构建写入一次 v1、一次 v2 后，验证上一稳定构建不会覆盖新命名空间；再切回版本化构建，两份周目均可恢复。

## 8. 验收矩阵

### 8.1 必须新增的纯测试/fixture（实施阶段）

1. **缺失路由**：真实历史 payload 缺 `worldGeneratorVersion`，加载后严格为 1；保存后字段显式存在。
2. **未知路由**：版本 0、3、负数、浮点、字符串均 fail closed；原始 primary/backup/cloud 不变。
3. **v1 golden**：固定多 seed、多正负 chunk 坐标，逐字节锁定 descriptor、semantic object IDs/positions/metadata、terrain samples、river center/surface 和 river target IDs。
4. **v1 稀疏后果**：砍倒树、部分采矿、植物再生、尸体和建筑在 v2-capable build 中加载，ID、位置、quantity、treeHarvest、regeneration 完全一致，无对象复活/错配。
5. **v2 确定性**：同 `(v2, seed, coordinate)` 重跑 byte-stable；不同 seed 变化；随机 channel 增加一个消费项不会扰动无关家族。
6. **同 seed 双世界**：`(v1, seed)` 与 `(v2, seed)` 明确不同，但各自重复稳定；renderer 在 version 改变时清空旧 view。
7. **边界共享**：v2 共享边高度误差 `<1e-4`、法线夹角 `<3°`；terrain、movement、placement、hit、river、render 查询同一点结果一致。
8. **河流路由**：v1 只接受 v1 target，v2 只接受 v2 target；跨版本/畸形 ID 无副作用。
9. **本地/云往返**：v1 和 v2 分别通过 primary、backup、Toy cloud round-trip；cloud conflict 不把一个世界版本覆盖成另一个。
10. **旧/新 bundle 隔离**：旧客户端对旧 key 的晚到写入不能覆盖新命名空间；导入重复执行幂等。
11. **回滚演练**：按第 7 节真实运行；失败不会清档或启动默认新游戏。
12. **配额**：十小时探索规模继续只保存 seed + sparse delta；新字段/迁移元数据不突破现有 Toy key/value/总 key 预算。

### 8.2 玩家可观察验收

- 标题页能看见“继续：世界 v1/v2”，新游戏能看见将创建 v2；不存在暗中升级。
- 同一 v1 存档升级前后回到固定路线：地面、河、建筑、树石、尸体、资源后果和任务点不跳动。
- 新 v2 世界的一个 evergreen → river-wetland 纵切满足 V1B 连续场指标，且没有碰撞/水/视觉分裂。
- 关闭 v2 新建入口后，已有 v1/v2 保存仍然安全、可识别、可恢复。

## 9. 决策请求

请在进入 V1B 前明确选择：

1. **A：旧世界永久 v1 + 新世界显式 v2（推荐）**；
2. **B：备份后一次性重开 v2**；
3. **C：另立迁移项目，先 dry-run 和准确率 gate**。

在收到选择前，本 gate 保持关闭；V1A、浏览器基线和不改变世界身份的优化可以继续。
