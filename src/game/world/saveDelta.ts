import { ITEMS, RESOURCE_REGENERATION, WORLD_ENTITY_TEMPLATES } from "../sim/content";
import type {
  GameState,
  ItemId,
  ResourceRegenerationState,
  TreeHarvestState,
  TreeRegrowthState,
  WorldEntity,
  WorldEntityDelta,
  WorldEntitySemanticMetadata,
  WorldState,
} from "../sim/types";
import {
  isTreeEntity,
  normalizeTreeEntityRuntime,
  normalizeTreeHarvestState,
  treeHarvestFinished,
} from "../sim/treeHarvest";
import { normalizeTreeRegrowthState } from "../sim/treeRegrowth";
import { cloneTreeRegrowthState } from "../sim/treeRegrowthRuntime";
import {
  normalizeMineableRockRuntime,
  rockInteractionGeometry,
} from "../sim/rockHarvest";
import { generateChunkStandingTreePlan } from "./harvestGeneration";
import {
  chunkKey,
  generateChunkResourcePlan,
  worldToChunkCoordinate,
  type ChunkCoordinate,
} from "./generation";
import {
  generateSemanticChunkPlan,
  type SemanticHarvestablePlantObject,
  type SemanticWorldObject,
} from "./semanticGeneration";
import {
  CANOPY_JUNCTION_PHASES,
  normalizeCanopyJunctionState,
  type CanopyJunctionState,
} from "../sim/canopyJunction";
import {
  normalizeWindFieldState,
  type WindFieldState,
} from "./windField";

const WORLD_DELTA_FORMAT = "canopy-world-delta";
const WORLD_DELTA_VERSION = 3;

type CompactRegeneration = readonly [
  capacity: number,
  nextTick: number | null,
  cycle: number,
  nextAmount: number | null,
];

type CompactTreeHarvest = readonly [
  fallDirection: number,
  branches: number,
  trunkSegments: number,
  looseLog: 0 | 1,
];

type CompactTreeRegrowth = readonly [
  version: 1,
  cycle: number,
  stumpStartedAtTick: number,
  saplingAtTick: number,
  youngAtTick: number,
  matureAtTick: number,
  stage: TreeRegrowthState["stage"],
  stageStartedAtTick: number,
  lastAdvancedTick: number,
];

type CompactRiverHydrology = readonly [
  version: 1,
  levelMeters: number,
  runoff: number,
  trendMetersPerGameHour: number,
  lastAdvancedTick: number,
];

type CompactWindField = readonly [
  version: 1,
  directionRadians: number,
  speed: number,
  gust: number,
  targetDirectionRadians: number,
  targetSpeed: number,
  nextFrontTick: number,
  lastAdvancedTick: number,
];

type CompactCanopyWindSample = readonly [
  directionRadians: number,
  strength: number,
  signalQuality: number,
  capturedAtTick: number,
  stableTicks: number,
];

type CompactCanopyJunction = readonly [
  version: 1,
  phase: CanopyJunctionState["phase"],
  clearedObstructionIds: string[],
  phaseEnteredTick: number,
  samplingStartedTick: number | null,
  consecutiveReadableTicks: number,
  lastAdvancedTick: number,
  sample: CompactCanopyWindSample | null,
  reportedAtTick: number | null,
];

type CompactEntityDelta = readonly [
  id: string,
  chunk: string | null,
  quantity: number,
  regeneration?: CompactRegeneration | null,
  treeHarvest?: CompactTreeHarvest | null,
  treeRegrowth?: CompactTreeRegrowth,
];

interface CompactWorldSnapshot {
  format: typeof WORLD_DELTA_FORMAT;
  version: 1 | 2 | typeof WORLD_DELTA_VERSION;
  bounds: WorldState["bounds"];
  exploredChunks: string[];
  deltas: CompactEntityDelta[];
  customEntities: WorldEntity[];
  /** Optional so compact saves written before the river campaign remain valid. */
  riverHydrology?: CompactRiverHydrology;
  /** Optional so saves written before A2 remain valid. */
  windField?: CompactWindField;
  canopyJunction?: CompactCanopyJunction;
}

function cloneRegeneration(
  regeneration: ResourceRegenerationState | undefined,
): ResourceRegenerationState | undefined {
  return regeneration ? { ...regeneration } : undefined;
}

function cloneEntity(entity: WorldEntity): WorldEntity {
  return {
    ...entity,
    position: { ...entity.position },
    ...(entity.regeneration
      ? { regeneration: { ...entity.regeneration } }
      : {}),
    ...(entity.semantic ? { semantic: { ...entity.semantic } } : {}),
    ...(entity.treeHarvest ? { treeHarvest: { ...entity.treeHarvest } } : {}),
    ...(entity.treeRegrowth
      ? { treeRegrowth: cloneTreeRegrowthState(entity.treeRegrowth) }
      : {}),
    tags: [...entity.tags],
  };
}

function entityUsesItemRegeneration(entity: WorldEntity): boolean {
  return Boolean(
    entity.kind === "resource" &&
      entity.itemId &&
      !entity.tags.includes("nonrenewable") &&
      !entity.tags.includes("standing-tree") &&
      RESOURCE_REGENERATION[entity.itemId],
  );
}

