import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TOOL_DURABILITY,
  TORCH_BURN_SEGMENT_SECONDS,
} from "../../src/game/sim/content";
import { createInitialState } from "../../src/game/sim/state";
import { simulationSecondsToGameMinutes } from "../../src/game/sim/time";
import { Panels } from "../../src/game/ui/Panels";
import { createGameViewModel } from "../../src/game/ui/viewModel";

const noop = () => undefined;

test("water inventory projects one conserved coconut-shell lifecycle on every related row", () => {
  const state = createInitialState("water-container-view");
  state.inventory["coconut-shell"] = 5;
  state.inventory["dirty-water"] = 2;
  state.inventory["clean-water"] = 1;

  const inventory = createGameViewModel(state).inventory;
  const shell = inventory.find((item) => item.id === "coconut-shell");
  const dirty = inventory.find((item) => item.id === "dirty-water");
  const clean = inventory.find((item) => item.id === "clean-water");

  assert.deepEqual(shell?.waterContainer, {
    role: "container",
    total: 5,
    empty: 2,
    dirtyWater: 2,
    cleanWater: 1,
  });
  assert.equal(dirty?.waterContainer?.role, "dirty-water");
  assert.equal(clean?.waterContainer?.role, "clean-water");
  assert.deepEqual(
    dirty?.waterContainer && {
      total: dirty.waterContainer.total,
      empty: dirty.waterContainer.empty,
      dirtyWater: dirty.waterContainer.dirtyWater,
      cleanWater: dirty.waterContainer.cleanWater,
    },
    { total: 5, empty: 2, dirtyWater: 2, cleanWater: 1 },
  );
  assert.equal(
    shell!.waterContainer!.total,
    shell!.waterContainer!.empty +
      shell!.waterContainer!.dirtyWater +
      shell!.waterContainer!.cleanWater,
  );
  assert.match(dirty?.statusLabel ?? "", /占用椰壳 2\/5/);
  assert.match(clean?.statusLabel ?? "", /饮用后释放空壳/);
});

test("the read-only water projection remains conserved for an inconsistent legacy payload", () => {
  const state = createInitialState("water-container-legacy-conflict");
  state.inventory["coconut-shell"] = 1;
  state.inventory["dirty-water"] = 2;
  state.inventory["clean-water"] = 1;

  const before = { ...state.inventory };
  const lifecycle = createGameViewModel(state).inventory.find(
    (item) => item.id === "dirty-water",
  )?.waterContainer;

  assert.deepEqual(lifecycle, {
    role: "dirty-water",
    total: 3,
    empty: 0,
    dirtyWater: 2,
    cleanWater: 1,
  });
  assert.deepEqual(state.inventory, before, "the view must not repair or mutate the save");
});

test("durable units are weakest-first, mark the equipped concrete unit, and survive equipment switching", () => {
  const state = createInitialState("durable-order-view");
  state.inventory.axe = 2;
  state.inventory.spear = 1;
  state.itemLifecycle!.tools.axe = [
    { durability: 20, maxDurability: TOOL_DURABILITY.axe.maxDurability },
    { durability: 5, maxDurability: TOOL_DURABILITY.axe.maxDurability },
  ];
  state.itemLifecycle!.tools.spear = [
    { durability: 9, maxDurability: TOOL_DURABILITY.spear.maxDurability },
  ];
  state.player.equippedItem = "axe";

  const equippedAxe = createGameViewModel(state).inventory.find(
    (item) => item.id === "axe",
  );
  assert.deepEqual(
    equippedAxe?.durableUnits?.map((unit) => [unit.durability, unit.role]),
    [[5, "equipped"], [20, "reserve"]],
  );
  assert.deepEqual(
    state.itemLifecycle?.tools.axe?.map((tool) => tool.durability),
    [20, 5],
    "sorting the view must not reorder persisted units",
  );

  state.player.equippedItem = "spear";
  const switched = createGameViewModel(state).inventory;
  assert.equal(
    switched.find((item) => item.id === "axe")?.durableUnits?.[0].role,
    "next-use",
  );
  assert.equal(
    switched.find((item) => item.id === "spear")?.durableUnits?.[0].role,
    "equipped",
  );
});

