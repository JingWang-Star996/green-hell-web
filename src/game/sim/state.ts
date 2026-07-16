import { ITEMS, TASK_SEQUENCE } from "./content";
import {
  AUTHORED_ECOLOGY_SPECIES_IDS,
  ECOLOGY_SPECIES,
  ECOLOGY_SPECIES_IDS,
  createEcologyState,
  type EcologyCorpseSnapshot,
} from "../ecology";
import {
  createAuthoredWorldEntities,
  syncGeneratedWorldBubble,
} from "../world/saveDelta";
import {
  activeChunkCoordinates,
  chunkKey,
  generateChunkDescriptor,
  worldToChunkCoordinate,
} from "../world/generation";
import { createRngChannels, hashSeed } from "./rng";
import { migrateLegacyAuthoredSnakes } from "./authoredSnakes";
import { ensureItemLifecycleState } from "./lifecycle";
import { normalizeMineableRockRuntime } from "./rockHarvest";
import { RAIN_COLLECTOR_CAPACITY } from "./rainCollectorRules";
import {
  normalizeTreeEntityRuntime,
  normalizeTreeHarvestState,
  treeHarvestFinished,
} from "./treeHarvest";
import { normalizeTreeRegrowthState } from "./treeRegrowth";
import {
  advanceTreeRegrowthEntity,
  cloneTreeRegrowthState,
} from "./treeRegrowthRuntime";
import { DEFAULT_STRUCTURE_PLACEMENTS } from "./structureGeometry";
import {
  normalizePlacedCampfireState,
  syncLegacyCampFacades,
} from "./campStructures";
import { normalizeTorchWaymarkState } from "./torchWaymarkRules";
import {
  normalizeResourceDirectorState,
  resourceDirectorEpochForTick,
} from "./resourceDirector";
import {
  gameHoursToSimulationSeconds,
  START_MINUTE_OF_DAY,
  synchronizeCalendar,
} from "./time";
import {
  normalizeObjectiveFactReference,
  normalizeObjectiveFacts,
  recordObjectiveFact,
} from "./objectiveFacts";
import {
  createRiverHydrologyState,
  normalizeRiverHydrologyState,
} from "../world/riverHydrology";
import {
  createWindFieldState,
  normalizeWindFieldState,
} from "../world/windField";
import {
  CANOPY_JUNCTION_ID,
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  CANOPY_JUNCTION_TENSION_VINE_IDS,
  createCanopyJunctionState,
  normalizeCanopyJunctionState,
} from "./canopyJunction";
import {
  EQUIPPABLE_ITEM_IDS,
  ITEM_IDS,
  RECIPE_IDS,
} from "./types";
import type {
  GameEvent,
  GameState,
  HealthLossRecord,
  Inventory,
  ItemId,
  KnowledgeState,
  PlacedStructureKind,
  PlacedStructureState,
  ProgressState,
  RecipeId,
  SanityLossRecord,
  Seed,
} from "./types";

export const SIMULATION_VERSION = 1 as const;
export const DYNAMIC_WORLD_LIMIT = 1_000_000;
export const MAX_HEALTH_LOSS_HISTORY = 8;
export const MAX_SANITY_LOSS_HISTORY = 8;

function activeEcologyChunks(seed: number, x: number, z: number) {
  return activeChunkCoordinates(x, z, 1).map((coordinate) =>
    generateChunkDescriptor(String(seed), coordinate),
  );
}

export function createEmptyInventory(): Inventory {
  return Object.fromEntries(ITEM_IDS.map((itemId) => [itemId, 0])) as Inventory;
}

