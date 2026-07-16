import {
  WORLD_CHUNK_SIZE,
  chunkKey,
  generateChunkDescriptor,
  stableSpawnId,
  type BiomeId,
  type ChunkCoordinate,
  type ChunkDescriptor,
} from "./generation";
import { hashSeed, nextRandom } from "../sim/rng";
import {
  RIVER_MUD_HALF_WIDTH,
  riverDistance,
} from "./terrain";

export const SEMANTIC_WORLD_GENERATOR_VERSION = 1 as const;

export type SemanticObjectCategory =
  | "tree"
  | "mineable-rock"
  | "harvestable-plant"
  | "ambient-foliage"
  | "micro-clutter";

export type SemanticSize = "small" | "medium" | "large";
export type SemanticToolClass = "hand" | "blade" | "axe" | "pick";
export type SemanticToolTier = 0 | 1 | 2;

export interface SemanticTransform {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface ToolRequirementIntent {
  action: "pickup" | "cut" | "chop" | "mine";
  toolClass: SemanticToolClass;
  minimumTier: SemanticToolTier;
}

export interface YieldIntent {
  /** Stable rules-table key. Simulation resolves this intent into item drops. */
  tableId: string;
  primaryMaterial: string;
  baseUnits: readonly [minimum: number, maximum: number];
  secondaryMaterials: readonly string[];
}

interface SemanticObjectBase<
  Category extends SemanticObjectCategory,
  Interactive extends boolean,
> {
  id: string;
  generatorVersion: typeof SEMANTIC_WORLD_GENERATOR_VERSION;
  chunkKey: string;
  category: Category;
  interactive: Interactive;
  transform: SemanticTransform;
  visualVariant: string;
}

export type TreeSpecies = "balsa" | "ironwood" | "rain-palm";
export type TreeGrowthStage = "sapling" | "young" | "mature" | "old-growth";
export type TreeMaterial = "lightwood" | "hardwood" | "palmwood";

export interface SemanticTreeObject
  extends SemanticObjectBase<"tree", true> {
  species: TreeSpecies;
  growthStage: TreeGrowthStage;
  size: SemanticSize;
  material: TreeMaterial;
  toolRequirement: ToolRequirementIntent;
  yieldIntent: YieldIntent;
  /** Deterministic full-state quantity shared by simulation and rendering. */
  baselineQuantity: number;
}

export type RockMaterial = "granite" | "limestone" | "flint" | "laterite-clay";

export interface SemanticMineableRockObject
  extends SemanticObjectBase<"mineable-rock", true> {
  material: RockMaterial;
  size: SemanticSize;
  toolRequirement: ToolRequirementIntent;
  yieldIntent: YieldIntent;
  /** Deterministic full-state quantity shared by simulation and rendering. */
  baselineQuantity: number;
}

export type HarvestablePlantSpecies =
  | "medicinal-broadleaf"
  | "antiparasitic-herb"
  | "fiber-vine"
  | "palm-fruit-shrub"
  | "wild-plantain";

export interface SemanticHarvestablePlantObject
  extends SemanticObjectBase<"harvestable-plant", true> {
  species: HarvestablePlantSpecies;
  growthStage: "young" | "mature";
  material: "medicine" | "fiber" | "fruit";
  toolRequirement: ToolRequirementIntent;
  yieldIntent: YieldIntent;
  /** Deterministic full-state quantity shared by simulation and rendering. */
  baselineQuantity: number;
}

export type AmbientFoliageKind =
  | "understory-leaf-bank"
  | "fern-bank"
  | "midstory-leaf-screen";

/**
 * Non-interactive depth fill. These shapes deliberately have no fruit, stem
 * landmark or capability and therefore cannot masquerade as a harvest node.
 */
export interface SemanticAmbientFoliageObject
  extends SemanticObjectBase<"ambient-foliage", false> {
  kind: AmbientFoliageKind;
  visualRole: "depth-fill";
  selectionPolicy: "never-focus";
}

export type MicroClutterKind =
  | "leaf-litter"
  | "grass-tuft"
  | "fern-groundcover"
  | "pebble-scatter";

export interface SemanticMicroClutterObject
  extends SemanticObjectBase<"micro-clutter", false> {
  kind: MicroClutterKind;
  visualRole: "ground-texture";
  selectionPolicy: "never-focus";
}

export type SemanticWorldObject =
  | SemanticTreeObject
  | SemanticMineableRockObject
  | SemanticHarvestablePlantObject
  | SemanticAmbientFoliageObject
  | SemanticMicroClutterObject;

export interface SemanticTerrainIntent {
  biome: BiomeId;
  elevation: number;
  moisture: number;
  canopy: number;
  waterPresence: "none" | "seasonal" | "persistent";
}

export interface SemanticChunkPlan {
  generatorVersion: typeof SEMANTIC_WORLD_GENERATOR_VERSION;
  worldSeed: string;
  coordinate: ChunkCoordinate;
  chunkKey: string;
  descriptor: ChunkDescriptor;
  terrain: SemanticTerrainIntent;
  /** Single authoritative discrete-object set for future sim and renderer consumers. */
  objects: readonly SemanticWorldObject[];
}

export interface SemanticExclusionZone {
  id: string;
  x: number;
  z: number;
  radius: number;
}

/**
 * Hand-authored landmarks keep deterministic clearings in the semantic
 * forest. Because filtering is part of this authoritative plan, simulation
 * and future renderer consumers cannot disagree about clipped objects.
 */
export const SEMANTIC_EXCLUSION_ZONES: readonly SemanticExclusionZone[] = [
  { id: "camp-clearing", x: 0, z: 0, radius: 10 },
  { id: "stream-access", x: 12, z: -14, radius: 5 },
  { id: "weather-station", x: 33, z: 27, radius: 9 },
  { id: "survey-cache", x: -35, z: 31, radius: 8 },
  // Authored C-17 box, its fallen tree and tension vines own this small local
  // clearing. Deterministic forest baselines must not bury the interaction
  // volumes under an unrelated rock or trunk for particular seeds.
  { id: "canopy-junction-c17", x: 118, z: 92, radius: 7 },
] as const;

export interface SemanticNavigationCorridor {
  id: string;
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  halfWidth: number;
}

/**
 * Small authored route guarantees keep the denser forest from erasing the
 * first readable choices. They are not visible roads: low foliage and
 * harvestable herbs may still grow here, while solid trunks, rocks and leaf
 * screens stay outside the walking envelope.
 */
export const SEMANTIC_NAVIGATION_CORRIDORS: readonly SemanticNavigationCorridor[] = [
  {
    id: "camp-to-stream",
    startX: 0,
    startZ: 0,
    endX: 12,
    endZ: -14,
    halfWidth: 2.8,
  },
  {
    id: "camp-to-weather-station",
    startX: 0,
    startZ: 0,
    endX: 33,
    endZ: 27,
    halfWidth: 3.1,
  },
  {
    id: "camp-to-survey-cache",
    startX: 0,
    startZ: 0,
    endX: -35,
    endZ: 31,
    halfWidth: 3,
  },
  {
    id: "c17-wet-approach",
    startX: 78,
    startZ: 74,
    endX: 118,
    endZ: 92,
    halfWidth: 2.5,
  },
  {
    id: "c17-shoulder-approach",
    startX: 96,
    startZ: 50,
    endX: 118,
    endZ: 92,
    halfWidth: 2.7,
  },
] as const;

interface WeightedEntry<Id extends string> {
  id: Id;
  weight: number;
}

interface CountRange {
  minimum: number;
  maximum: number;
}

interface BiomeSemanticProfile {
  counts: Readonly<{
    trees: CountRange;
    rocks: CountRange;
    plants: CountRange;
    ambientFoliage: CountRange;
    microClutter: CountRange;
  }>;
  trees: readonly WeightedEntry<TreeSpecies>[];
  rocks: readonly WeightedEntry<RockMaterial>[];
  plants: readonly WeightedEntry<HarvestablePlantSpecies>[];
  ambientFoliage: readonly WeightedEntry<AmbientFoliageKind>[];
  microClutter: readonly WeightedEntry<MicroClutterKind>[];
}

interface TreeSpeciesDefinition {
  material: TreeMaterial;
  visualVariants: readonly string[];
  stages: readonly WeightedEntry<TreeGrowthStage>[];
}

interface RockMaterialDefinition {
  visualVariants: readonly string[];
  sizes: readonly WeightedEntry<SemanticSize>[];
}

interface PlantSpeciesDefinition {
  material: SemanticHarvestablePlantObject["material"];
  visualVariants: readonly string[];
  toolRequirement: ToolRequirementIntent;
  yieldIntent: YieldIntent;
}

export const TREE_SPECIES_CATALOG: Readonly<
  Record<TreeSpecies, TreeSpeciesDefinition>
> = {
  balsa: {
    material: "lightwood",
    visualVariants: ["balsa-straight", "balsa-forked"],
    stages: [
      { id: "sapling", weight: 2 },
      { id: "young", weight: 4 },
      { id: "mature", weight: 5 },
      { id: "old-growth", weight: 1 },
    ],
  },
  ironwood: {
    material: "hardwood",
    visualVariants: ["ironwood-buttress", "ironwood-column"],
    stages: [
      { id: "sapling", weight: 1 },
      { id: "young", weight: 3 },
      { id: "mature", weight: 5 },
      { id: "old-growth", weight: 3 },
    ],
  },
  "rain-palm": {
    material: "palmwood",
    visualVariants: ["rain-palm-upright", "rain-palm-leaning"],
    stages: [
      { id: "sapling", weight: 2 },
      { id: "young", weight: 3 },
      { id: "mature", weight: 5 },
      { id: "old-growth", weight: 1 },
    ],
  },
};

export const ROCK_MATERIAL_CATALOG: Readonly<
  Record<RockMaterial, RockMaterialDefinition>
> = {
  granite: {
    visualVariants: ["granite-rounded", "granite-fractured"],
    sizes: [
      { id: "small", weight: 2 },
      { id: "medium", weight: 5 },
      { id: "large", weight: 3 },
    ],
  },
  limestone: {
    visualVariants: ["limestone-pale", "limestone-layered"],
    sizes: [
      { id: "small", weight: 2 },
      { id: "medium", weight: 5 },
      { id: "large", weight: 2 },
    ],
  },
  flint: {
    visualVariants: ["flint-nodule", "flint-seam"],
    sizes: [
      { id: "small", weight: 6 },
      { id: "medium", weight: 3 },
      { id: "large", weight: 1 },
    ],
  },
  "laterite-clay": {
    visualVariants: ["laterite-red", "laterite-wet"],
    sizes: [
      { id: "small", weight: 2 },
      { id: "medium", weight: 6 },
      { id: "large", weight: 2 },
    ],
  },
};

export const PLANT_SPECIES_CATALOG: Readonly<
  Record<HarvestablePlantSpecies, PlantSpeciesDefinition>
> = {
  "medicinal-broadleaf": {
    material: "medicine",
    visualVariants: ["medicinal-broadleaf-open", "medicinal-broadleaf-tall"],
    toolRequirement: { action: "cut", toolClass: "hand", minimumTier: 0 },
    yieldIntent: {
      tableId: "plant/medicinal-broadleaf",
      primaryMaterial: "medicinal-leaf",
      baseUnits: [1, 3],
      secondaryMaterials: [],
    },
  },
  "antiparasitic-herb": {
    material: "medicine",
    visualVariants: ["antiparasitic-herb-flower", "antiparasitic-herb-low"],
    toolRequirement: { action: "cut", toolClass: "hand", minimumTier: 0 },
    yieldIntent: {
      tableId: "plant/antiparasitic-herb",
      primaryMaterial: "antiparasitic-herb",
      baseUnits: [1, 2],
      secondaryMaterials: [],
    },
  },
  "fiber-vine": {
    material: "fiber",
    visualVariants: ["fiber-vine-loop", "fiber-vine-hanging"],
    toolRequirement: { action: "cut", toolClass: "blade", minimumTier: 1 },
    yieldIntent: {
      tableId: "plant/fiber-vine",
      primaryMaterial: "vine",
      baseUnits: [1, 3],
      secondaryMaterials: ["dry-fiber"],
    },
  },
  "palm-fruit-shrub": {
    material: "fruit",
    visualVariants: ["palm-fruit-green", "palm-fruit-ripe"],
    toolRequirement: { action: "pickup", toolClass: "hand", minimumTier: 0 },
    yieldIntent: {
      tableId: "plant/palm-fruit-shrub",
      primaryMaterial: "palm-fruit",
      baseUnits: [1, 3],
      secondaryMaterials: ["broad-leaf"],
    },
  },
  "wild-plantain": {
    material: "fruit",
    visualVariants: ["wild-plantain-green", "wild-plantain-ripe"],
    toolRequirement: { action: "pickup", toolClass: "hand", minimumTier: 0 },
    yieldIntent: {
      tableId: "plant/wild-plantain",
      // The inventory already treats palm fruit as edible tropical fruit.
      // Keeping that item contract avoids a save/schema fork in this slice.
      primaryMaterial: "palm-fruit",
      baseUnits: [2, 4],
      secondaryMaterials: ["broad-leaf"],
    },
  },
};

export const BIOME_SEMANTIC_PROFILES: Readonly<
  Record<BiomeId, BiomeSemanticProfile>
> = {
  "evergreen-rainforest": {
    counts: {
      trees: { minimum: 20, maximum: 26 },
      rocks: { minimum: 2, maximum: 4 },
      plants: { minimum: 7, maximum: 11 },
      ambientFoliage: { minimum: 52, maximum: 72 },
      microClutter: { minimum: 18, maximum: 28 },
    },
    trees: [
      { id: "balsa", weight: 5 },
      { id: "ironwood", weight: 4 },
      { id: "rain-palm", weight: 2 },
    ],
    rocks: [
      { id: "granite", weight: 4 },
      { id: "limestone", weight: 3 },
      { id: "flint", weight: 1 },
    ],
    plants: [
      { id: "medicinal-broadleaf", weight: 4 },
      { id: "fiber-vine", weight: 4 },
      { id: "antiparasitic-herb", weight: 1 },
      { id: "palm-fruit-shrub", weight: 1 },
    ],
    ambientFoliage: [
      { id: "understory-leaf-bank", weight: 5 },
      { id: "fern-bank", weight: 3 },
      { id: "midstory-leaf-screen", weight: 2 },
    ],
    microClutter: [
      { id: "leaf-litter", weight: 5 },
      { id: "fern-groundcover", weight: 4 },
      { id: "grass-tuft", weight: 2 },
      { id: "pebble-scatter", weight: 1 },
    ],
  },
  "river-wetland": {
    counts: {
      trees: { minimum: 12, maximum: 18 },
      rocks: { minimum: 2, maximum: 5 },
      plants: { minimum: 10, maximum: 15 },
      ambientFoliage: { minimum: 58, maximum: 80 },
      microClutter: { minimum: 20, maximum: 32 },
    },
    trees: [
      { id: "balsa", weight: 4 },
      { id: "rain-palm", weight: 5 },
      { id: "ironwood", weight: 1 },
    ],
    rocks: [
      { id: "limestone", weight: 4 },
      { id: "flint", weight: 2 },
      { id: "granite", weight: 1 },
    ],
    plants: [
      { id: "medicinal-broadleaf", weight: 4 },
      { id: "fiber-vine", weight: 3 },
      { id: "antiparasitic-herb", weight: 2 },
      { id: "palm-fruit-shrub", weight: 2 },
    ],
    ambientFoliage: [
      { id: "understory-leaf-bank", weight: 5 },
      { id: "fern-bank", weight: 5 },
      { id: "midstory-leaf-screen", weight: 1 },
    ],
    microClutter: [
      { id: "grass-tuft", weight: 4 },
      { id: "fern-groundcover", weight: 4 },
      { id: "leaf-litter", weight: 2 },
      { id: "pebble-scatter", weight: 2 },
    ],
  },
  "palm-grove": {
    counts: {
      trees: { minimum: 15, maximum: 22 },
      rocks: { minimum: 3, maximum: 6 },
      plants: { minimum: 6, maximum: 10 },
      ambientFoliage: { minimum: 38, maximum: 58 },
      microClutter: { minimum: 14, maximum: 23 },
    },
    trees: [
      { id: "rain-palm", weight: 7 },
      { id: "balsa", weight: 2 },
      { id: "ironwood", weight: 1 },
    ],
    rocks: [
      { id: "limestone", weight: 3 },
      { id: "granite", weight: 2 },
      { id: "flint", weight: 2 },
    ],
    plants: [
      { id: "palm-fruit-shrub", weight: 6 },
      { id: "fiber-vine", weight: 2 },
      { id: "medicinal-broadleaf", weight: 1 },
    ],
    ambientFoliage: [
      { id: "understory-leaf-bank", weight: 6 },
      { id: "fern-bank", weight: 1 },
      { id: "midstory-leaf-screen", weight: 3 },
    ],
    microClutter: [
      { id: "leaf-litter", weight: 4 },
      { id: "grass-tuft", weight: 3 },
      { id: "pebble-scatter", weight: 2 },
      { id: "fern-groundcover", weight: 1 },
    ],
  },
  swamp: {
    counts: {
      trees: { minimum: 14, maximum: 20 },
      rocks: { minimum: 1, maximum: 3 },
      plants: { minimum: 11, maximum: 17 },
      ambientFoliage: { minimum: 60, maximum: 84 },
      microClutter: { minimum: 22, maximum: 34 },
    },
    trees: [
      { id: "balsa", weight: 4 },
      { id: "rain-palm", weight: 4 },
      { id: "ironwood", weight: 1 },
    ],
    rocks: [
      { id: "laterite-clay", weight: 6 },
      { id: "limestone", weight: 2 },
      { id: "flint", weight: 1 },
    ],
    plants: [
      { id: "antiparasitic-herb", weight: 5 },
      { id: "fiber-vine", weight: 3 },
      { id: "medicinal-broadleaf", weight: 2 },
    ],
    ambientFoliage: [
      { id: "understory-leaf-bank", weight: 3 },
      { id: "fern-bank", weight: 6 },
      { id: "midstory-leaf-screen", weight: 1 },
    ],
    microClutter: [
      { id: "fern-groundcover", weight: 5 },
      { id: "leaf-litter", weight: 3 },
      { id: "grass-tuft", weight: 2 },
      { id: "pebble-scatter", weight: 1 },
    ],
  },
  "rocky-highland": {
    counts: {
      trees: { minimum: 7, maximum: 12 },
      rocks: { minimum: 10, maximum: 16 },
      plants: { minimum: 3, maximum: 7 },
      ambientFoliage: { minimum: 20, maximum: 36 },
      microClutter: { minimum: 12, maximum: 20 },
    },
    trees: [
      { id: "ironwood", weight: 4 },
      { id: "balsa", weight: 1 },
      { id: "rain-palm", weight: 1 },
    ],
    rocks: [
      { id: "granite", weight: 6 },
      { id: "flint", weight: 3 },
      { id: "limestone", weight: 2 },
      { id: "laterite-clay", weight: 1 },
    ],
    plants: [
      { id: "medicinal-broadleaf", weight: 2 },
      { id: "fiber-vine", weight: 1 },
      { id: "palm-fruit-shrub", weight: 1 },
    ],
    ambientFoliage: [
      { id: "understory-leaf-bank", weight: 3 },
      { id: "fern-bank", weight: 1 },
      { id: "midstory-leaf-screen", weight: 1 },
    ],
    microClutter: [
      { id: "pebble-scatter", weight: 5 },
      { id: "grass-tuft", weight: 3 },
      { id: "leaf-litter", weight: 1 },
      { id: "fern-groundcover", weight: 1 },
    ],
  },
};

/** Hard upper bounds derived from the existing generation profiles. */
export const MAX_SEMANTIC_TREES_PER_CHUNK = Math.max(
  ...Object.values(BIOME_SEMANTIC_PROFILES).map(
    (profile) => profile.counts.trees.maximum,
  ),
);

export const MAX_SEMANTIC_ROCKS_PER_CHUNK = Math.max(
  ...Object.values(BIOME_SEMANTIC_PROFILES).map(
    (profile) => profile.counts.rocks.maximum,
  ),
);

export const MAX_SEMANTIC_AMBIENT_FOLIAGE_PER_CHUNK = Math.max(
  ...Object.values(BIOME_SEMANTIC_PROFILES).map(
    (profile) => profile.counts.ambientFoliage.maximum,
  ),
);

/** Structural generation ceilings used by tests and renderer budgeting. */
export const SEMANTIC_DENSITY_BUDGET = Object.freeze({
  treesPerChunk: MAX_SEMANTIC_TREES_PER_CHUNK,
  rocksPerChunk: MAX_SEMANTIC_ROCKS_PER_CHUNK,
  ambientFoliagePerChunk: MAX_SEMANTIC_AMBIENT_FOLIAGE_PER_CHUNK,
  // Existing plant maxima plus the dedicated plantain supplement below.
  harvestablePlantsPerChunk: 22,
  totalObjectsPerChunk: 182,
});

const CATEGORY_SALTS: Readonly<Record<SemanticObjectCategory, number>> = {
  tree: 0x51f15e1d,
  "mineable-rock": 0x8d12e41b,
  "harvestable-plant": 0xc367a52d,
  "ambient-foliage": 0x79f4a7c1,
  "micro-clutter": 0x31b49e07,
};

const PLANTAIN_SALT = 0xb47a6e35;

function randomForCategory(
  descriptor: ChunkDescriptor,
  category: SemanticObjectCategory,
): () => number {
  return mulberry32((descriptor.generationSeed ^ CATEGORY_SALTS[category]) >>> 0);
}

function randomCount(random: () => number, range: CountRange): number {
  return range.minimum + Math.floor(random() * (range.maximum - range.minimum + 1));
}

function chooseWeighted<Id extends string>(
  random: () => number,
  entries: readonly WeightedEntry<Id>[],
): Id {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = random() * totalWeight;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.id;
  }
  return entries.at(-1)!.id;
}