function baselineRegeneration(entity: WorldEntity): void {
  if (!entityUsesItemRegeneration(entity)) return;
  entity.regeneration = {
    capacity: Math.max(1, Math.floor(entity.quantity)),
    nextTick: null,
  };
}

type InteractiveSemanticObject = Exclude<
  SemanticWorldObject,
  { category: "micro-clutter" | "ambient-foliage" }
>;

const SEMANTIC_PLANT_ITEM_IDS: Readonly<
  Record<SemanticHarvestablePlantObject["species"], ItemId>
> = {
  "medicinal-broadleaf": "medicinal-leaf",
  "antiparasitic-herb": "antiparasitic-herb",
  "fiber-vine": "vine",
  "palm-fruit-shrub": "palm-fruit",
  "wild-plantain": "palm-fruit",
};

function semanticItemId(object: InteractiveSemanticObject): ItemId {
  if (object.category === "tree") {
    // TODO(S5): resolve lightwood/hardwood/palmwood into dedicated log items.
    return "stick";
  }
  if (object.category === "mineable-rock") {
    return "stone";
  }
  return SEMANTIC_PLANT_ITEM_IDS[object.species];
}

function semanticLabel(object: InteractiveSemanticObject): string {
  if (object.category === "tree") {
    const species = {
      balsa: "轻木",
      ironwood: "铁木",
      "rain-palm": "雨棕",
    }[object.species];
    const stage = {
      sapling: "幼株",
      young: "幼树",
      mature: "成树",
      "old-growth": "古树",
    }[object.growthStage];
    return `${species}${stage}`;
  }
  if (object.category === "mineable-rock") {
    return {
      granite: "坚硬岩体",
      limestone: "层状浅岩",
      flint: "深色结核岩",
      "laterite-clay": "红土胶结岩",
    }[object.material];
  }
  return {
    "medicinal-broadleaf": "药用阔叶草",
    "antiparasitic-herb": "驱虫草",
    "fiber-vine": "纤维藤",
    "palm-fruit-shrub": "棕榈果丛",
    "wild-plantain": "野芭蕉果串",
  }[object.species];
}

function semanticMetadata(
  object: InteractiveSemanticObject,
): WorldEntitySemanticMetadata {
  return {
    generatorVersion: object.generatorVersion,
    category: object.category,
    ...(object.category !== "mineable-rock" ? { species: object.species } : {}),
    material: object.material,
    ...(object.category !== "mineable-rock"
      ? { growthStage: object.growthStage }
      : {}),
    size: object.category === "harvestable-plant" ? "small" : object.size,
    visualVariant: object.visualVariant,
    yaw: object.transform.yaw,
    scale: object.transform.scale,
    action: object.toolRequirement.action,
    toolClass: object.toolRequirement.toolClass,
    toolTier: object.toolRequirement.minimumTier,
    yieldTableId: object.yieldIntent.tableId,
    primaryMaterial: object.yieldIntent.primaryMaterial,
    yieldMinimum: object.yieldIntent.baseUnits[0],
    yieldMaximum: object.yieldIntent.baseUnits[1],
    baselineQuantity: object.baselineQuantity,
  };
}

function semanticTags(
  object: InteractiveSemanticObject,
  key: string,
): string[] {
  const common = [
    "generated",
    "semantic",
    `semantic:${object.category}`,
    `chunk:${key}`,
  ];
  if (object.category === "tree") {
    return [
      ...common,
      "tree",
      "standing-tree",
      "wood",
      `species:${object.species}`,
      `material:${object.material}`,
    ];
  }
  if (object.category === "mineable-rock") {
    return [
      ...common,
      "rock",
      "mineable-rock",
      "nonrenewable",
      `material:${object.material}`,
    ];
  }
  return [
    ...common,
    "plant",
    "harvestable-plant",
    `species:${object.species}`,
    `material:${object.material}`,
  ];
}

function semanticInteractRadius(object: InteractiveSemanticObject): number {
  if (object.category === "harvestable-plant") return 2.4;
  if (object.category === "mineable-rock") {
    return rockInteractionGeometry(object).interactRadius;
  }
  if (object.size === "small") return 2.4;
  return object.size === "medium" ? 2.9 : 3.4;
}

function worldEntityFromSemantic(object: InteractiveSemanticObject): WorldEntity {
  const entity: WorldEntity = {
    id: object.id,
    kind: "resource",
    label: semanticLabel(object),
    position: {
      x: object.transform.x,
      y: object.transform.y,
      z: object.transform.z,
    },
    interactRadius: semanticInteractRadius(object),
    itemId: semanticItemId(object),
    quantity: object.baselineQuantity,
    depleted: false,
    semantic: semanticMetadata(object),
    tags: semanticTags(object, object.chunkKey),
  };
  baselineRegeneration(entity);
  normalizeMineableRockRuntime(entity);
  return entity;
}

