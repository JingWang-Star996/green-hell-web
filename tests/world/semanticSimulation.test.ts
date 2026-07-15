import assert from "node:assert/strict";
import test from "node:test";

import { hashSeed } from "../../src/game/sim/rng";
import { createInitialState } from "../../src/game/sim/state";
import type { GameState, WorldEntity } from "../../src/game/sim/types";
import {
  compactGameStateSavePayload,
  createGeneratedChunkEntities,
  createLegacyGeneratedChunkEntities,
  expandGameStateSavePayload,
  materializeGeneratedWorldChunk,
} from "../../src/game/world/saveDelta";
import {
  generateSemanticChunkPlan,
  semanticObjectIntersectsExclusionZone,
} from "../../src/game/world/semanticGeneration";

function cloneEntity(entity: WorldEntity): WorldEntity {
  return {
    ...entity,
    position: { ...entity.position },
    ...(entity.regeneration
      ? { regeneration: { ...entity.regeneration } }
      : {}),
    ...(entity.semantic ? { semantic: { ...entity.semantic } } : {}),
    tags: [...entity.tags],
  };
}

function semanticEntities(
  state: GameState,
  chunk: string,
): WorldEntity[] {
  return Object.values(state.world.entities).filter(
    (entity) => entity.tags.includes("semantic") && entity.tags.includes(`chunk:${chunk}`),
  );
}

test("semantic trees, rocks, and plants materialize while micro clutter never becomes a WorldEntity", () => {
  const seed = hashSeed("semantic-simulation-baseline");
  const coordinate = { x: 5, z: -4 };
  const plan = generateSemanticChunkPlan(String(seed), coordinate);
  const entities = createGeneratedChunkEntities(seed, coordinate);
  const interactive = plan.objects.filter((object) => object.interactive);
  const clutterIds = new Set(
    plan.objects
      .filter((object) => object.category === "micro-clutter")
      .map((object) => object.id),
  );

  assert.deepEqual(Object.keys(entities).sort(), interactive.map((object) => object.id).sort());
  assert.ok(interactive.length > 0);
  assert.ok(clutterIds.size > 0);
  assert.ok(Object.keys(entities).every((id) => !clutterIds.has(id)));

  for (const object of interactive) {
    const entity = entities[object.id];
    assert.ok(entity.semantic);
    assert.equal(entity.semantic?.category, object.category);
    assert.equal(entity.semantic?.visualVariant, object.visualVariant);
    assert.equal(entity.semantic?.toolClass, object.toolRequirement.toolClass);
    assert.equal(entity.semantic?.toolTier, object.toolRequirement.minimumTier);
    assert.equal(entity.semantic?.yieldTableId, object.yieldIntent.tableId);
    assert.equal(entity.semantic?.primaryMaterial, object.yieldIntent.primaryMaterial);
    assert.equal(entity.semantic?.yieldMinimum, object.yieldIntent.baseUnits[0]);
    assert.equal(entity.semantic?.yieldMaximum, object.yieldIntent.baseUnits[1]);
    assert.equal(entity.semantic?.baselineQuantity, object.baselineQuantity);
    assert.equal(entity.quantity, object.baselineQuantity);

    if (object.category === "tree") {
      assert.equal(entity.itemId, "stick");
      assert.ok(entity.tags.includes("standing-tree"));
      assert.equal(entity.tags.includes("nonrenewable"), false);
      assert.equal(entity.regeneration, undefined);
    } else if (object.category === "mineable-rock") {
      assert.equal(entity.itemId, "stone");
      assert.ok(entity.tags.includes("mineable-rock"));
      assert.ok(entity.tags.includes("nonrenewable"));
      assert.equal(entity.regeneration, undefined);
    } else {
      assert.ok(entity.tags.includes("harvestable-plant"));
      assert.ok(entity.regeneration, "semantic plants use their existing conservative growth window");
    }
  }

  assert.deepEqual(createGeneratedChunkEntities(seed, coordinate), entities);
});

