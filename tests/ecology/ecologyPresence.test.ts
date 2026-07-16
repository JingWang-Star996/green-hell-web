import assert from "node:assert/strict";
import test from "node:test";

import {
  ECOLOGY_SPECIES,
  ECOLOGY_SPECIES_IDS,
  createEcologyState,
  ecologyPopulationKey,
  projectEcologyForRender,
} from "../../src/game/ecology";
import type { EcologyEnvironmentFrame } from "../../src/game/ecology";
import type { ChunkDescriptor } from "../../src/game/world/generation";

const ACTIVE_CHUNK: ChunkDescriptor = {
  coordinate: { x: 2, z: -1 },
  key: "2:-1",
  biome: "evergreen-rainforest",
  elevation: 0.32,
  moisture: 0.76,
  canopy: 0.9,
  generationSeed: 117,
};

function populatedState(count = 3) {
  const state = createEcologyState("stable-presence", {
    activeChunks: [ACTIVE_CHUNK],
    rainIntensity: 0.2,
  });
  for (const speciesId of ECOLOGY_SPECIES_IDS) {
    state.populations[ecologyPopulationKey(ACTIVE_CHUNK.key, speciesId)].count =
      count;
  }
  return state;
}

function frame(
  tick: number,
  rainIntensity = 0.2,
): EcologyEnvironmentFrame {
  return {
    tick,
    rainIntensity,
    activeChunks: [ACTIVE_CHUNK],
  };
}

function livingIdsAt(
  state: ReturnType<typeof populatedState>,
  ecologyFrame: EcologyEnvironmentFrame,
): string[] {
  return projectEcologyForRender(state, ecologyFrame)
    .filter((projection) => projection.health > 0)
    .map((projection) => projection.individualId)
    .sort();
}

test("active-bubble animals remain present across former 90-tick redraw boundaries", () => {
  const state = populatedState();
  const expectedIds = livingIdsAt(state, frame(89));

  for (const tick of [89, 90, 179, 180]) {
    const projections = projectEcologyForRender(state, frame(tick));
    assert.deepEqual(livingIdsAt(state, frame(tick)), expectedIds);
    assert.ok(projections.length > 0);
    assert.ok(
      projections.every((projection) => projection.visible),
      `tick ${tick} must not randomly erase an active individual`,
    );
    assert.ok(
      projections.every(
        (projection) =>
          projection.visibility >= 0 && projection.visibility <= 1,
      ),
    );
  }
});

test("weather changes readability without changing animal existence", () => {
  const state = populatedState();
  const clear = projectEcologyForRender(state, frame(180, 0));
  const downpour = projectEcologyForRender(state, frame(180, 1));

  assert.deepEqual(
    downpour.map((projection) => projection.individualId).sort(),
    clear.map((projection) => projection.individualId).sort(),
  );
  assert.ok(downpour.every((projection) => projection.visible));
  assert.ok(
    downpour.some((rainyProjection) => {
      const clearProjection = clear.find(
        (candidate) => candidate.individualId === rainyProjection.individualId,
      );
      return (
        clearProjection !== undefined &&
        rainyProjection.visibility < clearProjection.visibility
      );
    }),
    "rain may lower the continuous readability scalar",
  );
});

test("a sparse injured individual survives population-summary decline", () => {
  const state = populatedState(0);
  const speciesId = "reedtail-scuttler" as const;
  const populationKey = ecologyPopulationKey(ACTIVE_CHUNK.key, speciesId);
  const individualId = `${populationKey}#2`;
  state.populations[populationKey].count = 3;
  const originalProjection = projectEcologyForRender(state, frame(89)).find(
    (projection) => projection.individualId === individualId,
  );
  assert.ok(originalProjection);
  state.individuals ??= {};
  state.individuals[individualId] = {
    speciesId,
    health: 12,
    maxHealth: ECOLOGY_SPECIES[speciesId].combat.maxHealth,
    lastHitTick: 88,
    defeatedAtTick: null,
    respawnAtTick: null,
  };

  state.populations[populationKey].count = 1;
  const before = JSON.stringify(state);
  const declined = projectEcologyForRender(state, frame(90)).filter(
    (projection) => projection.speciesId === speciesId,
  );
  assert.equal(JSON.stringify(state), before, "projection is state-pure");
  assert.deepEqual(
    declined.map((projection) => projection.individualId),
    [individualId],
    "the injured identity fills the remaining summary slot instead of duplicating it",
  );
  assert.equal(declined[0].health, 12);

  state.populations[populationKey].count = 0;
  const belowSummaryBefore = JSON.stringify(state);
  const belowSummary = projectEcologyForRender(state, frame(180)).filter(
    (projection) => projection.speciesId === speciesId,
  );
  assert.deepEqual(
    belowSummary.map((projection) => projection.individualId),
    [individualId],
  );
  assert.equal(belowSummary[0].visible, true);
  assert.equal(JSON.stringify(state), belowSummaryBefore, "projection is state-pure");
  assert.equal(state.individuals[individualId].health, 12);
});

test("an unclaimed corpse remains frozen through save round-trips and ecology frames", () => {
  const state = populatedState(0);
  const speciesId = "reedtail-scuttler" as const;
  const populationKey = ecologyPopulationKey(ACTIVE_CHUNK.key, speciesId);
  const individualId = `${populationKey}#7`;
  const corpseSnapshot = {
    chunkKey: ACTIVE_CHUNK.key,
    position: { x: 111.25, y: 1.6, z: -34.5 },
    headingRadians: 1.375,
  };
  state.individuals = {
    [individualId]: {
      speciesId,
      health: 0,
      maxHealth: ECOLOGY_SPECIES[speciesId].combat.maxHealth,
      lastHitTick: 80,
      defeatedAtTick: 81,
      respawnAtTick: 900,
      pendingMeat: 2,
      pendingHide: 1,
      corpse: corpseSnapshot,
    },
  };
  const saved = JSON.stringify(state);
  const resumed = JSON.parse(saved) as typeof state;

  for (const ecologyFrame of [frame(89, 0), frame(180, 1)]) {
    const corpse = projectEcologyForRender(resumed, ecologyFrame).find(
      (projection) => projection.individualId === individualId,
    );
    assert.ok(corpse);
    assert.equal(corpse.behavior, "dead");
    assert.equal(corpse.visible, true);
    assert.deepEqual(corpse.position, corpseSnapshot.position);
    assert.equal(corpse.headingRadians, corpseSnapshot.headingRadians);
    assert.equal(corpse.pendingMeat, 2);
    assert.equal(corpse.pendingHide, 1);
  }
  assert.equal(JSON.stringify(resumed), saved, "render projection is save-pure");
});
