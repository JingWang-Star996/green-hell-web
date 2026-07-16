import assert from "node:assert/strict";
import test from "node:test";

import { ITEMS, TOOL_DURABILITY } from "../../src/game/sim/content";
import {
  applyCommand,
  createInitialState,
  getDurableToolInventoryStatus,
  migrateGameState,
} from "../../src/game/sim";
import {
  ROCK_MINING_PROFILES,
  rockInteractionGeometry,
  rockLifecycle,
} from "../../src/game/sim/rockHarvest";
import type { GameState, WorldEntity } from "../../src/game/sim/types";
import { resolveAffordance } from "../../src/game/sim/affordances";
import {
  createGeneratedChunkEntities,
  materializeGeneratedWorldChunk,
} from "../../src/game/world/saveDelta";
import {
  SEMANTIC_WORLD_GENERATOR_VERSION,
  generateSemanticChunkPlan,
  type RockMaterial,
  type SemanticSize,
} from "../../src/game/world/semanticGeneration";

function findRock(state: GameState, size: SemanticSize): WorldEntity {
  for (let radius = 0; radius <= 5; radius += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
        materializeGeneratedWorldChunk(state, { x, z });
        const rock = Object.values(state.world.entities).find(
          (entity) =>
            entity.semantic?.category === "mineable-rock" &&
            entity.semantic.size === size,
        );
        if (rock) return rock;
      }
    }
  }
  throw new Error(`missing ${size} rock`);
}

function equipPick(state: GameState): GameState {
  state.inventory["stone-pick"] = 1;
  state = migrateGameState(state);
  return applyCommand(state, { type: "equip-item", itemId: "stone-pick" });
}

test("every generated geology label resolves to reachable tier-one stone truth", () => {
  const materials = new Set<RockMaterial>();
  const state = createInitialState("rock-truth-affordance");
  for (let x = -2; x <= 2; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      const plan = generateSemanticChunkPlan("rock-truth-affordance", { x, z });
      for (const rock of plan.objects) {
        if (rock.category !== "mineable-rock") continue;
        materials.add(rock.material);
        assert.equal(rock.toolRequirement.minimumTier, 1);
        assert.equal(rock.yieldIntent.primaryMaterial, "stone");
        assert.deepEqual(rock.yieldIntent.secondaryMaterials, []);
      }
      for (const entity of Object.values(
        createGeneratedChunkEntities(state.seed, { x, z }),
      )) {
        if (entity.semantic?.category !== "mineable-rock") continue;
        assert.equal(entity.itemId, "stone");
        assert.equal(entity.semantic.toolTier, 1);
        assert.equal(entity.semantic.primaryMaterial, "stone");
        const affordance = resolveAffordance(state, entity);
        assert.equal(affordance.actionId, "mine");
        assert.equal(affordance.preview.itemId, "stone");
        assert.equal(affordance.preview.primaryMaterial, "stone");
        assert.equal(affordance.preview.minimumToolTier, 1);
      }
    }
  }
  assert.deepEqual(
    materials,
    new Set<RockMaterial>(["granite", "limestone", "flint", "laterite-clay"]),
  );
  assert.equal(SEMANTIC_WORLD_GENERATOR_VERSION, 1);
});

test("small, medium and large mining strikes share exact size costs", () => {
  for (const size of ["small", "medium", "large"] as const) {
    let state = createInitialState(`rock-cost-${size}`);
    const rock = findRock(state, size);
    state = equipPick(state);
    state = applyCommand(state, { type: "move-player", position: rock.position });
    state.player.vitals.stamina = 100;
    const profile = ROCK_MINING_PROFILES[size];
    const before = {
      time: state.clock.elapsedSeconds,
      stamina: state.player.vitals.stamina,
      stone: state.inventory.stone,
      quantity: state.world.entities[rock.id].quantity,
      durability: getDurableToolInventoryStatus(state, "stone-pick")
        .activeDurability,
    };

    state = applyCommand(state, { type: "harvest", entityId: rock.id });
    const event = state.eventLog.at(-1);
    assert.equal(event?.type, "harvest-struck");
    assert.equal(event?.details?.itemId, "stone");
    assert.equal(event?.details?.requiredToolTier, 1);
    assert.equal(event?.details?.workSeconds, profile.workSeconds);
    assert.equal(event?.details?.staminaCost, profile.staminaCost);
    assert.equal(event?.details?.durabilityCost, profile.durabilityCost);
    assert.equal(state.clock.elapsedSeconds - before.time, profile.workSeconds);
    assert.equal(state.player.vitals.stamina, before.stamina - profile.staminaCost);
    assert.equal(state.inventory.stone, before.stone + 1);
    assert.equal(state.world.entities[rock.id].quantity, before.quantity - 1);
    assert.equal(
      getDurableToolInventoryStatus(state, "stone-pick").activeDurability,
      before.durability - profile.durabilityCost,
    );
  }
});