test("the first playable central chunk contains semantic trees and rocks outside authored clearings", () => {
  const state = createInitialState("central-semantic-world");
  const entities = semanticEntities(state, "0:-1");
  const categories = new Set(entities.map((entity) => entity.semantic?.category));

  assert.ok(state.world.generatedResourceChunks?.includes("0:-1"));
  assert.ok(categories.has("tree"));
  assert.ok(categories.has("mineable-rock"));
  assert.ok(
    entities.every(
      (entity) =>
        !semanticObjectIntersectsExclusionZone({
          transform: {
            x: entity.position.x,
            y: entity.position.y,
            z: entity.position.z,
            yaw: entity.semantic?.yaw ?? 0,
            scale: entity.semantic?.scale ?? 1,
          },
        }),
    ),
  );
});

test("only changed semantic entities survive a compact reload and rebuild with baseline metadata", () => {
  const state = createInitialState("semantic-delta-reload");
  const coordinate = { x: 6, z: 3 };
  const key = `${coordinate.x}:${coordinate.z}`;
  materializeGeneratedWorldChunk(state, coordinate);
  const generated = semanticEntities(state, key);
  const changed = ["tree", "mineable-rock", "harvestable-plant"].map(
    (category) => generated.find((entity) => entity.semantic?.category === category)!,
  );
  assert.ok(changed.every(Boolean));

  const quantities = new Map<string, number>();
  for (const entity of changed) {
    entity.quantity = Math.max(0, entity.quantity - 1);
    entity.depleted = entity.quantity === 0;
    quantities.set(entity.id, entity.quantity);
  }

  const compact = compactGameStateSavePayload(state) as {
    world: {
      format: string;
      deltas: Array<readonly [string, string | null, number]>;
      customEntities: WorldEntity[];
    };
  };
  assert.equal(compact.world.format, "canopy-world-delta");
  assert.deepEqual(
    new Set(compact.world.deltas.map(([id]) => id)),
    new Set(changed.map((entity) => entity.id)),
  );
  assert.equal(
    compact.world.customEntities.some((entity) => entity.tags.includes("semantic")),
    false,
  );

  const restored = expandGameStateSavePayload(compact) as GameState;
  materializeGeneratedWorldChunk(restored, coordinate);
  for (const entity of changed) {
    assert.equal(restored.world.entities[entity.id].quantity, quantities.get(entity.id));
    assert.deepEqual(restored.world.entities[entity.id].semantic, entity.semantic);
  }
});

test("changed legacy generated IDs round-trip without retaining pristine legacy baselines", () => {
  const state = createInitialState("legacy-semantic-migration");
  const coordinate = { x: 7, z: -5 };
  const key = `${coordinate.x}:${coordinate.z}`;
  const legacy = Object.values(
    createLegacyGeneratedChunkEntities(state.seed, coordinate),
  );
  assert.ok(legacy.length >= 2);

  const changed = cloneEntity(legacy[0]);
  changed.quantity = 0;
  changed.depleted = true;
  const pristine = cloneEntity(legacy[1]);
  state.world.entities[changed.id] = changed;
  state.world.entities[pristine.id] = pristine;

  const compact = compactGameStateSavePayload(state) as {
    world: {
      deltas: Array<readonly [string, string | null, number]>;
      customEntities: WorldEntity[];
    };
  };
  assert.ok(compact.world.deltas.some(([id, chunk]) => id === changed.id && chunk === key));
  assert.equal(compact.world.deltas.some(([id]) => id === pristine.id), false);
  assert.equal(
    compact.world.customEntities.some((entity) => entity.id === changed.id || entity.id === pristine.id),
    false,
  );

  const restored = expandGameStateSavePayload(compact) as GameState;
  materializeGeneratedWorldChunk(restored, coordinate);
  assert.equal(restored.world.entities[changed.id].quantity, 0);
  assert.equal(restored.world.entities[changed.id].depleted, true);
  assert.equal(restored.world.entities[pristine.id], undefined);
  assert.ok(semanticEntities(restored, key).length > 0);
});
