import {
  RESOURCE_REGENERATION,
  TASK_SEQUENCE,
  WORLD_ENTITY_TEMPLATES,
} from "./content";
import { createEcologyState } from "../ecology";
import {
  activeChunkCoordinates,
  chunkKey,
  generateChunkDescriptor,
  worldToChunkCoordinate,
} from "../world/generation";
import { createRngChannels, hashSeed } from "./rng";
import { ensureItemLifecycleState } from "./lifecycle";
import { ITEM_IDS } from "./types";
import type {
  GameState,
  Inventory,
  Seed,
  WorldEntity,
} from "./types";

export const SIMULATION_VERSION = 1 as const;
export const DYNAMIC_WORLD_LIMIT = 1_000_000;

function activeEcologyChunks(seed: number, x: number, z: number) {
  return activeChunkCoordinates(x, z, 1).map((coordinate) =>
    generateChunkDescriptor(String(seed), coordinate),
  );
}

export function createEmptyInventory(): Inventory {
  return Object.fromEntries(ITEM_IDS.map((itemId) => [itemId, 0])) as Inventory;
}

function createWorldEntities(): Record<string, WorldEntity> {
  return Object.fromEntries(
    WORLD_ENTITY_TEMPLATES.map((template) => {
      const entity: WorldEntity = {
        ...template,
        position: { ...template.position },
        tags: [...template.tags],
        depleted: template.depleted ?? template.quantity <= 0,
      };
      if (
        entity.kind === "resource" &&
        entity.itemId &&
        RESOURCE_REGENERATION[entity.itemId]
      ) {
        entity.regeneration = {
          capacity: Math.max(1, Math.floor(entity.quantity)),
          nextTick: null,
        };
      }
      return [entity.id, entity];
    }),
  );
}

export function createInitialState(seed: Seed = 1): GameState {
  const normalizedSeed = hashSeed(seed);
  const initialEcology = createEcologyState(normalizedSeed, {
    tick: 0,
    rainIntensity: 0.22,
    activeChunks: activeEcologyChunks(normalizedSeed, 0, -5),
  });
  return {
    version: SIMULATION_VERSION,
    seed: normalizedSeed,
    status: "playing",
    lossReason: null,
    clock: {
      tick: 0,
      elapsedSeconds: 0,
      remainderSeconds: 0,
      day: 1,
      minuteOfDay: 14 * 60,
    },
    rng: createRngChannels(seed),
    player: {
      position: { x: 0, y: 0, z: -5 },
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
      perishables: {},
      tools: {},
    },
    weather: {
      rainIntensity: 0.22,
      targetRainIntensity: 0.22,
      secondsUntilChange: 45,
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
    },
    world: {
      bounds: {
        minX: -DYNAMIC_WORLD_LIMIT,
        maxX: DYNAMIC_WORLD_LIMIT,
        minZ: -DYNAMIC_WORLD_LIMIT,
        maxZ: DYNAMIC_WORLD_LIMIT,
      },
      entities: createWorldEntities(),
      exploredChunks: [chunkKey(worldToChunkCoordinate(0, -5))],
      generatedResourceChunks: [],
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
          perishables: Object.fromEntries(
            Object.entries(state.itemLifecycle.perishables).map(
              ([itemId, batches]) => [
                itemId,
                batches?.map((batch) => ({ ...batch })),
              ],
            ),
          ),
          tools: Object.fromEntries(
            Object.entries(state.itemLifecycle.tools).map(([itemId, tools]) => [
              itemId,
              tools?.map((tool) => ({ ...tool })),
            ]),
          ),
        }
      : undefined,
    weather: { ...state.weather },
    camp: {
      ...state.camp,
      position: { ...state.camp.position },
      fire: { ...state.camp.fire },
    },
    world: {
      bounds: { ...state.world.bounds },
      exploredChunks: state.world.exploredChunks
        ? [...state.world.exploredChunks]
        : undefined,
      generatedResourceChunks: state.world.generatedResourceChunks
        ? [...state.world.generatedResourceChunks]
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
        }
      : undefined,
    objectives: {
      ...state.objectives,
      completedTaskIds: [...state.objectives.completedTaskIds],
      flags: { ...state.objectives.flags },
    },
    eventLog: state.eventLog.map((event) => ({
      ...event,
      cause: { ...event.cause },
      details: event.details ? { ...event.details } : undefined,
    })),
  };
}

/** Upgrades a legacy version-1 save without mutating the persisted payload. */
export function migrateGameState(state: GameState): GameState {
  const migrated = cloneGameState(state);
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
  return migrated;
}
