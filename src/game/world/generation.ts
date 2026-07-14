export const WORLD_CHUNK_SIZE = 48;

export type ChunkCoordinate = Readonly<{ x: number; z: number }>;

export type BiomeId =
  | "evergreen-rainforest"
  | "river-wetland"
  | "palm-grove"
  | "swamp"
  | "rocky-highland";

export type BiomeProfile = Readonly<{
  id: BiomeId;
  label: string;
  movementCost: number;
  moisture: number;
  canopy: number;
  resourceTags: readonly string[];
  faunaTags: readonly string[];
}>;

export type ChunkDescriptor = Readonly<{
  coordinate: ChunkCoordinate;
  key: string;
  biome: BiomeId;
  elevation: number;
  moisture: number;
  canopy: number;
  generationSeed: number;
}>;

export const BIOME_PROFILES: Record<BiomeId, BiomeProfile> = {
  "evergreen-rainforest": {
    id: "evergreen-rainforest",
    label: "常绿密林",
    movementCost: 1.08,
    moisture: 0.72,
    canopy: 0.94,
    resourceTags: ["wood", "vine", "medicine"],
    faunaTags: ["bird", "frog", "rodent"],
  },
  "river-wetland": {
    id: "river-wetland",
    label: "河谷湿地",
    movementCost: 1.22,
    moisture: 0.96,
    canopy: 0.64,
    resourceTags: ["water", "fish", "reed"],
    faunaTags: ["frog", "fish", "caiman"],
  },
  "palm-grove": {
    id: "palm-grove",
    label: "棕榈坚果林",
    movementCost: 1,
    moisture: 0.58,
    canopy: 0.72,
    resourceTags: ["fruit", "nut", "fiber"],
    faunaTags: ["bird", "rodent", "boar"],
  },
  swamp: {
    id: "swamp",
    label: "黑水沼泽",
    movementCost: 1.42,
    moisture: 1,
    canopy: 0.78,
    resourceTags: ["medicine", "fiber", "parasite"],
    faunaTags: ["frog", "snake", "caiman"],
  },
  "rocky-highland": {
    id: "rocky-highland",
    label: "岩石高地",
    movementCost: 1.16,
    moisture: 0.34,
    canopy: 0.32,
    resourceTags: ["stone", "dry-tinder", "shelter"],
    faunaTags: ["raptor", "snake", "rodent"],
  },
};

export function worldToChunkCoordinate(x: number, z: number): ChunkCoordinate {
  return {
    x: Math.floor(x / WORLD_CHUNK_SIZE),
    z: Math.floor(z / WORLD_CHUNK_SIZE),
  };
}

export function chunkKey(coordinate: ChunkCoordinate): string {
  return `${coordinate.x}:${coordinate.z}`;
}

export function stableSpawnId(
  generatorVersion: number,
  coordinate: ChunkCoordinate,
  spawnIndex: number,
): string {
  return `${generatorVersion}:${chunkKey(coordinate)}:${spawnIndex}`;
}

export function chunkRing(center: ChunkCoordinate, radius: number): ChunkCoordinate[] {
  const safeRadius = Math.max(0, Math.floor(radius));
  const coordinates: ChunkCoordinate[] = [];
  for (let z = center.z - safeRadius; z <= center.z + safeRadius; z += 1) {
    for (let x = center.x - safeRadius; x <= center.x + safeRadius; x += 1) {
      coordinates.push({ x, z });
    }
  }
  return coordinates;
}

export function generateChunkDescriptor(
  worldSeed: string,
  coordinate: ChunkCoordinate,
): ChunkDescriptor {
  const generationSeed = hashWorldCoordinate(worldSeed, coordinate.x, coordinate.z, 0);
  const elevation = normalizedHash(worldSeed, coordinate.x, coordinate.z, 1);
  const moisture = normalizedHash(worldSeed, coordinate.x, coordinate.z, 2);
  const canopy = normalizedHash(worldSeed, coordinate.x, coordinate.z, 3);
  return {
    coordinate: { ...coordinate },
    key: chunkKey(coordinate),
    biome: selectBiome(elevation, moisture, canopy),
    elevation,
    moisture,
    canopy,
    generationSeed,
  };
}

function selectBiome(elevation: number, moisture: number, canopy: number): BiomeId {
  if (elevation > 0.76) return "rocky-highland";
  if (moisture > 0.82 && elevation < 0.46) return "swamp";
  if (moisture > 0.68 && elevation < 0.58) return "river-wetland";
  if (canopy < 0.58 || moisture < 0.42) return "palm-grove";
  return "evergreen-rainforest";
}

function normalizedHash(seed: string, x: number, z: number, salt: number): number {
  return hashWorldCoordinate(seed, x, z, salt) / 0xffffffff;
}

function hashWorldCoordinate(seed: string, x: number, z: number, salt: number): number {
  let hash = 0x811c9dc5;
  const input = `${seed}|${x}|${z}|${salt}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
