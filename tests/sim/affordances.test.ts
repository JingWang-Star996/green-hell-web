import assert from "node:assert/strict";
import test from "node:test";

import { ITEMS } from "../../src/game/sim/content";
import { MAXIMUM_FIRE_FUEL_SECONDS } from "../../src/game/sim/time";
import {
  affordanceAcceptsInput,
  interactionModeForAffordance,
  resolveAffordance,
  type AffordanceEntitySemantic,
} from "../../src/game/sim/affordances";
import { createInitialState } from "../../src/game/sim/state";
import type {
  GameState,
  PlacedStructureKind,
  PlacedStructureState,
  WorldEntity,
} from "../../src/game/sim/types";

function structure(kind: PlacedStructureKind): PlacedStructureState {
  return {
    id: `structure.${kind}.affordance-test`,
    kind,
    position: { x: 2, y: 0, z: 2 },
    yaw: 0,
    builtAtTick: 0,
  };
}

function withSemantic(
  source: WorldEntity,
  semantic: AffordanceEntitySemantic,
): WorldEntity {
  return { ...source, semantic } as WorldEntity;
}

function establishBatteryPrerequisites(state: GameState): void {
  state.objectives.flags.campEstablished = true;
  state.knowledge!.inspectedLandmarkIds = [
    "landmark.camp-radio",
    "landmark.survey-cache",
    "landmark.weather-station",
  ];
}

test("interaction modes derive once from affordance truth", () => {
  assert.equal(
    interactionModeForAffordance({ state: "ready", actionId: "pickup" }),
    "execute",
  );
  assert.equal(
    interactionModeForAffordance({ state: "ready", actionId: "inspect" }),
    "inspect",
  );
  assert.equal(
    interactionModeForAffordance({ state: "ambient", actionId: "observe" }),
    "inspect",
  );
  assert.equal(
    interactionModeForAffordance({ state: "danger", actionId: "avoid" }),
    "movement",
  );
  assert.equal(
    interactionModeForAffordance({ state: "blocked", actionId: "inspect" }),
    "unavailable",
  );
  assert.equal(
    interactionModeForAffordance({ state: "blocked", actionId: "chop" }),
    "unavailable",
  );
  assert.equal(affordanceAcceptsInput({ interactionMode: "execute" }), true);
  assert.equal(affordanceAcceptsInput({ interactionMode: "inspect" }), true);
  assert.equal(affordanceAcceptsInput({ interactionMode: "movement" }), false);
  assert.equal(affordanceAcceptsInput({ interactionMode: "unavailable" }), false);
});

test("standing and semantic trees expose chop/cut capability instead of pickup", () => {
  const state = createInitialState("affordance-tree");
  const tree = state.world.entities["resource.tree.camp-east"];
  const blocked = resolveAffordance(state, tree);

  assert.equal(blocked.semanticKind, "tree");
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.actionId, "chop");
  assert.equal(blocked.requiredItem, "axe");
  assert.equal(blocked.blocker, "missing-required-tool");

  state.inventory.axe = 1;
  state.player.equippedItem = "axe";
  const ready = resolveAffordance(state, tree);
  assert.equal(ready.state, "ready");
  assert.equal(ready.animationKey, "tool.axe.chop");

  const sapling = withSemantic(
    { ...tree, id: "semantic.tree.sapling", tags: [] },
    {
      category: "tree",
      action: "cut",
      toolClass: "blade",
      toolTier: 1,
    },
  );
  const saplingBlocked = resolveAffordance(state, sapling);
  assert.equal(saplingBlocked.semanticKind, "tree");
  assert.equal(saplingBlocked.actionId, "cut");
  assert.equal(saplingBlocked.requiredItem, "stone-blade");
  assert.equal(saplingBlocked.state, "blocked");
});