test("invalid mining paths have zero time, yield, stamina, durability and world side effects", () => {
  let equipped = createInitialState("rock-validation-atomic");
  const rock = findRock(equipped, "large");
  equipped = equipPick(equipped);
  equipped.player.vitals.stamina = 100;
  const baseline = equipped.world.entities[rock.id];
  const durability = getDurableToolInventoryStatus(
    equipped,
    "stone-pick",
  ).activeDurability;

  const assertUnchanged = (state: GameState) => {
    assert.equal(state.clock.elapsedSeconds, equipped.clock.elapsedSeconds);
    assert.equal(state.player.vitals.stamina, 100);
    assert.equal(state.inventory.stone, equipped.inventory.stone);
    assert.equal(state.world.entities[rock.id].quantity, baseline.quantity);
    assert.equal(
      getDurableToolInventoryStatus(state, "stone-pick").activeDurability,
      durability,
    );
    assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
  };

  const tooFar = applyCommand(equipped, {
    type: "move-player",
    position: {
      ...rock.position,
      x: rock.position.x + rock.interactRadius + 0.01,
    },
  });
  assertUnchanged(
    applyCommand(tooFar, { type: "harvest", entityId: rock.id }),
  );

  const full = migrateGameState(equipped);
  full.inventory.stone = ITEMS.stone.stackLimit;
  const fullResult = applyCommand(full, { type: "harvest", entityId: rock.id });
  assert.equal(fullResult.clock.elapsedSeconds, full.clock.elapsedSeconds);
  assert.equal(fullResult.player.vitals.stamina, full.player.vitals.stamina);
  assert.equal(fullResult.world.entities[rock.id].quantity, baseline.quantity);
  assert.equal(
    getDurableToolInventoryStatus(fullResult, "stone-pick").activeDurability,
    durability,
  );

  const noTool = migrateGameState(equipped);
  noTool.inventory["stone-pick"] = 0;
  noTool.player.equippedItem = null;
  const missingResult = applyCommand(noTool, {
    type: "harvest",
    entityId: rock.id,
  });
  assert.equal(missingResult.clock.elapsedSeconds, noTool.clock.elapsedSeconds);
  assert.equal(missingResult.world.entities[rock.id].quantity, baseline.quantity);
});

test("rock geometry forms non-overlapping silhouettes and derives lifecycle", () => {
  const bounds = (["small", "medium", "large"] as const).map((size) => {
    const minimum = rockInteractionGeometry({
      x: 4,
      z: -2,
      scale: 0.9,
      semantic: { size },
    });
    const maximum = rockInteractionGeometry({
      x: 4,
      z: -2,
      scale: 1.1,
      semantic: { size },
    });
    assert.deepEqual(minimum.anchor.x, 4);
    assert.deepEqual(minimum.anchor.z, -2);
    assert.equal(minimum.interactRadius, minimum.colliderRadius + 2);
    return {
      size,
      minimumWidth: minimum.bodyScale.x * 2,
      maximumWidth: maximum.bodyScale.x * 2,
      minimumHeight: minimum.bodyScale.y * 2,
      maximumHeight: maximum.bodyScale.y * 2,
    };
  });
  assert.ok(bounds[0].maximumWidth < bounds[1].minimumWidth);
  assert.ok(bounds[1].maximumWidth < bounds[2].minimumWidth);
  assert.ok(bounds[0].maximumHeight < bounds[1].minimumHeight);
  assert.ok(bounds[1].maximumHeight < bounds[2].minimumHeight);
  assert.equal(rockLifecycle(5, 5), "intact");
  assert.equal(rockLifecycle(2, 5), "partial");
  assert.equal(rockLifecycle(0, 5), "exhausted");
});

test("legacy tier-two runtime rocks normalize without moving or refilling", () => {
  const legacy = createInitialState("legacy-tier-two-rock");
  const rock = findRock(legacy, "large");
  const quantity = rock.quantity - 1;
  rock.quantity = quantity;
  rock.semantic!.toolTier = 2;
  rock.semantic!.primaryMaterial = "flint";
  const position = { ...rock.position };

  const migrated = migrateGameState(legacy);
  const normalized = migrated.world.entities[rock.id];
  assert.deepEqual(normalized.position, position);
  assert.equal(normalized.quantity, quantity);
  assert.equal(normalized.itemId, "stone");
  assert.equal(normalized.semantic?.toolTier, 1);
  assert.equal(normalized.semantic?.primaryMaterial, "stone");
  assert.equal(normalized.regeneration, undefined);
  assert.equal(
    getDurableToolInventoryStatus(migrated, "stone-pick").activeDurability,
    0,
  );
  assert.equal(TOOL_DURABILITY["stone-pick"].maxDurability, 32);
});
