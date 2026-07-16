import {
  WORLD_CHUNK_SIZE,
  generateChunkDescriptor,
  stableSpawnId,
  type ChunkCoordinate,
} from "./generation";

export type StandingTreeSpawn = Readonly<{
  id: string;
  x: number;
  z: number;
  yieldUnits: number;
}>;

/**
 * A sparse deterministic layer of actionable trees. Visual forest density can
 * remain high and cheap, while these nodes have stable IDs and saveable state.
 */
export function generateChunkStandingTreePlan(
  worldSeed: string,
  coordinate: ChunkCoordinate,
): readonly StandingTreeSpawn[] {
  const descriptor = generateChunkDescriptor(worldSeed, coordinate);
  const random = mulberry32((descriptor.generationSeed ^ 0x91e10da5) >>> 0);
  const count = descriptor.biome === "rocky-highland" ? 1 : descriptor.biome === "swamp" ? 2 : 3;
  const originX = coordinate.x * WORLD_CHUNK_SIZE;
  const originZ = coordinate.z * WORLD_CHUNK_SIZE;
  const padding = 8;
  return Array.from({ length: count }, (_, index) => ({
    id: `tree.generated.${stableSpawnId(2, coordinate, index)}`,
    x: originX + padding + random() * (WORLD_CHUNK_SIZE - padding * 2),
    z: originZ + padding + random() * (WORLD_CHUNK_SIZE - padding * 2),
    yieldUnits: 4 + Math.floor(random() * 4),
  }));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}