export function createInitialState(seed: Seed = 1): GameState {
  const normalizedSeed = hashSeed(seed);
  const initialEcology = createEcologyState(normalizedSeed, {
    tick: 0,
    rainIntensity: 0.22,
    activeChunks: activeEcologyChunks(normalizedSeed, 0, -5),
  });
  const state: GameState = {
    version: SIMULATION_VERSION,
    seed: normalizedSeed,
    status: "playing",
    lossReason: null,
    clock: {
      tick: 0,
      elapsedSeconds: 0,
      remainderSeconds: 0,
      day: 1,
      minuteOfDay: START_MINUTE_OF_DAY,
      gameMinutesElapsed: 0,
    },
    rng: createRngChannels(seed),
    player: {
      position: { x: 0, y: 0, z: -5 },
      lookYaw: Math.PI,
      lookPitch: -0.05,
      poseRevision: 0,
      equippedItem: null,
      torchBurnSeconds: 0,
      nutrition: {
        carbohydrates: 72,
        protein: 66,
        fat: 62,
        hydration: 42,
      },
      vitals: {
        health: 84,
        stamina: 72,
        energy: 70,
        sanity: 76,
      },
      conditions: {
        wound: {
          open: true,
          treated: false,
          severity: 32,
          infection: 0,
        },
        parasites: 0,
        wetness: 12,
      },
    },
    inventory: createEmptyInventory(),
    itemLifecycle: {
      balanceVersion: 2,
      torchFuelVersion: 1,
      perishables: {},
      tools: {},
    },
    weather: {
      rainIntensity: 0.22,
      targetRainIntensity: 0.22,
      secondsUntilChange: gameHoursToSimulationSeconds(0.75),
      storm: false,
    },
    camp: {
      position: { x: 0, y: 0, z: 0 },
      fire: {
        built: false,
        lit: false,
        fuelSeconds: 0,
        rainExposure: 0,
        sheltered: false,
      },
      shelterBuilt: false,
      bedBuilt: false,
      beaconBuilt: false,
      structures: [],
    },
    world: {
      bounds: {
        minX: -DYNAMIC_WORLD_LIMIT,
        maxX: DYNAMIC_WORLD_LIMIT,
        minZ: -DYNAMIC_WORLD_LIMIT,
        maxZ: DYNAMIC_WORLD_LIMIT,
      },
      entities: createAuthoredWorldEntities(),
      exploredChunks: [chunkKey(worldToChunkCoordinate(0, -5))],
      generatedResourceChunks: [],
      entityDeltas: {},
      riverHydrology: createRiverHydrologyState(0),
      windField: createWindFieldState(normalizedSeed, 0),
      canopyJunction: createCanopyJunctionState(0),
    },
    ecology: initialEcology,
    objectives: {
      currentTaskId: TASK_SEQUENCE[0],
      completedTaskIds: [],
      flags: {
        woundTreated: false,
        waterPurified: false,
        campEstablished: false,
        batteryRecovered: false,
        transmitted: false,
      },
    },
    knowledge: {
      inspectedLandmarkIds: [],
      observedItemIds: [],
      craftedRecipeIds: [],
      // The opening objective teaches the emergency bandage immediately. It
      // must be visible before the player gathers ingredients, especially on
      // a fresh mobile device with no local recipe profile.
      announcedRecipeIds: ["bandage"],
      objectiveFacts: [],
    },
    progress: {
      restEverCompleted: false,
      waterEverCollected: false,
    },
    resourceDirector: {
      version: 1,
      evaluatedThroughEpoch: resourceDirectorEpochForTick(0),
    },
    healthLossHistory: [],
    sanityLossHistory: [],
    eventLog: [
      {
        id: 1,
        tick: 0,
        elapsedSeconds: 0,
        type: "state-created",
        message: "暴雨将至。左臂的开放伤口需要立即处理。",
        cause: { source: "system", code: "run-start" },
        details: { seed: normalizedSeed },
      },
    ],
    nextEventId: 2,
  };
  syncGeneratedWorldBubble(
    state,
    worldToChunkCoordinate(state.player.position.x, state.player.position.z),
    1,
  );
  return state;
}