function semanticId(
  category: SemanticObjectCategory,
  coordinate: ChunkCoordinate,
  index: number,
): string {
  return `semantic.${category}.${stableSpawnId(
    SEMANTIC_WORLD_GENERATOR_VERSION,
    coordinate,
    index,
  )}`;
}

function randomTransform(
  random: () => number,
  coordinate: ChunkCoordinate,
  scaleMinimum: number,
  scaleMaximum: number,
  padding: number,
): SemanticTransform {
  const originX = coordinate.x * WORLD_CHUNK_SIZE;
  const originZ = coordinate.z * WORLD_CHUNK_SIZE;
  const usableSize = WORLD_CHUNK_SIZE - padding * 2;
  return {
    x: originX + padding + random() * usableSize,
    y: 0,
    z: originZ + padding + random() * usableSize,
    yaw: random() * Math.PI * 2,
    scale: scaleMinimum + random() * (scaleMaximum - scaleMinimum),
  };
}

function sizeForTreeStage(stage: TreeGrowthStage): SemanticSize {
  return stage === "sapling" ? "small" : stage === "young" ? "medium" : "large";
}

function treeToolRequirement(
  _species: TreeSpecies,
  stage: TreeGrowthStage,
): ToolRequirementIntent {
  if (stage === "sapling") {
    return { action: "cut", toolClass: "blade", minimumTier: 1 };
  }
  return {
    action: "chop",
    toolClass: "axe",
    // The current progression exposes one reachable axe tier. Species and
    // age still change work/wear, but no generated tree is permanently inert.
    minimumTier: 1,
  };
}