test("discrete semantic rocks require a mining tool and never degrade to ground pickup", () => {
  const state = createInitialState("affordance-rock");
  const source = state.world.entities["resource.stone.camp-01"];
  const rock = withSemantic(
    { ...source, id: "semantic.mineable-rock.test", tags: [] },
    {
      category: "mineable-rock",
      material: "granite",
      action: "mine",
      toolClass: "pick",
      toolTier: 1,
      primaryMaterial: "stone",
      yieldTableId: "rock/granite/medium",
      yieldMinimum: 3,
      yieldMaximum: 5,
    },
  );

  const result = resolveAffordance(state, rock);
  assert.equal(result.semanticKind, "mineable-rock");
  assert.equal(result.state, "blocked");
  assert.equal(result.actionId, "mine");
  assert.equal(result.requiredItem, "stone-pick");
  assert.equal(result.blocker, "missing-mining-tool");
  assert.match(result.preview.detail, /需要采矿工具/);
  assert.equal(result.preview.primaryMaterial, "stone");
  assert.equal(result.preview.yieldTableId, "rock/granite/medium");

  state.inventory["stone-pick"] = 1;
  assert.equal(resolveAffordance(state, rock).blocker, "required-tool-not-equipped");
  state.player.equippedItem = "stone-pick";
  const ready = resolveAffordance(state, rock);
  assert.equal(ready.state, "ready");
  assert.equal(ready.actionId, "mine");
});

test("materialized flat semantic metadata routes real generated trees and rocks", () => {
  const state = createInitialState("affordance-flat-semantic-world");
  const entities = Object.values(state.world.entities);
  const tree = entities.find((entity) => entity.semantic?.category === "tree");
  const rock = entities.find(
    (entity) => entity.semantic?.category === "mineable-rock",
  );
  assert.ok(tree);
  assert.ok(rock);

  const treeAffordance = resolveAffordance(state, tree);
  assert.equal(treeAffordance.semanticKind, "tree");
  assert.notEqual(treeAffordance.actionId, "pickup");
  assert.equal(treeAffordance.preview.toolClass, tree.semantic?.toolClass);
  assert.equal(treeAffordance.preview.yieldTableId, tree.semantic?.yieldTableId);

  const rockAffordance = resolveAffordance(state, rock);
  assert.equal(rockAffordance.semanticKind, "mineable-rock");
  assert.equal(rockAffordance.actionId, "mine");
  assert.equal(rockAffordance.blocker, "missing-mining-tool");
});

test("pickup resources report full inventory and depletion before execution", () => {
  const state = createInitialState("affordance-pickup");
  const source = state.world.entities["resource.stone.camp-01"];
  state.inventory.stone = ITEMS.stone.stackLimit;

  const full = resolveAffordance(state, source);
  assert.equal(full.state, "blocked");
  assert.equal(full.actionId, "pickup");
  assert.equal(full.blocker, "inventory-full");
  assert.equal(full.preview.remainingCapacity, 0);

  const depleted = { ...source, quantity: 0, depleted: true };
  const empty = resolveAffordance(state, depleted);
  assert.equal(empty.state, "depleted");
  assert.equal(empty.highlightTone, "spent");
  assert.equal(empty.blocker, "resource-depleted");
});

test("water exposes container requirements and contamination before collection", () => {
  const state = createInitialState("affordance-water");
  const stream = state.world.entities["landmark.stream"];
  const blocked = resolveAffordance(state, stream);

  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.actionId, "collect-water");
  assert.equal(blocked.requiredItem, "coconut-shell");
  assert.equal(blocked.preview.contamination, 0.62);
  assert.equal(blocked.preview.contaminationBand, "unsafe");

  state.inventory["coconut-shell"] = 1;
  const ready = resolveAffordance(state, stream);
  assert.equal(ready.state, "ready");
  assert.equal(ready.blocker, null);
  assert.match(ready.preview.detail, /煮沸/);
});

test("snake affordance is dangerous while offering embodied attack and avoidance", () => {
  const state = createInitialState("affordance-snake");
  const snake = state.world.entities["hazard.snake.stream-ridge"];
  const avoid = resolveAffordance(state, snake);

  assert.equal(avoid.state, "danger");
  assert.equal(avoid.highlightTone, "threat");
  assert.equal(avoid.actionId, "avoid");
  assert.equal(avoid.preview.alternatives?.[0]?.actionId, "attack");
  assert.equal(avoid.preview.alternatives?.[0]?.available, false);

  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  const attack = resolveAffordance(state, snake);
  assert.equal(attack.state, "danger");
  assert.equal(attack.actionId, "attack");
  assert.equal(attack.verb, "主动刺击");
  assert.equal(attack.requiredItem, "spear");
});

