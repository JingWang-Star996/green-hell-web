# CANOPY：岩石辨识与可达开采纵切规格

日期：2026-07-14
状态：只读设计完成；砍树纵切之后实施，不扩展物品/配方树

## 1. 纵切目标

当前同类多面体同时表示可拾散石、需镐矿体、不可聚焦碎石和勘测岩棚；大型矿体还要求流程中不存在的 tier 2 镐。`flint/clay` 预览又承诺了背包中不存在的材料，实际始终发放 `stone`。

本纵切只建立一条可信规则：

`看轮廓判断拾取/开采/地标 → 聚焦同一锚点 → tier 1 石镐可处理所有矿体 → 命中改变岩体 → 获得既有 stone → 状态持久`

非目标：新增燧石、黏土、矿石配方，高级镐，矿脉刷新，洞穴系统，落石物理或完整冶炼树。

## 2. 语义与物品映射

保留生成器内部 `granite | limestone | flint | laterite-clay`，仅作为色彩、层理和未来扩展的地质标签；本纵切四类都映射到现有 `stone`，不新增 `ItemId`。

| 内部 material | 玩家可见名称 | 本纵切产出 | 轮廓/色带 |
|---|---|---|---|
| granite | 坚硬岩体 | 石块 | 深灰整块、浅色晶粒 |
| limestone | 层状浅岩 | 石块 | 浅灰水平层片 |
| flint | 深色结核岩 | 石块 | 灰色母岩、深色结核带 |
| laterite-clay | 红土胶结岩 | 石块 | 暗红疏松块、湿润暗面 |

- `rockYieldIntent.primaryMaterial` 四类统一为 `stone`；HUD 只预览“石块 ×1/击”，不再显示“燧石/黏土”。
- `semanticItemId()` 继续返回 `stone`；删除“稍后解析 flint/clay”的误导性 TODO。
- 既有 `stone` 的显示名从“锋利石块”收敛为“石块”，描述改为“可直接使用，也可敲击加工出锋利边缘”。配方和存档 ID 不变。
- 只有在对应材料至少拥有一项用途、配方、容量规则和获得反馈后，才允许把内部 material 晋升为新物品。

## 3. 可达工具规则

- 所有 `mineable-rock` 固定为 `action=mine, toolClass=pick, minimumTier=1`；尺寸和材质不得再生成 tier 2 门槛。
- 唯一执行工具是现有 `stone-pick`。未持有提示“需要制作石镐”，持有未装备提示“装备石镐”，装备后立即可执行。
- 硬度只由尺寸表达，不借未实现的工具等级表达：

| size | 每击工时 | 体力 | 石镐耐久 | 基线可采单位 |
|---|---:|---:|---:|---:|
| small | 3.5 秒 | 2 | 1 | 1–2 |
| medium | 4.5 秒 | 3 | 1 | 3–5 |
| large | 6 秒 | 4 | 2 | 6–9 |

- 一击成功固定取得 1 `stone`；背包满、越距或工具不符时不推进时间、不扣数量/耐久。
- 起始可拾石块必须足以闭合工具图：打制石刃 2 + 石镐 3 = 5。将既有营地石堆保底数量校正为 5，不能要求玩家先开采才能制作开采工具。

## 4. 最小状态机

不增加 `RockHarvestState`，`quantity` 只表示剩余可剥离的石块单位，状态完全派生：

| 状态 | 条件 | 动作 | 世界结果 |
|---|---|---|---|
| intact | `quantity === baselineQuantity` | 镐击 | 发 1 石块，进入 partial |
| partial | `0 < quantity < baselineQuantity` | 镐击 | 发 1 石块，裂隙加深/体块减少 |
| exhausted | `quantity === 0` | 无 | 保留低矮废石疤，不碰撞、不聚焦、不刷新 |

每击的世界扣减与背包入账必须原子化；工具在成功击中后损坏，最后一点耐久可完成该击并自动收起。动画、火花和碎屑是表现态，不入存档。

可拾散石继续使用现有资源刷新协议：`quantity>0` 可拾，归零后按随机窗口远离玩家刷新；它与永久耗尽的语义矿体不是同一状态机。

## 5. 四类外观不得重叠

最终世界尺寸必须落在互不重叠的包围区间，不能再让生成的 `transform.scale=0.55..1.45` 把类别拉回同一尺度：

| 类别 | 最大水平尺寸 | 高度 | 必须具有 | 禁止具有 |
|---|---:|---:|---|---|
| 可拾散石/石堆 | 单块 0.22–0.34 m | 0.08–0.16 m | 平躺、2–5 块可见，拾取后少一块 | 直立矿脊、基岩底座 |
| small 矿体 | 0.75–1.05 m | 0.42–0.70 m | 嵌地底座、直立断口、材质带 | 散落小石姿态 |
| medium 矿体 | 1.30–1.80 m | 0.75–1.25 m | 双体块、可见裂隙 | 岩棚入口 |
| large 矿体 | 2.20–3.10 m | 1.35–2.10 m | 阶梯式三体块、宽击打面 | 顶棚/黑洞/箱体 |
| pebble clutter | 单粒 0.04–0.10 m | ≤0.05 m | 5+ 粒低对比地表散布 | 单个可读主石、聚焦/高亮 |

