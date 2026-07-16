import assert from "node:assert/strict";
import test from "node:test";

import {
  RESOURCE_DIRECTOR_EPOCH_TICKS,
  advanceResourceDirector,
  cloneGameState,
  createInitialState,
  evaluateResourceNeeds,
  migrateGameState,
} from "../../src/game/sim/index";
import type {
  GameState,
  ResourceRegenerationState,
  WorldEntity,
} from "../../src/game/sim/index";
import { createGeneratedChunkEntities } from "../../src/game/world/saveDelta";

const ACTIVE_RESOURCE_IDS = [
  "resource.stick.trail-01",
  "resource.vine.trail-01",
] as const;

function makeDue(
  state: GameState,
  entityId: string,
  position: { x: number; y: number; z: number },
  overrides: Partial<ResourceRegenerationState> = {},
): WorldEntity {
  const entity = state.world.entities[entityId];
  assert.ok(entity, `missing fixture entity ${entityId}`);
  entity.position = position;
  entity.quantity = 0;
  entity.depleted = true;
  entity.regeneration = {
    capacity: 12,
    nextTick: 1,
    cycle: 0,
    nextAmount: 1,
    ...overrides,
  };
  return entity;
}

function stateAtFirstEpoch(seed: string): GameState {
  const state = createInitialState(seed);
  state.player.position = { x: 0, y: 0, z: 0 };
  state.player.lookYaw = Math.PI;
  state.clock.tick = RESOURCE_DIRECTOR_EPOCH_TICKS;
  state.resourceDirector = { version: 1, evaluatedThroughEpoch: 0 };
  return state;
}

test("resource director decisions are deterministic and independent of entity insertion order", () => {
  const source = stateAtFirstEpoch("director-order");
  makeDue(source, ACTIVE_RESOURCE_IDS[0], { x: -8, y: 0, z: -64 });
  makeDue(source, ACTIVE_RESOURCE_IDS[1], { x: 8, y: 0, z: -64 });

  const left = cloneGameState(source);
  const right = cloneGameState(source);
  right.world.entities = Object.fromEntries(
    Object.entries(right.world.entities).reverse(),
  );

  const leftDecisions = advanceResourceDirector(left);
  const rightDecisions = advanceResourceDirector(right);

  assert.deepEqual(rightDecisions, leftDecisions);
  assert.deepEqual(
    Object.fromEntries(
      ACTIVE_RESOURCE_IDS.map((id) => [id, left.world.entities[id].quantity]),
    ),
    Object.fromEntries(
      ACTIVE_RESOURCE_IDS.map((id) => [id, right.world.entities[id].quantity]),
    ),
  );
});

test("one epoch settles at most one due node without boosting its capacity or pending batch", () => {
  const state = stateAtFirstEpoch("director-cap");
  makeDue(state, ACTIVE_RESOURCE_IDS[0], { x: -8, y: 0, z: -64 });
  makeDue(state, ACTIVE_RESOURCE_IDS[1], { x: 8, y: 0, z: -64 });

  const decisions = advanceResourceDirector(state);
  const changed = ACTIVE_RESOURCE_IDS.filter(
    (id) => state.world.entities[id].quantity > 0,
  );

  assert.equal(decisions.length, 1);
  assert.equal(changed.length, 1);
  assert.equal(state.world.entities[changed[0]].quantity, 1);
  assert.equal(state.world.entities[changed[0]].regeneration?.capacity, 12);
});

test("active nodes never pop in nearby space or in the player's forward half-plane", () => {
  const state = stateAtFirstEpoch("director-no-pop");
  makeDue(state, ACTIVE_RESOURCE_IDS[0], { x: 0, y: 0, z: -30 });
  makeDue(state, ACTIVE_RESOURCE_IDS[1], { x: 0, y: 0, z: 64 });

  assert.deepEqual(advanceResourceDirector(state), []);
  assert.equal(state.world.entities[ACTIVE_RESOURCE_IDS[0]].quantity, 0);
  assert.equal(state.world.entities[ACTIVE_RESOURCE_IDS[1]].quantity, 0);
});

