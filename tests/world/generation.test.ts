import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME_PROFILES,
  BIOME_VISUAL_PROFILES,
  WORLD_CHUNK_SIZE,
  activeChunkCoordinates,
  chunkKey,
  chunkRing,
  generateChunkDescriptor,
  generateChunkResourcePlan,
  generateChunkVisualPlan,
  stableSpawnId,
  worldToChunkCoordinate,
} from "../../src/game/world/generation";

test("world positions map deterministically across positive and negative chunk boundaries", () => {
  assert.deepEqual(worldToChunkCoordinate(0, 0), { x: 0, z: 0 });
  assert.deepEqual(worldToChunkCoordinate(WORLD_CHUNK_SIZE - 0.01, WORLD_CHUNK_SIZE), { x: 0, z: 1 });
  assert.deepEqual(worldToChunkCoordinate(-0.01, -WORLD_CHUNK_SIZE), { x: -1, z: -1 });
});

test("chunk descriptors and spawn ids are stable for a world seed", () => {
  const coordinate = { x: -18, z: 27 };
  const first = generateChunkDescriptor("living-forest", coordinate);
  const second = generateChunkDescriptor("living-forest", coordinate);
  assert.deepEqual(first, second);
  assert.equal(first.key, chunkKey(coordinate));
  assert.equal(stableSpawnId(2, coordinate, 7), "2:-18:27:7");
  assert.ok(BIOME_PROFILES[first.biome]);
});

test("different world seeds produce a varied deterministic biome field", () => {
  const coordinates = chunkRing({ x: 0, z: 0 }, 4);
  const firstWorld = new Set(coordinates.map((coordinate) => generateChunkDescriptor("forest-a", coordinate).biome));
  const secondWorld = coordinates.map((coordinate) => generateChunkDescriptor("forest-b", coordinate));
  assert.ok(firstWorld.size >= 3, "a local region should expose several functional biomes");
  assert.ok(
    secondWorld.some((chunk, index) => chunk.generationSeed !== generateChunkDescriptor("forest-a", coordinates[index]).generationSeed),
    "world seed must affect generated chunks",
  );
});

test("active chunk rings have a stable square footprint", () => {
  const ring = chunkRing({ x: 3, z: -2 }, 2);
  assert.equal(ring.length, 25);
  assert.deepEqual(ring[0], { x: 1, z: -4 });
  assert.deepEqual(ring.at(-1), { x: 5, z: 0 });
});

test("chunk visual plans are deterministic and low-power plans reduce object counts", () => {
  const coordinate = { x: -4, z: 9 };
  const standard = generateChunkVisualPlan("living-forest", coordinate, "standard");
  const repeated = generateChunkVisualPlan("living-forest", coordinate, "standard");
  const low = generateChunkVisualPlan("living-forest", coordinate, "low");

  assert.deepEqual(standard, repeated);
  assert.equal(standard.profile, BIOME_VISUAL_PROFILES[standard.descriptor.biome]);
  assert.ok(low.trees.length < standard.trees.length);
  assert.ok(low.shrubs.length < standard.shrubs.length);
  for (const spawn of [...standard.trees, ...standard.shrubs, ...standard.rocks]) {
    assert.ok(spawn.x >= coordinate.x * WORLD_CHUNK_SIZE);
    assert.ok(spawn.x < (coordinate.x + 1) * WORLD_CHUNK_SIZE);
    assert.ok(spawn.z >= coordinate.z * WORLD_CHUNK_SIZE);
    assert.ok(spawn.z < (coordinate.z + 1) * WORLD_CHUNK_SIZE);
  }
});

test("each biome produces a visibly distinct decoration signature", () => {
  const coordinates = chunkRing({ x: 0, z: 0 }, 12);
  const planByBiome = new Map(
    coordinates.map((coordinate) => {
      const plan = generateChunkVisualPlan("living-forest", coordinate);
      return [plan.descriptor.biome, plan] as const;
    }),
  );
  assert.equal(planByBiome.size, 5);

  const signatures = new Set(
    [...planByBiome.values()].map((plan) => [
      plan.profile.groundLow,
      plan.profile.treeStyle,
      plan.trees.length,
      plan.shrubs.length,
      plan.rocks.length,
      plan.wetPatches.length,
    ].join(":")),
  );
  assert.equal(signatures.size, 5);
});

test("active chunk selection remains unchanged until a chunk boundary is crossed", () => {
  const first = activeChunkCoordinates(1, 1, 2).map(chunkKey);
  const sameChunk = activeChunkCoordinates(47.99, 47.99, 2).map(chunkKey);
  const nextChunk = activeChunkCoordinates(48, 1, 2).map(chunkKey);

  assert.deepEqual(first, sameChunk);
  assert.notDeepEqual(first, nextChunk);
  assert.equal(first.length, 25);
});

test("generated chunks carry a deterministic biome-appropriate resource baseline", () => {
  const coordinate = { x: 7, z: -5 };
  const first = generateChunkResourcePlan("living-economy", coordinate);
  const second = generateChunkResourcePlan("living-economy", coordinate);

  assert.deepEqual(first, second);
  assert.ok(first.length >= 5 && first.length <= 8);
  assert.equal(new Set(first.map((spawn) => spawn.id)).size, first.length);
  for (const spawn of first) {
    assert.ok(spawn.x >= coordinate.x * WORLD_CHUNK_SIZE);
    assert.ok(spawn.x < (coordinate.x + 1) * WORLD_CHUNK_SIZE);
    assert.ok(spawn.z >= coordinate.z * WORLD_CHUNK_SIZE);
    assert.ok(spawn.z < (coordinate.z + 1) * WORLD_CHUNK_SIZE);
  }
});
