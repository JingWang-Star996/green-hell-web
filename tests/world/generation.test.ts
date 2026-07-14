import assert from "node:assert/strict";
import test from "node:test";

import {
  BIOME_PROFILES,
  WORLD_CHUNK_SIZE,
  chunkKey,
  chunkRing,
  generateChunkDescriptor,
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