function treeYieldIntent(
  species: TreeSpecies,
  stage: TreeGrowthStage,
  material: TreeMaterial,
): YieldIntent {
  const units: Record<TreeGrowthStage, readonly [number, number]> = {
    sapling: [1, 2],
    young: [2, 4],
    mature: [5, 8],
    "old-growth": [8, 12],
  };
  return {
    tableId: `tree/${species}/${stage}`,
    primaryMaterial: material,
    baseUnits: units[stage],
    secondaryMaterials:
      species === "rain-palm" ? ["broad-leaf", "dry-leaf"] : ["stick"],
  };
}

function rockToolRequirement(): ToolRequirementIntent {
  return {
    action: "mine",
    toolClass: "pick",
    minimumTier: 1,
  };
}

function rockYieldIntent(material: RockMaterial, size: SemanticSize): YieldIntent {
  const units: Record<SemanticSize, readonly [number, number]> = {
    small: [1, 2],
    medium: [3, 5],
    large: [6, 9],
  };
  return {
    tableId: `rock/${material}/${size}`,
    // Geology remains a visual/future-content label. The current inventory
    // contract only delivers stone, so previews can never promise phantom ore.
    primaryMaterial: "stone",
    baseUnits: units[size],
    secondaryMaterials: [],
  };
}

