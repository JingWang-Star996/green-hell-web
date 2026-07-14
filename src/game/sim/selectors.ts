import { ITEMS, RECIPES, TASKS, TASK_SEQUENCE } from "./content";
import type {
  CraftCheck,
  GameEvent,
  GameState,
  Inventory,
  ItemId,
  RecipeId,
  TaskDefinition,
  Vec3,
  VitalsState,
  WorldEntity,
} from "./types";

export const CAMP_RADIUS = 8;

export function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

export function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.sqrt(distanceSquared(a, b));
}

export function isAtCamp(state: GameState): boolean {
  return distanceSquared(state.player.position, state.camp.position) <= CAMP_RADIUS ** 2;
}

export function getInventoryCount(state: GameState, itemId: ItemId): number {
  return state.inventory[itemId];
}

/** Landmark knowledge lives in the causal log, so old saves remain compatible. */
export function hasInspectedLandmark(state: GameState, entityId: string): boolean {
  return state.eventLog.some(
    (event) =>
      event.type === "landmark-inspected" && event.details?.entityId === entityId,
  );
}

function hasObservedItem(state: GameState, itemId: ItemId): boolean {
  if (state.inventory[itemId] > 0) return true;
  return state.eventLog.some((event) =>
    event.type === "resource-picked" && event.details?.itemId === itemId,
  );
}

function hasCrafted(state: GameState, recipeId: RecipeId): boolean {
  return state.eventLog.some((event) =>
    event.type === "craft-succeeded" && event.details?.recipeId === recipeId,
  );
}

/** Knowledge is earned from observed materials and retained in the causal log. */
export function getDiscoveredRecipeIds(state: GameState): RecipeId[] {
  const observed = (itemId: ItemId) => hasObservedItem(state, itemId);
  const hasCuttingEdge = state.inventory["stone-blade"] > 0 || hasCrafted(state, "stone-blade");
  const discovered = new Set<RecipeId>(["stone-blade"]);

  if (observed("medicinal-leaf") && observed("vine")) discovered.add("bandage");
  if (observed("coconut")) discovered.add("coconut-shell");
  if (observed("stick") && observed("dry-leaf")) discovered.add("campfire");
  if (observed("stick") && observed("vine") && observed("broad-leaf")) discovered.add("shelter");
  if (state.camp.shelterBuilt) discovered.add("bed");
  if (hasCuttingEdge && observed("stick") && observed("vine")) {
    discovered.add("axe");
    discovered.add("spear");
  }
  if (observed("battery")) discovered.add("radio-beacon");

  return (Object.keys(RECIPES) as RecipeId[]).filter((recipeId) => discovered.has(recipeId));
}

export function getCurrentTask(state: GameState): TaskDefinition | null {
  return state.objectives.currentTaskId
    ? TASKS[state.objectives.currentTaskId]
    : null;
}

function alreadyBuilt(state: GameState, recipeId: RecipeId): boolean {
  switch (recipeId) {
    case "campfire":
      return state.camp.fire.built;
    case "shelter":
      return state.camp.shelterBuilt;
    case "bed":
      return state.camp.bedBuilt;
    case "radio-beacon":
      return state.camp.beaconBuilt;
    default:
      return false;
  }
}

export function canCraft(state: GameState, recipeId: RecipeId): CraftCheck {
  const recipe = RECIPES[recipeId];
  if (!recipe) {
    return {
      ok: false,
      missingItems: {},
      missingTools: [],
      reason: "unknown-recipe",
    };
  }

  const missingItems: Partial<Record<ItemId, number>> = {};
  for (const [itemId, required] of Object.entries(recipe.ingredients) as [
    ItemId,
    number,
  ][]) {
    const deficit = required - state.inventory[itemId];
    if (deficit > 0) missingItems[itemId] = deficit;
  }

  const missingTools = (recipe.tools ?? []).filter(
    (itemId) => state.inventory[itemId] <= 0,
  );

  let reason: CraftCheck["reason"];
  if (recipe.requiresCamp && !isAtCamp(state)) reason = "not-at-camp";
  if (alreadyBuilt(state, recipeId)) reason = "already-built";
  for (const [itemId, produced] of Object.entries(recipe.results ?? {}) as [
    ItemId,
    number,
  ][]) {
    if (state.inventory[itemId] + produced > ITEMS[itemId].stackLimit) {
      reason = "inventory-full";
    }
  }

  return {
    ok:
      Object.keys(missingItems).length === 0 &&
      missingTools.length === 0 &&
      reason === undefined,
    missingItems,
    missingTools,
    reason,
  };
}

export function getNearbyEntities(
  state: GameState,
  radius = 4,
): WorldEntity[] {
  const radiusSquared = radius * radius;
  return Object.values(state.world.entities)
    .filter(
      (entity) =>
        !entity.depleted &&
        distanceSquared(entity.position, state.player.position) <= radiusSquared,
    )
    .sort((left, right) => {
      const distanceDelta =
        distanceSquared(left.position, state.player.position) -
        distanceSquared(right.position, state.player.position);
      return distanceDelta || left.id.localeCompare(right.id);
    });
}

