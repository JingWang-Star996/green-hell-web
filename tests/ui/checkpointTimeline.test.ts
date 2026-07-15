import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import type { CheckpointTimelineEntry } from "../../src/game/persistence";
import { CheckpointTimelinePanel } from "../../src/game/ui/Panels";

const entry: CheckpointTimelineEntry = {
  slotId: "auto-4",
  kind: "auto",
  reason: "rest-before",
  sequence: 12,
  createdAt: new Date("2026-07-15T08:30:00.000Z").getTime(),
  gameDay: 3,
  minuteOfDay: 9 * 60 + 19,
  elapsedSeconds: 7_740,
  objectiveLabel: "建立雨水收集器",
  position: { x: 18.4, z: -42.2 },
  biomeLabel: "河岸雨林",
  health: 63,
  majorStatuses: [
    { label: "开放伤口", severity: "critical" },
    { label: "水分偏低", severity: "warning" },
  ],
  storm: true,
  combat: false,
  danger: true,
  safety: "caution",
  localDurability: "persistent",
  cloudDurability: "local-only",
  recordChecksum: "fnv1a32:12345678",
  validation: "verified",
  recoveredFromBackup: false,
};

test("checkpoint cards expose enough context to choose safely and never imply cloud sync", () => {
  const markup = renderToStaticMarkup(createElement(CheckpointTimelinePanel, {
    entries: [entry],
    recommendedSlotId: entry.slotId,
    mode: "manage",
    onSaveManual: () => undefined,
    onSelect: () => undefined,
  }));

  assert.match(markup, /手动档独立保留/);
  assert.match(markup, /保存到手动槽 1/);
  assert.match(markup, /保存到手动槽 2/);
  assert.match(markup, /保存到手动槽 3/);
  assert.match(markup, /第 3 天 · 09:19/);
  assert.match(markup, /休息前/);
  assert.match(markup, /2 小时 9 分/);
  assert.match(markup, /河岸雨林/);
  assert.match(markup, /建立雨水收集器/);
  assert.match(markup, /生命 63/);
  assert.match(markup, /危急：开放伤口/);
  assert.match(markup, /暴雨 · 危险区/);
  assert.match(markup, /本地持久/);
  assert.match(markup, /云端未同步/);
  assert.match(markup, /校验通过/);
  assert.match(markup, /推荐安全点/);
  assert.doesNotMatch(markup, /云端已同步/);
});

test("checkpoint cards distinguish pending, synced, and local-only Toy durability", () => {
  const markup = renderToStaticMarkup(createElement(CheckpointTimelinePanel, {
    entries: [
      { ...entry, slotId: "auto-1", cloudDurability: "synced" },
      { ...entry, slotId: "auto-2", cloudDurability: "pending" },
      { ...entry, slotId: "auto-3", cloudDurability: "local-only" },
    ],
    recommendedSlotId: "auto-1",
    mode: "manage",
    onSaveManual: () => undefined,
    onSelect: () => undefined,
  }));

  assert.match(markup, /Toy 云端已同步/);
  assert.match(markup, /Toy 云端同步中/);
  assert.match(markup, /仅本地 · 云端未同步/);
});

test("death recovery and rest barrier contracts remain visible in the client", () => {
  const source = readFileSync(new URL("../../src/game/GameClient.tsx", import.meta.url), "utf8");
  const coordinatorSource = readFileSync(
    new URL("../../src/game/persistence/saveCoordinator.ts", import.meta.url),
    "utf8",
  );
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /选择恢复点/);
  assert.match(source, /正在建立休息前恢复点/);
  assert.match(source, /runVerifiedCheckpointTransaction/);
  assert.match(source, /createCheckpointMetadata\(staged, "rest-after"\)/);
  assert.match(source, /checkpointRecoveryInFlightRef\.current/);
  assert.match(coordinatorSource, /publishCheckpointCloudCompletion/);
  assert.match(source, /activePanelRef\.current = null;\s*setActivePanel\(null\);\s*finishBarrier/);
  assert.match(source, /const openPanel = useCallback\(\(panel: PanelId\) => \{\s*if \(restCheckpointBarrierRef\.current\) return;/);
  assert.match(source, /visible=\{rendererReady && !activePanel && !resolution && restCheckpointBarrier\.phase !== "saving"\}/);
  assert.match(source, /if \(!rendererReadyRef\.current \|\| restCheckpointBarrierRef\.current\) return;/);
  assert.match(source, /当前游戏状态不会改变/);
  assert.match(css, /\.checkpoint-recovery-card\s*\{[^}]*max-height:\s*min\(92dvh/);
  assert.match(css, /\.checkpoint-recovery-card\s*\{[^}]*width:\s*100vw/);
});