/**
 * Resolves an intent into the immutable full-state quantity for one object.
 * The seed salt intentionally matches the pre-contract save implementation so
 * existing sparse deltas keep comparing against the same baseline.
 */
export function realizeSemanticBaselineQuantity(
  worldSeed: string,
  object: Pick<SemanticWorldObject, "id"> & { yieldIntent: YieldIntent },
): number {
  const [minimum, maximum] = object.yieldIntent.baseUnits;
  const [roll] = nextRandom(
    hashSeed(
      `${worldSeed}:${object.id}:${object.yieldIntent.tableId}:realized-yield`,
    ),
  );
  return minimum + Math.floor(roll * (maximum - minimum + 1));
}

function generateTrees(
  worldSeed: string,
  descriptor: ChunkDescriptor,
  profile: BiomeSemanticProfile,
): SemanticTreeObject[] {
  const random = randomForCategory(descriptor, "tree");
  const count = randomCount(random, profile.counts.trees);
  return Array.from({ length: count }, (_, index) => {
    const species = chooseWeighted(random, profile.trees);
    const definition = TREE_SPECIES_CATALOG[species];
    const growthStage = chooseWeighted(random, definition.stages);
    const size = sizeForTreeStage(growthStage);
    const id = semanticId("tree", descriptor.coordinate, index);
    const yieldIntent = treeYieldIntent(
      species,
      growthStage,
      definition.material,
    );
    return {
      id,
      generatorVersion: SEMANTIC_WORLD_GENERATOR_VERSION,
      chunkKey: descriptor.key,
      category: "tree",
      interactive: true,
      transform: randomTransform(random, descriptor.coordinate, 0.72, 1.34, 4),
      visualVariant: definition.visualVariants[
        Math.floor(random() * definition.visualVariants.length)
      ]!,
      species,
      growthStage,
      size,
      material: definition.material,
      toolRequirement: treeToolRequirement(species, growthStage),
      yieldIntent,
      baselineQuantity: realizeSemanticBaselineQuantity(worldSeed, {
        id,
        yieldIntent,
      }),
    };
  });
}

