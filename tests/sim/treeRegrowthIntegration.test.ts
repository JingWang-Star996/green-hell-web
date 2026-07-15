import assert from "node:assert/strict";
import test from "node:test";

import { RIVER_GAUGE_OBSTRUCTION_ID } from "../../src/game/sim/campaignContent";
import { TOOL_DURABILITY } from "../../src/game/sim/content";
import {
  DEFAULT_STRUCTURE_PLACEMENTS,
  FIXED_HZ,
  REST_SIMULATION_SECONDS,
  applyCommand,
  createInitialState,
  migrateGameState,
  stepSimulation,
} from "../../src/game/sim/index";
import {
  advanceTreeRegrowthEntity,
  beginTreeRegrowth,
  effectiveTreeGrowthStage,
  effectiveTreeSize,
  treeRegrowthEligible,
} from "../../src/game/sim/treeRegrowthRuntime";
import {
  treeHarvestPhase,
  treeInteractionAnchor,
} from "../../src/game/sim/treeHarvest";
import type {
  DurableToolId,
  GameState,
  WorldEntity,
} from "../../src/game/sim/types";
import {
  compactGameStateSavePayload,
  dematerializeGeneratedWorldChunk,
  expandGameStateSavePayload,
  materializeGeneratedWorldChunk,
} from "../../src/game/world/saveDelta";

function giveTool(
  state: GameState,
  itemId: DurableToolId,
): GameState {
  state.inventory[itemId] = 1;
  state.itemLifecycle!.tools[itemId] = [
    {
      durability: TOOL_DURABILITY[itemId].maxDurability,
      maxDurability: TOOL_DURABILITY[itemId].maxDurability,
    },
  ];
  return applyCommand(state, { type: "equip-item", itemId });
}

function moveToTreeAnchor(state: GameState, treeId: string): GameState {
  const tree = state.world.entities[treeId];
  assert.ok(tree, `missing tree ${treeId}`);
  const anchor = treeInteractionAnchor(tree);
  return applyCommand(state, {
    type: "move-player",
    position: { x: anchor.x, y: 0, z: anchor.z },
    look: { yaw: state.player.lookYaw ?? Math.PI, pitch: -0.4 },
  });
}

function ordinaryGeneratedTree(state: GameState): WorldEntity {
  const tree = Object.values(state.world.entities)
    .filter(
      (entity) =>
        entity.semantic?.category === "tree" &&
        entity.tags.includes("chunk:0:0") &&
        entity.semantic.action === "chop",
    )
    .sort((left, right) => left.quantity - right.quantity)[0];
  assert.ok(tree, "fixture needs an ordinary generated tree in chunk 0:0");
  return tree;
}

function fullyProcessOrdinaryGeneratedTree(seed: string): {
  state: GameState;
  treeId: string;
} {
  let state = createInitialState(seed);
  const selected = ordinaryGeneratedTree(state);
  const treeId = selected.id;
  assert.equal(treeRegrowthEligible(selected), true);
  assert.equal(selected.tags.includes("nonrenewable"), false);

  state = giveTool(state, "axe");
  state = moveToTreeAnchor(state, treeId);
  let guard = 0;
  while (state.world.entities[treeId].quantity > 0) {
    state = applyCommand(state, { type: "harvest", entityId: treeId });
    guard += 1;
    assert.ok(guard < 40, "standing work must terminate");
  }
  assert.notEqual(treeHarvestPhase(state.world.entities[treeId]), "stump");

  while (state.world.entities[treeId].treeHarvest) {
    state = moveToTreeAnchor(state, treeId);
    state = applyCommand(state, { type: "harvest", entityId: treeId });
    guard += 1;
    assert.ok(guard < 80, "felled processing must terminate");
  }
  return { state, treeId };
}

function treeChunkCoordinate(tree: WorldEntity): { x: number; z: number } {
  const key = tree.tags.find((tag) => tag.startsWith("chunk:"))?.slice(6);
  assert.ok(key, "generated tree needs a chunk tag");
  const [x, z] = key.split(":").map(Number);
  assert.ok(Number.isSafeInteger(x) && Number.isSafeInteger(z));
  return { x: x!, z: z! };
}

function prepareSafeRest(state: GameState): GameState {
  state.camp.bedBuilt = true;
  state.camp.shelterBuilt = true;
  state.player.position = { ...DEFAULT_STRUCTURE_PLACEMENTS.bed.position };
  state.player.conditions.wound.open = false;
  state.player.conditions.wound.treated = true;
  state.player.conditions.wound.severity = 0;
  state.player.conditions.wound.infection = 0;
  state.player.nutrition = {
    carbohydrates: 100,
    protein: 100,
    fat: 100,
    hydration: 100,
  };
  state.player.vitals.health = 100;
  state.player.vitals.energy = 100;
  return state;
}

test("a fully processed ordinary generated tree enters a persistent stump schedule", () => {
  const { state, treeId } = fullyProcessOrdinaryGeneratedTree(
    "tree-regrowth-player-loop",
  );
  const tree = state.world.entities[treeId];

  assert.equal(tree.quantity, 0);
  assert.equal(tree.depleted, true);
  assert.equal(tree.treeHarvest, undefined);
  assert.equal(tree.treeRegrowth?.stage, "stump");
  assert.equal(
    tree.treeRegrowth?.schedule.stumpStartedAtTick,
    state.clock.tick,
  );
  assert.ok(
    (tree.treeRegrowth?.schedule.saplingAtTick ?? 0) > state.clock.tick,
  );
});

