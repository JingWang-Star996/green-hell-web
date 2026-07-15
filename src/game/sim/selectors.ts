import { ITEMS, RECIPES, TASKS, TASK_SEQUENCE } from "./content";
import {
  getDurableToolInventoryStatus,
  getPerishableInventoryStatus,
} from "./lifecycle";
import {
  resolveStructureTransform,
  structureTransformFromSource,
  DEFAULT_STRUCTURE_PLACEMENTS,
  SHELTER_COVERAGE_RADIUS,
  STRUCTURE_USE_RADII,
  isWithinStructureRadius,
  type StructureTransform2D,
} from "./structureGeometry";
import { DURABLE_TOOL_IDS, PERISHABLE_ITEM_IDS } from "./types";
import {
  resolveCampfireIgnitionAtPoint,
  resolvePotentialCampfireIgnition,
} from "./campfireIgnitionRules";
import { nearestLitCampfire } from "./campStructures";
import type {
  CraftCheck,
  GameEvent,
  GameState,
  Inventory,
  ItemId,
  PlacedStructureKind,
  RecipeId,
  StructurePlacement,
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

function structureIsBuilt(
  state: GameState,
  kind: PlacedStructureKind,
): boolean {
  if (kind === "campfire") return state.camp.fire.built;
  if (kind === "shelter") return state.camp.shelterBuilt;
  if (kind === "bed") return state.camp.bedBuilt;
  if (kind === "radio-beacon") return state.camp.beaconBuilt;
  return Boolean(state.camp.structures?.some((structure) => structure.kind === kind));
}

export function getCampStructureTransforms(
  state: GameState,
  kind: PlacedStructureKind,
): StructureTransform2D[] {
  const explicit = (state.camp.structures ?? [])
    .filter((structure) => structure.kind === kind)
    .map(structureTransformFromSource)
    .filter((structure): structure is StructureTransform2D => structure !== null);
  if (
    explicit.length > 0 ||
    kind === "smoking-rack" ||
    kind === "rain-collector"
  ) {
    return explicit;
  }
  const fallback = resolveStructureTransform(kind, undefined, structureIsBuilt(state, kind));
  return fallback ? [fallback] : [];
}

export function getCampStructureById(
  state: GameState,
  structureId: string,
): NonNullable<GameState["camp"]["structures"]>[number] | null {
  return state.camp.structures?.find((structure) => structure.id === structureId) ?? null;
}

export function getCampStructureTransform(
  state: GameState,
  kind: PlacedStructureKind,
): StructureTransform2D | null {
  return getNearestCampStructureTransform(state, kind);
}

export function getNearestCampStructureTransform(
  state: GameState,
  kind: PlacedStructureKind,
  point: Pick<Vec3, "x" | "z"> = state.player.position,
): StructureTransform2D | null {
  return getCampStructureTransforms(state, kind)
    .sort(
      (left, right) =>
        Math.hypot(left.x - point.x, left.z - point.z) -
          Math.hypot(right.x - point.x, right.z - point.z) ||
        left.id.localeCompare(right.id),
    )[0] ?? null;
}

export function isNearCampStructure(
  state: GameState,
  kind: PlacedStructureKind,
  radius = STRUCTURE_USE_RADII[kind],
): boolean {
  return getCampStructureTransforms(state, kind).some((structure) =>
    isWithinStructureRadius(state.player.position, structure, radius),
  );
}

export function getNearestLitCampfireTransform(
  state: GameState,
  point: Pick<Vec3, "x" | "z"> = state.player.position,
  maximumDistance = Number.POSITIVE_INFINITY,
): StructureTransform2D | null {
  const explicit = nearestLitCampfire(state, point, maximumDistance);
  if (explicit) return structureTransformFromSource(explicit);
  // Once placement records exist they are the only spatial truth. Falling
  // back to the legacy camp-centre facade here would create an invisible
  // second fire whenever the real fire is outside `maximumDistance`.
  if (
    (state.camp.structures ?? []).some(
      (structure) => structure.kind === "campfire",
    )
  ) {
    return null;
  }
  if (!state.camp.fire.built || !state.camp.fire.lit) return null;
  const fallback = resolveStructureTransform("campfire", undefined, true);
  return fallback &&
    Math.hypot(fallback.x - point.x, fallback.z - point.z) <= maximumDistance
    ? fallback
    : null;
}

export function isNearLitCampfire(
  state: GameState,
  radius = STRUCTURE_USE_RADII.campfire,
): boolean {
  return getNearestLitCampfireTransform(state, state.player.position, radius) !== null;
}

export function isShelteredByCampStructures(state: GameState): boolean {
  return getCampStructureTransforms(state, "shelter").some((shelter) =>
    isWithinStructureRadius(
      state.player.position,
      shelter,
      SHELTER_COVERAGE_RADIUS,
    ),
  );
}

export function isPointShelteredByCampStructures(
  state: GameState,
  point: Pick<Vec3, "x" | "z">,
): boolean {
  return getCampStructureTransforms(state, "shelter").some((shelter) =>
    isWithinStructureRadius(point, shelter, SHELTER_COVERAGE_RADIUS),
  );
}

export function getInventoryCount(state: GameState, itemId: ItemId): number {
  return state.inventory[itemId];
}

/** Coconut shells are physical containers; water entries represent occupied shells. */
export function getAvailableWaterContainerCount(state: GameState): number {
  return Math.max(
    0,
    state.inventory["coconut-shell"] -
      state.inventory["dirty-water"] -
      state.inventory["clean-water"],
  );
}

/** Durable knowledge is primary; the log fallback keeps unmigrated saves readable. */
export function hasInspectedLandmark(state: GameState, entityId: string): boolean {
  return Boolean(state.knowledge?.inspectedLandmarkIds.includes(entityId)) || state.eventLog.some(
    (event) =>
      event.type === "landmark-inspected" && event.details?.entityId === entityId,
  );
}

function hasObservedItem(state: GameState, itemId: ItemId): boolean {
  if (state.inventory[itemId] > 0) return true;
  return Boolean(state.knowledge?.observedItemIds.includes(itemId)) || state.eventLog.some((event) =>
    (event.type === "resource-picked" || event.type === "harvest-struck") &&
    event.details?.itemId === itemId,
  );
}

function hasCrafted(state: GameState, recipeId: RecipeId): boolean {
  return Boolean(state.knowledge?.craftedRecipeIds.includes(recipeId)) || state.eventLog.some((event) =>
    event.type === "craft-succeeded" && event.details?.recipeId === recipeId,
  );
}

export function hasCompletedRest(state: GameState): boolean {
  return state.progress?.restEverCompleted === true || state.eventLog.some(
    (event) => event.type === "rest-completed",
  );
}

export function hasCollectedWater(state: GameState): boolean {
  return state.progress?.waterEverCollected === true || state.eventLog.some(
    (event) => event.type === "water-collected",
  );
}

/** Knowledge is earned from observed materials and retained beyond the causal log. */
export function getDiscoveredRecipeIds(state: GameState): RecipeId[] {
  const observed = (itemId: ItemId) => hasObservedItem(state, itemId);
  const hasCuttingEdge = state.inventory["stone-blade"] > 0 || hasCrafted(state, "stone-blade");
  const discovered = new Set<RecipeId>(["stone-blade"]);

  if (observed("medicinal-leaf") && observed("vine")) discovered.add("bandage");
  if (observed("coconut")) discovered.add("coconut-shell");
  if (observed("stick") && observed("dry-leaf")) discovered.add("campfire");
  if (observed("stick") && observed("dry-leaf") && observed("vine")) {
    discovered.add("torch");
  }
  if (observed("stick") && observed("vine") && observed("broad-leaf")) discovered.add("shelter");
  if (getCampStructureTransforms(state, "shelter").length > 0) discovered.add("bed");
  if (hasCuttingEdge && observed("stick") && observed("vine")) {
    discovered.add("axe");
    discovered.add("spear");
    if (observed("stone")) discovered.add("stone-pick");
  }
  if (observed("battery")) discovered.add("radio-beacon");
  if (observed("raw-meat")) discovered.add("cooked-meat");
  if (observed("raw-meat") && observed("stick") && observed("vine")) {
    discovered.add("smoking-rack");
  }
  if (
    hasCrafted(state, "coconut-shell") &&
    hasCollectedWater(state) &&
    observed("stick") &&
    observed("vine") &&
    observed("broad-leaf")
  ) {
    discovered.add("rain-collector");
  }
  if (hasCrafted(state, "torch") && observed("stone") && observed("vine")) {
    discovered.add("torch-waymark");
  }
  if (observed("log")) discovered.add("split-log");
  const currentTask = state.objectives.currentTaskId
    ? TASKS[state.objectives.currentTaskId]
    : null;
  for (const recipeId of currentTask?.supportRecipeIds ?? []) {
    discovered.add(recipeId);
  }

  return (Object.keys(RECIPES) as RecipeId[]).filter((recipeId) => discovered.has(recipeId));
}

export function getCurrentTask(state: GameState): TaskDefinition | null {
  return state.objectives.currentTaskId
    ? TASKS[state.objectives.currentTaskId]
    : null;
}

function alreadyBuilt(state: GameState, recipeId: RecipeId): boolean {
  return recipeId === "radio-beacon" && state.camp.beaconBuilt;
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
  if (
    recipe.requiresLitFire &&
    !isNearLitCampfire(state)
  ) {
    reason = "fire-not-lit";
  }
  if (
    recipeId === "campfire" ||
    recipeId === "torch-waymark"
  ) {
    const ignition = resolvePotentialCampfireIgnition(state);
    if (!ignition.canIgnite) reason = ignition.blocker ?? undefined;
  }
  if (alreadyBuilt(state, recipeId)) reason = "already-built";
  if (
    recipeId === "rain-collector" &&
    getAvailableWaterContainerCount(state) < 2
  ) {
    missingItems["coconut-shell"] =
      2 - getAvailableWaterContainerCount(state);
    reason = "missing-empty-containers";
  }
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

export function canCraftAtPlacement(
  state: GameState,
  recipeId: RecipeId,
  placement: StructurePlacement | undefined,
): CraftCheck {
  const check = canCraft(state, recipeId);
  if (
    (recipeId !== "campfire" && recipeId !== "torch-waymark") ||
    check.reason === "already-built"
  ) {
    return check;
  }
  const position =
    placement?.position ?? DEFAULT_STRUCTURE_PLACEMENTS[
      recipeId === "campfire" ? "campfire" : "torch-waymark"
    ].position;
  const ignition = resolveCampfireIgnitionAtPoint(state, position);
  const reason = ignition.canIgnite
    ? check.reason === "rain-exposed"
      ? undefined
      : check.reason
    : ignition.blocker ?? undefined;
  return {
    ...check,
    ok:
      Object.keys(check.missingItems).length === 0 &&
      check.missingTools.length === 0 &&
      reason === undefined,
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
  return (((state.clock.minuteOfDay / 60) % 24) + 24) % 24;
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

export interface SimulationPerishableView {
  itemId: (typeof PERISHABLE_ITEM_IDS)[number];
  quantity: number;
  nextExpiryTick: number | null;
  secondsUntilNextSpoilage: number | null;
  shelfLifeSeconds: number;
}

export interface SimulationDurableToolView {
  itemId: (typeof DURABLE_TOOL_IDS)[number];
  quantity: number;
  durabilities: number[];
  activeDurability: number;
  maxDurability: number;
}

export interface SimulationView {
  status: GameState["status"];
  player: Vec3;
  equippedItem: GameState["player"]["equippedItem"];
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
    placed: NonNullable<GameState["camp"]["structures"]>;
  };
  worldEntities: SimulationViewEntity[];
  inventory: Inventory;
  inventoryLifecycle: {
    perishables: SimulationPerishableView[];
    tools: SimulationDurableToolView[];
  };
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
    equippedItem: state.player.equippedItem ?? null,
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
      placed: (state.camp.structures ?? []).map((structure) => ({
        ...structure,
        position: { ...structure.position },
      })),
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
    inventoryLifecycle: {
      perishables: PERISHABLE_ITEM_IDS.map((itemId) => ({
        ...getPerishableInventoryStatus(state, itemId),
      })),
      tools: DURABLE_TOOL_IDS.map((itemId) => ({
        ...getDurableToolInventoryStatus(state, itemId),
      })),
    },
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