test("old saves and zero-count tools project honest per-unit lifecycle without mutation", () => {
  const legacy = createInitialState("legacy-tool-view");
  legacy.inventory.axe = 2;
  legacy.inventory.spear = 0;
  delete legacy.itemLifecycle;

  const inventory = createGameViewModel(legacy).inventory;
  const axe = inventory.find((item) => item.id === "axe");
  const spear = inventory.find((item) => item.id === "spear");

  assert.equal(legacy.itemLifecycle, undefined);
  assert.deepEqual(
    axe?.durableUnits?.map((unit) => unit.durability),
    [TOOL_DURABILITY.axe.maxDurability, TOOL_DURABILITY.axe.maxDurability],
  );
  assert.deepEqual(
    axe?.durableUnits?.map((unit) => unit.role),
    ["next-use", "reserve"],
  );
  assert.equal(spear?.durableUnits, undefined);
  assert.equal(spear?.statusLabel, undefined);
});

test("each torch projects its own exact fuel even while the type is stowed", () => {
  const state = createInitialState("torch-unit-view");
  state.inventory.torch = 2;
  state.itemLifecycle!.tools.torch = [
    {
      durability: 4,
      maxDurability: TOOL_DURABILITY.torch.maxDurability,
      remainingUseSeconds: TORCH_BURN_SEGMENT_SECONDS * 4,
    },
    {
      durability: 2,
      maxDurability: TOOL_DURABILITY.torch.maxDurability,
      remainingUseSeconds: TORCH_BURN_SEGMENT_SECONDS * 1.5,
    },
  ];
  state.player.equippedItem = "torch";

  const equipped = createGameViewModel(state).inventory.find(
    (item) => item.id === "torch",
  )!;
  assert.deepEqual(
    equipped.durableUnits?.map((unit) => unit.durability),
    [1.5, 4],
  );
  assert.equal(equipped.durableUnits?.[0].role, "equipped");
  assert.equal(
    equipped.durableUnits?.[0].remainingGameMinutes,
    simulationSecondsToGameMinutes(TORCH_BURN_SEGMENT_SECONDS * 1.5),
  );
  assert.match(equipped.durableUnits?.[0].statusLabel ?? "", /1\.5\/6 段/);

  state.player.equippedItem = undefined;
  const stowed = createGameViewModel(state).inventory.find(
    (item) => item.id === "torch",
  )!;
  assert.equal(stowed.durableUnits?.[0].role, "next-use");
  assert.deepEqual(
    stowed.durableUnits?.map((unit) => unit.durability),
    [1.5, 4],
    "stowing must not restore the partially burned segment",
  );
});

test("inventory markup exposes container definitions and concrete tool order accessibly", () => {
  const state = createInitialState("inventory-lifecycle-markup");
  state.inventory["coconut-shell"] = 4;
  state.inventory["dirty-water"] = 1;
  state.inventory["clean-water"] = 1;
  state.inventory.axe = 2;
  state.itemLifecycle!.tools.axe = [
    { durability: 12, maxDurability: TOOL_DURABILITY.axe.maxDurability },
    { durability: 5, maxDurability: TOOL_DURABILITY.axe.maxDurability },
  ];
  state.player.equippedItem = "axe";
  const view = createGameViewModel(state);

  const markup = renderToStaticMarkup(
    createElement(Panels, {
      active: "inventory",
      feedback: null,
      watch: view.watch,
      inventory: view.inventory,
      recipes: [],
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

  assert.match(markup, /aria-label="椰壳容器占用"/);
  assert.match(markup, /<dt>总数<\/dt><dd>4<\/dd>/);
  assert.match(markup, /<dt>空壳<\/dt><dd>2<\/dd>/);
  assert.match(markup, /aria-label="石斧按实际使用顺序"/);
  assert.match(markup, /aria-current="true"/);
  assert.match(markup, /已装备 · 当前使用/);
  assert.match(markup, /石斧第 1 件，已装备 · 当前使用，耐久 5\/36/);
  assert.match(markup, /<meter[^>]*value="5"/);
});
