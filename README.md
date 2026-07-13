# CANOPY: First Night / 雨林第一夜

一款原创、可通关的第一人称浏览器生存纵切片。玩家需要观察雨林、处理伤口、获得安全饮水、建立营地，最后从废弃气象站带回电池并发出求救信号。

An original, completable first-person browser survival vertical slice about reading a hostile rainforest, managing linked risks, building a safe camp, and returning with the battery needed to call for rescue.

> **非官方声明 / Unofficial notice**  
> CANOPY: First Night 是独立原创项目，不是《Green Hell / 绿色地狱》的网页版、移植版或复刻版，也未获得 Creepy Jar 的授权、认可或赞助。《Green Hell》及相关商标属于各自权利人。本项目不包含该游戏的官方角色、剧情、地图、文本、截图、模型、贴图、图标、音乐、录音或其他资产；该名称只在研究文档中用于说明公开的机制研究对象。  
> CANOPY: First Night is an independent original project. It is not a web port, remake, or official adaptation of Green Hell, and it is not affiliated with, endorsed by, or sponsored by Creepy Jar. Green Hell and related marks belong to their respective owners. No official characters, story, maps, text, screenshots, models, textures, icons, music, recordings, or other game assets are included.

## 当前版本 / Current release

当前版本是一段紧凑的短局体验，不承诺固定的游玩分钟数；探索路线、配方熟悉度和失败重试都会显著改变时长。确定性规则测试中的完整关键路径记录为 784 秒游戏状态时间，但该测试使用规则层定位并跳过了真人行走与操作延迟，因此不是完整真人墙钟通关记录。当前实现覆盖“首夜求救”核心循环，而不是 [GAME_DESIGN.md](docs/GAME_DESIGN.md) 中全部长期设计目标。

The current build is a compact session whose duration varies with exploration, learned knowledge, and retries. Its deterministic rules test records 784 seconds of in-game state time for the full critical path, but that test uses rules-layer positioning and excludes human traversal and input latency; it is not a complete wall-clock playthrough. The build implements the “first-night rescue” core loop, not every long-term target described in [GAME_DESIGN.md](docs/GAME_DESIGN.md).

一局中的五个连续目标：

1. 检查并处理初始开放伤口。
2. 识别水源风险并真正喝下一份安全饮水。
3. 建造营火、遮雨棚和棕榈床，形成可恢复的营地。
4. 沿地标和坐标抵达气象站，取回电池。
5. 返回营地修复信标并发出求救。

## 已实现 / Implemented

- Three.js 第一人称程序化雨林：地形、植被、溪流、雨、雾、昼夜、营火、营地和气象站。
- 确定性 30 Hz TypeScript 模拟：固定种子、固定步长、资源、制作、任务、天气与可追溯事件。
- 相互耦合的生命、耐力、能量、理智、四类营养、伤口、感染、潮湿和寄生虫状态。
- 风险与反制：脏水的短期收益与寄生虫代价、暴雨熄灭露天火、蛇的视听预警，以及长矛规避伤害。
- 知识驱动的制作：配方随材料观察和行动结果逐步发现；已学配方会在本机保留。
- 营地恢复循环：净水、接雨、加柴、遮雨、棕榈床休息，以及营火对理智和潮湿的影响。
- 程序化 Web Audio 环境声与危险提示，不依赖外部录音素材；无声游玩仍有可见危险提示。
- 自动存档、校验、备份与损坏隔离；Toy 宿主注入 SDK 时可使用云存储，否则安全退回本地存档。
- 中文 HUD、手表、背包、制作、身体检查、笔记和纸图界面，以及胜负与因果日志结算。
- 原创 AI 生成社交分享图 `public/og-canopy-first-night.png`；不含原作素材、角色、文字或标志，生成来源记录在资产清单中。

详细的已实现/暂缓范围和发布门禁见 [RELEASE_REPORT.md](docs/RELEASE_REPORT.md)。

## 操作 / Controls

桌面键鼠是当前优先体验；触摸界面提供移动、观察、互动、冲刺、背包和身体检查的基础操作。

| 输入 | 行为 |
|---|---|
| 点击场景 | 锁定鼠标视角并启用音频 |
| WASD | 移动 |
| 鼠标 | 观察 |
| Shift | 冲刺 |
| E | 与当前目标互动 |
| F | 手表 |
| Tab | 背包 |
| C | 制作 |
| B | 身体检查 |
| N | 笔记与因果日志 |
| M | 防水纸图 |
| Esc | 释放鼠标 / 暂停 |

