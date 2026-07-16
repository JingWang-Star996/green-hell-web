import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_DURABILITY } from "../../src/game/sim/content";
import {
  applyCommand,
  createInitialState,
  getDurableToolInventoryStatus,
  migrateGameState,
} from "../../src/game/sim";
import {
  activeChunkCoordinates,
  chunkKey as worldChunkKey,
} from "../../src/game/world/generation";

test("equipment rejects missing items, equips explicitly, and can be stowed", () => {
  const initial = createInitialState("equipment-contract");
  const rejected = applyCommand(initial, {
    type: "equip-item",
    itemId: "axe",
  });

  assert.equal(initial.player.equippedItem, null);
  assert.equal(rejected.player.equippedItem, null);
  assert.equal(rejected.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(rejected.eventLog.at(-1)?.details?.itemId, "axe");

  rejected.inventory.axe = 1;
  const equipped = applyCommand(rejected, {
    type: "equip-item",
    itemId: "axe",
  });
  assert.equal(equipped.player.equippedItem, "axe");
  assert.equal(equipped.eventLog.at(-1)?.type, "item-equipped");

  const stowed = applyCommand(equipped, {
    type: "equip-item",
    itemId: null,
  });
  assert.equal(stowed.player.equippedItem, null);
  assert.equal(stowed.eventLog.at(-1)?.type, "item-unequipped");
  assert.equal(stowed.eventLog.at(-1)?.cause.code, "equipment:stow");
});

test("a standing tree rejects ground pickup and empty hands, then explicit axe strikes consume time and durability", () => {
  const treeId = "resource.tree.camp-east";
  let state = createInitialState("standing-tree-contract");
  const startingYield = state.world.entities[treeId].quantity;
  state = applyCommand(state, {
    type: "move-player",
    position: state.world.entities[treeId].position,
  });

  const pickupRejected = applyCommand(state, {
    type: "pick-up",
    entityId: treeId,
  });
  assert.equal(pickupRejected.inventory.stick, state.inventory.stick);
  assert.equal(pickupRejected.world.entities[treeId].quantity, startingYield);
  assert.equal(pickupRejected.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(pickupRejected.eventLog.at(-1)?.details?.requiredItem, "axe");

  const emptyHandRejected = applyCommand(pickupRejected, {
    type: "harvest",
    entityId: treeId,
  });
  assert.equal(emptyHandRejected.inventory.stick, state.inventory.stick);
  assert.equal(emptyHandRejected.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(emptyHandRejected.eventLog.at(-1)?.details?.requiredItem, "axe");

  emptyHandRejected.inventory.axe = 1;
  state = applyCommand(emptyHandRejected, {
    type: "equip-item",
    itemId: "axe",
  });
  const initialDurability = getDurableToolInventoryStatus(state, "axe").activeDurability;
  const workStartedAt = state.clock.elapsedSeconds;

  const stillNotGroundLoot = applyCommand(state, {
    type: "pick-up",
    entityId: treeId,
    amount: 3,
  });
  assert.equal(stillNotGroundLoot.inventory.stick, state.inventory.stick);
  assert.equal(stillNotGroundLoot.world.entities[treeId].quantity, startingYield);

  state = stillNotGroundLoot;
  for (let index = 0; index < startingYield; index += 1) {
    state = applyCommand(state, { type: "harvest", entityId: treeId });
  }

  assert.equal(
    state.inventory.stick,
    0,
    "structural hits leave materials on the felled tree instead of teleporting them into inventory",
  );
  assert.equal(state.world.entities[treeId].quantity, 0);
  assert.equal(state.world.entities[treeId].depleted, false);
  assert.ok(state.world.entities[treeId].treeHarvest);
  assert.equal(state.clock.elapsedSeconds - workStartedAt, startingYield * 3);
  assert.equal(
    getDurableToolInventoryStatus(state, "axe").activeDurability,
    initialDurability - startingYield,
  );
  assert.equal(state.eventLog.at(-1)?.type, "harvest-struck");
  assert.equal(state.eventLog.at(-1)?.details?.fallen, true);
});

test("the last axe breaks atomically during a strike and is automatically unequipped", () => {
  const treeId = "resource.tree.camp-west";
  let state = createInitialState("tool-break-stows");
  state.inventory.axe = 1;
  state.itemLifecycle!.tools.axe = [
    {
      durability: 1,
      maxDurability: TOOL_DURABILITY.axe.maxDurability,
    },
  ];
  state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  state = applyCommand(state, {
    type: "move-player",
    position: state.world.entities[treeId].position,
  });
  state = applyCommand(state, { type: "harvest", entityId: treeId });

  assert.equal(state.inventory.axe, 0);
  assert.equal(state.player.equippedItem, null);
  assert.ok(state.eventLog.some((event) => event.type === "tool-broken"));
  assert.ok(
    state.eventLog.some(
      (event) =>
        event.type === "item-unequipped" &&
        event.cause.code === "equipment:broken:axe",
    ),
  );
  assert.equal(
    state.inventory.stick,
    0,
    "a completed strike changes tree structure but never grants instant wood",
  );
  assert.equal(
    state.world.entities[treeId].quantity,
    createInitialState("tool-break-stows").world.entities[treeId].quantity - 1,
  );
});

test("structure placement consumes materials only after validation and records the accepted transform", () => {
  const placement = {
    position: { x: 1.25, y: 0, z: -1.5 },
    yaw: Math.PI / 3,
  };
  const validSource = createInitialState("valid-placement");
  validSource.inventory.stick = 4;
  validSource.inventory["dry-leaf"] = 2;
  const validBefore = { ...validSource.inventory };
  const placed = applyCommand(validSource, {
    type: "craft",
    recipeId: "campfire",
    placement,
  });

  assert.deepEqual(validSource.inventory, validBefore, "commands do not mutate their source");
  assert.equal(placed.inventory.stick, 0);
  assert.equal(placed.inventory["dry-leaf"], 0);
  assert.equal(placed.camp.fire.built, true);
  assert.deepEqual(
    placed.camp.structures?.map(({ kind, position, yaw }) => ({
      kind,
      position,
      yaw,
    })),
    [{ kind: "campfire", position: placement.position, yaw: placement.yaw }],
  );
  assert.equal(placed.eventLog.at(-1)?.type, "craft-succeeded");
  assert.equal(placed.eventLog.at(-1)?.details?.placed, true);

  const invalidSource = createInitialState("invalid-placement");
  invalidSource.inventory.stick = 4;
  invalidSource.inventory["dry-leaf"] = 2;
  const invalidBefore = { ...invalidSource.inventory };
  const rejected = applyCommand(invalidSource, {
    type: "craft",
    recipeId: "campfire",
    placement: {
      position: { x: 40, y: 0, z: 40 },
      yaw: 0,
    },
  });

  assert.deepEqual(rejected.inventory, invalidBefore);
  assert.equal(rejected.camp.fire.built, false);
  assert.deepEqual(rejected.camp.structures, []);
  assert.equal(rejected.clock.tick, invalidSource.clock.tick);
  assert.equal(rejected.eventLog.at(-1)?.type, "craft-failed");
  assert.equal(rejected.eventLog.at(-1)?.details?.reason, "invalid-placement");

  const overlapSource = createInitialState("overlap-placement");
  overlapSource.inventory.stick = 10;
  overlapSource.inventory["dry-leaf"] = 4;
  const firstFire = applyCommand(overlapSource, {
    type: "craft",
    recipeId: "campfire",
    placement,
  });
  // Re-open the one-per-kind gate only to isolate overlap validation from the
  // authored recipe cap.
  firstFire.camp.fire.built = false;
  const overlapBefore = { ...firstFire.inventory };
  const overlapRejected = applyCommand(firstFire, {
    type: "craft",
    recipeId: "campfire",
    placement: {
      position: { x: placement.position.x + 0.2, y: 0, z: placement.position.z },
      yaw: 0,
    },
  });
  assert.deepEqual(overlapRejected.inventory, overlapBefore);
  assert.equal(overlapRejected.camp.structures?.length, 1);
  assert.equal(overlapRejected.eventLog.at(-1)?.details?.reason, "invalid-placement");
});

test("legacy built flags migrate to stable placement records without mutating the save", () => {
  const legacy = createInitialState("legacy-structures");
  legacy.camp.fire.built = true;
  legacy.camp.shelterBuilt = true;
  legacy.camp.bedBuilt = true;
  delete legacy.camp.structures;

  const migrated = migrateGameState(legacy);
  assert.equal(legacy.camp.structures, undefined);
  assert.deepEqual(
    migrated.camp.structures?.map((structure) => structure.kind),
    ["campfire", "shelter", "bed"],
  );
  assert.ok(
    migrated.camp.structures?.every(
      (structure) =>
        structure.id.endsWith(".legacy") &&
        structure.builtAtTick === 0 &&
        Object.values(structure.position).every(Number.isFinite),
    ),
  );
});

test("legacy generated-chunk markers do not suppress the newer standing-tree layer", () => {
  let state = createInitialState("legacy-generated-chunk");
  const centerChunkKey = "100:-75";
  state.world.generatedResourceChunks = [centerChunkKey];
  assert.equal(
    Object.values(state.world.entities).some((entity) =>
      entity.tags.includes(`chunk:${centerChunkKey}`),
    ),
    false,
  );

  state = applyCommand(state, {
    type: "move-player",
    position: { x: 4_800, y: 0, z: -3_600 },
  });
  const generatedTrees = Object.values(state.world.entities).filter(
    (entity) =>
      entity.tags.includes(`chunk:${centerChunkKey}`) &&
      entity.tags.includes("standing-tree"),
  );

  assert.ok(generatedTrees.length > 0);
  assert.ok(generatedTrees.every((tree) => tree.itemId === "stick"));
  assert.deepEqual(
    [...(state.world.generatedResourceChunks ?? [])].sort(),
    activeChunkCoordinates(4_800, -3_600, 1).map(worldChunkKey).sort(),
  );
});