test("objective, rare, and explicitly nonrenewable trees never start regrowth", () => {
  const state = createInitialState("tree-regrowth-exclusions");
  const objective = state.world.entities[RIVER_GAUGE_OBSTRUCTION_ID];
  assert.ok(objective.tags.includes("objective"));
  objective.quantity = 0;
  objective.depleted = true;
  delete objective.treeHarvest;
  assert.equal(treeRegrowthEligible(objective), false);
  assert.equal(beginTreeRegrowth(state.seed, state.clock.tick, objective), false);
  assert.equal(objective.treeRegrowth, undefined);

  const rare = {
    ...state.world.entities["resource.tree.camp-east"],
    tags: ["standing-tree", "rare"],
    quantity: 0,
    depleted: true,
  };
  delete rare.treeHarvest;
  assert.equal(beginTreeRegrowth(state.seed, state.clock.tick, rare), false);

  const nonrenewable = {
    ...state.world.entities["resource.tree.camp-west"],
    tags: ["standing-tree", "nonrenewable"],
    quantity: 0,
    depleted: true,
  };
  delete nonrenewable.treeHarvest;
  assert.equal(
    beginTreeRegrowth(state.seed, state.clock.tick, nonrenewable),
    false,
  );
});

test("generated stump schedule survives streaming and compact v3 before catching up", () => {
  const completed = fullyProcessOrdinaryGeneratedTree(
    "tree-regrowth-stream-save",
  );
  const { state, treeId } = completed;
  const original = state.world.entities[treeId];
  const coordinate = treeChunkCoordinate(original);
  const schedule = structuredClone(original.treeRegrowth!);

  dematerializeGeneratedWorldChunk(state, coordinate);
  assert.equal(state.world.entities[treeId], undefined);
  assert.deepEqual(state.world.entityDeltas?.[treeId].treeRegrowth, schedule);

  materializeGeneratedWorldChunk(state, coordinate);
  const rematerialized = state.world.entities[treeId] as WorldEntity | undefined;
  assert.ok(rematerialized);
  assert.deepEqual(rematerialized.treeRegrowth, schedule);
  dematerializeGeneratedWorldChunk(state, coordinate);

  const compact = compactGameStateSavePayload(state) as {
    world: { version: number; deltas: unknown[][] };
  };
  assert.equal(compact.world.version, 3);
  const tuple = compact.world.deltas.find((delta) => delta[0] === treeId);
  assert.ok(tuple);
  assert.equal(tuple.length, 6);
  assert.ok(Array.isArray(tuple[5]) && tuple[5].length === 9);

  const restored = migrateGameState(
    expandGameStateSavePayload(compact) as GameState,
  );
  assert.deepEqual(restored.world.entities[treeId].treeRegrowth, schedule);

  const catchUpSource = structuredClone(state);
  catchUpSource.clock.tick = schedule.schedule.saplingAtTick;
  catchUpSource.clock.elapsedSeconds = catchUpSource.clock.tick / FIXED_HZ;
  const caughtUp = migrateGameState(
    expandGameStateSavePayload(
      compactGameStateSavePayload(catchUpSource),
    ) as GameState,
  );
  assert.equal(caughtUp.world.entities[treeId].treeRegrowth?.stage, "sapling");
  assert.deepEqual(
    caughtUp.world.entities[treeId].treeRegrowth?.schedule,
    schedule.schedule,
  );
});

test("one long rest and equivalent fixed ticks reach the same mature authority", () => {
  const source = prepareSafeRest(createInitialState("tree-regrowth-rest-equivalence"));
  const treeId = "resource.tree.camp-east";
  const tree = source.world.entities[treeId];
  const baseline = tree.quantity;
  tree.quantity = 0;
  tree.depleted = true;
  delete tree.treeHarvest;
  assert.equal(beginTreeRegrowth(source.seed, source.clock.tick, tree), true);
  const schedule = structuredClone(tree.treeRegrowth!.schedule);
  const startTick = schedule.matureAtTick - REST_SIMULATION_SECONDS * FIXED_HZ;
  source.clock.tick = startTick;
  source.clock.elapsedSeconds = startTick / FIXED_HZ;
  const caughtUp = advanceTreeRegrowthEntity(startTick, tree);
  assert.equal(caughtUp?.stage, "young");
  assert.equal(tree.treeRegrowth?.stage, "young");

  const rested = applyCommand(source, { type: "rest" });
  const stepped = stepSimulation(source, {}, REST_SIMULATION_SECONDS);
  const restedTree = rested.world.entities[treeId];
  const steppedTree = stepped.world.entities[treeId];

  assert.equal(rested.clock.tick, schedule.matureAtTick);
  assert.equal(stepped.clock.tick, schedule.matureAtTick);
  assert.deepEqual(restedTree.treeRegrowth, steppedTree.treeRegrowth);
  assert.equal(restedTree.treeRegrowth?.stage, "mature");
  assert.equal(restedTree.quantity, baseline);
  assert.equal(effectiveTreeGrowthStage(restedTree), "mature");
  assert.equal(effectiveTreeSize(restedTree), "large");

  restedTree.quantity = 0;
  restedTree.depleted = true;
  delete restedTree.treeHarvest;
  assert.equal(beginTreeRegrowth(rested.seed, rested.clock.tick, restedTree), true);
  assert.equal(restedTree.treeRegrowth?.cycle, 1);
  assert.equal(restedTree.treeRegrowth?.stage, "stump");
  assert.notDeepEqual(restedTree.treeRegrowth?.schedule, schedule);
});