/** Rebuilds the small authored world baseline without consulting a save. */
export function createAuthoredWorldEntities(): Record<string, WorldEntity> {
  return Object.fromEntries(
    WORLD_ENTITY_TEMPLATES.map((template) => {
      const entity: WorldEntity = {
        ...template,
        position: { ...template.position },
        tags: [...template.tags],
        ...(template.treeHarvest
          ? { treeHarvest: { ...template.treeHarvest } }
          : {}),
        ...(template.treeRegrowth
          ? { treeRegrowth: cloneTreeRegrowthState(template.treeRegrowth) }
          : {}),
        depleted: template.depleted ?? template.quantity <= 0,
      };
      baselineRegeneration(entity);
      return [entity.id, entity];
    }),
  );
}

/** Rebuilds one chunk's deterministic interactive baseline from the world seed. */
export function createGeneratedChunkEntities(
  seed: number,
  coordinate: ChunkCoordinate,
): Record<string, WorldEntity> {
  const entities: Record<string, WorldEntity> = {};
  const plan = generateSemanticChunkPlan(String(seed), coordinate);
  for (const object of plan.objects) {
    if (!object.interactive) continue;
    const entity = worldEntityFromSemantic(object);
    entities[entity.id] = entity;
  }
  return entities;
}

/**
 * Exact pre-semantic baseline used only to migrate old generated IDs/deltas.
 * Pristine legacy nodes are omitted from new worlds and disappear after their
 * first compact save; changed nodes remain until their consequence resolves.
 */
export function createLegacyGeneratedChunkEntities(
  seed: number,
  coordinate: ChunkCoordinate,
): Record<string, WorldEntity> {
  if (Math.abs(coordinate.x) <= 1 && Math.abs(coordinate.z) <= 1) return {};
  const key = chunkKey(coordinate);
  const entities: Record<string, WorldEntity> = {};

  for (const tree of generateChunkStandingTreePlan(String(seed), coordinate)) {
    const entity: WorldEntity = {
      id: tree.id,
      kind: "resource",
      label: "可砍伐的轻木",
      position: { x: tree.x, y: 0, z: tree.z },
      interactRadius: 3.2,
      itemId: "stick",
      quantity: tree.yieldUnits,
      depleted: false,
      tags: [
        "generated",
        "legacy-generated",
        "standing-tree",
        "wood",
        `chunk:${key}`,
      ],
    };
    baselineRegeneration(entity);
    entities[entity.id] = entity;
  }

  for (const spawn of generateChunkResourcePlan(String(seed), coordinate)) {
    const entity: WorldEntity = {
      id: spawn.id,
      kind: "resource",
      label: ITEMS[spawn.kind].label,
      position: { x: spawn.x, y: 0, z: spawn.z },
      interactRadius: 2.6,
      itemId: spawn.kind,
      quantity: spawn.quantity,
      depleted: false,
      tags: ["generated", "legacy-generated", `chunk:${key}`],
    };
    baselineRegeneration(entity);
    entities[entity.id] = entity;
  }
  return entities;
}

function applyEntityDelta(entity: WorldEntity, delta: WorldEntityDelta): void {
  entity.quantity = delta.quantity;
  const treeHarvest = normalizeTreeHarvestState(delta.treeHarvest);
  if (treeHarvest) entity.treeHarvest = treeHarvest;
  else delete entity.treeHarvest;
  if (delta.treeRegrowth) {
    const treeRegrowth = normalizeTreeRegrowthState(
      delta.treeRegrowth,
      delta.treeRegrowth.lastAdvancedTick,
    );
    if (treeRegrowth) entity.treeRegrowth = treeRegrowth;
    else delete entity.treeRegrowth;
  } else delete entity.treeRegrowth;
  if (isTreeEntity(entity)) {
    normalizeTreeEntityRuntime(entity);
  } else {
    entity.depleted = delta.quantity <= 0;
  }
  if (delta.regeneration && entityUsesItemRegeneration(entity)) {
    entity.regeneration = { ...delta.regeneration };
  } else if (!entityUsesItemRegeneration(entity)) {
    delete entity.regeneration;
  }
  normalizeMineableRockRuntime(entity);
}

/**
 * Lazily materializes a generated chunk and overlays any saved player changes.
 * Existing runtime entities win so revisiting a chunk cannot rewind live state.
 */
export function materializeGeneratedWorldChunk(
  state: GameState,
  coordinate: ChunkCoordinate,
): void {
  const key = chunkKey(coordinate);
  for (const baseline of Object.values(
    createGeneratedChunkEntities(state.seed, coordinate),
  )) {
    if (state.world.entities[baseline.id]) continue;
    const entity = cloneEntity(baseline);
    const delta = state.world.entityDeltas?.[entity.id];
    if (!delta || delta.chunk === key) applyEntityDelta(entity, delta ?? {
      quantity: entity.quantity,
    });
    state.world.entities[entity.id] = entity;
  }
  const legacy = createLegacyGeneratedChunkEntities(state.seed, coordinate);
  for (const [id, delta] of Object.entries(state.world.entityDeltas ?? {})) {
    if (delta.chunk !== key || state.world.entities[id] || !legacy[id]) continue;
    const entity = cloneEntity(legacy[id]);
    applyEntityDelta(entity, delta);
    state.world.entities[id] = entity;
  }
  state.world.generatedResourceChunks ??= [];
  if (!state.world.generatedResourceChunks.includes(key)) {
    state.world.generatedResourceChunks.push(key);
  }
}