function generateRocks(
  worldSeed: string,
  descriptor: ChunkDescriptor,
  profile: BiomeSemanticProfile,
): SemanticMineableRockObject[] {
  const random = randomForCategory(descriptor, "mineable-rock");
  const count = randomCount(random, profile.counts.rocks);
  return Array.from({ length: count }, (_, index) => {
    const material = chooseWeighted(random, profile.rocks);
    const definition = ROCK_MATERIAL_CATALOG[material];
    const size = chooseWeighted(random, definition.sizes);
    const id = semanticId("mineable-rock", descriptor.coordinate, index);
    const yieldIntent = rockYieldIntent(material, size);
    return {
      id,
      generatorVersion: SEMANTIC_WORLD_GENERATOR_VERSION,
      chunkKey: descriptor.key,
      category: "mineable-rock",
      interactive: true,
      // A narrow controlled variance keeps small/medium/large silhouettes from
      // overlapping while preserving the same RNG consumption and positions.
      transform: randomTransform(random, descriptor.coordinate, 0.9, 1.1, 3),
      visualVariant: definition.visualVariants[
        Math.floor(random() * definition.visualVariants.length)
      ]!,
      material,
      size,
      toolRequirement: rockToolRequirement(),
      yieldIntent,
      baselineQuantity: realizeSemanticBaselineQuantity(worldSeed, {
        id,
        yieldIntent,
      }),
    };
  });
}