export function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    clock: { ...state.clock },
    rng: { ...state.rng },
    player: {
      ...state.player,
      position: { ...state.player.position },
      nutrition: { ...state.player.nutrition },
      vitals: { ...state.player.vitals },
      conditions: {
        ...state.player.conditions,
        wound: { ...state.player.conditions.wound },
      },
    },
    inventory: { ...state.inventory },
    itemLifecycle: state.itemLifecycle
      ? {
          balanceVersion: state.itemLifecycle.balanceVersion,
          torchFuelVersion: state.itemLifecycle.torchFuelVersion,
          perishables: Object.fromEntries(
            Object.entries(state.itemLifecycle.perishables).map(
              ([itemId, batches]) => [
                itemId,
                Array.isArray(batches)
                  ? batches.map((batch) => ({ ...batch }))
                  : [],
              ],
            ),
          ),
          tools: Object.fromEntries(
            Object.entries(state.itemLifecycle.tools).map(([itemId, tools]) => [
              itemId,
              Array.isArray(tools)
                ? tools.map((tool) => ({ ...tool }))
                : [],
            ]),
          ),
        }
      : undefined,
    weather: { ...state.weather },
    camp: {
      ...state.camp,
      position: { ...state.camp.position },
      fire: { ...state.camp.fire },
      structures: state.camp.structures?.map((structure) => ({
        ...structure,
        position: { ...structure.position },
        ...(structure.fire ? { fire: { ...structure.fire } } : {}),
        ...(structure.process ? { process: { ...structure.process } } : {}),
        ...(Array.isArray(structure.torchFuelQueueSeconds)
          ? { torchFuelQueueSeconds: [...structure.torchFuelQueueSeconds] }
          : {}),
      })),
    },
    world: {
      bounds: { ...state.world.bounds },
      exploredChunks: state.world.exploredChunks
        ? [...state.world.exploredChunks]
        : undefined,
      generatedResourceChunks: state.world.generatedResourceChunks
        ? [...state.world.generatedResourceChunks]
        : undefined,
      entityDeltas: state.world.entityDeltas
        ? Object.fromEntries(
            Object.entries(state.world.entityDeltas).map(([id, delta]) => [
              id,
              {
                ...delta,
                ...(delta.regeneration
                  ? { regeneration: { ...delta.regeneration } }
                  : {}),
                ...(delta.treeHarvest
                  ? { treeHarvest: { ...delta.treeHarvest } }
                  : {}),
                ...(delta.treeRegrowth
                  ? { treeRegrowth: cloneTreeRegrowthState(delta.treeRegrowth) }
                  : {}),
              },
            ]),
          )
        : undefined,
      riverHydrology: state.world.riverHydrology
        ? { ...state.world.riverHydrology }
        : undefined,
      windField: state.world.windField
        ? { ...state.world.windField }
        : undefined,
      canopyJunction: state.world.canopyJunction
        ? {
            ...state.world.canopyJunction,
            clearedObstructionIds: Array.isArray(
              state.world.canopyJunction.clearedObstructionIds,
            )
              ? [...state.world.canopyJunction.clearedObstructionIds]
              : [],
            sample: state.world.canopyJunction.sample
              ? { ...state.world.canopyJunction.sample }
              : null,
          }
        : undefined,
      entities: Object.fromEntries(
        Object.entries(state.world.entities).map(([id, entity]) => [
          id,
          {
            ...entity,
            position: { ...entity.position },
            ...(entity.regeneration
              ? { regeneration: { ...entity.regeneration } }
              : {}),
            ...(entity.semantic ? { semantic: { ...entity.semantic } } : {}),
            ...(entity.treeHarvest
              ? { treeHarvest: { ...entity.treeHarvest } }
              : {}),
            ...(entity.treeRegrowth
              ? { treeRegrowth: cloneTreeRegrowthState(entity.treeRegrowth) }
              : {}),
            tags: [...entity.tags],
          },
        ]),
      ),
    },
    ecology: state.ecology
      ? {
          ...state.ecology,
          populations: Object.fromEntries(
            Object.entries(state.ecology.populations).map(([key, population]) => [
              key,
              { ...population },
            ]),
            ),
          individuals: state.ecology.individuals
            ? Object.fromEntries(
                Object.entries(state.ecology.individuals).map(
                  ([id, individual]) => [
                    id,
                    {
                      ...individual,
                      ...(individual.corpse
                        ? {
                            corpse: {
                              ...individual.corpse,
                              position: { ...individual.corpse.position },
                            },
                          }
                        : {}),
                    },
                  ],
                ),
              )
            : {},
        }
      : undefined,
    objectives: {
      ...state.objectives,
      completedTaskIds: [...state.objectives.completedTaskIds],
      flags: { ...state.objectives.flags },
    },
    knowledge: state.knowledge
      ? {
          inspectedLandmarkIds: [...state.knowledge.inspectedLandmarkIds],
          observedItemIds: [...state.knowledge.observedItemIds],
          craftedRecipeIds: [...state.knowledge.craftedRecipeIds],
          announcedRecipeIds: [...state.knowledge.announcedRecipeIds],
          objectiveFacts: normalizeObjectiveFacts(
            state.knowledge.objectiveFacts,
          ),
        }
      : undefined,
    progress: state.progress ? { ...state.progress } : undefined,
    resourceDirector: state.resourceDirector
      ? { ...state.resourceDirector }
      : undefined,
    healthLossHistory: normalizeHealthLossHistory(state.healthLossHistory),
    sanityLossHistory: normalizeSanityLossHistory(state.sanityLossHistory),
    eventLog: state.eventLog.map((event) => ({
      ...event,
      cause: { ...event.cause },
      details: event.details ? { ...event.details } : undefined,
    })),
  };
}

function normalizePendingWildlifeLoot(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(999, Math.floor(value)))
    : 0;
}

function normalizeCorpseSnapshot(value: unknown): EcologyCorpseSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EcologyCorpseSnapshot>;
  if (
    typeof candidate.chunkKey !== "string" ||
    !candidate.position ||
    typeof candidate.position !== "object" ||
    typeof candidate.headingRadians !== "number" ||
    !Number.isFinite(candidate.headingRadians) ||
    typeof candidate.position.x !== "number" ||
    !Number.isFinite(candidate.position.x) ||
    typeof candidate.position.y !== "number" ||
    !Number.isFinite(candidate.position.y) ||
    typeof candidate.position.z !== "number" ||
    !Number.isFinite(candidate.position.z)
  ) {
    return null;
  }
  const expectedChunkKey = chunkKey(
    worldToChunkCoordinate(candidate.position.x, candidate.position.z),
  );
  if (candidate.chunkKey !== expectedChunkKey) return null;
  return {
    chunkKey: candidate.chunkKey,
    position: {
      x: candidate.position.x,
      y: candidate.position.y,
      z: candidate.position.z,
    },
    headingRadians: candidate.headingRadians,
  };
}

