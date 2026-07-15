import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ITEM_IDS } from "../../src/game/sim/types";
import { createInitialState } from "../../src/game/sim/state";
import { Panels } from "../../src/game/ui/Panels";
import {
  ITEM_ACQUISITION_HINTS,
  acquisitionHintForItem,
} from "../../src/game/ui/recipeRequirements";
import { createGameViewModel } from "../../src/game/ui/viewModel";

const noop = () => undefined;

test("every recipe item has ecological or upstream-production guidance without exact coordinates", () => {
  assert.deepEqual(Object.keys(ITEM_ACQUISITION_HINTS).sort(), [...ITEM_IDS].sort());
  for (const itemId of ITEM_IDS) {
    const hint = acquisitionHintForItem(itemId);
    assert.ok(hint.length >= 12, `${itemId} should have a useful acquisition hint`);
    assert.doesNotMatch(hint, /坐标|\b[xyz]\s*[:=]\s*-?\d|经度|纬度/i);
  }
});

test("recipe projection reports live owned versus required counts and non-consumed tools", () => {
  const state = createInitialState("recipe-requirement-counts");
  state.inventory.stone = 2;
  state.inventory.stick = 1;
  state.inventory.vine = 0;
  state.inventory["stone-blade"] = 1;

  const axe = createGameViewModel(state, ["axe"]).recipes.find((item) => item.id === "axe");
  assert.ok(axe);

  assert.deepEqual(
    axe.requirements?.find((item) => item.id === "material:stone"),
    {
      id: "material:stone",
      label: "石块",
      kind: "material",
      current: 2,
      required: 2,
      satisfied: true,
      consumed: true,
      acquisitionHint: ITEM_ACQUISITION_HINTS.stone,
    },
  );
  assert.equal(axe.requirements?.find((item) => item.id === "material:vine")?.satisfied, false);
  assert.deepEqual(
    axe.requirements?.find((item) => item.id === "tool:stone-blade"),
    {
      id: "tool:stone-blade",
      label: "石刃",
      kind: "tool",
      current: 1,
      required: 1,
      satisfied: true,
      consumed: false,
      acquisitionHint: ITEM_ACQUISITION_HINTS["stone-blade"],
    },
  );
});

test("rain collector counts only empty coconut shells as usable materials", () => {
  const state = createInitialState("recipe-empty-container-count");
  state.inventory["coconut-shell"] = 3;
  state.inventory["dirty-water"] = 2;

  const collector = createGameViewModel(state, ["rain-collector"]).recipes.find(
    (item) => item.id === "rain-collector",
  );
  const shell = collector?.requirements?.find((item) => item.id === "material:coconut-shell");
  assert.equal(shell?.label, "空椰壳");
  assert.equal(shell?.current, 1);
  assert.equal(shell?.required, 2);
  assert.equal(shell?.satisfied, false);
});

test("crafting markup distinguishes ready and missing requirements and exposes a click-to-open hint", () => {
  const state = createInitialState("recipe-requirement-markup");
  state.inventory.stone = 2;
  state.inventory.stick = 1;
  state.inventory.vine = 0;
  state.inventory["stone-blade"] = 1;
  const view = createGameViewModel(state, ["axe"]);
  const axe = view.recipes.find((item) => item.id === "axe");
  assert.ok(axe);

  const markup = renderToStaticMarkup(
    createElement(Panels, {
      active: "crafting",
      feedback: null,
      watch: view.watch,
      inventory: view.inventory,
      recipes: [axe],
      body: view.body,
      objectives: [],
      events: [],
      landmarks: [],
      mapChunks: [],
      score: 0,
      audioEnabled: true,
      reducedMotion: false,
      saveStatus: {} as never,
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
    }),
  );

  assert.match(markup, /requirement-ready requirement-material/);
  assert.match(markup, /requirement-missing requirement-material/);
  assert.match(markup, /已有 2 \/ 所需 2/);
  assert.match(markup, /已有 0 \/ 所需 1/);
  assert.match(markup, /<details><summary>/);
  assert.match(markup, /查看获取提示/);
  assert.match(markup, /河谷湿地、林缘和树干附近/);
  assert.match(markup, /工具不消耗/);
});