function generatePlants(
  worldSeed: string,
  descriptor: ChunkDescriptor,
  profile: BiomeSemanticProfile,
): SemanticHarvestablePlantObject[] {
  const random = randomForCategory(descriptor, "harvestable-plant");
  const count = randomCount(random, profile.counts.plants);
  return Array.from({ length: count }, (_, index) => {
    const species = chooseWeighted(random, profile.plants);
    const definition = PLANT_SPECIES_CATALOG[species];
    const growthStage = random() < 0.28 ? "young" : "mature";
    const id = semanticId("harvestable-plant", descriptor.coordinate, index);
    const yieldIntent: YieldIntent = {
      ...definition.yieldIntent,
      baseUnits: [...definition.yieldIntent.baseUnits],
      secondaryMaterials: [...definition.yieldIntent.secondaryMaterials],
    };
    return {
      id,
      generatorVersion: SEMANTIC_WORLD_GENERATOR_VERSION,
      chunkKey: descriptor.key,
      category: "harvestable-plant",
      interactive: true,
      transform: randomTransform(random, descriptor.coordinate, 0.72, 1.18, 2),
      visualVariant: definition.visualVariants[
        Math.floor(random() * definition.visualVariants.length)
      ]!,
      species,
      growthStage,
      material: definition.material,
      toolRequirement: { ...definition.toolRequirement },
      yieldIntent,
      baselineQuantity: realizeSemanticBaselineQuantity(worldSeed, {
        id,
        yieldIntent,
      }),
    };
  });
}

