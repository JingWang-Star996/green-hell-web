import assert from "node:assert/strict";
import test from "node:test";

import {
  ECOLOGY_SPECIES,
  ECOLOGY_SPECIES_IDS,
  createEcologyState,
  ecologyPopulationKey,
  projectEcologyEncounters,
  projectEcologyForRender,
} from "../../src/game/ecology";
import type {
  EcologyEnvironmentFrame,
  EcologyFireDeterrent,
  EcologyRenderProjection,
} from "../../src/game/ecology";
import type { ChunkDescriptor } from "../../src/game/world/generation";

const ACTIVE_CHUNK: ChunkDescriptor = {
  coordinate: { x: 0, z: 0 },
  key: "0:0",
  biome: "evergreen-rainforest",
  elevation: 0.34,
  moisture: 0.78,
  canopy: 0.88,
  generationSeed: 441,
};
const TICK = 3_600;

function predatorState() {
  const state = createEcologyState("fire-deterrence", {
    activeChunks: [ACTIVE_CHUNK],
    rainIntensity: 0.2,
  });
  for (const speciesId of ECOLOGY_SPECIES_IDS) {
    state.populations[ecologyPopulationKey(ACTIVE_CHUNK.key, speciesId)].count =
      speciesId === "glassfang-stalker" ? 1 : 0;
  }
  return state;
}

function frame(
  deterrents?: readonly EcologyFireDeterrent[],
): EcologyEnvironmentFrame {
  return {
    tick: TICK,
    rainIntensity: 0.2,
    activeChunks: [ACTIVE_CHUNK],
    ...(deterrents ? { deterrents } : {}),
  };
}

function predator(
  state: ReturnType<typeof predatorState>,
  ecologyFrame: EcologyEnvironmentFrame,
): EcologyRenderProjection {
  const result = projectEcologyForRender(state, ecologyFrame).find(
    (projection) => projection.speciesId === "glassfang-stalker",
  );
  assert.ok(result);
  return result;
}

function sourceAt(
  origin: EcologyRenderProjection,
  distance: number,
  strength = 1,
  id = "fire.primary",
): EcologyFireDeterrent {
  const sourceOnPositiveX = origin.position.x >= 24;
  return {
    kind: "fire",
    id,
    position: {
      x: origin.position.x + (sourceOnPositiveX ? distance : -distance),
      y: origin.position.y,
      z: origin.position.z,
    },
    radius: 10,
    strength,
  };
}

test("a living predator continuously retreats from fire while awareness remains honest", () => {
  const state = predatorState();
  const baseline = predator(state, frame());
  const fire = sourceAt(baseline, 2);
  const observerPosition = { ...baseline.position };
  const noFireAware = predator(state, { ...frame(), observerPosition });
  const avoided = predator(state, {
    ...frame([fire]),
    observerPosition,
  });

  assert.equal(noFireAware.behavior, "stalk");
  assert.equal(avoided.behavior, "fire-avoid");
  assert.equal(avoided.awareness, 1);
  assert.equal(avoided.visible, true);
  assert.equal(avoided.health, baseline.health);
  assert.ok(avoided.deterrence);
  assert.ok(avoided.deterrence.displacement > 0);
  assert.equal(avoided.headingRadians, avoided.deterrence.retreatHeadingRadians);
  assert.equal(
    projectEcologyEncounters([avoided], observerPosition).length,
    1,
    "fire changes intent; it does not delete the predator or grant immunity",
  );
});

test("fire strength and radial distance produce bounded continuous influence", () => {
  const state = predatorState();
  const baseline = predator(state, frame());
  const weak = predator(state, frame([sourceAt(baseline, 2, 0.25)]));
  const strong = predator(state, frame([sourceAt(baseline, 2, 1)]));
  const far = predator(state, frame([sourceAt(baseline, 8, 1)]));
  const edge = predator(state, frame([sourceAt(baseline, 9.9, 1)]));
  const boundary = predator(state, frame([sourceAt(baseline, 10, 1)]));

  assert.ok((strong.deterrence?.influence ?? 0) > (weak.deterrence?.influence ?? 0));
  assert.ok((strong.deterrence?.displacement ?? 0) > (far.deterrence?.displacement ?? 0));
  assert.ok((edge.deterrence?.displacement ?? 1) < 0.01);
  assert.deepEqual(boundary, baseline, "the exact radius boundary is fail-closed");
  assert.ok((strong.deterrence?.influence ?? -1) <= 1);
  assert.ok((strong.deterrence?.displacement ?? -1) <= 3.2);
});

test("multiple fires are order-stable and malformed or duplicate authority fails closed", () => {
  const state = predatorState();
  const baseline = predator(state, frame());
  const first = sourceAt(baseline, 2, 0.8, "fire.a");
  const second = {
    ...sourceAt(baseline, 3, 0.6, "fire.b"),
    position: {
      ...sourceAt(baseline, 3, 0.6, "fire.b").position,
      z: baseline.position.z - 1,
    },
  };
  const ordered = predator(state, frame([first, second]));
  const reversed = predator(state, frame([second, first]));
  assert.deepEqual(reversed, ordered);
  assert.deepEqual(ordered.deterrence?.sourceIds, ["fire.a", "fire.b"]);

  const duplicate = predator(state, frame([first, { ...first, strength: 1 }]));
  assert.deepEqual(duplicate, baseline);
  const invalid = predator(
    state,
    frame([
      {
        ...first,
        position: { ...first.position, x: Number.NaN },
      },
    ]),
  );
  assert.deepEqual(invalid, baseline);
});

test("a predator corpse remains frozen and fire projections replay through JSON", () => {
  const state = predatorState();
  const living = predator(state, frame());
  const populationKey = ecologyPopulationKey(
    ACTIVE_CHUNK.key,
    "glassfang-stalker",
  );
  state.populations[populationKey].count = 0;
  state.individuals = {
    [living.individualId]: {
      speciesId: "glassfang-stalker",
      health: 0,
      maxHealth: ECOLOGY_SPECIES["glassfang-stalker"].combat.maxHealth,
      lastHitTick: TICK - 1,
      defeatedAtTick: TICK - 1,
      respawnAtTick: TICK + 1_000,
      pendingMeat: 2,
      pendingHide: 1,
      corpse: {
        chunkKey: ACTIVE_CHUNK.key,
        position: { ...living.position },
        headingRadians: living.headingRadians,
      },
    },
  };
  const fire = sourceAt(living, 0);
  const corpseWithoutFire = projectEcologyForRender(state, frame())[0];
  const corpseWithFire = projectEcologyForRender(state, frame([fire]))[0];
  assert.deepEqual(corpseWithFire, corpseWithoutFire);
  assert.equal(corpseWithFire.behavior, "dead");
  assert.equal(corpseWithFire.deterrence, undefined);

  const livingState = predatorState();
  const replayFrame = frame([sourceAt(predator(livingState, frame()), 2)]);
  const before = JSON.stringify(livingState);
  const expected = projectEcologyForRender(livingState, replayFrame);
  const replayed = projectEcologyForRender(
    JSON.parse(JSON.stringify(livingState)) as typeof livingState,
    JSON.parse(JSON.stringify(replayFrame)) as EcologyEnvironmentFrame,
  );
  assert.deepEqual(replayed, expected);
  assert.equal(JSON.stringify(livingState), before, "projection remains state-pure");
});
