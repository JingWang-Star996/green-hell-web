import assert from "node:assert/strict";
import test from "node:test";

import { MemoryKV, SaveRepository } from "../../src/game/persistence";
import { applyCommand, stepSimulation } from "../../src/game/sim/simulation";
import { createInitialState, migrateGameState } from "../../src/game/sim/state";
import type { GameState } from "../../src/game/sim/types";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import { WORLD_CHUNK_SIZE } from "../../src/game/world/generation";
import { wildlifeHitShape } from "../../src/game/sim/hitValidation";
import { hitProfileFor } from "../../src/game/world/hitGeometry";
import { terrainHeight } from "../../src/game/world/terrain";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
} from "../../src/game/world/saveDelta";

function killProceduralPrey(seed: string) {
  let state = createInitialState(seed);
  const prey = createRenderSnapshot(state).wildlife.find(
    (candidate) =>
      candidate.visible && candidate.speciesId === "reedtail-scuttler",
  );
  assert.ok(prey);
  state.player.position = { ...prey.position };
  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  state.world.entities = Object.fromEntries(
    Object.entries(state.world.entities).filter(
      ([, entity]) =>
        entity.semantic?.category !== "tree" &&
        entity.semantic?.category !== "mineable-rock",
    ),
  );
  const attacked = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.ok(attacked?.visible);
  state.player.lookYaw = Math.atan2(
    -(attacked.position.x - state.player.position.x),
    -(attacked.position.z - state.player.position.z),
  );
  const hitShape = wildlifeHitShape(attacked);
  state.player.lookPitch = Math.atan2(
    (hitShape.minimumY + hitShape.maximumY) / 2 -
      (terrainHeight(state.player.position.x, state.player.position.z) +
        hitProfileFor("attack").originHeight),
    Math.hypot(
      attacked.position.x - state.player.position.x,
      attacked.position.z - state.player.position.z,
    ),
  );
  state = applyCommand(state, {
    type: "physical-action",
    targetId: `wildlife:${prey.individualId}`,
    actionId: "attack",
    poseRevision: state.player.poseRevision ?? 0,
  });
  const condition = state.ecology?.individuals?.[prey.individualId];
  assert.ok(condition?.corpse);
  return {
    state,
    individualId: prey.individualId,
    populationKey: prey.populationKey,
    corpse: structuredClone(condition.corpse),
    respawnAtTick: condition.respawnAtTick,
  };
}

test("overdue procedural respawn remains gated until the final corpse item is collected", () => {
  const killed = killProceduralPrey("carcass-respawn");
  let state = killed.state;
  const { individualId, corpse } = killed;
  const condition = state.ecology?.individuals?.[individualId];
  assert.ok(condition);
  condition.respawnAtTick = state.clock.tick;

  state = stepSimulation(state, {}, 1);
  const gated = state.ecology?.individuals?.[individualId];
  assert.ok(gated, "an overdue respawn cannot consume pending corpse loot");
  assert.deepEqual(gated.corpse, corpse);
  assert.equal(gated.pendingMeat, 1);
  assert.equal(
    createRenderSnapshot(state).wildlife.find(
      (candidate) => candidate.individualId === individualId,
    )?.behavior,
    "dead",
  );

  state = applyCommand(state, {
    type: "collect-wildlife-loot",
    individualId,
  });
  assert.equal(state.ecology?.individuals?.[individualId]?.pendingMeat, 0);
  assert.equal(state.ecology?.individuals?.[individualId]?.corpse, undefined);
  assert.equal(
    createRenderSnapshot(state).wildlife.some(
      (candidate) => candidate.individualId === individualId,
    ),
    false,
    "the command result exposes neither an empty corpse nor a premature live actor",
  );

  state = stepSimulation(state, {}, 1);
  assert.equal(state.ecology?.individuals?.[individualId], undefined);
  const respawned = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === individualId,
  );
  assert.ok(respawned);
  assert.equal(respawned.health, respawned.maxHealth);
});

test("corpse anchor and loot survive repository save plus activity-bubble re-entry", async () => {
  const killed = killProceduralPrey("carcass-save-bubble");
  const population = killed.state.ecology?.populations[killed.populationKey];
  assert.ok(population);
  population.count = 0;

  const saves = new SaveRepository<unknown>({
    key: "test.procedural-carcass",
    schema: 2,
    content: "procedural-carcass@1",
    device: "test-device",
    kv: new MemoryKV(),
    payloadValidator: (payload): payload is unknown => payload !== undefined,
  });
  const saved = await saves.save(compactGameStateSavePayload(killed.state), {
    seed: killed.state.seed,
    simTick: killed.state.clock.tick,
  });
  assert.equal(saved.ok, true);
  const loaded = await saves.load();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  let restored = migrateGameState(
    expandGameStateSavePayload(loaded.envelope.payload) as GameState,
  );
  const restoredCondition = restored.ecology?.individuals?.[killed.individualId];
  assert.ok(restoredCondition);
  assert.deepEqual(restoredCondition.corpse, killed.corpse);
  assert.equal(restoredCondition.pendingMeat, 1);
  assert.equal(restoredCondition.respawnAtTick, killed.respawnAtTick);

  restored.player.position = {
    x: killed.corpse.position.x + WORLD_CHUNK_SIZE * 8,
    y: killed.corpse.position.y,
    z: killed.corpse.position.z + WORLD_CHUNK_SIZE * 8,
  };
  restored = stepSimulation(restored, {}, 31);
  assert.equal(
    createRenderSnapshot(restored).wildlife.some(
      (candidate) => candidate.individualId === killed.individualId,
    ),
    false,
    "inactive chunks do not project their corpses",
  );

  restored.player.position = { ...killed.corpse.position };
  const returnedCorpse = createRenderSnapshot(restored).wildlife.find(
    (candidate) => candidate.individualId === killed.individualId,
  );
  assert.ok(returnedCorpse, "the sparse corpse is independent of population count");
  assert.equal(returnedCorpse.behavior, "dead");
  assert.deepEqual(returnedCorpse.position, killed.corpse.position);
  assert.equal(returnedCorpse.headingRadians, killed.corpse.headingRadians);
  assert.equal(returnedCorpse.pendingMeat, 1);
});

test("migration rejects corrupt anchors and removes stale corpse data from live animals", () => {
  const killed = killProceduralPrey("carcass-migration-guard");
  const corrupt = killed.state.ecology?.individuals?.[killed.individualId];
  assert.ok(corrupt?.corpse);
  corrupt.corpse.chunkKey = "999:999";
  corrupt.corpse.headingRadians = Number.POSITIVE_INFINITY;
  const normalized = migrateGameState(killed.state);
  const normalizedCondition = normalized.ecology?.individuals?.[killed.individualId];
  assert.ok(normalizedCondition);
  assert.equal(normalizedCondition.corpse, undefined);
  assert.equal(normalizedCondition.pendingMeat, 0);
  assert.equal(normalizedCondition.pendingHide, 0);

  const live = killProceduralPrey("carcass-live-normalize");
  const liveCondition = live.state.ecology?.individuals?.[live.individualId];
  assert.ok(liveCondition);
  liveCondition.health = 1;
  const liveNormalized = migrateGameState(live.state);
  assert.equal(
    liveNormalized.ecology?.individuals?.[live.individualId]?.corpse,
    undefined,
  );
  assert.equal(
    liveNormalized.ecology?.individuals?.[live.individualId]?.pendingMeat,
    undefined,
  );
});
