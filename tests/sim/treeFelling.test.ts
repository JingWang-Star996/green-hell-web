import assert from "node:assert/strict";
import test from "node:test";

import {
  ITEMS,
  TOOL_DURABILITY,
} from "../../src/game/sim/content";
import {
  applyCommand,
  createInitialState,
  getDiscoveredRecipeIds,
  getDurableToolInventoryStatus,
  migrateGameState,
} from "../../src/game/sim";
import { resolveAffordance } from "../../src/game/sim/affordances";
import {
  treeInteractionAnchor,
  treeMaterialYield,
} from "../../src/game/sim/treeHarvest";
import type {
  DurableToolId,
  GameState,
  WorldEntity,
} from "../../src/game/sim/types";
import {
  createGameViewModel,
  createRenderSnapshot,
} from "../../src/game/ui/viewModel";
import {
  compactGameStateSavePayload,
  dematerializeGeneratedWorldChunk,
  expandGameStateSavePayload,
  materializeGeneratedWorldChunk,
} from "../../src/game/world/saveDelta";
import { generateSemanticChunkPlan } from "../../src/game/world/semanticGeneration";

function giveTool(
  state: GameState,
  itemId: DurableToolId,
  durability = TOOL_DURABILITY[itemId].maxDurability,
): GameState {
  state.inventory[itemId] = 1;
  state.itemLifecycle!.tools[itemId] = [
    { durability, maxDurability: TOOL_DURABILITY[itemId].maxDurability },
  ];
  return applyCommand(state, { type: "equip-item", itemId });
}

function moveToTreeAnchor(state: GameState, tree: WorldEntity): GameState {
  const anchor = treeInteractionAnchor(tree);
  return applyCommand(state, {
    type: "move-player",
    position: { x: anchor.x, y: 0, z: anchor.z },
    look: { yaw: state.player.lookYaw ?? Math.PI, pitch: -0.45 },
  });
}

function fellAuthoredTree(): { state: GameState; treeId: string } {
  const treeId = "resource.tree.camp-east";
  let state = createInitialState("tree-felling-state-machine");
  const tree = state.world.entities[treeId];
  state = giveTool(state, "axe");
  state = applyCommand(state, {
    type: "move-player",
    position: { x: tree.position.x + 1, y: 0, z: tree.position.z },
    look: { yaw: Math.PI / 2, pitch: 0 },
  });
  const hits = tree.quantity;
  for (let index = 0; index < hits; index += 1) {
    state = applyCommand(state, { type: "harvest", entityId: treeId });
  }
  return { state, treeId };
}

test("all generated tree species are reachable with the current tool tier", () => {
  const trees = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 2, z: -1 },
    { x: -2, z: 3 },
  ].flatMap((coordinate) =>
    generateSemanticChunkPlan("reachable-tree-tools", coordinate).objects.filter(
      (object) => object.category === "tree",
    ),
  );
  assert.ok(trees.some((tree) => tree.species === "ironwood"));
  for (const tree of trees) {
    assert.ok(tree.toolRequirement.minimumTier <= 1, tree.id);
    assert.ok(
      tree.toolRequirement.toolClass === "axe" ||
        tree.toolRequirement.toolClass === "blade",
      tree.id,
    );
  }
});

