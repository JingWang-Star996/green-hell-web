export const CANONICAL_PLAYER_WIKI_URL =
  "https://www.bilibili.com/toy/canopy-survival-wiki/index.html";

export type GameReleaseChange = Readonly<{
  category: "新增" | "世界" | "多端" | "存档" | "修复" | "优化";
  text: string;
}>;

export type GameReleaseNote = Readonly<{
  /** Player-facing build identity. Add a serial suffix for multiple releases on one day. */
  buildId: `${number}.${number}.${number}.${number}`;
  /** ISO calendar date shown to players. */
  date: `${number}-${number}-${number}`;
  /** Candidate entries remain editable until the matching Toy artifact is published. */
  status: "candidate" | "published";
  title: string;
  changes: readonly GameReleaseChange[];
}>;

/**
 * Public release ledger, newest first.
 *
 * Every player-visible Toy update must prepend one candidate entry. A candidate
 * may be corrected while it is still private; after the matching Toy artifact
 * is public, flip it to published and never rewrite or delete it.
 */
export const GAME_RELEASE_NOTES = [
  {
    buildId: "2026.07.16.1",
    date: "2026-07-16",
    status: "candidate",
    title: "Living Forest 基础、多端体验与恢复能力",
    changes: [
      {
        category: "新增",
        text: "开始页加入版本化更新公告；此后的玩家可见更新会在这里保留日期与变更条目。",
      },
      {
        category: "新增",
        text: "加入 CANOPY 玩家 Wiki 正式入口，游戏与生存档案现在可以双向跳转。",
      },
      {
        category: "新增",
        text: "加入“前哨迁营”纵切：空烟熏架与空雨水收集架可二次确认拆除，返还部分材料并自动保存。",
      },
      {
        category: "世界",
        text: "汇总当前 Living Forest 基础：语义化树木、岩石与植物交互，资源导演及普通树木分阶段再生。",
      },
      {
        category: "多端",
        text: "完善触控菜单、移动端制作与装备入口，并收紧竖屏和短横屏的信息占用。",
      },
      {
        category: "存档",
        text: "完善本地优先保存、存档导入导出、手动档位与多个自动恢复点。",
      },
    ],
  },
] as const satisfies readonly GameReleaseNote[];

export const LATEST_GAME_RELEASE = GAME_RELEASE_NOTES[0];