function chunkTag(entity: WorldEntity): string | null {
  const tag = entity.tags.find((candidate) => candidate.startsWith("chunk:"));
  return tag ? tag.slice("chunk:".length) : null;
}

function parseChunkKey(value: string): ChunkCoordinate | null {
  const match = /^(-?\d+):(-?\d+)$/.exec(value);
  if (!match) return null;
  const x = Number(match[1]);
  const z = Number(match[2]);
  return Number.isSafeInteger(x) && Number.isSafeInteger(z) ? { x, z } : null;
}

function regenerationEquivalent(
  left: ResourceRegenerationState | undefined,
  right: ResourceRegenerationState | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.capacity === right.capacity &&
    (left.nextTick ?? null) === (right.nextTick ?? null) &&
    (left.cycle ?? 0) === (right.cycle ?? 0) &&
    (left.nextAmount ?? null) === (right.nextAmount ?? null)
  );
}

function treeHarvestEquivalent(
  left: TreeHarvestState | undefined,
  right: TreeHarvestState | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.fallDirection === right.fallDirection &&
    left.branches === right.branches &&
    left.trunkSegments === right.trunkSegments &&
    left.looseLog === right.looseLog
  );
}

function treeRegrowthEquivalent(
  left: TreeRegrowthState | undefined,
  right: TreeRegrowthState | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.version === right.version &&
    left.cycle === right.cycle &&
    left.stage === right.stage &&
    left.stageStartedAtTick === right.stageStartedAtTick &&
    left.lastAdvancedTick === right.lastAdvancedTick &&
    left.schedule.stumpStartedAtTick === right.schedule.stumpStartedAtTick &&
    left.schedule.saplingAtTick === right.schedule.saplingAtTick &&
    left.schedule.youngAtTick === right.schedule.youngAtTick &&
    left.schedule.matureAtTick === right.schedule.matureAtTick
  );
}

function deltaFor(
  entity: WorldEntity,
  baseline: WorldEntity,
  chunk: string | undefined,
): WorldEntityDelta | null {
  const entityTreeHarvest =
    entity.treeHarvest && !treeHarvestFinished(entity.treeHarvest)
      ? entity.treeHarvest
      : undefined;
  const entityRegeneration = entityUsesItemRegeneration(baseline)
    ? entity.regeneration
    : undefined;
  const baselineEntityRegeneration = entityUsesItemRegeneration(baseline)
    ? baseline.regeneration
    : undefined;
  const entityTreeRegrowth = entity.treeRegrowth;
  if (
    entity.quantity === baseline.quantity &&
    regenerationEquivalent(entityRegeneration, baselineEntityRegeneration) &&
    treeHarvestEquivalent(entityTreeHarvest, baseline.treeHarvest) &&
    treeRegrowthEquivalent(entityTreeRegrowth, baseline.treeRegrowth)
  ) {
    return null;
  }
  return {
    ...(chunk ? { chunk } : {}),
    quantity: entity.quantity,
    ...(entityRegeneration
      ? { regeneration: cloneRegeneration(entityRegeneration) }
      : {}),
    ...(entityTreeHarvest
      ? { treeHarvest: { ...entityTreeHarvest } }
      : {}),
    ...(entityTreeRegrowth
      ? { treeRegrowth: cloneTreeRegrowthState(entityTreeRegrowth) }
      : {}),
  };
}

export interface GeneratedWorldBubbleSyncResult {
  materializedChunks: string[];
  dematerializedChunks: string[];
  activeChunks: string[];
}

/**
 * Folds one generated chunk back into sparse deltas and removes its runtime
 * baseline. Authored/custom entities are deliberately untouched.
 */
export function dematerializeGeneratedWorldChunk(
  state: GameState,
  coordinate: ChunkCoordinate,
): number {
  const key = chunkKey(coordinate);
  const baseline = createGeneratedChunkEntities(state.seed, coordinate);
  const legacy = createLegacyGeneratedChunkEntities(state.seed, coordinate);
  state.world.entityDeltas ??= {};
  let removed = 0;

  for (const [id, entity] of Object.entries(state.world.entities)) {
    if (
      !entity.tags.includes("generated") ||
      chunkTag(entity) !== key
    ) {
      continue;
    }
    const source = baseline[id] ?? legacy[id];
    if (!source) continue;
    const delta = deltaFor(entity, source, key);
    if (delta) state.world.entityDeltas[id] = delta;
    else delete state.world.entityDeltas[id];
    delete state.world.entities[id];
    removed += 1;
  }

  state.world.generatedResourceChunks = (
    state.world.generatedResourceChunks ?? []
  ).filter((candidate) => candidate !== key);
  return removed;
}

/**
 * Keeps only a square deterministic activity bubble materialized. This helper
 * is intentionally independent from renderer quality: low-power visuals may
 * change LOD, never the 3x3 semantic truth around the player.
 */