test("tree work is a staged world loop instead of instant stick drops", () => {
  const treeId = "resource.tree.camp-east";
  let state = createInitialState("tree-no-instant-drop");
  const structuralHits = state.world.entities[treeId].quantity;
  state = giveTool(state, "axe");
  state = applyCommand(state, {
    type: "move-player",
    position: {
      x: state.world.entities[treeId].position.x + 1,
      y: 0,
      z: state.world.entities[treeId].position.z,
    },
    look: { yaw: Math.PI / 2, pitch: 0 },
  });
  const sticksBefore = state.inventory.stick;
  const durabilityBefore = getDurableToolInventoryStatus(
    state,
    "axe",
  ).activeDurability;
  const estimatedSeconds = resolveAffordance(
    state,
    state.world.entities[treeId],
  ).estimatedSeconds;

  state = applyCommand(state, { type: "harvest", entityId: treeId });
  assert.equal(state.inventory.stick, sticksBefore);
  assert.equal(state.world.entities[treeId].quantity, structuralHits - 1);
  assert.equal(state.world.entities[treeId].treeHarvest, undefined);
  assert.equal(
    state.eventLog.at(-1)?.details?.workSeconds,
    estimatedSeconds,
    "standing-tree UI work estimate and simulation settlement share one formula",
  );

  for (let index = 1; index < structuralHits; index += 1) {
    state = applyCommand(state, { type: "harvest", entityId: treeId });
  }
  let tree = state.world.entities[treeId];
  assert.equal(tree.quantity, 0);
  assert.equal(tree.depleted, false);
  assert.deepEqual(tree.treeHarvest, {
    fallDirection: 512,
    branches: 2,
    trunkSegments: 1,
    looseLog: false,
  });
  assert.equal(state.inventory.stick, sticksBefore);
  assert.ok(
    getDurableToolInventoryStatus(state, "axe").activeDurability <
      durabilityBefore,
  );

  while ((tree.treeHarvest?.branches ?? 0) > 0) {
    state = moveToTreeAnchor(state, tree);
    state = applyCommand(state, { type: "harvest", entityId: treeId });
    tree = state.world.entities[treeId];
  }
  assert.equal(state.inventory.stick, sticksBefore + 2);
  assert.equal(resolveAffordance(state, tree).verb, "分段倒木");

  state = moveToTreeAnchor(state, tree);
  state = applyCommand(state, { type: "harvest", entityId: treeId });
  tree = state.world.entities[treeId];
  assert.equal(tree.treeHarvest?.trunkSegments, 0);
  assert.equal(tree.treeHarvest?.looseLog, true);
  assert.equal(state.inventory.log, 0);

  state = moveToTreeAnchor(state, tree);
  state = applyCommand(state, { type: "harvest", entityId: treeId });
  tree = state.world.entities[treeId];
  assert.equal(state.inventory.log, 1);
  assert.equal(tree.depleted, true);
  assert.equal(tree.treeHarvest, undefined, "finished stumps keep the compact legacy shape");
  assert.ok(getDiscoveredRecipeIds(state).includes("split-log"));
  assert.ok(
    createGameViewModel(state).recipes.some((recipe) => recipe.id === "split-log"),
    "the first carried log exposes its processing recipe in the crafting UI",
  );
  assert.ok(createRenderSnapshot(state).entities.find((entry) => entry.id === treeId));

  const sticksBeforeSplit = state.inventory.stick;
  const axeBeforeSplit = getDurableToolInventoryStatus(
    state,
    "axe",
  ).activeDurability;
  state = applyCommand(state, { type: "craft", recipeId: "split-log" });
  assert.equal(state.inventory.log, 0);
  assert.equal(state.inventory.stick, sticksBeforeSplit + 3);
  assert.ok(
    getDurableToolInventoryStatus(state, "axe").activeDurability <
      axeBeforeSplit,
  );
});

test("full inventory never consumes branches, loose logs, or a split-log input", () => {
  const felled = fellAuthoredTree();
  let state = felled.state;
  const treeId = felled.treeId;
  let tree = state.world.entities[treeId];
  state.inventory.stick = ITEMS.stick.stackLimit;
  state = moveToTreeAnchor(state, tree);
  const blockedBranch = applyCommand(state, {
    type: "harvest",
    entityId: treeId,
  });
  assert.equal(
    blockedBranch.world.entities[treeId].treeHarvest?.branches,
    tree.treeHarvest?.branches,
  );
  assert.equal(blockedBranch.eventLog.at(-1)?.type, "command-rejected");

  state = blockedBranch;
  state.inventory.stick = 0;
  tree = state.world.entities[treeId];
  while ((tree.treeHarvest?.branches ?? 0) > 0) {
    state = moveToTreeAnchor(state, tree);
    state = applyCommand(state, { type: "harvest", entityId: treeId });
    tree = state.world.entities[treeId];
  }
  state = moveToTreeAnchor(state, tree);
  state = applyCommand(state, { type: "harvest", entityId: treeId });
  tree = state.world.entities[treeId];
  state.inventory.log = ITEMS.log.stackLimit;
  state = moveToTreeAnchor(state, tree);
  const blockedLog = applyCommand(state, {
    type: "harvest",
    entityId: treeId,
  });
  assert.equal(blockedLog.world.entities[treeId].treeHarvest?.looseLog, true);
  assert.equal(blockedLog.eventLog.at(-1)?.type, "command-rejected");

  let split = createInitialState("split-log-capacity");
  split = giveTool(split, "axe");
  split.inventory.log = 1;
  split.inventory.stick = ITEMS.stick.stackLimit - 2;
  const rejected = applyCommand(split, {
    type: "craft",
    recipeId: "split-log",
  });
  assert.equal(rejected.inventory.log, 1);
  assert.equal(rejected.inventory.stick, ITEMS.stick.stackLimit - 2);
  assert.equal(rejected.eventLog.at(-1)?.type, "craft-failed");
  assert.equal(rejected.eventLog.at(-1)?.details?.reason, "inventory-full");
});