const PLANTAIN_COUNTS: Readonly<Record<BiomeId, CountRange>> = {
  "evergreen-rainforest": { minimum: 1, maximum: 3 },
  "river-wetland": { minimum: 2, maximum: 4 },
  "palm-grove": { minimum: 3, maximum: 5 },
  swamp: { minimum: 1, maximum: 2 },
  "rocky-highland": { minimum: 0, maximum: 1 },
};

/**
 * Plantains are an append-only supplement with a reserved ID range and salt.
 * Adding them does not reroll the established plant sequence in a v1 chunk.
 */
function generatePlantains(
  worldSeed: string,
  descriptor: ChunkDescriptor,
): SemanticHarvestablePlantObject[] {
  const random = mulberry32(
    (descriptor.generationSeed ^ PLANTAIN_SALT) >>> 0,
  );
  const count = randomCount(random, PLANTAIN_COUNTS[descriptor.biome]);
  const definition = PLANT_SPECIES_CATALOG["wild-plantain"];
  return Array.from({ length: count }, (_, index) => {
    const id = semanticId(
      "harvestable-plant",
      descriptor.coordinate,
      1_000 + index,
    );
    const growthStage = random() < 0.24 ? "young" : "mature";
    const yieldIntent: YieldIntent = {
      ...definition.yieldIntent,
      baseUnits: [...definition.yieldIntent.baseUnits],
      secondaryMaterials: [...definition.yieldIntent.secondaryMaterials],
    };
    return {
      id,
      generatorVersion: SEMANTIC_WORLD_GENERATOR_VERSION,
      chunkKey: descriptor.key,
      category: "harvestable-plant",
      interactive: true,
      transform: randomTransform(random, descriptor.coordinate, 0.92, 1.28, 3),
      visualVariant: definition.visualVariants[
        Math.floor(random() * definition.visualVariants.length)
      ]!,
      species: "wild-plantain",
      growthStage,
      material: definition.material,
      toolRequirement: { ...definition.toolRequirement },
      yieldIntent,
      baselineQuantity: realizeSemanticBaselineQuantity(worldSeed, {
        id,
        yieldIntent,
      }),
    };
  });
}

function generateAmbientFoliage(
  descriptor: ChunkDescriptor,
  profile: BiomeSemanticProfile,
): SemanticAmbientFoliageObject[] {
  const random = randomForCategory(descriptor, "ambient-foliage");
  const count = randomCount(random, profile.counts.ambientFoliage);
  return Array.from({ length: count }, (_, index) => {
    const kind = chooseWeighted(random, profile.ambientFoliage);
    return {
      id: semanticId("ambient-foliage", descriptor.coordinate, index),
      generatorVersion: SEMANTIC_WORLD_GENERATOR_VERSION,
      chunkKey: descriptor.key,
      category: "ambient-foliage",
      interactive: false,
      transform: randomTransform(random, descriptor.coordinate, 0.62, 1.42, 1.5),
      visualVariant: `${kind}-${1 + Math.floor(random() * 3)}`,
      kind,
      visualRole: "depth-fill",
      selectionPolicy: "never-focus",
    };
  });
}