export function syncGeneratedWorldBubble(
  state: GameState,
  center: ChunkCoordinate,
  radius = 1,
): GeneratedWorldBubbleSyncResult {
  if (!Number.isSafeInteger(radius) || radius < 0) {
    throw new RangeError("generated world bubble radius must be a non-negative integer");
  }
  const desired = new Map<string, ChunkCoordinate>();
  for (let x = center.x - radius; x <= center.x + radius; x += 1) {
    for (let z = center.z - radius; z <= center.z + radius; z += 1) {
      const coordinate = { x, z };
      desired.set(chunkKey(coordinate), coordinate);
    }
  }

  const dematerializedChunks: string[] = [];
  for (const key of [...(state.world.generatedResourceChunks ?? [])]) {
    if (desired.has(key)) continue;
    const coordinate = parseChunkKey(key);
    if (!coordinate) continue;
    dematerializeGeneratedWorldChunk(state, coordinate);
    dematerializedChunks.push(key);
  }

  const materializedChunks: string[] = [];
  const alreadyMaterialized = new Set(
    state.world.generatedResourceChunks ?? [],
  );
  for (const [key, coordinate] of desired) {
    if (!alreadyMaterialized.has(key)) materializedChunks.push(key);
    materializeGeneratedWorldChunk(state, coordinate);
  }
  const activeChunks = [...desired.keys()];
  state.world.generatedResourceChunks = activeChunks;
  return { materializedChunks, dematerializedChunks, activeChunks };
}

function compactRegeneration(
  regeneration: ResourceRegenerationState,
): CompactRegeneration {
  return [
    regeneration.capacity,
    regeneration.nextTick,
    regeneration.cycle ?? 0,
    regeneration.nextAmount ?? null,
  ];
}

function compactTreeRegrowth(
  regrowth: TreeRegrowthState,
): CompactTreeRegrowth {
  return [
    regrowth.version,
    regrowth.cycle,
    regrowth.schedule.stumpStartedAtTick,
    regrowth.schedule.saplingAtTick,
    regrowth.schedule.youngAtTick,
    regrowth.schedule.matureAtTick,
    regrowth.stage,
    regrowth.stageStartedAtTick,
    regrowth.lastAdvancedTick,
  ];
}

function compactDelta(id: string, delta: WorldEntityDelta): CompactEntityDelta {
  if (delta.treeRegrowth) {
    return [
      id,
      delta.chunk ?? null,
      delta.quantity,
      delta.regeneration ? compactRegeneration(delta.regeneration) : null,
      delta.treeHarvest
        ? [
            delta.treeHarvest.fallDirection,
            delta.treeHarvest.branches,
            delta.treeHarvest.trunkSegments,
            delta.treeHarvest.looseLog ? 1 : 0,
          ]
        : null,
      compactTreeRegrowth(delta.treeRegrowth),
    ];
  }
  if (delta.treeHarvest) {
    return [
      id,
      delta.chunk ?? null,
      delta.quantity,
      delta.regeneration ? compactRegeneration(delta.regeneration) : null,
      [
        delta.treeHarvest.fallDirection,
        delta.treeHarvest.branches,
        delta.treeHarvest.trunkSegments,
        delta.treeHarvest.looseLog ? 1 : 0,
      ],
    ];
  }
  return delta.regeneration
    ? [
        id,
        delta.chunk ?? null,
        delta.quantity,
        compactRegeneration(delta.regeneration),
      ]
    : [id, delta.chunk ?? null, delta.quantity];
}

function compactRiverHydrology(
  hydrology: NonNullable<WorldState["riverHydrology"]>,
): CompactRiverHydrology {
  return [
    hydrology.version,
    hydrology.levelMeters,
    hydrology.runoff,
    hydrology.trendMetersPerGameHour,
    hydrology.lastAdvancedTick,
  ];
}

function compactWindField(wind: WindFieldState): CompactWindField {
  return [
    wind.version,
    wind.directionRadians,
    wind.speed,
    wind.gust,
    wind.targetDirectionRadians,
    wind.targetSpeed,
    wind.nextFrontTick,
    wind.lastAdvancedTick,
  ];
}

