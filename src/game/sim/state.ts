import { TASK_SEQUENCE, WORLD_ENTITY_TEMPLATES } from "./content";
import { createRngChannels, hashSeed } from "./rng";
import { ITEM_IDS } from "./types";
import type {
  GameState,
  Inventory,
  Seed,
  WorldEntity,
} from "./types";

export const SIMULATION_VERSION = 1 as const;

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
      return [entity.id, entity];
    }),
  );
}

export function createInitialState(seed: Seed = 1): GameState {
  const normalizedSeed = hashSeed(seed);
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
      bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
      entities: createWorldEntities(),
    },
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
    weather: { ...state.weather },
    camp: {
      ...state.camp,
      position: { ...state.camp.position },
      fire: { ...state.camp.fire },
    },
    world: {
      bounds: { ...state.world.bounds },
      entities: Object.fromEntries(
        Object.entries(state.world.entities).map(([id, entity]) => [
          id,
          {
            ...entity,
            position: { ...entity.position },
            tags: [...entity.tags],
          },
        ]),
      ),
    },
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
