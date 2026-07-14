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

export type WorldVisualDetail = "low" | "standard";

export type ChunkVisualSpawn = Readonly<{
  x: number;
  z: number;
  scale: number;
  rotation: number;
}>;

export type BiomeVisualProfile = Readonly<{
  groundLow: number;
  groundHigh: number;
  treeColor: number;
  shrubColor: number;
  rockColor: number;
  treeStyle: "broadleaf" | "palm" | "wetland" | "sparse";
  standardCounts: Readonly<{
    trees: number;
    shrubs: number;
    rocks: number;
    wetPatches: number;
  }>;
}>;

export type ChunkVisualPlan = Readonly<{
  descriptor: ChunkDescriptor;
  profile: BiomeVisualProfile;
  trees: readonly ChunkVisualSpawn[];
  shrubs: readonly ChunkVisualSpawn[];
  rocks: readonly ChunkVisualSpawn[];
  wetPatches: readonly ChunkVisualSpawn[];
}>;

export type GeneratedResourceKind =
  | "stone"
  | "stick"
  | "vine"
  | "broad-leaf"
  | "medicinal-leaf"
  | "dry-leaf"
  | "coconut"
  | "antiparasitic-herb"
  | "palm-fruit"
  | "brazil-nuts"
  | "grubs";

export type ChunkResourceSpawn = Readonly<{
  id: string;
  index: number;
  kind: GeneratedResourceKind;
  x: number;
  z: number;
  quantity: number;
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

/**
 * Renderer-facing palette and density data. Keeping this beside the deterministic
 * chunk descriptor makes visual regeneration stable without coupling world
 * generation to Three.js.
 */
export const BIOME_VISUAL_PROFILES: Record<BiomeId, BiomeVisualProfile> = {
  "evergreen-rainforest": {
    groundLow: 0x203a25,
    groundHigh: 0x42633b,
    treeColor: 0x194827,
    shrubColor: 0x39733e,
    rockColor: 0x596157,
    treeStyle: "broadleaf",
    standardCounts: { trees: 15, shrubs: 15, rocks: 2, wetPatches: 0 },
  },
  "river-wetland": {
    groundLow: 0x39432f,
    groundHigh: 0x587052,
    treeColor: 0x285b39,
    shrubColor: 0x6f8750,
    rockColor: 0x69746a,
    treeStyle: "wetland",
    standardCounts: { trees: 8, shrubs: 22, rocks: 2, wetPatches: 4 },
  },
  "palm-grove": {
    groundLow: 0x4c4c2b,
    groundHigh: 0x778052,
    treeColor: 0x487335,
    shrubColor: 0x728346,
    rockColor: 0x786f52,
    treeStyle: "palm",
    standardCounts: { trees: 12, shrubs: 10, rocks: 3, wetPatches: 0 },
  },
  swamp: {
    groundLow: 0x202b24,
    groundHigh: 0x3c4938,
    treeColor: 0x24452f,
    shrubColor: 0x526c43,
    rockColor: 0x454c43,
    treeStyle: "wetland",
    standardCounts: { trees: 10, shrubs: 18, rocks: 1, wetPatches: 7 },
  },
  "rocky-highland": {
    groundLow: 0x4a493d,
    groundHigh: 0x777462,
    treeColor: 0x314c30,
    shrubColor: 0x616b45,
    rockColor: 0x7d8079,
    treeStyle: "sparse",
    standardCounts: { trees: 6, shrubs: 7, rocks: 14, wetPatches: 0 },
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

export function generateChunkVisualPlan(
  worldSeed: string,
  coordinate: ChunkCoordinate,
  detail: WorldVisualDetail = "standard",
): ChunkVisualPlan {
  const descriptor = generateChunkDescriptor(worldSeed, coordinate);
  const profile = BIOME_VISUAL_PROFILES[descriptor.biome];
  const density = detail === "low" ? 0.55 : 1;
  const originX = coordinate.x * WORLD_CHUNK_SIZE;
  const originZ = coordinate.z * WORLD_CHUNK_SIZE;
  const random = mulberry32(descriptor.generationSeed);
  const createSpawns = (
    standardCount: number,
    minimumScale: number,
    scaleRange: number,
  ): ChunkVisualSpawn[] => {
    const count = Math.max(0, Math.round(standardCount * density));
    return Array.from({ length: count }, () => ({
      x: originX + random() * WORLD_CHUNK_SIZE,
      z: originZ + random() * WORLD_CHUNK_SIZE,
      scale: minimumScale + random() * scaleRange,
      rotation: random() * Math.PI * 2,
    }));
  };

  return {
    descriptor,
    profile,
    trees: createSpawns(profile.standardCounts.trees, 0.76, 0.68),
    shrubs: createSpawns(profile.standardCounts.shrubs, 0.48, 0.76),
    rocks: createSpawns(profile.standardCounts.rocks, 0.5, 1.15),
    wetPatches: createSpawns(profile.standardCounts.wetPatches, 1.7, 2.6),
  };
}

const BIOME_RESOURCE_POOLS: Record<BiomeId, readonly GeneratedResourceKind[]> = {
  "evergreen-rainforest": [
    "stick", "stick", "vine", "broad-leaf", "medicinal-leaf", "dry-leaf", "grubs",
  ],
  "river-wetland": [
    "broad-leaf", "medicinal-leaf", "grubs", "grubs", "stone", "vine",
  ],
  "palm-grove": [
    "palm-fruit", "palm-fruit", "coconut", "brazil-nuts", "vine", "dry-leaf",
  ],
  swamp: [
    "antiparasitic-herb", "grubs", "medicinal-leaf", "vine", "broad-leaf", "stone",
  ],
  "rocky-highland": [
    "stone", "stone", "stone", "dry-leaf", "stick", "brazil-nuts",
  ],
};

/** Deterministic interactive-resource baseline for a generated chunk. */
export function generateChunkResourcePlan(
  worldSeed: string,
  coordinate: ChunkCoordinate,
): readonly ChunkResourceSpawn[] {
  const descriptor = generateChunkDescriptor(worldSeed, coordinate);
  const pool = BIOME_RESOURCE_POOLS[descriptor.biome];
  const random = mulberry32((descriptor.generationSeed ^ 0xa341316c) >>> 0);
  const count = 5 + Math.floor(random() * 4);
  const originX = coordinate.x * WORLD_CHUNK_SIZE;
  const originZ = coordinate.z * WORLD_CHUNK_SIZE;
  const padding = 4;
  return Array.from({ length: count }, (_, index) => {
    const kind = pool[Math.floor(random() * pool.length)]!;
    return {
      id: `resource.generated.${stableSpawnId(1, coordinate, index)}`,
      index,
      kind,
      x: originX + padding + random() * (WORLD_CHUNK_SIZE - padding * 2),
      z: originZ + padding + random() * (WORLD_CHUNK_SIZE - padding * 2),
      quantity: kind === "stick" || kind === "stone" ? 2 : 1,
    };
  });
}

export function activeChunkCoordinates(
  x: number,
  z: number,
  radius: number,
): ChunkCoordinate[] {
  return chunkRing(worldToChunkCoordinate(x, z), radius);
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