function normalizeEcologyIndividuals(state: GameState): void {
  for (const individual of Object.values(state.ecology?.individuals ?? {})) {
    const pendingMeat = normalizePendingWildlifeLoot(individual.pendingMeat);
    const pendingHide = normalizePendingWildlifeLoot(individual.pendingHide);
    if (individual.health > 0) {
      delete individual.pendingMeat;
      delete individual.pendingHide;
      delete individual.corpse;
      continue;
    }
    individual.pendingMeat = pendingMeat;
    individual.pendingHide = pendingHide;
    const procedural = ECOLOGY_SPECIES_IDS.some(
      (speciesId) => speciesId === individual.speciesId,
    );
    if (!procedural) {
      delete individual.corpse;
      continue;
    }
    const corpse = normalizeCorpseSnapshot(individual.corpse);
    if (!corpse || pendingMeat + pendingHide <= 0) {
      delete individual.corpse;
      if (!corpse && pendingMeat + pendingHide > 0) {
        // Corrupt anchors must not leave invisible loot that blocks respawn.
        individual.pendingMeat = 0;
        individual.pendingHide = 0;
      }
      continue;
    }
    individual.corpse = corpse;
  }
}

/** Upgrades a legacy version-1 save without mutating the persisted payload. */
export function migrateGameState(state: GameState): GameState {
  const migrated = cloneGameState(state);
  migrated.player.lookYaw = normalizeLookYaw(migrated.player.lookYaw);
  migrated.player.lookPitch = normalizeLookPitch(migrated.player.lookPitch);
  migrated.player.poseRevision = Number.isFinite(migrated.player.poseRevision)
    ? Math.max(0, Math.floor(migrated.player.poseRevision ?? 0))
    : 0;
  ensureProgressMemory(migrated);
  synchronizeCalendar(migrated.clock);
  normalizeResourceDirectorState(migrated);
  migrated.healthLossHistory = normalizeHealthLossHistory(
    migrated.healthLossHistory,
  );
  migrated.sanityLossHistory = normalizeSanityLossHistory(
    migrated.sanityLossHistory,
  );
  // Version-1 saves are structurally open-ended: newly introduced item keys
  // are absent at runtime even though TypeScript sees a complete Inventory.
  // Materialize every current key before lifecycle/equipment reconciliation so
  // an old save gains new recipes and tools without producing NaN counts.
  for (const itemId of ITEM_IDS) {
    const count = migrated.inventory[itemId];
    migrated.inventory[itemId] = Number.isFinite(count)
      ? Math.max(0, Math.min(999, Math.floor(count)))
      : 0;
  }
  ensureItemLifecycleState(migrated);
  migrated.world.bounds = {
    minX: -DYNAMIC_WORLD_LIMIT,
    maxX: DYNAMIC_WORLD_LIMIT,
    minZ: -DYNAMIC_WORLD_LIMIT,
    maxZ: DYNAMIC_WORLD_LIMIT,
  };
  const currentChunkKey = chunkKey(
    worldToChunkCoordinate(
      migrated.player.position.x,
      migrated.player.position.z,
    ),
  );
  migrated.world.exploredChunks = [
    ...new Set([...(migrated.world.exploredChunks ?? []), currentChunkKey]),
  ].slice(-4096);
  migrated.world.generatedResourceChunks ??= [];
  migrated.world.entityDeltas ??= {};
  migrated.world.riverHydrology = normalizeRiverHydrologyState(
    migrated.world.riverHydrology,
    migrated.clock.tick,
  );
  migrated.world.windField = normalizeWindFieldState(
    migrated.world.windField,
    migrated.seed,
    migrated.clock.tick,
  );
  migrated.world.canopyJunction = normalizeCanopyJunctionState(
    migrated.world.canopyJunction,
    migrated.clock.tick,
  );
  const authoredEntities = createAuthoredWorldEntities();
  for (const id of [
    CANOPY_JUNCTION_ID,
    CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
    ...CANOPY_JUNCTION_TENSION_VINE_IDS,
  ]) {
    migrated.world.entities[id] ??= authoredEntities[id];
  }
  for (const delta of Object.values(migrated.world.entityDeltas)) {
    const normalized = normalizeTreeHarvestState(delta.treeHarvest);
    if (delta.quantity > 0 || !normalized || treeHarvestFinished(normalized)) {
      delete delta.treeHarvest;
    }
    else delta.treeHarvest = normalized;
    if (delta.treeRegrowth) {
      const savedTick = delta.treeRegrowth.lastAdvancedTick;
      const regrowth = normalizeTreeRegrowthState(
        delta.treeRegrowth,
        savedTick,
      );
      if (regrowth) delta.treeRegrowth = regrowth;
      else delete delta.treeRegrowth;
    }
  }
  syncGeneratedWorldBubble(
    migrated,
    worldToChunkCoordinate(
      migrated.player.position.x,
      migrated.player.position.z,
    ),
    1,
  );
  for (const entity of Object.values(migrated.world.entities)) {
    normalizeTreeEntityRuntime(entity);
    advanceTreeRegrowthEntity(migrated.clock.tick, entity);
    normalizeMineableRockRuntime(entity);
  }
  const equippedItem = migrated.player.equippedItem;
  migrated.player.equippedItem =
    equippedItem &&
    EQUIPPABLE_ITEM_IDS.includes(equippedItem) &&
    migrated.inventory[equippedItem] > 0
      ? equippedItem
      : null;
  // ensureItemLifecycleState has already paid any legacy burn debt into the
  // first concrete torch unit. Never let that debt attach to a future torch.
  migrated.player.torchBurnSeconds = 0;
  migrated.camp.structures = normalizePlacedStructures(migrated);
  syncLegacyCampFacades(migrated);
  migrated.objectives.flags.sandboxContinued ??= false;
  if (
    !migrated.ecology ||
    migrated.ecology.version !== 1 ||
    migrated.ecology.worldSeed !== String(migrated.seed)
  ) {
    migrated.ecology = createEcologyState(migrated.seed, {
      tick: migrated.clock.tick,
      rainIntensity: migrated.weather.rainIntensity,
      activeChunks: activeEcologyChunks(
        migrated.seed,
        migrated.player.position.x,
        migrated.player.position.z,
      ),
    });
  }
  normalizeEcologyIndividuals(migrated);
  migrateLegacyAuthoredSnakes(migrated);
  return migrated;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

const LOSS_BOUNDARY_EPSILON = 1e-9;
const WILDLIFE_SOURCE_LABELS = new Map<string, string>(
  [...ECOLOGY_SPECIES_IDS, ...AUTHORED_ECOLOGY_SPECIES_IDS].map((speciesId) => [
    `wildlife:contact:${speciesId}`,
    ECOLOGY_SPECIES[speciesId].label,
  ]),
);
const CONSUMPTION_SOURCE_LABELS = new Map<string, string>(
  ITEM_IDS.map((itemId) => [
    `consumption:${itemId}`,
    `食用${ITEMS[itemId].label}`,
  ]),
);
const FIXED_HEALTH_SOURCE_LABELS = new Map<string, string>([
  ["hazard:snake:bite", "眼镜蛇"],
  ["condition:open-wound", "未处理的开放伤口"],
  ["condition:infected-wound", "感染的开放伤口"],
  ["condition:dehydration", "持续脱水"],
  ["condition:exhaustion", "极度衰竭"],
]);
const FIXED_SANITY_SOURCE_LABELS = new Map<string, string>([
  ["hazard:snake:bite", "眼镜蛇的袭击"],
  ["condition:wet-cold", "持续湿冷暴露"],
  ["condition:night-isolation", "无火照明的黑夜"],
]);

function validHealthSource(sourceCode: string, sourceLabel: string): boolean {
  const wildlifeLabel = WILDLIFE_SOURCE_LABELS.get(sourceCode);
  if (wildlifeLabel) return sourceLabel === wildlifeLabel;
  const fixedLabel = FIXED_HEALTH_SOURCE_LABELS.get(sourceCode);
  if (fixedLabel) return sourceLabel === fixedLabel;
  return sourceCode === "condition:starvation" &&
    /^[1-3] 类营养归零$/.test(sourceLabel);
}

function validSanitySource(sourceCode: string, sourceLabel: string): boolean {
  const wildlifeLabel = WILDLIFE_SOURCE_LABELS.get(sourceCode);
  if (wildlifeLabel) return sourceLabel === `${wildlifeLabel}的袭击`;
  const consumptionLabel = CONSUMPTION_SOURCE_LABELS.get(sourceCode);
  if (consumptionLabel) return sourceLabel === consumptionLabel;
  const fixedLabel = FIXED_SANITY_SOURCE_LABELS.get(sourceCode);
  if (fixedLabel) return sourceLabel === fixedLabel;
  return sourceCode === "condition:parasites" &&
    /^寄生虫负担 ×[1-3]$/.test(sourceLabel);
}

function followsHealthEvidence(
  previous: HealthLossRecord | undefined,
  startedTick: number,
  startedElapsedSeconds: number,
  tick: number,
  elapsedSeconds: number,
  healthBefore: number,
): boolean {
  if (!previous) return true;
  return !previous.lethal &&
    startedTick >= previous.tick &&
    startedElapsedSeconds + LOSS_BOUNDARY_EPSILON >= previous.elapsedSeconds &&
    tick >= previous.tick &&
    elapsedSeconds + LOSS_BOUNDARY_EPSILON >= previous.elapsedSeconds &&
    healthBefore + LOSS_BOUNDARY_EPSILON >= previous.healthAfter;
}

function followsSanityEvidence(
  previous: SanityLossRecord | undefined,
  startedTick: number,
  startedElapsedSeconds: number,
  tick: number,
  elapsedSeconds: number,
  sanityBefore: number,
): boolean {
  if (!previous) return true;
  return !previous.lethal &&
    startedTick >= previous.tick &&
    startedElapsedSeconds + LOSS_BOUNDARY_EPSILON >= previous.elapsedSeconds &&
    tick >= previous.tick &&
    elapsedSeconds + LOSS_BOUNDARY_EPSILON >= previous.elapsedSeconds &&
    sanityBefore + LOSS_BOUNDARY_EPSILON >= previous.sanityAfter;
}

/**
 * Treats imported damage history as evidence: malformed or internally
 * inconsistent rows are discarded instead of being repaired into a claim the
 * simulation never made. Source provenance, ordering and boundary continuity
 * must validate before the exact amount is re-derived from the two endpoints.
 */
export function normalizeHealthLossHistory(
  value: unknown,
): HealthLossRecord[] {
  if (!Array.isArray(value)) return [];
  const normalized: HealthLossRecord[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<HealthLossRecord>;
    const sourceCode =
      typeof candidate.sourceCode === "string"
        ? candidate.sourceCode.trim().slice(0, 128)
        : "";
    const sourceLabel =
      typeof candidate.sourceLabel === "string"
        ? candidate.sourceLabel.trim().slice(0, 80)
        : "";
    if (!sourceCode || !sourceLabel || !validHealthSource(sourceCode, sourceLabel)) {
      continue;
    }
    if (
      !finiteNumber(candidate.healthBefore) ||
      !finiteNumber(candidate.healthAfter) ||
      candidate.healthBefore < 0 ||
      candidate.healthBefore > 100 ||
      candidate.healthAfter < 0 ||
      candidate.healthAfter > candidate.healthBefore
    ) {
      continue;
    }
    const amount = candidate.healthBefore - candidate.healthAfter;
    if (amount <= 0) continue;
    if (!finiteNumber(candidate.tick) || !finiteNumber(candidate.elapsedSeconds)) {
      continue;
    }
    const tick = Math.max(0, Math.floor(candidate.tick));
    const elapsedSeconds = Math.max(0, candidate.elapsedSeconds);
    const startedTick = finiteNumber(candidate.startedTick)
      ? Math.max(0, Math.min(tick, Math.floor(candidate.startedTick)))
      : tick;
    const startedElapsedSeconds = finiteNumber(candidate.startedElapsedSeconds)
      ? Math.max(0, Math.min(elapsedSeconds, candidate.startedElapsedSeconds))
      : elapsedSeconds;
    if (!followsHealthEvidence(
      normalized.at(-1),
      startedTick,
      startedElapsedSeconds,
      tick,
      elapsedSeconds,
      candidate.healthBefore,
    )) {
      continue;
    }
    const baseId =
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim().slice(0, 160)
        : `health-loss:legacy:${tick}:${index}`;
    let id = baseId;
    let collision = 1;
    while (seenIds.has(id)) {
      id = `${baseId}:${collision}`;
      collision += 1;
    }
    seenIds.add(id);
    normalized.push({
      id,
      sourceCode,
      sourceLabel,
      amount,
      healthBefore: candidate.healthBefore,
      healthAfter: candidate.healthAfter,
      startedTick,
      startedElapsedSeconds,
      tick,
      elapsedSeconds,
      sampleCount: finiteNumber(candidate.sampleCount)
        ? Math.max(1, Math.min(1_000_000, Math.floor(candidate.sampleCount)))
        : 1,
      lethal: candidate.healthBefore > 0 && candidate.healthAfter <= 0,
    });
  }
  return normalized.slice(-MAX_HEALTH_LOSS_HISTORY);
}

/**
 * Imported sanity history is evidence, not a hint. Discard rows with unknown
 * provenance or broken chronology before deriving amount/lethality.
 */
export function normalizeSanityLossHistory(
  value: unknown,
): SanityLossRecord[] {
  if (!Array.isArray(value)) return [];
  const normalized: SanityLossRecord[] = [];
  const seenIds = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<SanityLossRecord>;
    const sourceCode =
      typeof candidate.sourceCode === "string"
        ? candidate.sourceCode.trim().slice(0, 128)
        : "";
    const sourceLabel =
      typeof candidate.sourceLabel === "string"
        ? candidate.sourceLabel.trim().slice(0, 80)
        : "";
    if (!sourceCode || !sourceLabel || !validSanitySource(sourceCode, sourceLabel)) {
      continue;
    }
    if (
      !finiteNumber(candidate.sanityBefore) ||
      !finiteNumber(candidate.sanityAfter) ||
      candidate.sanityBefore < 0 ||
      candidate.sanityBefore > 100 ||
      candidate.sanityAfter < 0 ||
      candidate.sanityAfter > candidate.sanityBefore
    ) {
      continue;
    }
    const amount = candidate.sanityBefore - candidate.sanityAfter;
    if (amount <= 0) continue;
    if (!finiteNumber(candidate.tick) || !finiteNumber(candidate.elapsedSeconds)) {
      continue;
    }
    const tick = Math.max(0, Math.floor(candidate.tick));
    const elapsedSeconds = Math.max(0, candidate.elapsedSeconds);
    const startedTick = finiteNumber(candidate.startedTick)
      ? Math.max(0, Math.min(tick, Math.floor(candidate.startedTick)))
      : tick;
    const startedElapsedSeconds = finiteNumber(candidate.startedElapsedSeconds)
      ? Math.max(0, Math.min(elapsedSeconds, candidate.startedElapsedSeconds))
      : elapsedSeconds;
    if (!followsSanityEvidence(
      normalized.at(-1),
      startedTick,
      startedElapsedSeconds,
      tick,
      elapsedSeconds,
      candidate.sanityBefore,
    )) {
      continue;
    }
    const baseId =
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim().slice(0, 160)
        : `sanity-loss:legacy:${tick}:${index}`;
    let id = baseId;
    let collision = 1;
    while (seenIds.has(id)) {
      id = `${baseId}:${collision}`;
      collision += 1;
    }
    seenIds.add(id);
    normalized.push({
      id,
      sourceCode,
      sourceLabel,
      amount,
      sanityBefore: candidate.sanityBefore,
      sanityAfter: candidate.sanityAfter,
      startedTick,
      startedElapsedSeconds,
      tick,
      elapsedSeconds,
      sampleCount: finiteNumber(candidate.sampleCount)
        ? Math.max(1, Math.min(1_000_000, Math.floor(candidate.sampleCount)))
        : 1,
      lethal: candidate.sanityBefore > 0 && candidate.sanityAfter <= 0,
    });
  }
  return normalized.slice(-MAX_SANITY_LOSS_HISTORY);
}

