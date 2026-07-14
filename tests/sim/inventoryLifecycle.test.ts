import assert from "node:assert/strict";
import test from "node:test";

import { FOOD_SPOILAGE, TOOL_DURABILITY } from "../../src/game/sim/content";
import {
  applyCommand,
  createInitialState,
  getDurableToolInventoryStatus,
  getPerishableInventoryStatus,
  migrateGameState,
  selectGameView,
  stepSimulation,
} from "../../src/game/sim/index";
import { createGameViewModel } from "../../src/game/ui/viewModel";

test("legacy saves gain full-life food batches and full-durability tools without mutating the payload", () => {
  const legacy = createInitialState("legacy-lifecycle");
  legacy.inventory.grubs = 2;
  legacy.inventory.axe = 1;
  delete legacy.itemLifecycle;

  const migrated = migrateGameState(legacy);
  const food = getPerishableInventoryStatus(migrated, "grubs");
  const axe = getDurableToolInventoryStatus(migrated, "axe");

  assert.equal(legacy.itemLifecycle, undefined);
  assert.equal(food.quantity, 2);
  assert.equal(food.secondsUntilNextSpoilage, FOOD_SPOILAGE.grubs.shelfLifeSeconds);
  assert.deepEqual(axe.durabilities, [TOOL_DURABILITY.axe.maxDurability]);
  assert.equal(migrated.version, 1, "the compatible save schema remains version 1");
});

test("perishable food expires on deterministic simulation ticks with explicit feedback", () => {
  const entityId = "resource.grubs.log-01";
  let state = createInitialState("spoilage-clock");
  state.player.position = { ...state.world.entities[entityId].position };
  state = applyCommand(state, { type: "pick-up", entityId });

  const collected = getPerishableInventoryStatus(state, "grubs");
  assert.equal(collected.quantity, 1);
  assert.equal(collected.secondsUntilNextSpoilage, FOOD_SPOILAGE.grubs.shelfLifeSeconds);
  assert.match(
    createGameViewModel(state).inventory.find((item) => item.id === "grubs")
      ?.statusLabel ?? "",
    /分钟后腐坏/,
  );

  state = stepSimulation(state, {}, FOOD_SPOILAGE.grubs.shelfLifeSeconds - 1);
  assert.equal(state.inventory.grubs, 1);
  state = stepSimulation(state, {}, 2);

  assert.equal(state.inventory.grubs, 0);
  const spoilage = state.eventLog.findLast((event) => event.type === "food-spoiled");
  assert.equal(spoilage?.details?.itemId, "grubs");
  assert.equal(spoilage?.details?.amount, 1);
  assert.match(spoilage?.message ?? "", /腐坏/);
});

test("new food does not reset an older batch and eating consumes the earliest batch first", () => {
  const entityId = "resource.grubs.log-01";
  let state = createInitialState("spoilage-batches");
  state.player.position = { ...state.world.entities[entityId].position };
  state = applyCommand(state, { type: "pick-up", entityId });
  const firstExpiry = getPerishableInventoryStatus(state, "grubs").nextExpiryTick;
  assert.ok(firstExpiry);

  state = stepSimulation(state, {}, 30);
  state = applyCommand(state, { type: "pick-up", entityId });
  assert.equal(state.inventory.grubs, 2);
  assert.equal(
    getPerishableInventoryStatus(state, "grubs").nextExpiryTick,
    firstExpiry,
  );

  state = applyCommand(state, { type: "eat", itemId: "grubs" });
  assert.equal(state.inventory.grubs, 1);
  assert.ok(
    (getPerishableInventoryStatus(state, "grubs").nextExpiryTick ?? 0) >
      firstExpiry,
    "the fresher batch must retain its later deadline",
  );
});

test("axe harvesting and spear encounters consume durability, break tools, and project status to UI", () => {
  const stickEntityId = "resource.stick.camp-01";
  let state = createInitialState("durability-actions");
  state.inventory.axe = 1;
  state = migrateGameState(state);
  state.player.position = { ...state.world.entities[stickEntityId].position };
  state = applyCommand(state, {
    type: "pick-up",
    entityId: stickEntityId,
    amount: 3,
  });

  const axe = getDurableToolInventoryStatus(state, "axe");
  assert.equal(axe.activeDurability, TOOL_DURABILITY.axe.maxDurability - 1);
  assert.equal(
    selectGameView(state).inventoryLifecycle.tools.find(
      (tool) => tool.itemId === "axe",
    )?.activeDurability,
    axe.activeDurability,
  );
  assert.match(
    createGameViewModel(state).inventory.find((item) => item.id === "axe")
      ?.statusLabel ?? "",
    /耐久 35\/36/,
  );

  const hazardId = "hazard.snake.stream-ridge";
  state.inventory.spear = 1;
  state.itemLifecycle!.tools.spear = [
    { durability: 5, maxDurability: TOOL_DURABILITY.spear.maxDurability },
  ];
  state.player.position = { ...state.world.entities[hazardId].position };
  state = applyCommand(state, { type: "encounter-hazard", entityId: hazardId });

  assert.equal(state.inventory.spear, 0);
  assert.ok(state.eventLog.some((event) => event.type === "tool-broken"));
  assert.equal(
    getDurableToolInventoryStatus(state, "spear").activeDurability,
    0,
  );
  assert.equal(
    state.eventLog.at(-1)?.type,
    "threat-avoided",
    "the spear still resolves the encounter that breaks it",
  );
});