浏览器必须在首次用户操作后才能启动音频。自动化浏览器通常无法代替真实用户授予 Pointer Lock，因此发布验收仍需进行一次人工键鼠冒烟测试。

## 开发 / Development

要求 Node.js 22.13.0 或更高版本，以及仓库内的 `package-lock.json`。

```bash
npm ci
npm run dev
```

| 命令 | 用途 |
|---|---|
| `npm run dev` | Vinext 本地开发 |
| `npm run typecheck` | TypeScript 静态检查 |
| `npm test` | Node 测试运行器执行模拟与存档测试 |
| `npm run lint` | ESLint |
| `npm run build` | Vinext / Cloudflare 兼容构建 |
| `npm run build:pages` | Next.js 静态导出到 `out/` |
| `npm run verify` | typecheck、test、lint 与 Vinext build |

提交前的完整门禁：

```bash
npm ci
npm run typecheck
npm test
npm run lint
npm run build
npm run build:pages
```

`CI` 工作流在 Ubuntu 与 Windows 上验证静态检查、33 项自动化测试、lint、Sites/Vinext 构建和 Pages 构建。推送到 `main` 后，`Deploy GitHub Pages` 工作流会再次执行 typecheck、测试、lint 和 Pages 构建，上传 `out/`，再部署到 GitHub Pages。

## 架构 / Architecture

```text
玩家输入
  → 确定性模拟命令
  → 状态、事件与因果记录
  → React UI / Three.js 快照 / Web Audio 提示
```

```text
app/                         Next.js App Router、元数据与全局样式
src/game/sim/                确定性规则、内容、状态、事件与随机种子
src/game/render/             Three.js 程序化雨林渲染器
src/game/audio/              Web Audio 程序化环境音
src/game/persistence/        版本化本地/云存档与恢复策略
src/game/platform/           Toy 宿主桥接
src/game/ui/                 HUD、面板、触摸控件与结算界面
tests/                       模拟、存档仓库与 Toy 桥接测试
docs/                        研究、复盘、制作流程、设计与发布报告
public/assets/licenses.json  运行时资产与关键图形依赖来源清单
```

模拟层不依赖 React 或 Three.js，因此可以用固定种子复现规则结果，也可以在不改规则的前提下替换表现层。

## 文档 / Documentation

- [Research / 机制与来源研究](docs/RESEARCH.md)
- [Game design / 完整设计蓝图](docs/GAME_DESIGN.md)
- [Release report / 实现范围与发布证据](docs/RELEASE_REPORT.md)
- [Postmortem / 旧版复盘](docs/POSTMORTEM.md)
- [Production playbook / 制作流程](docs/PRODUCTION_PLAYBOOK.md)
- [Runtime asset manifest / 资产与许可清单](public/assets/licenses.json)

## 存档与宿主数据 / Save and host data

页面进入可交互阶段后会从 `https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js` 请求 Toy 平台提供的外部 SDK；该网络请求及 SDK 本身受平台条款约束。在普通网页环境中，项目代码把随机设备标识、配方知识和版本化自动存档保存在浏览器本机。若 SDK 暴露 Toy 宿主桥接，宿主可同步该随机设备标识与完整游戏存档，并接收“开始/继续/胜利/失败”动作事件；SDK 不可用或请求失败时，游戏继续使用本地存档。项目代码不请求姓名、邮箱或精确位置。

After the page becomes interactive, it requests the platform-provided Toy SDK from `https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js`; that network request and the SDK are governed by the platform's terms. In a normal browser, the project code keeps its random device identifier, learned recipes, and versioned autosave in local browser storage. If the SDK exposes the Toy host bridge, the host may sync that identifier and the full save state and receive start/continue/win/loss action events. The game falls back to local storage if the SDK is unavailable or rejects a request. Project code does not request a name, email address, or precise location.

## 许可与权利 / License and rights

原创源代码按 [MIT License](LICENSE) 提供。MIT 授权不覆盖第三方依赖、第三方资产、商标、游戏标题或贡献者无权授权的材料。每项依赖仍受其自身许可证约束；运行时资产来源记录在 [public/assets/licenses.json](public/assets/licenses.json)。

Original source code is available under the [MIT License](LICENSE). The MIT grant does not cover third-party dependencies, third-party assets, trademarks, game titles, or material contributors do not own. Runtime asset provenance is recorded in [public/assets/licenses.json](public/assets/licenses.json).