test("unloaded chunk deltas are preferred over eligible active nodes", () => {
  const state = stateAtFirstEpoch("director-unloaded");
  makeDue(state, ACTIVE_RESOURCE_IDS[0], { x: 0, y: 0, z: -64 });

  const chunk = { x: 3, z: 3 };
  const generated = Object.values(
    createGeneratedChunkEntities(state.seed, chunk),
  );
  const unloaded = generated.find(
    (entity) => entity.semantic?.category === "harvestable-plant",
  );
  assert.ok(unloaded, "the deterministic fixture chunk needs a renewable plant");
  state.world.entityDeltas ??= {};
  state.world.entityDeltas[unloaded.id] = {
    chunk: "3:3",
    quantity: 0,
    regeneration: {
      capacity: Math.max(1, unloaded.quantity),
      nextTick: 1,
      cycle: 0,
      nextAmount: 1,
    },
  };

  const decisions = advanceResourceDirector(state);

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].source, "unloaded");
  assert.equal(decisions[0].entityId, unloaded.id);
  assert.equal(state.world.entityDeltas[unloaded.id].quantity, 1);
  assert.equal(state.world.entities[ACTIVE_RESOURCE_IDS[0]].quantity, 0);
});

test("tree, rock, rare, and objective bodies are outside director authority", () => {
  const state = stateAtFirstEpoch("director-exclusions");
  const valid = makeDue(
    state,
    ACTIVE_RESOURCE_IDS[0],
    { x: 0, y: 0, z: -64 },
  );
  const forbidden = Object.values(state.world.entities).filter(
    (entity) =>
      entity.semantic?.category === "tree" ||
      entity.semantic?.category === "mineable-rock",
  );
  assert.ok(forbidden.some((entity) => entity.semantic?.category === "tree"));
  assert.ok(
    forbidden.some((entity) => entity.semantic?.category === "mineable-rock"),
  );
  for (const [index, entity] of forbidden.entries()) {
    entity.position = { x: index * 3, y: 0, z: -70 };
    entity.quantity = 0;
    entity.depleted = true;
    entity.regeneration = {
      capacity: 4,
      nextTick: 1,
      cycle: 0,
      nextAmount: 4,
    };
  }
  const objective = state.world.entities["resource.battery.weather-station"];
  objective.position = { x: 0, y: 0, z: -80 };
  objective.quantity = 0;
  objective.depleted = true;
  objective.regeneration = {
    capacity: 1,
    nextTick: 1,
    cycle: 0,
    nextAmount: 1,
  };

  const decisions = advanceResourceDirector(state);

  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].entityId, valid.id);
  assert.ok(forbidden.every((entity) => entity.quantity === 0));
  assert.equal(objective.quantity, 0);
});

test("persisted director epoch prevents duplicate settlement after save migration", () => {
  const state = stateAtFirstEpoch("director-save-epoch");
  makeDue(state, ACTIVE_RESOURCE_IDS[0], { x: 0, y: 0, z: -64 });
  assert.equal(advanceResourceDirector(state).length, 1);

  const restored = migrateGameState(
    JSON.parse(JSON.stringify(state)) as GameState,
  );
  const quantityAfterLoad = restored.world.entities[ACTIVE_RESOURCE_IDS[0]].quantity;

  assert.deepEqual(advanceResourceDirector(restored), []);
  assert.equal(
    restored.world.entities[ACTIVE_RESOURCE_IDS[0]].quantity,
    quantityAfterLoad,
  );

  makeDue(restored, ACTIVE_RESOURCE_IDS[1], { x: 8, y: 0, z: -64 });
  restored.clock.tick = RESOURCE_DIRECTOR_EPOCH_TICKS * 2;
  const nextEpoch = advanceResourceDirector(restored);
  assert.equal(nextEpoch.length, 1);
  assert.equal(nextEpoch[0].epoch, 2);
});

test("first-night progression need ranks due tinder ahead of unrelated renewable loot", () => {
  const state = stateAtFirstEpoch("director-first-night-tinder");
  state.objectives.currentTaskId = "purify-water";
  state.inventory.stick = 99;
  state.inventory["stone-blade"] = 1;
  state.inventory["coconut-shell"] = 2;
  state.inventory["dry-leaf"] = 0;
  for (const entity of Object.values(state.world.entities)) {
    if (entity.itemId !== "dry-leaf") continue;
    entity.quantity = 0;
    entity.depleted = true;
    if (entity.regeneration) {
      entity.regeneration.nextTick = null;
      entity.regeneration.nextAmount = null;
    }
  }

  const tinder = makeDue(
    state,
    "resource.dry-leaf.camp-02",
    { x: 0, y: 0, z: -64 },
    { capacity: 3 },
  );
  makeDue(
    state,
    "resource.coconut.stream-01",
    { x: 0, y: 0, z: -64 },
    { capacity: 3 },
  );

  assert.equal(evaluateResourceNeeds(state)["dry-leaf"], 1);
  const decisions = advanceResourceDirector(state);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].entityId, tinder.id);
  assert.equal(state.world.entities[tinder.id].quantity, 1);
});