function compactCanopyJunction(
  junction: CanopyJunctionState,
): CompactCanopyJunction {
  return [
    junction.version,
    junction.phase,
    [...junction.clearedObstructionIds],
    junction.phaseEnteredTick,
    junction.samplingStartedTick,
    junction.consecutiveReadableTicks,
    junction.lastAdvancedTick,
    junction.sample
      ? [
          junction.sample.directionRadians,
          junction.sample.strength,
          junction.sample.signalQuality,
          junction.sample.capturedAtTick,
          junction.sample.stableTicks,
        ]
      : null,
    junction.reportedAtTick,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeGameState(value: unknown): value is GameState {
  if (!isRecord(value) || value.version !== 1 || typeof value.seed !== "number") {
    return false;
  }
  if (!isRecord(value.world) || !isRecord(value.world.entities)) return false;
  return isRecord(value.player) && isRecord(value.player.position);
}

function baselineForRuntimeEntity(
  state: GameState,
  entity: WorldEntity,
  authored: Readonly<Record<string, WorldEntity>>,
  chunkCache: Map<string, Record<string, WorldEntity>>,
  legacyChunkCache: Map<string, Record<string, WorldEntity>>,
): { baseline: WorldEntity; chunk?: string } | null {
  const authoredEntity = authored[entity.id];
  if (authoredEntity) return { baseline: authoredEntity };
  if (!entity.tags.includes("generated")) return null;
  const key = chunkTag(entity);
  if (!key) return null;
  const coordinate = parseChunkKey(key);
  if (!coordinate) return null;
  let chunk = chunkCache.get(key);
  if (!chunk) {
    chunk = createGeneratedChunkEntities(state.seed, coordinate);
    chunkCache.set(key, chunk);
  }
  let baseline = chunk[entity.id];
  if (!baseline) {
    let legacyChunk = legacyChunkCache.get(key);
    if (!legacyChunk) {
      legacyChunk = createLegacyGeneratedChunkEntities(state.seed, coordinate);
      legacyChunkCache.set(key, legacyChunk);
    }
    baseline = legacyChunk[entity.id];
  }
  return baseline ? { baseline, chunk: key } : null;
}

/**
 * Converts only a GameState payload. Generic SaveRepository payloads pass
 * through untouched, so the envelope layer remains reusable.
 */
export function compactGameStateSavePayload(value: unknown): unknown {
  if (!isRuntimeGameState(value)) return value;
  const state = value;
  const authored = createAuthoredWorldEntities();
  const chunkCache = new Map<string, Record<string, WorldEntity>>();
  const legacyChunkCache = new Map<string, Record<string, WorldEntity>>();
  const deltas: Record<string, WorldEntityDelta> = {
    ...(state.world.entityDeltas ?? {}),
  };
  const customEntities: WorldEntity[] = [];

  for (const entity of Object.values(state.world.entities)) {
    const resolved = baselineForRuntimeEntity(
      state,
      entity,
      authored,
      chunkCache,
      legacyChunkCache,
    );
    if (!resolved) {
      customEntities.push(cloneEntity(entity));
      continue;
    }
    const delta = deltaFor(entity, resolved.baseline, resolved.chunk);
    if (delta) deltas[entity.id] = delta;
    else delete deltas[entity.id];
  }

  const snapshot: CompactWorldSnapshot = {
    format: WORLD_DELTA_FORMAT,
    version: WORLD_DELTA_VERSION,
    bounds: { ...state.world.bounds },
    exploredChunks: [...(state.world.exploredChunks ?? [])],
    deltas: Object.entries(deltas)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, delta]) => compactDelta(id, delta)),
    customEntities,
    ...(state.world.riverHydrology
      ? { riverHydrology: compactRiverHydrology(state.world.riverHydrology) }
      : {}),
    ...(state.world.windField
      ? { windField: compactWindField(state.world.windField) }
      : {}),
    ...(state.world.canopyJunction
      ? { canopyJunction: compactCanopyJunction(state.world.canopyJunction) }
      : {}),
  };
  return { ...state, world: snapshot };
}

function expandRegeneration(value: unknown): ResourceRegenerationState | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [capacity, nextTick, cycle, nextAmount] = value;
  if (
    !Number.isFinite(capacity) ||
    (nextTick !== null && !Number.isFinite(nextTick)) ||
    !Number.isFinite(cycle) ||
    (nextAmount !== null && !Number.isFinite(nextAmount))
  ) {
    return null;
  }
  return {
    capacity: Math.max(1, Math.floor(capacity as number)),
    nextTick: nextTick === null ? null : Math.max(0, Math.floor(nextTick as number)),
    cycle: Math.max(0, Math.floor(cycle as number)),
    nextAmount:
      nextAmount === null ? null : Math.max(1, Math.floor(nextAmount as number)),
  };
}

function expandTreeHarvest(value: unknown): TreeHarvestState | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [fallDirection, branches, trunkSegments, looseLog] = value;
  if (
    !Number.isFinite(fallDirection) ||
    !Number.isFinite(branches) ||
    !Number.isFinite(trunkSegments) ||
    (looseLog !== 0 && looseLog !== 1)
  ) {
    return null;
  }
  return normalizeTreeHarvestState({
    fallDirection: fallDirection as number,
    branches: branches as number,
    trunkSegments: trunkSegments as number,
    looseLog: looseLog === 1,
  }) ?? null;
}

function expandTreeRegrowth(value: unknown): TreeRegrowthState | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  const [
    version,
    cycle,
    stumpStartedAtTick,
    saplingAtTick,
    youngAtTick,
    matureAtTick,
    stage,
    stageStartedAtTick,
    lastAdvancedTick,
  ] = value;
  if (
    version !== 1 ||
    !Number.isSafeInteger(cycle) ||
    (cycle as number) < 0 ||
    !Number.isSafeInteger(lastAdvancedTick) ||
    (lastAdvancedTick as number) < 0
  ) {
    return null;
  }
  return normalizeTreeRegrowthState(
    {
      version,
      cycle: cycle as number,
      schedule: {
        stumpStartedAtTick,
        saplingAtTick,
        youngAtTick,
        matureAtTick,
      },
      stage,
      stageStartedAtTick,
      lastAdvancedTick,
    },
    lastAdvancedTick as number,
  );
}

