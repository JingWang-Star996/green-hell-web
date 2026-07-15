import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_DURABILITY } from "../../src/game/sim/content";
import {
  applyCommand,
  createInitialState,
  getDiscoveredRecipeIds,
  getDurableToolInventoryStatus,
  migrateGameState,
} from "../../src/game/sim";
import type { GameState, WorldEntity } from "../../src/game/sim/types";
import { rockMiningProfile } from "../../src/game/sim/rockHarvest";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
  materializeGeneratedWorldChunk,
} from "../../src/game/world/saveDelta";

function findSemanticEntity(
  state: GameState,
  predicate: (entity: WorldEntity) => boolean,
): WorldEntity {
  for (let radius = 0; radius <= 6; radius += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
        materializeGeneratedWorldChunk(state, { x, z });
        const found = Object.values(state.world.entities).find(
          (entity) => entity.semantic && predicate(entity),
        );
        if (found) return found;
      }
    }
  }
  throw new Error("No matching semantic entity generated in the test search area.");
}

function giveDurableTool(
  state: GameState,
  itemId: "stone-blade" | "axe" | "stone-pick",
): GameState {
  state.inventory[itemId] = 1;
  return migrateGameState(state);
}

test("stone pick is crafted with an actual cutting tool, gains durability, and equips explicitly", () => {
  let state = createInitialState("craft-stone-pick");
  state.inventory.stone = 3;
  state.inventory.stick = 1;
  state.inventory.vine = 1;
  state.inventory["stone-blade"] = 1;
  state = migrateGameState(state);
  state.knowledge!.observedItemIds = ["stone", "stick", "vine"];
  state.knowledge!.craftedRecipeIds = ["stone-blade"];
  assert.ok(getDiscoveredRecipeIds(state).includes("stone-pick"));
  const bladeBefore = getDurableToolInventoryStatus(
    state,
    "stone-blade",
  ).activeDurability;

  state = applyCommand(state, { type: "craft", recipeId: "stone-pick" });
  assert.equal(state.inventory.stone, 0);
  assert.equal(state.inventory.stick, 0);
  assert.equal(state.inventory.vine, 0);
  assert.equal(state.inventory["stone-pick"], 1);
  assert.equal(
    getDurableToolInventoryStatus(state, "stone-pick").activeDurability,
    TOOL_DURABILITY["stone-pick"].maxDurability,
  );
  assert.equal(
    getDurableToolInventoryStatus(state, "stone-blade").activeDurability,
    bladeBefore - 1,
    "the recipe tool is a tracked physical stone blade",
  );

  state = applyCommand(state, { type: "equip-item", itemId: "stone-pick" });
  assert.equal(state.player.equippedItem, "stone-pick");
  assert.equal(state.eventLog.at(-1)?.type, "item-equipped");
});

