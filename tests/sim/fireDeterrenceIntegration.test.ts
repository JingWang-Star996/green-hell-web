import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPFIRE_WILDLIFE_DETERRENT_ID,
  CAMPFIRE_WILDLIFE_DETERRENT_RADIUS,
  activeFireDeterrents,
  activeWildlifeProjections,
  applyCommand,
  createInitialState,
  migrateGameState,
  projectActiveWildlife,
} from "../../src/game/sim";
import { DEFAULT_STRUCTURE_PLACEMENTS } from "../../src/game/sim/structureGeometry";
import type { GameState } from "../../src/game/sim/types";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import {
  WORLD_CHUNK_SIZE,
  worldToChunkCoordinate,
} from "../../src/game/world/generation";

function predator(state: GameState) {
  let found = projectActiveWildlife(state).wildlife.find(
    (wildlife) => wildlife.speciesId === "glassfang-stalker",
  );
  if (!found) {
    const population = Object.values(state.ecology?.populations ?? {}).find(
      (candidate) => candidate.speciesId === "glassfang-stalker",
    );
    assert.ok(population);
    population.count = 1;
    found = projectActiveWildlife(state).wildlife.find(
      (wildlife) => wildlife.speciesId === "glassfang-stalker",
    );
  }
  assert.ok(found);
  return found;
}

function placePlayerOnPredator(state: GameState) {
  let found = predator(state);
  state.player.position = { ...found.position };
  // The first observer change removes the prior stalking offset; the second
  // projection is the stable same-frame contact pose.
  found = predator(state);
  state.player.position = { ...found.position };
  return predator(state);
}

function directionToChunkCenter(position: { x: number; z: number }) {
  const coordinate = worldToChunkCoordinate(position.x, position.z);
  const centerX = (coordinate.x + 0.5) * WORLD_CHUNK_SIZE;
  const centerZ = (coordinate.z + 0.5) * WORLD_CHUNK_SIZE;
  const dx = centerX - position.x;
  const dz = centerZ - position.z;
  const length = Math.hypot(dx, dz);
  assert.ok(length > 0);
  return { x: dx / length, z: dz / length };
}

function lightFire(
  state: GameState,
  position: { x: number; y: number; z: number },
) {
  state.camp.fire.built = true;
  state.camp.fire.lit = true;
  state.camp.fire.fuelSeconds = 120;
  state.camp.structures = [
    {
      id: "structure.campfire.fire-deterrence-test",
      kind: "campfire",
      position: { ...position },
      yaw: 0,
      builtAtTick: state.clock.tick,
    },
  ];
}

function rendererProjections(state: GameState) {
  return createRenderSnapshot(state).wildlife.map((entry) =>
    Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== "affordance"),
    ),
  );
}

test("renderer and simulation consume the exact same lit-fire wildlife projection", () => {
  const state = createInitialState("fire-projection-source");
  const nearby = placePlayerOnPredator(state);
  const inward = directionToChunkCenter(nearby.position);
  lightFire(state, {
    x: nearby.position.x - inward.x,
    y: 0,
    z: nearby.position.z - inward.z,
  });

  assert.deepEqual(rendererProjections(state), activeWildlifeProjections(state));
  const projected = predator(state);
  assert.equal(projected.behavior, "fire-avoid");
  assert.match(
    createRenderSnapshot(state).wildlife.find(
      (entry) => entry.individualId === projected.individualId,
    )?.affordance.preview.detail ?? "",
    /火圈边缘.*仍可能完成扑击/,
  );
});

test("only a built and lit campfire emits the unique transform-derived deterrent", () => {
  const state = createInitialState("fire-toggle");
  state.camp.structures = [
    {
      id: "structure.campfire.toggle",
      kind: "campfire",
      position: { x: 17, y: 1.25, z: -9 },
      yaw: 0.4,
      builtAtTick: 0,
    },
  ];
  assert.deepEqual(activeFireDeterrents(state), []);
  state.camp.fire.built = true;
  assert.deepEqual(activeFireDeterrents(state), []);
  state.camp.fire.lit = true;
  assert.deepEqual(activeFireDeterrents(state), [
    {
      kind: "fire",
      id: CAMPFIRE_WILDLIFE_DETERRENT_ID,
      position: { x: 17, y: 1.25, z: -9 },
      radius: CAMPFIRE_WILDLIFE_DETERRENT_RADIUS,
      strength: 0.92,
    },
  ]);
  state.camp.fire.lit = false;
  assert.deepEqual(activeFireDeterrents(state), []);
});

test("near-fire retreat invalidates a stale contact pose without granting immunity at the edge", () => {
  const protectedState = createInitialState("fire-contact-near");
  const closePredator = placePlayerOnPredator(protectedState);
  const inward = directionToChunkCenter(closePredator.position);
  lightFire(protectedState, {
    x: closePredator.position.x - inward.x,
    y: 0,
    z: closePredator.position.z - inward.z,
  });
  const retreated = predator(protectedState);
  assert.equal(retreated.behavior, "fire-avoid");
  assert.ok(
    Math.hypot(
      retreated.position.x - protectedState.player.position.x,
      retreated.position.z - protectedState.player.position.z,
    ) > 1.65,
  );
  const protectedHealth = protectedState.player.vitals.health;
  const protectedResult = applyCommand(protectedState, {
    type: "encounter-wildlife",
    individualId: closePredator.individualId,
  });
  assert.equal(protectedResult.player.vitals.health, protectedHealth);
  assert.equal(
    protectedResult.eventLog.some((event) => event.type === "wildlife-attack"),
    false,
  );

  const edgeState = createInitialState("fire-contact-edge");
  edgeState.player.vitals.health = 100;
  const edgePredator = placePlayerOnPredator(edgeState);
  const edgeInward = directionToChunkCenter(edgePredator.position);
  const edgeDistance = CAMPFIRE_WILDLIFE_DETERRENT_RADIUS - 0.02;
  lightFire(edgeState, {
    x: edgePredator.position.x - edgeInward.x * edgeDistance,
    y: 0,
    z: edgePredator.position.z - edgeInward.z * edgeDistance,
  });
  const edgeProjection = predator(edgeState);
  assert.equal(edgeProjection.behavior, "fire-avoid");
  assert.ok((edgeProjection.deterrence?.influence ?? 1) < 0.001);
  const edgeResult = applyCommand(edgeState, {
    type: "encounter-wildlife",
    individualId: edgePredator.individualId,
  });
  assert.ok(edgeResult.player.vitals.health < 100);
  assert.equal(edgeResult.eventLog.at(-1)?.type, "wildlife-attack");
});

test("legacy saves without placed structures derive fire from the old authored transform", () => {
  const legacy = createInitialState("fire-legacy");
  legacy.camp.fire.built = true;
  legacy.camp.fire.lit = true;
  legacy.camp.fire.fuelSeconds = 60;
  legacy.camp.structures = undefined;
  legacy.ecology = undefined;

  const migrated = migrateGameState(
    JSON.parse(JSON.stringify(legacy)) as GameState,
  );
  const [source] = activeFireDeterrents(migrated);
  assert.ok(source);
  assert.deepEqual(source.position, DEFAULT_STRUCTURE_PLACEMENTS.campfire.position);
  assert.doesNotThrow(() => createRenderSnapshot(migrated));
  assert.equal(JSON.stringify(migrated).includes('"deterrents"'), false);
});