function expandRiverHydrology(
  value: unknown,
): WorldState["riverHydrology"] | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const [version, levelMeters, runoff, trendMetersPerGameHour, lastAdvancedTick] =
    value;
  if (
    version !== 1 ||
    !Number.isFinite(levelMeters) ||
    !Number.isFinite(runoff) ||
    !Number.isFinite(trendMetersPerGameHour) ||
    !Number.isSafeInteger(lastAdvancedTick) ||
    (lastAdvancedTick as number) < 0
  ) {
    return null;
  }
  return {
    version,
    levelMeters: levelMeters as number,
    runoff: runoff as number,
    trendMetersPerGameHour: trendMetersPerGameHour as number,
    lastAdvancedTick: lastAdvancedTick as number,
  };
}

function expandWindField(value: unknown, worldSeed: number): WindFieldState | null {
  if (!Array.isArray(value) || value.length !== 8) return null;
  const [
    version,
    directionRadians,
    speed,
    gust,
    targetDirectionRadians,
    targetSpeed,
    nextFrontTick,
    lastAdvancedTick,
  ] = value;
  if (
    version !== 1 ||
    ![
      directionRadians,
      speed,
      gust,
      targetDirectionRadians,
      targetSpeed,
    ].every(Number.isFinite) ||
    !Number.isSafeInteger(nextFrontTick) ||
    (nextFrontTick as number) < 0 ||
    !Number.isSafeInteger(lastAdvancedTick) ||
    (lastAdvancedTick as number) < 0
  ) {
    return null;
  }
  return normalizeWindFieldState(
    {
      version,
      directionRadians: directionRadians as number,
      speed: speed as number,
      gust: gust as number,
      targetDirectionRadians: targetDirectionRadians as number,
      targetSpeed: targetSpeed as number,
      nextFrontTick: nextFrontTick as number,
      lastAdvancedTick: lastAdvancedTick as number,
    },
    worldSeed,
    lastAdvancedTick as number,
  );
}

function expandCanopyJunction(value: unknown): CanopyJunctionState | null {
  if (!Array.isArray(value) || value.length !== 9) return null;
  const [
    version,
    phase,
    clearedObstructionIds,
    phaseEnteredTick,
    samplingStartedTick,
    consecutiveReadableTicks,
    lastAdvancedTick,
    sampleValue,
    reportedAtTick,
  ] = value;
  if (
    version !== 1 ||
    typeof phase !== "string" ||
    !CANOPY_JUNCTION_PHASES.includes(
      phase as (typeof CANOPY_JUNCTION_PHASES)[number],
    ) ||
    !Array.isArray(clearedObstructionIds) ||
    !clearedObstructionIds.every((id) => typeof id === "string") ||
    !Number.isSafeInteger(phaseEnteredTick) ||
    (phaseEnteredTick as number) < 0 ||
    (samplingStartedTick !== null &&
      (!Number.isSafeInteger(samplingStartedTick) ||
        (samplingStartedTick as number) < 0)) ||
    !Number.isSafeInteger(consecutiveReadableTicks) ||
    (consecutiveReadableTicks as number) < 0 ||
    !Number.isSafeInteger(lastAdvancedTick) ||
    (lastAdvancedTick as number) < 0 ||
    (reportedAtTick !== null &&
      (!Number.isSafeInteger(reportedAtTick) ||
        (reportedAtTick as number) < 0))
  ) {
    return null;
  }
  let sample = null;
  if (sampleValue !== null) {
    if (
      !Array.isArray(sampleValue) ||
      sampleValue.length !== 5 ||
      !sampleValue.slice(0, 3).every(Number.isFinite) ||
      !Number.isSafeInteger(sampleValue[3]) ||
      !Number.isSafeInteger(sampleValue[4])
    ) {
      return null;
    }
    sample = {
      directionRadians: sampleValue[0] as number,
      strength: sampleValue[1] as number,
      signalQuality: sampleValue[2] as number,
      capturedAtTick: sampleValue[3] as number,
      stableTicks: sampleValue[4] as number,
    };
  }
  return normalizeCanopyJunctionState(
    {
      version,
      phase: phase as CanopyJunctionState["phase"],
      clearedObstructionIds: clearedObstructionIds as string[],
      phaseEnteredTick: phaseEnteredTick as number,
      samplingStartedTick: samplingStartedTick as number | null,
      consecutiveReadableTicks: consecutiveReadableTicks as number,
      lastAdvancedTick: lastAdvancedTick as number,
      sample,
      reportedAtTick: reportedAtTick as number | null,
    },
    lastAdvancedTick as number,
  );
}

