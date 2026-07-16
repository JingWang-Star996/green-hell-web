import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { INITIAL_SAVE_STATUS } from "../../src/game/persistence";
import { createInitialState } from "../../src/game/sim/state";
import {
  PANEL_FOCUSABLE_SELECTOR,
  Panels,
  PAUSE_SECTION_IDS,
} from "../../src/game/ui/Panels";
import { createGameViewModel } from "../../src/game/ui/viewModel";

const noop = () => undefined;

test("ESC opens a focused overview and separates secondary operations into four sections", () => {
  const view = createGameViewModel(createInitialState("pause-information-architecture"));
  const markup = renderToStaticMarkup(createElement(Panels, {
    active: "pause",
    feedback: null,
    watch: view.watch,
    inventory: view.inventory,
    recipes: view.recipes,
    body: view.body,
    objectives: view.objectives,
    events: view.events,
    landmarks: view.landmarks,
    mapChunks: view.mapChunks,
    score: view.score,
    audioEnabled: true,
    reducedMotion: false,
    saveStatus: INITIAL_SAVE_STATUS,
    onClose: noop,
    onCraft: () => false,
    onItemAction: noop,
    onTreatWound: noop,
    onTreatParasites: noop,
    onResume: noop,
    onRestart: noop,
    onManualSave: noop,
    onToggleAudio: noop,
    onToggleReducedMotion: noop,
  }));

  assert.deepEqual(PAUSE_SECTION_IDS, ["overview", "saves", "settings", "session"]);
  assert.match(markup, /role="tablist" aria-label="暂停菜单分类"/);
  for (const label of ["总览", "存档与恢复", "显示与声音", "本局管理"]) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.match(markup, /id="pause-tab-overview"[^>]*aria-selected="true"/);
  assert.match(markup, /role="tabpanel" aria-labelledby="pause-tab-overview"/);
  assert.match(markup, /返回雨林/);
  assert.match(markup, /返回前检查/);
  assert.match(markup, /保存当前活动档/);
  assert.doesNotMatch(markup, /恢复点时间线/);
  assert.doesNotMatch(markup, /放弃本局并重新开始/);
});

test("panel focus containment includes settings and save-transfer form controls", () => {
  assert.match(PANEL_FOCUSABLE_SELECTOR, /input:not\(\[disabled\]\):not\(\[type='hidden'\]\):not\(\[tabindex='-1'\]\)/);
  assert.match(PANEL_FOCUSABLE_SELECTOR, /select:not\(\[disabled\]\)/);
  assert.match(PANEL_FOCUSABLE_SELECTOR, /textarea:not\(\[disabled\]\)/);
});
