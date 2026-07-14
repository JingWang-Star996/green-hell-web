import assert from "node:assert/strict";
import test from "node:test";

import {
  ECOLOGY_SPECIES,
  ECOLOGY_SPECIES_IDS,
  ECOLOGY_STEP_TICKS,
  activityAtMinute,
  advanceEcology,
  createEcologyState,
  ecologyPopulationKey,
  getCarryingCapacity,
  projectEcologyEncounters,
  projectEcologyForRender,
} from "../../src/game/ecology";
import {
  chunkRing,
  generateChunkDescriptor,
} from "../../src/game/world/generation";
import type {
  BiomeId,
  ChunkDescriptor,
} from "../../src/game/world/generation";

function chunk(
  key: string,
  x: number,
  biome: BiomeId,
  moisture: number,
  canopy: number,
): ChunkDescriptor {
  return {
    coordinate: { x, z: 0 },
    key,
    biome,
    elevation: biome === "rocky-highland" ? 0.86 : 0.32,
    moisture,
    canopy,
    generationSeed: x + 100,
  };
}

test("the original fauna roster spans prey, large herbivore and predator rhythms", () => {
  assert.deepEqual(
    ECOLOGY_SPECIES_IDS.map((id) => ECOLOGY_SPECIES[id].role),
    ["small-prey", "large-herbivore", "predator"],
  );
  assert.ok(activityAtMinute("diurnal", 13 * 60) > activityAtMinute("diurnal", 1 * 60));
  assert.ok(activityAtMinute("nocturnal", 1 * 60) > activityAtMinute("nocturnal", 13 * 60));
  assert.ok(
    activityAtMinute("crepuscular", 18 * 60) >
      activityAtMinute("crepuscular", 12 * 60),
  );
});
test("habitat and weather preferences produce biome-specific carrying capacities", () => {
  const palm = chunk("palm", 0, "palm-grove", 0.62, 0.7);
  const rock = chunk("rock", 1, "rocky-highland", 0.18, 0.22);
  const swamp = chunk("swamp", 2, "swamp", 0.96, 0.9);

  assert.ok(
    getCarryingCapacity(ECOLOGY_SPECIES["reedtail-scuttler"], palm, 0.32) >
      getCarryingCapacity(ECOLOGY_SPECIES["reedtail-scuttler"], rock, 0.32),
  );
  assert.ok(
    getCarryingCapacity(ECOLOGY_SPECIES["glassfang-stalker"], swamp, 0.76) >
      getCarryingCapacity(ECOLOGY_SPECIES["glassfang-stalker"], palm, 0.76),
  );
  assert.ok(
    getCarryingCapacity(ECOLOGY_SPECIES["mossback-grazer"], palm, 0.3) >
      getCarryingCapacity(ECOLOGY_SPECIES["mossback-grazer"], palm, 1),
  );
});

test("seeded population evolution is replayable across update partitioning and JSON saves", () => {
  const activeChunks = chunkRing({ x: 0, z: 0 }, 1).map((coordinate) =>
    generateChunkDescriptor("ecology-replay", coordinate),
  );
  const initial = createEcologyState("ecology-replay", {
    activeChunks,
    rainIntensity: 0.38,
  });
  const destinationTick = ECOLOGY_STEP_TICKS * 24;
  const oneShot = advanceEcology(initial, {
    tick: destinationTick,
    rainIntensity: 0.38,
    activeChunks,
  });

  let partitioned = JSON.parse(JSON.stringify(initial)) as typeof initial;
  const partitionedTransitions = [];
  for (let step = 1; step <= 24; step += 1) {
    const result = advanceEcology(partitioned, {
      tick: ECOLOGY_STEP_TICKS * step,
      rainIntensity: 0.38,
      activeChunks,
    });
    partitioned = result.state;
    partitionedTransitions.push(...result.transitions);
  }

  assert.deepEqual(partitioned, oneShot.state);
  assert.deepEqual(partitionedTransitions, oneShot.transitions);
  const resumed = advanceEcology(
    JSON.parse(JSON.stringify(partitioned)) as typeof partitioned,
    {
      tick: destinationTick + ECOLOGY_STEP_TICKS,
      rainIntensity: 0.38,
      activeChunks,
    },
  );
  assert.deepEqual(
    resumed,
    advanceEcology(partitioned, {
      tick: destinationTick + ECOLOGY_STEP_TICKS,
      rainIntensity: 0.38,
      activeChunks,
    }),
  );
});

test("population lifecycle supports replenishment, migration and capacity-driven departure", () => {
  const poorSource = chunk("0:0", 0, "rocky-highland", 0.32, 0.34);
  const richTarget = chunk("1:0", 1, "palm-grove", 0.62, 0.72);
  const activeChunks = [poorSource, richTarget];
  const state = createEcologyState("lifecycle-17", {
    activeChunks,
    rainIntensity: 0.3,
  });
  const sourceKey = ecologyPopulationKey(poorSource.key, "reedtail-scuttler");
  const targetKey = ecologyPopulationKey(richTarget.key, "reedtail-scuttler");
  state.populations[sourceKey].count =
    getCarryingCapacity(ECOLOGY_SPECIES["reedtail-scuttler"], poorSource, 0.3) + 4;
  state.populations[targetKey].count = 0;

  const result = advanceEcology(state, {
    tick: ECOLOGY_STEP_TICKS * 80,
    rainIntensity: 0.3,
    activeChunks,
  });
  const transitionTypes = new Set(result.transitions.map((transition) => transition.type));
  assert.ok(transitionTypes.has("departure"));
  assert.ok(transitionTypes.has("immigration"));
  assert.ok(transitionTypes.has("birth"));
  assert.ok(transitionTypes.has("migration"));
  for (const speciesId of ECOLOGY_SPECIES_IDS) {
    for (const activeChunk of activeChunks) {
      const population = result.state.populations[
        ecologyPopulationKey(activeChunk.key, speciesId)
      ];
      assert.ok(population.count >= 0);
      assert.ok(
        population.count <=
          getCarryingCapacity(ECOLOGY_SPECIES[speciesId], activeChunk, 0.3),
      );
    }
  }
});

test("render and encounter projections are pure, stable consumer views", () => {
  const activeChunk = chunk("4:-3", 4, "evergreen-rainforest", 0.72, 0.9);
  const state = createEcologyState("projection", {
    activeChunks: [activeChunk],
    rainIntensity: 0.2,
  });
  for (const speciesId of ECOLOGY_SPECIES_IDS) {
    state.populations[ecologyPopulationKey(activeChunk.key, speciesId)].count = 1;
  }
  const frame = {
    tick: ECOLOGY_STEP_TICKS * 3,
    rainIntensity: 0.2,
    activeChunks: [activeChunk],
  };
  const before = JSON.stringify(state);
  const first = projectEcologyForRender(state, frame);
  const second = projectEcologyForRender(state, frame);

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(new Set(first.map((projection) => projection.speciesId)), new Set(ECOLOGY_SPECIES_IDS));
  for (const projection of first) {
    assert.ok(projection.position.x >= activeChunk.coordinate.x * 48);
    assert.ok(projection.position.x <= (activeChunk.coordinate.x + 1) * 48);
  }

  const visible = { ...first[0], visible: true };
  const encounters = projectEcologyEncounters([visible], visible.position);
  assert.equal(encounters.length, 1);
  assert.equal(encounters[0].distance, 0);
  assert.equal(encounters[0].urgency, 1);
});