function generateMicroClutter(
  descriptor: ChunkDescriptor,
  profile: BiomeSemanticProfile,
): SemanticMicroClutterObject[] {
  const random = randomForCategory(descriptor, "micro-clutter");
  const count = randomCount(random, profile.counts.microClutter);
  return Array.from({ length: count }, (_, index) => {
    const kind = chooseWeighted(random, profile.microClutter);
    return {
      id: semanticId("micro-clutter", descriptor.coordinate, index),
      generatorVersion: SEMANTIC_WORLD_GENERATOR_VERSION,
      chunkKey: descriptor.key,
      category: "micro-clutter",
      interactive: false,
      transform: randomTransform(random, descriptor.coordinate, 0.35, 0.9, 1),
      visualVariant: `${kind}-${1 + Math.floor(random() * 3)}`,
      kind,
      visualRole: "ground-texture",
      selectionPolicy: "never-focus",
    };
  });
}

function waterPresence(descriptor: ChunkDescriptor): SemanticTerrainIntent["waterPresence"] {
  if (descriptor.biome === "river-wetland" || descriptor.biome === "swamp") {
    return "persistent";
  }
  return descriptor.moisture > 0.58 ? "seasonal" : "none";
}

export function semanticObjectIntersectsExclusionZone(
  object: Pick<SemanticWorldObject, "transform">,
): boolean {
  return SEMANTIC_EXCLUSION_ZONES.some((zone) => {
    const deltaX = object.transform.x - zone.x;
    const deltaZ = object.transform.z - zone.z;
    return deltaX * deltaX + deltaZ * deltaZ < zone.radius * zone.radius;
  });
}

function distanceSquaredToCorridor(
  x: number,
  z: number,
  corridor: SemanticNavigationCorridor,
): number {
  const segmentX = corridor.endX - corridor.startX;
  const segmentZ = corridor.endZ - corridor.startZ;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  if (lengthSquared <= Number.EPSILON) {
    const deltaX = x - corridor.startX;
    const deltaZ = z - corridor.startZ;
    return deltaX * deltaX + deltaZ * deltaZ;
  }
  const progress = Math.max(
    0,
    Math.min(
      1,
      ((x - corridor.startX) * segmentX +
        (z - corridor.startZ) * segmentZ) /
        lengthSquared,
    ),
  );
  const closestX = corridor.startX + segmentX * progress;
  const closestZ = corridor.startZ + segmentZ * progress;
  const deltaX = x - closestX;
  const deltaZ = z - closestZ;
  return deltaX * deltaX + deltaZ * deltaZ;
}

/**
 * Clearance applies only to solid objects and opaque depth screens. Small
 * harvestable plants may remain beside a route and become readable rewards.
 */
export function semanticObjectIntersectsNavigationClearance(
  object: Pick<SemanticWorldObject, "category" | "transform">,
): boolean {
  if (
    object.category !== "tree" &&
    object.category !== "mineable-rock" &&
    object.category !== "ambient-foliage"
  ) {
    return false;
  }
  if (
    riverDistance(object.transform.x, object.transform.z) <
    RIVER_MUD_HALF_WIDTH + 1.15
  ) {
    return true;
  }
  return SEMANTIC_NAVIGATION_CORRIDORS.some(
    (corridor) =>
      distanceSquaredToCorridor(
        object.transform.x,
        object.transform.z,
        corridor,
      ) <
      corridor.halfWidth * corridor.halfWidth,
  );
}

/**
 * Pure authoritative semantic plan. Rendering detail and active simulation
 * state are deliberately absent, so both consumers can share the same IDs.
 */
export function generateSemanticChunkPlan(
  worldSeed: string,
  coordinate: ChunkCoordinate,
): SemanticChunkPlan {
  if (
    !Number.isSafeInteger(coordinate.x) ||
    !Number.isSafeInteger(coordinate.z)
  ) {
    throw new RangeError("semantic chunk coordinates must be safe integers");
  }
  const descriptor = generateChunkDescriptor(worldSeed, coordinate);
  const profile = BIOME_SEMANTIC_PROFILES[descriptor.biome];
  const objects: SemanticWorldObject[] = [
    ...generateTrees(worldSeed, descriptor, profile),
    ...generateRocks(worldSeed, descriptor, profile),
    ...generatePlants(worldSeed, descriptor, profile),
    ...generatePlantains(worldSeed, descriptor),
    ...generateAmbientFoliage(descriptor, profile),
    ...generateMicroClutter(descriptor, profile),
  ].filter(
    (object) =>
      !semanticObjectIntersectsExclusionZone(object) &&
      !semanticObjectIntersectsNavigationClearance(object),
  );
  return {
    generatorVersion: SEMANTIC_WORLD_GENERATOR_VERSION,
    worldSeed,
    coordinate: { ...coordinate },
    chunkKey: chunkKey(coordinate),
    descriptor,
    terrain: {
      biome: descriptor.biome,
      elevation: descriptor.elevation,
      moisture: descriptor.moisture,
      canopy: descriptor.canopy,
      waterPresence: waterPresence(descriptor),
    },
    objects,
  };
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