function normalizeLookYaw(value: number | undefined): number {
  if (!Number.isFinite(value)) return Math.PI;
  const twoPi = Math.PI * 2;
  return ((value! + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

function normalizeLookPitch(value: number | undefined): number {
  if (!Number.isFinite(value)) return -0.05;
  return Math.max(-1.34, Math.min(1.34, value!));
}

function appendUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function validItemId(value: unknown): value is ItemId {
  return (
    typeof value === "string" &&
    ITEM_IDS.includes(value as ItemId)
  );
}

function validRecipeId(value: unknown): value is RecipeId {
  return (
    typeof value === "string" &&
    RECIPE_IDS.includes(value as RecipeId)
  );
}

function normalizedKnowledge(knowledge: KnowledgeState | undefined): KnowledgeState {
  const inspectedLandmarkIds = Array.isArray(knowledge?.inspectedLandmarkIds)
    ? knowledge.inspectedLandmarkIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const observedItemIds = Array.isArray(knowledge?.observedItemIds)
    ? knowledge.observedItemIds.filter(validItemId)
    : [];
  const craftedRecipeIds = Array.isArray(knowledge?.craftedRecipeIds)
    ? knowledge.craftedRecipeIds.filter(validRecipeId)
    : [];
  const announcedRecipeIds = Array.isArray(knowledge?.announcedRecipeIds)
    ? knowledge.announcedRecipeIds.filter(validRecipeId)
    : [];
  const objectiveFacts = normalizeObjectiveFacts(knowledge?.objectiveFacts);
  return {
    inspectedLandmarkIds: [...new Set(inspectedLandmarkIds)],
    observedItemIds: [...new Set(observedItemIds)],
    craftedRecipeIds: [...new Set(craftedRecipeIds)],
    announcedRecipeIds: [...new Set(announcedRecipeIds)],
    objectiveFacts,
  };
}

function normalizedProgress(progress: ProgressState | undefined): ProgressState {
  return {
    restEverCompleted: progress?.restEverCompleted === true,
    waterEverCollected: progress?.waterEverCollected === true,
  };
}

/** Records one event into durable memory without retaining the whole event. */
export function recordProgressEvent(state: GameState, event: GameEvent): void {
  state.knowledge ??= normalizedKnowledge(undefined);
  state.progress ??= normalizedProgress(undefined);
  const entityId = event.details?.entityId;
  const itemId = event.details?.itemId;
  const secondaryItemId = event.details?.secondaryItemId;
  const recipeId = event.details?.recipeId;
  const fact = normalizeObjectiveFactReference({
    verb: event.details?.factVerb,
    subjectId: event.details?.factSubjectId,
  });
  if (fact) {
    state.knowledge.objectiveFacts = recordObjectiveFact(
      state.knowledge.objectiveFacts,
      fact,
      event.tick,
    );
  }
  if (event.type === "landmark-inspected" && typeof entityId === "string") {
    appendUnique(state.knowledge.inspectedLandmarkIds, entityId);
  }
  if (
    (event.type === "resource-picked" ||
      event.type === "harvest-struck" ||
      event.type === "wildlife-defeated" ||
      event.type === "wildlife-loot-collected" ||
      event.type === "structure-output-collected" ||
      event.type === "water-collected") &&
    validItemId(itemId)
  ) {
    appendUnique(state.knowledge.observedItemIds, itemId);
  }
  if (
    event.type === "wildlife-loot-collected" &&
    validItemId(secondaryItemId)
  ) {
    appendUnique(state.knowledge.observedItemIds, secondaryItemId);
  }
  if (event.type === "craft-succeeded" && validRecipeId(recipeId)) {
    appendUnique(state.knowledge.craftedRecipeIds, recipeId);
  }
  if (event.type === "recipe-discovered" && validRecipeId(recipeId)) {
    appendUnique(state.knowledge.announcedRecipeIds, recipeId);
  }
  if (event.type === "rest-completed") {
    state.progress.restEverCompleted = true;
  }
  if (
    event.type === "water-collected" ||
    (event.type === "structure-output-collected" && itemId === "clean-water")
  ) {
    state.progress.waterEverCollected = true;
  }
}

/**
 * Materializes durable memory and unions in every fact still recoverable from
 * a legacy save's bounded event log.
 */
export function ensureProgressMemory(state: GameState): void {
  state.knowledge = normalizedKnowledge(state.knowledge);
  state.progress = normalizedProgress(state.progress);
  for (const event of state.eventLog) recordProgressEvent(state, event);
}

function normalizePlacedStructures(state: GameState): PlacedStructureState[] {
  const kinds = new Set<PlacedStructureKind>([
    "campfire",
    "shelter",
    "bed",
    "radio-beacon",
    "smoking-rack",
    "rain-collector",
    "torch-waymark",
  ]);
  const seenIds = new Set<string>();
  const structures = (state.camp.structures ?? [])
    .filter(
      (structure) =>
        structure &&
        typeof structure.id === "string" &&
        kinds.has(structure.kind) &&
        [
          structure.position.x,
          structure.position.y,
          structure.position.z,
          structure.yaw,
          structure.builtAtTick,
        ].every(Number.isFinite),
    )
    .filter((structure) => {
      if (seenIds.has(structure.id)) return false;
      seenIds.add(structure.id);
      return true;
    })
    .map<PlacedStructureState>((structure) => {
      const process = structure.process;
      const validProcess =
        structure.kind === "smoking-rack" &&
        process?.kind === "smoking-meat" &&
        Number.isFinite(process.inputExpiresAtTick) &&
        Number.isFinite(process.progressSeconds) &&
        (process.outputExpiresAtTick === undefined ||
          Number.isFinite(process.outputExpiresAtTick)) &&
        ["processing", "ready", "spoiled"].includes(process.status);
      const rainCollectorState =
        structure.kind === "rain-collector"
          ? {
              storedUnits:
                typeof structure.storedUnits === "number" &&
                Number.isFinite(structure.storedUnits)
                  ? Math.max(
                      0,
                      Math.min(
                        RAIN_COLLECTOR_CAPACITY,
                        structure.storedUnits,
                      ),
                    )
                  : 0,
              capacity: RAIN_COLLECTOR_CAPACITY,
              lastAdvancedTick:
                typeof structure.lastAdvancedTick === "number" &&
                Number.isFinite(structure.lastAdvancedTick) &&
                structure.lastAdvancedTick >= 0
                  ? Math.min(
                      state.clock.tick,
                      Math.floor(structure.lastAdvancedTick),
                    )
                  : state.clock.tick,
            }
          : {};
      const torchWaymarkState =
        structure.kind === "torch-waymark"
          ? normalizeTorchWaymarkState(structure, state.clock.tick)
          : {};
      return {
        id: structure.id,
        kind: structure.kind,
        position: { ...structure.position },
        yaw: ((structure.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
        builtAtTick: Math.max(0, Math.floor(structure.builtAtTick)),
        ...(structure.kind === "campfire" && structure.fire
          ? { fire: normalizePlacedCampfireState(structure.fire) }
          : {}),
        ...rainCollectorState,
        ...torchWaymarkState,
        ...(validProcess
          ? {
              process: {
                kind: "smoking-meat" as const,
                inputExpiresAtTick: Math.max(
                  0,
                  Math.floor(process.inputExpiresAtTick),
                ),
                progressSeconds: Math.max(0, process.progressSeconds),
                ...(process.outputExpiresAtTick !== undefined
                  ? {
                      outputExpiresAtTick: Math.max(
                        0,
                        Math.floor(process.outputExpiresAtTick),
                      ),
                    }
                  : {}),
                status:
                  process.status === "processing" &&
                  process.inputExpiresAtTick <= state.clock.tick
                    ? ("spoiled" as const)
                    : process.status === "ready" &&
                        process.outputExpiresAtTick !== undefined &&
                        process.outputExpiresAtTick <= state.clock.tick
                      ? ("spoiled" as const)
                    : process.status,
              },
            }
          : {}),
      };
    });

  const ensureLegacy = (kind: PlacedStructureKind, built: boolean) => {
    if (!built || structures.some((structure) => structure.kind === kind)) return;
    structures.push({
      id: `structure.${kind}.legacy`,
      kind,
      position: { ...DEFAULT_STRUCTURE_PLACEMENTS[kind].position },
      yaw: DEFAULT_STRUCTURE_PLACEMENTS[kind].yaw,
      builtAtTick: 0,
      ...(kind === "campfire"
        ? { fire: normalizePlacedCampfireState(undefined, state.camp.fire) }
        : {}),
    });
  };
  ensureLegacy("campfire", state.camp.fire.built);
  ensureLegacy("shelter", state.camp.shelterBuilt);
  ensureLegacy("bed", state.camp.bedBuilt);
  ensureLegacy("radio-beacon", state.camp.beaconBuilt);
  let firstCampfire = true;
  for (const structure of structures) {
    if (structure.kind !== "campfire") continue;
    structure.fire = normalizePlacedCampfireState(
      structure.fire,
      firstCampfire ? state.camp.fire : undefined,
    );
    firstCampfire = false;
  }
  return structures;
}
