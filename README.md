# CANOPY: First Night / 雨林第一夜

一款原创、可通关的第一人称浏览器生存纵切片。玩家需要观察雨林、处理伤口、获得安全饮水、建立营地，最后从废弃气象站带回电池并发出求救信号。

An original, completable first-person browser survival vertical slice about reading a hostile rainforest, managing linked risks, building a safe camp, and returning with the battery needed to call for rescue.

> **非官方声明 / Unofficial notice**  
> CANOPY: First Night 是独立原创项目，不是《Green Hell / 绿色地狱》的网页版、移植版或复刻版，也未获得 Creepy Jar 的授权、认可或赞助。《Green Hell》及相关商标属于各自权利人。本项目不包含该游戏的官方角色、剧情、地图、文本、截图、模型、贴图、图标、音乐、录音或其他资产；该名称只在研究文档中用于说明公开的机制研究对象。  
> CANOPY: First Night is an independent original project. It is not a web port, remake, or official adaptation of Green Hell, and it is not affiliated with, endorsed by, or sponsored by Creepy Jar. Green Hell and related marks belong to their respective owners. No official characters, story, maps, text, screenshots, models, textures, icons, music, recordings, or other game assets are included.

## 当前版本 / Current release

当前版本已发布到 B 站 Toy：[绿色地狱网页版](https://www.bilibili.com/toy/green-hell-web/index.html)。本次制品、生产冒烟与已知边界见 [2026-07-16 发布记录](docs/releases/2026-07-16.md)。

正式知识站点：[CANOPY 玩家 Wiki](https://www.bilibili.com/toy/canopy-survival-wiki/index.html) · [游戏创作宝典](https://www.bilibili.com/toy/game-dev-handbook/index.html)。玩家 Wiki 的正式页已回链游戏；当前源码候选已在游戏开始页加入 Wiki 反向入口与版本化公告，需待下一次游戏 Toy 更新后才会在线上形成双向跳转。每次玩家可见更新需按 [日更维护与发布账本协议](docs/DAILY_RELEASE_PROTOCOL.md) 维护公告。

当前版本是一段紧凑的首夜纵切片，并带有可继续探索的长期世界骨架；探索路线、配方熟悉度和失败重试都会显著改变时长。确定性规则测试把完整关键路径约束在 1500–1950 秒模拟时间内，但该测试使用规则层定位并跳过了真人行走与操作延迟，因此不是完整真人墙钟通关记录。当前实现仍不等于 [GAME_DESIGN.md](docs/GAME_DESIGN.md) 中规划的完整十小时内容。

The current build is a compact session whose duration varies with exploration, learned knowledge, and retries. Its deterministic rules test bounds the full critical path to 1,500–1,950 seconds of simulated state time, but that test uses rules-layer positioning and excludes human traversal and input latency; it is not a complete wall-clock playthrough. The build implements the “first-night rescue” core loop, not every long-term target described in [GAME_DESIGN.md](docs/GAME_DESIGN.md).

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
- 五类确定性生态区、动态区块扩展、已探索纸图，以及会随昼夜、天气和承载力变化的原创动物种群。
- 显式装备与第一人称工具：石斧、石矛、石刃快捷切换；持斧砍树会消耗时间、耐力和单件耐久并产生世界反馈。
- 可旋转、可取消、可验证的世界内建造预览；营火、叶棚和床的位置与朝向进入存档，不再固定在线性坐标。
- 按游戏小时计的食物腐败、火与天气节奏；普通资源按节点独立、确定性随机刷新且不会在玩家眼前整批弹出。
- 程序化 Web Audio 环境声与危险提示，不依赖外部录音素材；无声游玩仍有可见危险提示。
- 手动与自动存档、校验、主/备份、损坏隔离、`runEpoch` 新周目保护及跨设备版本保护；睡眠、任务、地标和关键建造先落本地，再异步同步 Toy 云。Toy 云存档遵守每个物理条目的键名与值合计不超过 1024 字节、键名不超过 128 字节、单 Toy 不超过 128 键的限制，使用 gzip/base64、校验清单和透明分块；云端超限或损坏不会回滚本地成功写入。
- 中文 HUD、手表、背包、制作、身体检查、笔记和纸图界面，以及胜负与因果日志结算。
- 原创 AI 生成社交分享图 `public/og-canopy-first-night.png`；不含原作素材、角色、文字或标志，生成来源记录在资产清单中。

详细的已实现/暂缓范围见 [2026-07-15 历史候选报告](docs/RELEASE_REPORT.md)；当前生产发布事实见 [2026-07-16 发布记录](docs/releases/2026-07-16.md)。

## 操作 / Controls

桌面键鼠是当前优先体验；触摸界面提供移动、观察、互动、冲刺、完整系统菜单和装备栏入口。移动端与桌面端共享同一套游戏动作，但广泛真机矩阵仍待补充。

| 输入 | 行为 |
|---|---|
| 点击场景 | 锁定鼠标视角并启用音频 |
| WASD | 移动 |
| 鼠标 | 观察 |
| Shift | 冲刺 |
| 鼠标左键 / E | 使用当前工具、采集或确认建造 |
| 1 / 2 / 3 / 4 / 5 | 装备石斧 / 石矛 / 石刃 / 石镐 / 火把 |
| Q | 收起工具，恢复空手互动 |
| R | 旋转正在预览的建筑 |
| 鼠标右键 / Esc | 取消建筑预览；无预览时释放鼠标 / 暂停 |
| F | 手表 |
| Tab | 背包 |
| C | 制作 |
| B | 身体检查 |
| N | 笔记与因果日志 |
| M | 防水纸图 |

浏览器必须在首次用户操作后才能启动音频。自动化浏览器通常无法代替真实用户授予 Pointer Lock，因此发布验收仍需进行一次人工键鼠冒烟测试。

## 开发 / Development

要求 Node.js 22.18.0 或更高版本，以及仓库内的 `package-lock.json`。

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
| `npm run build:toy` | 生成 Toy 单页入口闭包，并校验相对资源、正式 Wiki URL 与当前 buildId |
| `npm run verify:wiki` | 校验玩家 Wiki 契约并构建、检查独立 Wiki 制品 |
| `npm run verify:handbook` | 校验游戏创作宝典契约并构建、检查独立宝典制品 |
| `npm run verify` | typecheck、test、lint 与 Vinext build |
| `npm run verify:release` | 汇总代码、Toy、Wiki 与宝典的自动化发布门禁 |

提交前的完整自动化门禁：

```bash
npm ci
npm run verify:release
npm run build:pages
```

当前 Toy 制品通过 **636 项自动化测试**以及 TypeScript、ESLint、Vinext 生产构建和 Toy 专用构建。经校验的 `toy-out/` 包含 **20 个文件，共 5,047,364 bytes**，官方 Toy doctor 返回 `ok: true` 且无 findings；Toy 当前状态为 `published`，生产首屏、既有存档恢复和 WebGL 场景进入已通过冒烟。该制品来自有未提交改动的工作树，因此不能声称与某个 Git SHA 完全一致；完整证据和 manifest 见 [发布记录](docs/releases/2026-07-16.md)。上述结果不等同于真人三小时或十小时连续游玩验证。

`CI` 工作流在 Ubuntu 与 Windows 上验证静态检查、全量自动化测试、lint、Sites/Vinext 构建和 Pages 构建。推送到 `main` 后，`Deploy GitHub Pages` 工作流会再次执行 typecheck、测试、lint 和 Pages 构建，上传 `out/`，再部署到 GitHub Pages。

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
- [Latest release / 2026-07-16 Toy 生产发布记录](docs/releases/2026-07-16.md)
- [Historical release report / 2026-07-15 历史候选报告](docs/RELEASE_REPORT.md)
- [Postmortem / 旧版复盘](docs/POSTMORTEM.md)
- [Production playbook / 制作流程](docs/PRODUCTION_PLAYBOOK.md)
- [Final retrospective & next-game playbook / CANOPY 总复盘与下一款游戏制作手册](docs/CANOPY_DEVELOPMENT_RETROSPECTIVE_AND_NEXT_GAME_PLAYBOOK.md)
- [World object audit / 世界对象与交互歧义审计](docs/WORLD_OBJECT_AUDIT.md)
- [Living rainforest gameplay spec / 活体雨林玩法与交互规格](docs/LIVING_RAINFOREST_GAMEPLAY_SPEC.md)
- [Living rainforest execution backlog / 活体雨林执行队列](docs/LIVING_RAINFOREST_EXECUTION_BACKLOG.md)
- [Valheim visual-world study / 程序化世界与视觉方法研究](docs/VALHEIM_VISUAL_WORLD_STUDY.md)
- [Runtime asset manifest / 资产与许可清单](public/assets/licenses.json)

## 存档与宿主数据 / Save and host data

页面进入可交互阶段后会从 `https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js` 请求 Toy 平台提供的外部 SDK；该网络请求及 SDK 本身受平台条款约束。在普通网页环境中，项目代码把随机设备标识、配方知识和版本化自动存档保存在浏览器本机。若 SDK 暴露 Toy 宿主桥接，宿主可同步该随机设备标识与完整游戏存档，并接收“开始/继续/胜利/失败”动作事件；SDK 不可用或请求失败时，游戏继续使用本地存档。项目代码不请求姓名、邮箱或精确位置。

After the page becomes interactive, it requests the platform-provided Toy SDK from `https://s1.hdslb.com/bfs/seed/toy/app/sdk/toy-sdk.js`; that network request and the SDK are governed by the platform's terms. In a normal browser, the project code keeps its random device identifier, learned recipes, and versioned autosave in local browser storage. If the SDK exposes the Toy host bridge, the host may sync that identifier and the full save state and receive start/continue/win/loss action events. The game falls back to local storage if the SDK is unavailable or rejects a request. Project code does not request a name, email address, or precise location.

## 许可与权利 / License and rights

原创源代码按 [MIT License](LICENSE) 提供。MIT 授权不覆盖第三方依赖、第三方资产、商标、游戏标题或贡献者无权授权的材料。每项依赖仍受其自身许可证约束；运行时资产来源记录在 [public/assets/licenses.json](public/assets/licenses.json)。

Original source code is available under the [MIT License](LICENSE). The MIT grant does not cover third-party dependencies, third-party assets, trademarks, game titles, or material contributors do not own. Runtime asset provenance is recorded in [public/assets/licenses.json](public/assets/licenses.json).
