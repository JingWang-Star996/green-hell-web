# CANOPY V0 可复现视觉诊断基线

日期：2026-07-15

状态：**离线 fixture 与静态/仿真诊断导出已实现；浏览器 benchmark、截图和 GPU 数据尚未采集**

本入口落实 `VISUAL_MILESTONE_PERFORMANCE_PROTOCOL.md` 中 V0 的可复现前半段。它固定 seed、相机、路线和质量档，并把当前生成规则的确定性观察导出为 JSON。它不启动游戏、不创建 `WebGLRenderer`，因此不能替代 production build 浏览器采样，也不能用于宣称 FPS、GPU 时间、Long Task、内存或视觉质量通过。

## 1. 运行方式

生成完整 V0 离线基线：

```powershell
npm run visual:baseline
```

输出位于 `outputs/visual-v0-baseline.json`。`outputs/` 已被 Git 忽略；需要保留一次候选结果时，应把 JSON 作为测试/里程碑工件归档，而不是作为运行时资产打入 Toy 包。

可选地显式记录源码修订和 production build 哈希：

```powershell
node --import tsx scripts/visual-v0-baseline.ts `
  --source-revision <commit-or-worktree-id> `
  --production-build-hash <build-hash> `
  --output outputs/visual-v0-baseline.json
```

未传入的 provenance 字段保持 `null`，脚本不会猜测 commit 或把脏工作树称为某个 build。只检查单 seed 静态源模型时，继续使用兼容入口：

```powershell
npm run visual:audit -- --seed 1 --grid-radius 20 --active-radius 2 --detail standard
```

## 2. 固定协议

当前协议版本为 `canopy-visual-v0-static-v1`，固定：

- 20 个显式 seed：字符串 `1` 到 `20`；默认新游戏 seed `1` 不再与 renderer 占位 seed 混淆。
- 12 个眼平相机 fixture：出生林下、两岸、岩脊、气象站、强雨林下、黄昏和夜间路线；每个机位包含世界坐标、yaw、pitch、时间和雨强。
- 5 条路线：`S0 forest-still`、`S1 crossing`、`S2 camp-50`、`S3 ecology`、`S4 weather-night`。
- 两个质量档：标准 1920×1080 / DPR 1 / 5×5 活跃环，低端 1280×720 / DPR 1 / 3×3 活跃环。
- 20×12 共 240 个 contact-sheet 地址。离线报告只解析这些地址的地形、区块描述和语义对象；`captureStatus` 仍为 `not-captured`。
- 20 seed×2 档共 40 份世界审计，覆盖 41×41 descriptor 连续性和当前活跃环的静态 draw/triangle inventory。

fixture 内容经过 canonical JSON 后计算 SHA-256。`fixtureSha256` 标识协议是否变化；`deterministicDataSha256` 标识当前生成/源模型在该协议下的结果是否变化。当前 fixture 哈希为：

```text
9a9ac23bde0abfbff2496740b0606ce266c8925eb66088a42cf6f4b675708adc
```

测试会钉住 fixture 哈希。若有意修改 seed、相机、路线或质量档，必须同时升级协议版本、更新文档和测试；普通 renderer 或生成代码变化只应改变 data 哈希。

## 3. 证据边界

| JSON 区域 | 可表达的事实 | 明确不能表达 |
|---|---|---|
| `fixtures` | 固定测试地址、路线、档位和 fixture 哈希 | 截图已经生成、路线已经实际运行 |
| `deterministicData.cameraObservations` | 当前共享地形函数、区块 descriptor 和语义生成器在 240 个地址的确定性结果 | 玩家实际看见的像素、遮挡、LOD、帧率 |
| `deterministicData.worldAudits` | 20 seed 的群系连续性事实；当前 mesh 布局的静态 inventory 工程估算 | `renderer.info` 实测、视锥/阴影实际提交、GPU profiling |
| `profileSummaries` | 上述 20 seed 静态结果的 min/median/max | 性能分布、设备等级结论 |
| `browserCapture` | 缺失项的机器可读清单 | 用 `0` 假装没有 Long Task、内存或 GPU 成本 |

分类沿用视觉协议：descriptor/fixture 是当前代码的 **[F]**；draw/triangle inventory 是带 caveat 的 **[I]**；本 JSON 不包含 **[M]**。

静态 draw 估算还会输出 `architectureVersion`、`semanticDrawScopeByCategory`、`chunksWithRenderedCategory` 和 `semanticDrawInventoryByCategory`。当前 post-V1A 版本为 `semantic-post-v1a-rainforest-depth-fill-v2`：树与岩石已经随正式落地的共享池改为 `per-active-ring`，植物、环境植被与 clutter 保持 `per-nonempty-chunk`。

树 draw 从 pre-V1A 的 `5 × 含树活动块数` 变为“活动环有树则固定 5”，岩石 draw 同理由 `3 × 含岩石活动块数` 变为固定 3。对应节省分别为 `5 × (含树块数 − 1)` 与 `3 × (含岩石块数 − 1)`。

seed `1` 当前标准 5×5 环包含 2,390 个语义对象，分类为树 371、可开采岩石 145、可采集植物 270、环境植被 1,134、微型 clutter 470。C17 气象站排除区及两条接近走廊会有意清除 30 个对象：相对不含 C17 清障规则的 2,420 个旧基线，树、岩石、植物、环境植被和 clutter 分别减少 7、1、2、18、2；变化仅落在区块 `1:1`（减少 6）和 `2:1`（减少 24）。这是地标与通路留白，不是生成漂移。

当前标准档已知 main draw inventory 为 142、semantic draw inventory 为 108，最坏语义 shadow submission 为 108；低端 3×3 环分别为 58、44 和 0。已知 main triangle inventory 分别为 203,912 和 54,608；标准档可能的语义 shadow triangles 为 196,048，低端为 0。C17 清障不会改变非空类别/区块所需的 draw inventory，但会减少实例 triangle inventory。这些都是源码静态 inventory **[I]**，不是 GPU、FPS 或浏览器 `renderer.info` **[M]**。

## 4. 为什么不复用当前 HUD 当 benchmark

`RainforestRenderer.updateDiagnostics` 当前只保留最近 90 个 rAF 间隔，并每 500ms 保存一次平均帧、p95/p99 和当时的 `renderer.info`。它没有逐帧 draw/triangle 序列、chunk sync mark、Long Task、稳定区间 heap、GPU timer query、纹理 resident byte 估算或截图。HUD 能发现明显异常，但不能证明 V0 性能 gate。

因此离线 JSON 中以下字段必须保持 `null` / `not-captured`，直到独立的 production-browser recorder 真正采样：

- renderer diagnostics 时间序列；
- frame interval、Long Task 和 chunk sync；
- JS heap；
- GPU time；
- resident texture byte estimate；
- screenshots / contact sheet；
- production 包体与首屏实际压缩传输。

## 5. 复现与审查

1. 在同一源码修订运行 `npm run visual:baseline` 两次。
2. 比较 `fixtureSha256` 和 `deterministicDataSha256`；两者都应完全一致。
3. 运行 `node --import tsx --test tests/diagnostics/visualV0Baseline.test.ts`。
4. 运行 `npm run typecheck` 和 `npm run lint`。
5. 浏览器可用后，在 production build 上按同一 fixture 另行采集；记录硬件、Chrome 完整版本、窗口、DPR、质量档、build/save hash，并保留原始逐帧序列。

离线报告通过不代表 V0 完成。V0 仍需 production 浏览器的三次 90 秒重复性、截图和性能数据；在这些证据到位前，不得把空字段补成估计值，也不得声称性能门槛通过。