function expandDelta(
  value: unknown,
  version: 1 | 2 | 3,
): [string, WorldEntityDelta] | null {
  if (
    !Array.isArray(value) ||
    (version === 1
      ? value.length !== 3 && value.length !== 4
      : version === 2
        ? value.length < 3 || value.length > 5
        : value.length < 3 || value.length > 6)
  ) {
    return null;
  }
  const [
    id,
    chunk,
    quantity,
    compactRegenerationValue,
    compactTreeHarvestValue,
    compactTreeRegrowthValue,
  ] = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    (chunk !== null && (typeof chunk !== "string" || !parseChunkKey(chunk))) ||
    !Number.isFinite(quantity)
  ) {
    return null;
  }
  const regeneration =
    compactRegenerationValue === undefined || compactRegenerationValue === null
      ? undefined
      : expandRegeneration(compactRegenerationValue);
  if (
    compactRegenerationValue !== undefined &&
    compactRegenerationValue !== null &&
    !regeneration
  ) {
    return null;
  }
  if (version === 1 && compactTreeHarvestValue !== undefined) return null;
  const treeHarvest =
    compactTreeHarvestValue === undefined || compactTreeHarvestValue === null
      ? undefined
      : expandTreeHarvest(compactTreeHarvestValue);
  if (
    compactTreeHarvestValue !== undefined &&
    compactTreeHarvestValue !== null &&
    !treeHarvest
  ) return null;
  if (version !== 3 && compactTreeRegrowthValue !== undefined) return null;
  const treeRegrowth =
    compactTreeRegrowthValue === undefined
      ? undefined
      : expandTreeRegrowth(compactTreeRegrowthValue);
  if (compactTreeRegrowthValue !== undefined && !treeRegrowth) return null;
  return [
    id,
    {
      ...(typeof chunk === "string" ? { chunk } : {}),
      quantity: Math.max(0, Math.min(999, Math.floor(quantity as number))),
      ...(regeneration ? { regeneration } : {}),
      ...(treeHarvest ? { treeHarvest } : {}),
      ...(treeRegrowth ? { treeRegrowth } : {}),
    },
  ];
}

function validBounds(value: unknown): value is WorldState["bounds"] {
  if (!isRecord(value)) return false;
  return [value.minX, value.maxX, value.minZ, value.maxZ].every(Number.isFinite);
}

function validCustomEntity(value: unknown): value is WorldEntity {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  if (!isRecord(value.position) || !Array.isArray(value.tags)) return false;
  return (
    [value.position.x, value.position.y, value.position.z, value.quantity].every(
      Number.isFinite,
    ) && value.tags.every((tag) => typeof tag === "string")
  );
}

/** Expands a checksummed delta payload into the ordinary runtime GameState. */
export function expandGameStateSavePayload(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.world)) return value;
  const snapshot = value.world;
  if (
    snapshot.format !== WORLD_DELTA_FORMAT ||
    (snapshot.version !== 1 &&
      snapshot.version !== 2 &&
      snapshot.version !== WORLD_DELTA_VERSION)
  ) {
    return value;
  }
  if (
    typeof value.seed !== "number" ||
    !validBounds(snapshot.bounds) ||
    !Array.isArray(snapshot.exploredChunks) ||
    !snapshot.exploredChunks.every(
      (entry) => typeof entry === "string" && parseChunkKey(entry),
    ) ||
    !Array.isArray(snapshot.deltas) ||
    !Array.isArray(snapshot.customEntities) ||
    !snapshot.customEntities.every(validCustomEntity)
  ) {
    return value;
  }

  const expandedDeltas = snapshot.deltas.map((delta) =>
    expandDelta(delta, snapshot.version as 1 | 2 | 3),
  );
  if (expandedDeltas.some((entry) => entry === null)) return value;
  const riverHydrology = Object.prototype.hasOwnProperty.call(
    snapshot,
    "riverHydrology",
  )
    ? expandRiverHydrology(snapshot.riverHydrology)
    : undefined;
  if (riverHydrology === null) return value;
  const windField = Object.prototype.hasOwnProperty.call(snapshot, "windField")
    ? expandWindField(snapshot.windField, value.seed)
    : undefined;
  if (windField === null) return value;
  const canopyJunction = Object.prototype.hasOwnProperty.call(
    snapshot,
    "canopyJunction",
  )
    ? expandCanopyJunction(snapshot.canopyJunction)
    : undefined;
  if (canopyJunction === null) return value;
  const entityDeltas = Object.fromEntries(
    expandedDeltas as [string, WorldEntityDelta][],
  );
  const entities = createAuthoredWorldEntities();
  for (const [id, delta] of Object.entries(entityDeltas)) {
    const authored = entities[id];
    if (authored && !delta.chunk) applyEntityDelta(authored, delta);
  }
  for (const entity of snapshot.customEntities) {
    entities[entity.id] = cloneEntity(entity);
  }

  const state = {
    ...value,
    world: {
      bounds: { ...snapshot.bounds },
      entities,
      exploredChunks: [...snapshot.exploredChunks],
      generatedResourceChunks: [],
      entityDeltas,
      ...(riverHydrology ? { riverHydrology } : {}),
      ...(windField ? { windField } : {}),
      ...(canopyJunction ? { canopyJunction } : {}),
    },
  } as unknown as GameState;
  const position = state.player?.position;
  if (
    position &&
    Number.isFinite(position.x) &&
    Number.isFinite(position.z)
  ) {
    syncGeneratedWorldBubble(
      state,
      worldToChunkCoordinate(position.x, position.z),
      1,
    );
  }
  return state;
}
