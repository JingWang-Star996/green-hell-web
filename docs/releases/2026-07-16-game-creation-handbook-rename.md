# 游戏创作宝典 Toy 更名发布记录

- 时间：2026-07-16T23:15:40+08:00
- 发布类型：更新既有独立 Toy；未新建项目，未修改 CANOPY 游戏或玩家 Wiki
- 原标题：游戏开发宝典｜CANOPY 实战方法库
- 新标题：游戏创作宝典｜CANOPY 实战方法库
- Toy ID：`11306522433536`
- 稳定 slug：`game-dev-handbook`（Toy 发布后不可更改）
- 可见性：`PUBLIC`
- 最终状态：`published`
- 正式地址：https://www.bilibili.com/toy/game-dev-handbook/index.html
- 验收预览：https://www.bilibili.com/toy/preview/preview_CPLnDhA5/index.html
- 提交预览：https://www.bilibili.com/toy/preview/preview_pQyHw4Bl/index.html

## 可见范围变更

- 页面标题、顶部品牌、无障碍首页名称和内容元数据统一改为“游戏创作宝典”。
- 定位扩展为覆盖创意、设计、世界与视觉、工程、制作、QA、Agent 协作和构建发布的游戏创作方法库。
- 英文页脚改为 `GAME CREATION HANDBOOK`。
- 1200×900 Toy 封面重新生成并完成目检。
- `game-dev-handbook` slug、构建目录、资源名和本地存储键继续作为稳定技术标识，避免公开链接和用户数据失效。

## 候选制品

- 输出目录：`game-dev-handbook-out/`
- 文件数：13
- 总字节：377784
- 制品 SHA-256 聚合摘要：`e9932d04bc7c091fdbea70733f45f5de83fad3461d6d22f9ee0fa8f2c43d79e9`
- 来源摘要：`53a3dadd69a17ef79a365b21a7d04e1748ea30ec2a060d68bd6de8f459262d13`
- 来源 HEAD：`6ad886f12bca0cdeacc3e4138cfc9ad3778cab3b`
- 来源工作树：脏；本记录不把制品宣称为与唯一 Git commit 一一绑定

## 门禁证据

- `npm run verify:handbook`：9/9 通过；构建及 13 文件制品校验通过
- `npm run typecheck`：通过
- `npm run lint`：通过
- 旧可见品牌扫描：0 个残留
- Toy doctor：`ok: true`，0 findings
- Toy 预览：新品牌、范围说明、英文页脚和完整知识内容正常载入
- 搜索 smoke：`存档 云` 唯一命中“本地成功不能被云失败回滚”
- 正式页 smoke：新品牌存在、旧品牌不存在、正式 CANOPY 游戏链接正确、内容统计存在、搜索正常

## 发布边界

- 本次只更新 Toy `11306522433536`。
- 未修改 CANOPY 游戏 Toy `10228414336000`。
- 未修改 CANOPY 玩家 Wiki Toy `11151719061504`。