test("tree harvest state survives chunk streaming and v3 compact saves while v1 zero trees stay stumps", () => {
  const state = createInitialState("tree-delta-roundtrip");
  const tree = Object.values(state.world.entities).find(
    (entity) => entity.semantic?.category === "tree",
  )!;
  const material = treeMaterialYield(tree);
  tree.quantity = 0;
  tree.depleted = false;
  tree.treeHarvest = {
    fallDirection: 777,
    branches: Math.max(1, material.branches - 1),
    trunkSegments: material.trunkSegments,
    looseLog: false,
  };
  const key = tree.tags.find((tag) => tag.startsWith("chunk:"))!.slice(6);
  const [chunkX, chunkZ] = key.split(":").map(Number);
  dematerializeGeneratedWorldChunk(state, { x: chunkX!, z: chunkZ! });
  assert.deepEqual(state.world.entityDeltas?.[tree.id].treeHarvest, tree.treeHarvest);
  materializeGeneratedWorldChunk(state, { x: chunkX!, z: chunkZ! });
  assert.deepEqual(state.world.entities[tree.id].treeHarvest, tree.treeHarvest);

  const compact = compactGameStateSavePayload(state) as {
    world: { version: number; deltas: unknown[][] };
  };
  assert.equal(compact.world.version, 3);
  const compactTree = compact.world.deltas.find((delta) => delta[0] === tree.id)!;
  assert.equal(compactTree.length, 5);
  const restored = migrateGameState(
    expandGameStateSavePayload(compact) as GameState,
  );
  assert.deepEqual(restored.world.entities[tree.id].treeHarvest, tree.treeHarvest);

  const legacy = createInitialState("legacy-zero-tree-stump");
  const legacyTree = Object.values(legacy.world.entities).find(
    (entity) => entity.semantic?.category === "tree",
  )!;
  legacyTree.quantity = 0;
  legacyTree.depleted = true;
  delete legacyTree.treeHarvest;
  const legacyCompact = compactGameStateSavePayload(legacy) as {
    world: { version: number; deltas: unknown[][] };
  };
  legacyCompact.world.version = 1;
  const legacyRestored = migrateGameState(
    expandGameStateSavePayload(legacyCompact) as GameState,
  );
  assert.equal(legacyRestored.world.entities[legacyTree.id].quantity, 0);
  assert.equal(legacyRestored.world.entities[legacyTree.id].depleted, true);
  assert.equal(legacyRestored.world.entities[legacyTree.id].treeHarvest, undefined);
});

test("a fully processed tree compacts back to the three-field stump delta", () => {
  const { state, treeId } = fellAuthoredTree();
  const tree = state.world.entities[treeId];
  tree.quantity = 0;
  tree.depleted = true;
  tree.treeHarvest = {
    fallDirection: 22,
    branches: 0,
    trunkSegments: 0,
    looseLog: false,
  };
  const compact = compactGameStateSavePayload(state) as {
    world: { deltas: unknown[][] };
  };
  const tuple = compact.world.deltas.find((delta) => delta[0] === treeId)!;
  assert.equal(tuple.length, 3);
});