test("semantic rock mining is simulation-authoritative and consumes bounded time, stamina, yield, and durability", () => {
  let state = createInitialState("semantic-rock-mining");
  const rock = findSemanticEntity(
    state,
    (entity) =>
      entity.semantic?.category === "mineable-rock" &&
      entity.semantic.toolTier === 1,
  );
  state = applyCommand(state, { type: "move-player", position: rock.position });

  const pickupRejected = applyCommand(state, {
    type: "pick-up",
    entityId: rock.id,
  });
  assert.equal(pickupRejected.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(pickupRejected.eventLog.at(-1)?.details?.action, "mine");
  assert.equal(pickupRejected.world.entities[rock.id].quantity, rock.quantity);

  const rejected = applyCommand(pickupRejected, {
    type: "harvest",
    entityId: rock.id,
  });
  assert.equal(rejected.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(rejected.eventLog.at(-1)?.details?.requiredItem, "stone-pick");
  assert.equal(rejected.world.entities[rock.id].quantity, rock.quantity);

  state = giveDurableTool(rejected, "stone-pick");
  state = applyCommand(state, { type: "equip-item", itemId: "stone-pick" });
  state.player.vitals.stamina = 100;
  const timeBefore = state.clock.elapsedSeconds;
  const quantityBefore = state.world.entities[rock.id].quantity;
  const stoneBefore = state.inventory.stone;
  const durabilityBefore = getDurableToolInventoryStatus(
    state,
    "stone-pick",
  ).activeDurability;
  const profile = rockMiningProfile(state.world.entities[rock.id]);

  state = applyCommand(state, { type: "harvest", entityId: rock.id });
  const event = state.eventLog.at(-1);
  assert.equal(event?.type, "harvest-struck");
  assert.equal(event?.details?.action, "mine");
  assert.equal(event?.details?.semanticCategory, "mineable-rock");
  assert.equal(state.inventory.stone, stoneBefore + 1);
  assert.equal(state.world.entities[rock.id].quantity, quantityBefore - 1);
  assert.equal(state.world.entities[rock.id].regeneration, undefined);
  assert.equal(
    state.clock.elapsedSeconds - timeBefore,
    event?.details?.workSeconds,
  );
  assert.equal(event?.details?.staminaCost, profile.staminaCost);
  assert.equal(state.player.vitals.stamina, 100 - profile.staminaCost);
  assert.equal(
    getDurableToolInventoryStatus(state, "stone-pick").activeDurability,
    durabilityBefore - profile.durabilityCost,
  );
});

test("a tier-one stone pick can mine a large outcrop with readable extra work and wear", () => {
  let state = createInitialState("semantic-large-tier-one");
  const rock = findSemanticEntity(
    state,
    (entity) =>
      entity.semantic?.category === "mineable-rock" &&
      entity.semantic.size === "large",
  );
  assert.equal(rock.semantic?.toolTier, 1);
  state = giveDurableTool(state, "stone-pick");
  state = applyCommand(state, { type: "equip-item", itemId: "stone-pick" });
  state = applyCommand(state, { type: "move-player", position: rock.position });
  const quantityBefore = state.world.entities[rock.id].quantity;
  const timeBefore = state.clock.elapsedSeconds;
  const durabilityBefore = getDurableToolInventoryStatus(
    state,
    "stone-pick",
  ).activeDurability;

  state.player.vitals.stamina = 100;
  const mined = applyCommand(state, { type: "harvest", entityId: rock.id });
  assert.equal(mined.eventLog.at(-1)?.type, "harvest-struck");
  assert.equal(mined.eventLog.at(-1)?.details?.requiredToolTier, 1);
  assert.equal(mined.world.entities[rock.id].quantity, quantityBefore - 1);
  assert.equal(mined.clock.elapsedSeconds - timeBefore, 6);
  assert.equal(mined.player.vitals.stamina, 96);
  assert.equal(
    getDurableToolInventoryStatus(mined, "stone-pick").activeDurability,
    durabilityBefore - 2,
  );
});

test("a stone pick that breaks on a completed mining strike is removed and automatically stowed", () => {
  let state = createInitialState("stone-pick-break-stows");
  const rock = findSemanticEntity(
    state,
    (entity) =>
      entity.semantic?.category === "mineable-rock" &&
      entity.semantic.toolTier === 1,
  );
  state = giveDurableTool(state, "stone-pick");
  state.itemLifecycle!.tools["stone-pick"] = [
    {
      durability: 1,
      maxDurability: TOOL_DURABILITY["stone-pick"].maxDurability,
    },
  ];
  state = applyCommand(state, { type: "equip-item", itemId: "stone-pick" });
  state = applyCommand(state, { type: "move-player", position: rock.position });
  const stoneBefore = state.inventory.stone;

  state = applyCommand(state, { type: "harvest", entityId: rock.id });
  assert.equal(state.inventory.stone, stoneBefore + 1);
  assert.equal(state.inventory["stone-pick"], 0);
  assert.equal(state.player.equippedItem, null);
  assert.ok(state.eventLog.some((event) => event.type === "tool-broken"));
  assert.ok(
    state.eventLog.some(
      (event) =>
        event.type === "item-unequipped" &&
        event.cause.code === "equipment:broken:stone-pick",
    ),
  );
});

test("semantic trees use their declared axe tier while hand and blade plants use distinct settlement paths", () => {
  let treeState = createInitialState("semantic-tree-axe");
  const tree = findSemanticEntity(
    treeState,
    (entity) =>
      entity.semantic?.category === "tree" &&
      entity.semantic.toolClass === "axe" &&
      entity.semantic.toolTier === 1,
  );
  treeState = giveDurableTool(treeState, "axe");
  treeState = applyCommand(treeState, { type: "equip-item", itemId: "axe" });
  treeState = applyCommand(treeState, {
    type: "move-player",
    position: tree.position,
  });
  const woodBefore = treeState.inventory.stick;
  const structureBefore = treeState.world.entities[tree.id].quantity;
  treeState = applyCommand(treeState, { type: "harvest", entityId: tree.id });
  assert.equal(treeState.eventLog.at(-1)?.details?.action, "chop");
  assert.equal(treeState.inventory.stick, woodBefore);
  assert.equal(
    treeState.world.entities[tree.id].quantity,
    structureBefore - 1,
  );
  assert.equal(treeState.world.entities[tree.id].regeneration, undefined);

  let plantState = createInitialState("semantic-plant-tools");
  const vine = findSemanticEntity(
    plantState,
    (entity) =>
      entity.semantic?.category === "harvestable-plant" &&
      entity.semantic.toolClass === "blade",
  );
  plantState = applyCommand(plantState, {
    type: "move-player",
    position: vine.position,
  });
  const noBlade = applyCommand(plantState, {
    type: "harvest",
    entityId: vine.id,
  });
  assert.equal(noBlade.eventLog.at(-1)?.details?.requiredItem, "stone-blade");

  plantState = giveDurableTool(noBlade, "stone-blade");
  plantState = applyCommand(plantState, {
    type: "equip-item",
    itemId: "stone-blade",
  });
  const bladeBefore = getDurableToolInventoryStatus(
    plantState,
    "stone-blade",
  ).activeDurability;
  plantState = applyCommand(plantState, {
    type: "harvest",
    entityId: vine.id,
  });
  assert.equal(plantState.eventLog.at(-1)?.details?.action, "cut");
  assert.equal(
    getDurableToolInventoryStatus(plantState, "stone-blade").activeDurability,
    bladeBefore - 1,
  );

  let handState = createInitialState("semantic-hand-plant");
  const handPlant = findSemanticEntity(
    handState,
    (entity) =>
      entity.semantic?.category === "harvestable-plant" &&
      entity.semantic.toolClass === "hand",
  );
  handState = applyCommand(handState, {
    type: "move-player",
    position: handPlant.position,
  });
  handState = applyCommand(handState, {
    type: handPlant.semantic?.action === "pickup" ? "pick-up" : "harvest",
    entityId: handPlant.id,
  });
  assert.equal(handState.eventLog.at(-1)?.type, "harvest-struck");
  assert.equal(handState.eventLog.at(-1)?.details?.equippedToolTier, 0);
  assert.ok(handState.world.entities[handPlant.id].regeneration);
});

test("wild plantain closes the existing harvest-to-food loop", () => {
  let state = createInitialState("wild-plantain-food-loop");
  const plantain = findSemanticEntity(
    state,
    (entity) => entity.semantic?.species === "wild-plantain",
  );
  assert.equal(plantain.itemId, "palm-fruit");
  assert.equal(plantain.semantic?.action, "pickup");
  state = applyCommand(state, {
    type: "move-player",
    position: plantain.position,
  });
  const fruitBefore = state.inventory["palm-fruit"];
  state = applyCommand(state, { type: "pick-up", entityId: plantain.id });
  assert.equal(state.eventLog.at(-1)?.type, "harvest-struck");
  assert.equal(state.inventory["palm-fruit"], fruitBefore + 1);
  assert.ok(state.world.entities[plantain.id].regeneration);

  state.player.nutrition.carbohydrates = 40;
  state = applyCommand(state, { type: "eat", itemId: "palm-fruit" });
  assert.equal(state.inventory["palm-fruit"], fruitBefore);
  assert.ok(state.player.nutrition.carbohydrates > 63.9);
});

test("legacy inventory migration adds safe tool keys without mutating the old payload", () => {
  const legacy = createInitialState("legacy-stone-pick-key");
  legacy.inventory["stone-blade"] = 1;
  delete (legacy.inventory as Partial<GameState["inventory"]>)["stone-pick"];
  delete legacy.itemLifecycle?.tools["stone-blade"];
  delete legacy.itemLifecycle?.tools["stone-pick"];

  const migrated = migrateGameState(legacy);
  assert.equal(
    (legacy.inventory as Partial<GameState["inventory"]>)["stone-pick"],
    undefined,
  );
  assert.equal(legacy.itemLifecycle?.tools["stone-blade"], undefined);
  assert.equal(migrated.inventory["stone-pick"], 0);
  assert.deepEqual(migrated.itemLifecycle?.tools["stone-pick"], []);
  assert.equal(
    getDurableToolInventoryStatus(migrated, "stone-blade").activeDurability,
    TOOL_DURABILITY["stone-blade"].maxDurability,
  );
});

test("semantic mining is deterministic and its node/tool deltas survive compact save roundtrip", () => {
  const prepare = () => {
    let state = createInitialState("semantic-mining-roundtrip");
    const rock = findSemanticEntity(
      state,
      (entity) =>
        entity.semantic?.category === "mineable-rock" &&
        entity.semantic.toolTier === 1,
    );
    state = giveDurableTool(state, "stone-pick");
    state = applyCommand(state, { type: "equip-item", itemId: "stone-pick" });
    state = applyCommand(state, { type: "move-player", position: rock.position });
    state = applyCommand(state, { type: "harvest", entityId: rock.id });
    return { state, rockId: rock.id };
  };

  const first = prepare();
  const second = prepare();
  assert.deepEqual(second, first);

  const compact = compactGameStateSavePayload(first.state);
  const restored = expandGameStateSavePayload(compact) as GameState;
  const chunk = first.state.world.entities[first.rockId].tags
    .find((tag) => tag.startsWith("chunk:"))!
    .slice("chunk:".length)
    .split(":")
    .map(Number);
  materializeGeneratedWorldChunk(restored, { x: chunk[0]!, z: chunk[1]! });
  assert.equal(
    restored.world.entities[first.rockId].quantity,
    first.state.world.entities[first.rockId].quantity,
  );
  assert.deepEqual(
    restored.itemLifecycle?.tools["stone-pick"],
    first.state.itemLifecycle?.tools["stone-pick"],
  );
  assert.equal(restored.player.equippedItem, "stone-pick");
});