## 6. 实例化模型规格

- `SemanticInstanceLayer` 按 `small-outcrop / medium-outcrop / large-outcrop` 建三个体块实例批次；每个尺寸只用一个低面数共享几何，`visualVariant` 决定确定性的部件旋转/缩放，而不是只换 batch key。
- 每个矿体由 body + accent 两层实例构成：body 表示体块，accent 表示层理/结核/红土断面并承载命中闪烁；颜色继续用 instance color，禁止为每块岩石创建独立材质或 mesh。
- `partial` 由剩余比例选择两级裂隙/缺口和 0–12% 体块收缩；`exhausted` 显示固定低矮三片废石疤，移除碰撞和焦点，不缩成一颗像可拾石头的多面体。
- 散石模型走既有动态实体组，但 `RenderEntity` 投影数量；显示 `min(quantity, 5)` 个平躺小石，拾取后下一快照可见减少。
- clutter 只保留低矮散点批次；低画质可减数量，不能改变任何可交互 ID。

## 7. 共用几何、锚点与距离

新增纯函数 `rockInteractionGeometry(source)`，模拟、`viewModel` 和实例层共同读取，不在三处重算比例：

```ts
type RockInteractionGeometry = {
  bodyScale: { x: number; y: number; z: number };
  anchor: { x: number; z: number; height: number };
  colliderRadius: number;
  interactRadius: number; // colliderRadius + 2.0 m 可操作距离
};
```

- anchor 的 x/z 是岩体稳定 ID 对应的中心，height 是可见击打面中心（small 0.30、medium 0.55、large 0.90 m，再乘受控视觉尺度）。
- `SemanticInstanceRecord.anchor`、`RenderEntity.interactionAnchor`、准星/LOS、高亮标记和命中反馈必须等于该 anchor。
- 模拟距离仍可用水平中心，但 `WorldEntity.interactRadius` 必须来自同一 spec；玩家站在碰撞体外缘时可开采，绝不能因中心距离而不可达。
- collider 与 body 同源；partial 保持原碰撞，exhausted 同帧移除。表现几何不得反向成为规则真值。

## 8. 勘测岩棚是地标，不是矿体

将岩棚布局抽成共享 `SURVEY_ROCK_SHELTER_LAYOUT`：中心/朝向、5.6×3.8 m 顶棚、≥2.6 m 宽且 ≥1.9 m 高的正面入口、U 形墙碰撞、入口 approach point、箱体 anchor 和遮雨范围均来自这一份规格。

- 外形改为“一块宽扁顶板 + 两侧支撑 + 明确黑暗内腔”，不再堆出近似大型矿体的多面体山。
- 入口前保留 1.4 m 无碰撞进深；暖色箱体从入口外 6 m 应有视线，交互锚点位于玩家能站到的内侧边缘。
- 岩棚外壳永不进入 `mineable-rock`、焦点或高亮集合；唯一交互对象仍是现有勘测箱。
- 禁止复用 small/medium/large 矿体几何；地标可以复用石材材质，但必须保留“顶棚—入口—内部目标”的独有轮廓。

## 9. 存档兼容

- 不改稳定 ID、不改位置、不改基线数量算法，不提升 `SEMANTIC_WORLD_GENERATOR_VERSION`，不新增 world-delta 字段；现有 v1/v2 数量 delta 原样有效。
- partial/exhausted 继续只保存 `quantity`。重载后由当前基线和数量重建裂隙、废石疤、碰撞和焦点。
- 对旧的完整运行态存档做幂等归一化：语义岩体强制 `toolTier=1`、`itemId=stone`、`primaryMaterial=stone` 和新显示名，但保留 quantity、位置与 ID。
- 旧存档中的已耗尽岩体不能复活或补发材料；未改动对象仍不写 delta。

## 10. 自动化验收

1. 扫描固定多种种子与 5×5 区块：所有交互岩体 `minimumTier===1`，且起始流程可取得 5 石块并制作石刃与石镐。
2. 四类 material 的生成意图、实体 item、affordance 预览和实际事件都只声明/发放 `stone`；玩家文案不出现未交付的“燧石/黏土”。
3. tier 1 石镐可从 large 岩体挖到耗尽；每击时间、体力、耐久、数量与背包变化符合尺寸表，失败路径零副作用。
4. `intact → partial → exhausted` 的下一渲染快照立即改变体块/裂隙；耗尽同帧移除 collider、focus 和执行提示。
5. 可拾散石、small 矿体和 pebble clutter 的包围盒区间不相交；三者 affordance 分别为 pickup、mine、none。
6. 对任一矿体，实例记录、渲染实体、LOS/准星和模拟使用同一 anchor/range；站在碰撞外缘可以执行，range+0.01 m 被拒绝。
7. 岩棚入口宽高、U 形碰撞、approach point 与箱体 LOS 通过纯几何测试；岩棚外壳不出现在交互 ID 集合。
8. partial 与 exhausted 岩体离开区块、返回、v1/v2 存档往返后不重置、不重复发奖；旧 tier 2 运行态被归一化。
9. 标准/低画质的矿体与散石交互 ID 集合完全一致；实现后再以浏览器固定路线人工验证轮廓、准星、命中和箱体可见性。