export function getObjectiveProgress(state: GameState): number {
  return state.objectives.completedTaskIds.length / TASK_SEQUENCE.length;
}

export function getTimeOfDayHours(state: GameState): number {
  const START_HOUR = 14;
  const DAY_LENGTH_SECONDS = 20 * 60;
  return (START_HOUR + (state.clock.elapsedSeconds / DAY_LENGTH_SECONDS) * 24) % 24;
}

export function getConditionSummary(state: GameState): string[] {
  const messages: string[] = [];
  const { conditions, nutrition, vitals } = state.player;
  if (conditions.wound.open) messages.push("开放伤口");
  if (conditions.wound.infection >= 25) messages.push("伤口感染");
  if (conditions.parasites > 0) messages.push(`寄生虫 ×${conditions.parasites}`);
  if (conditions.wetness >= 70) messages.push("全身湿透");
  if (nutrition.hydration <= 25) messages.push("严重缺水");
  if (vitals.energy <= 20) messages.push("精疲力竭");
  if (vitals.sanity <= 30) messages.push("理智动摇");
  if (messages.length === 0) messages.push("状态稳定");
  return messages;
}

export function getSurvivalScore(state: GameState): number {
  const completed = state.objectives.completedTaskIds.length * 500;
  const vitalScore = Object.values(state.player.vitals).reduce(
    (total, value) => total + value,
    0,
  );
  const nutritionScore = Object.values(state.player.nutrition).reduce(
    (total, value) => total + value,
    0,
  );
  const inventoryScore = Object.entries(state.inventory).reduce(
    (total, [itemId, count]) =>
      total + Math.min(count, ITEMS[itemId as ItemId].stackLimit) * 2,
    0,
  );
  const winBonus = state.status === "won" ? 2_000 : 0;
  const timePenalty = Math.floor(state.clock.elapsedSeconds / 10);
  return Math.max(
    0,
    Math.round(completed + vitalScore + nutritionScore + inventoryScore + winBonus - timePenalty),
  );
}

export interface SimulationViewEntity {
  id: string;
  kind: WorldEntity["kind"];
  label: string;
  x: number;
  y: number;
  z: number;
  available: boolean;
  quantity: number;
  itemId?: ItemId;
  renewable: boolean;
  capacity: number;
  nextRegenerationTick: number | null;
}

export interface SimulationView {
  status: GameState["status"];
  player: Vec3;
  clock: {
    tick: number;
    elapsedSeconds: number;
    day: number;
    minuteOfDay: number;
  };
  weather: {
    rain: number;
    storm: boolean;
  };
  structures: {
    fire: {
      built: boolean;
      lit: boolean;
      fuelSeconds: number;
      sheltered: boolean;
    };
    shelter: boolean;
    bed: boolean;
    beacon: boolean;
  };
  worldEntities: SimulationViewEntity[];
  inventory: Inventory;
  vitals: VitalsState & GameState["player"]["nutrition"];
  objectives: {
    currentTaskId: GameState["objectives"]["currentTaskId"];
    completedTaskIds: GameState["objectives"]["completedTaskIds"];
    flags: GameState["objectives"]["flags"];
  };
  events: GameEvent[];
}

/** Read-only-shaped projection consumed by the React HUD and Three renderer. */
export function selectGameView(state: GameState): SimulationView {
  return {
    status: state.status,
    player: { ...state.player.position },
    clock: {
      tick: state.clock.tick,
      elapsedSeconds: state.clock.elapsedSeconds,
      day: state.clock.day,
      minuteOfDay: state.clock.minuteOfDay,
    },
    weather: {
      rain: state.weather.rainIntensity,
      storm: state.weather.storm,
    },
    structures: {
      fire: {
        built: state.camp.fire.built,
        lit: state.camp.fire.lit,
        fuelSeconds: state.camp.fire.fuelSeconds,
        sheltered: state.camp.fire.sheltered,
      },
      shelter: state.camp.shelterBuilt,
      bed: state.camp.bedBuilt,
      beacon: state.camp.beaconBuilt,
    },
    worldEntities: Object.values(state.world.entities)
      .map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        label: entity.label,
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
        available: !entity.depleted && entity.quantity > 0,
        quantity: entity.quantity,
        itemId: entity.itemId,
        renewable: Boolean(entity.regeneration),
        capacity: entity.regeneration?.capacity ?? entity.quantity,
        nextRegenerationTick: entity.regeneration?.nextTick ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    inventory: { ...state.inventory },
    vitals: {
      ...state.player.vitals,
      ...state.player.nutrition,
    },
    objectives: {
      currentTaskId: state.objectives.currentTaskId,
      completedTaskIds: [...state.objectives.completedTaskIds],
      flags: { ...state.objectives.flags },
    },
    events: state.eventLog.map((event) => ({
      ...event,
      cause: { ...event.cause },
      details: event.details ? { ...event.details } : undefined,
    })),
  };
}