test("recorded landmarks remain observable and prerequisites are visible early", () => {
  const state = createInitialState("affordance-landmarks");
  const radio = state.world.entities["landmark.camp-radio"];
  const weatherStation = state.world.entities["landmark.weather-station"];
  const battery = state.world.entities["resource.battery.weather-station"];

  assert.equal(resolveAffordance(state, radio).state, "ready");
  state.knowledge!.inspectedLandmarkIds.push(radio.id);
  const recorded = resolveAffordance(state, radio);
  assert.equal(recorded.state, "ambient");
  assert.equal(recorded.actionId, "observe");

  const stationBlocked = resolveAffordance(state, weatherStation);
  assert.equal(stationBlocked.state, "blocked");
  assert.deepEqual(stationBlocked.preview.missingPrerequisiteIds, [
    "landmark.survey-cache",
  ]);

  const batteryBlocked = resolveAffordance(state, battery);
  assert.equal(batteryBlocked.state, "blocked");
  assert.equal(batteryBlocked.blocker, "camp-not-established");

  establishBatteryPrerequisites(state);
  const toolBlocked = resolveAffordance(state, battery);
  assert.equal(toolBlocked.blocker, "missing-required-tool");
  assert.equal(toolBlocked.requiredItem, "axe");
  state.inventory.axe = 1;
  state.player.equippedItem = "axe";
  assert.equal(resolveAffordance(state, battery).state, "ready");
});

test("placed structures project maintenance, rest, shelter, and signal states", () => {
  const state = createInitialState("affordance-structures");
  const fire = structure("campfire");
  const bed = structure("bed");
  const shelter = structure("shelter");
  const beacon = structure("radio-beacon");

  state.camp.fire.built = true;
  state.camp.fire.lit = false;
  state.camp.fire.fuelSeconds = 25;
  const fireBlocked = resolveAffordance(state, fire);
  assert.equal(fireBlocked.state, "blocked");
  assert.equal(
    fireBlocked.blocker,
    "missing-tinder",
    "retained fuel can be relit without wasting another stick",
  );
  assert.equal(fireBlocked.preview.fuelSeconds, 25);

  state.inventory.stick = 1;
  state.inventory["dry-leaf"] = 1;
  const fireReady = resolveAffordance(state, fire);
  assert.equal(fireReady.state, "ready");
  assert.equal(fireReady.verb, "重新点火");

  state.camp.fire.lit = true;
  state.camp.fire.fuelSeconds = MAXIMUM_FIRE_FUEL_SECONDS;
  const fireFull = resolveAffordance(state, fire);
  assert.equal(fireFull.state, "blocked");
  assert.equal(fireFull.blocker, "fuel-full");
  assert.equal(
    fireFull.preview.fuelCapacitySeconds,
    MAXIMUM_FIRE_FUEL_SECONDS,
  );

  state.camp.bedBuilt = true;
  assert.equal(resolveAffordance(state, bed).actionId, "rest");
  state.camp.shelterBuilt = true;
  const cover = resolveAffordance(state, shelter);
  assert.equal(cover.state, "ambient");
  assert.equal(cover.preview.sheltered, true);

  const unbuiltBeacon = resolveAffordance(state, beacon);
  assert.equal(unbuiltBeacon.actionId, "repair");
  assert.equal(unbuiltBeacon.blocker, "structure-not-operational");
  state.camp.beaconBuilt = true;
  state.objectives.currentTaskId = "transmit-signal";
  const transmit = resolveAffordance(state, beacon);
  assert.equal(transmit.state, "ready");
  assert.equal(transmit.actionId, "transmit");
});

test("affordance resolution is deterministic and does not mutate state or target", () => {
  const state = createInitialState("affordance-purity");
  const target = state.world.entities["landmark.stream"];
  state.inventory["coconut-shell"] = 1;
  const stateBefore = structuredClone(state);
  const targetBefore = structuredClone(target);

  const first = resolveAffordance(state, target);
  const second = resolveAffordance(state, target);

  assert.deepEqual(second, first);
  assert.deepEqual(state, stateBefore);
  assert.deepEqual(target, targetBefore);
});
