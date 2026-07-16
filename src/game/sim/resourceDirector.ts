import { RECIPES, RESOURCE_REGENERATION } from "./content";
import { hashSeed, nextRandom } from "./rng";
import { gameHoursToTicks } from "./time";
import type {
  GameState,
  ItemId,
  RecipeId,
  ResourceDirectorState,
  ResourceRegenerationState,
  WorldEntity,
  WorldEntityDelta,
} from "./types";
import {
  generateChunkDescriptor,
  worldToChunkCoordinate,
  type BiomeId,
  type ChunkCoordinate,
} from "../world/generation";
import { createGeneratedChunkEntities } from "../world/saveDelta";
import {
  RIVER_SURFACE_HALF_WIDTH,
  riverDistance,
} from "../world/terrain";

export const RESOURCE_DIRECTOR_EPOCH_TICKS = gameHoursToTicks(0.5);
export const RESOURCE_DIRECTOR_ACTIVE_MINIMUM_DISTANCE = 48;
export const RESOURCE_DIRECTOR_LOCAL_SUPPLY_RADIUS = 72;
export const RESOURCE_DIRECTOR_MAX_CATCH_UP_EPOCHS = 48;

type CandidateSource = "unloaded" | "active";

interface DirectorCandidate {
  entityId: string;
  itemId: ItemId;
  source: CandidateSource;
  entity: WorldEntity;
  regeneration: ResourceRegenerationState;
  commit: (entity: WorldEntity) => void;
}

interface ScoredCandidate extends DirectorCandidate {
  habitat: number;
  need: number;
  overdue: number;
  jitter: number;
  pressure: number;
  score: number;
}

export interface ResourceDirectorDecision {
  epoch: number;
  entityId: string;
  itemId: ItemId;
  source: CandidateSource;
}

const TASK_RECIPE_PLANS: Readonly<
  Record<NonNullable<GameState["objectives"]["currentTaskId"]>, readonly RecipeId[]>
> = {
  "treat-wound": ["bandage"],
  "purify-water": ["stone-blade", "coconut-shell", "campfire"],
  "establish-camp": ["stone-blade", "axe", "campfire", "shelter", "bed"],
  "recover-battery": [],
  "transmit-signal": ["stone-blade", "radio-beacon"],
  "river-rising": ["torch", "spear", "bandage", "torch-waymark"],
  "canopy-wind": [
    "axe",
    "stone-blade",
    "bandage",
    "torch",
    "shelter",
    "rain-collector",
    "smoking-rack",
  ],
};

const BIOME_ITEM_SUITABILITY: Readonly<
  Partial<Record<ItemId, Readonly<Record<BiomeId, number>>>>
> = {
  stone: {
    "evergreen-rainforest": 0.25,
    "river-wetland": 0.82,
    "palm-grove": 0.45,
    swamp: 0.22,
    "rocky-highland": 1,
  },
  stick: {
    "evergreen-rainforest": 1,
    "river-wetland": 0.78,
    "palm-grove": 0.75,
    swamp: 0.7,
    "rocky-highland": 0.45,
  },
  vine: {
    "evergreen-rainforest": 1,
    "river-wetland": 0.9,
    "palm-grove": 0.64,
    swamp: 0.88,
    "rocky-highland": 0.18,
  },
  "broad-leaf": {
    "evergreen-rainforest": 0.9,
    "river-wetland": 1,
    "palm-grove": 0.86,
    swamp: 0.78,
    "rocky-highland": 0.15,
  },
  "medicinal-leaf": {
    "evergreen-rainforest": 1,
    "river-wetland": 0.9,
    "palm-grove": 0.48,
    swamp: 0.76,
    "rocky-highland": 0.22,
  },
  "dry-leaf": {
    "evergreen-rainforest": 0.62,
    "river-wetland": 0.28,
    "palm-grove": 1,
    swamp: 0.18,
    "rocky-highland": 0.9,
  },
  coconut: {
    "evergreen-rainforest": 0.38,
    "river-wetland": 0.64,
    "palm-grove": 1,
    swamp: 0.22,
    "rocky-highland": 0.08,
  },
  "antiparasitic-herb": {
    "evergreen-rainforest": 0.58,
    "river-wetland": 0.86,
    "palm-grove": 0.2,
    swamp: 1,
    "rocky-highland": 0.08,
  },
  "palm-fruit": {
    "evergreen-rainforest": 0.45,
    "river-wetland": 0.58,
    "palm-grove": 1,
    swamp: 0.18,
    "rocky-highland": 0.08,
  },
  "brazil-nuts": {
    "evergreen-rainforest": 0.82,
    "river-wetland": 0.52,
    "palm-grove": 1,
    swamp: 0.14,
    "rocky-highland": 0.16,
  },
  grubs: {
    "evergreen-rainforest": 0.9,
    "river-wetland": 0.92,
    "palm-grove": 0.7,
    swamp: 1,
    "rocky-highland": 0.18,
  },
};

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function resourceDirectorEpochForTick(tick: number): number {
  if (!Number.isFinite(tick) || tick <= 0) return 0;
  return Math.floor(tick / RESOURCE_DIRECTOR_EPOCH_TICKS);
}

export function normalizeResourceDirectorState(
  state: GameState,
): ResourceDirectorState {
  const currentEpoch = resourceDirectorEpochForTick(state.clock.tick);
  const savedEpoch = state.resourceDirector?.evaluatedThroughEpoch;
  const evaluatedThroughEpoch =
    state.resourceDirector?.version === 1 &&
    typeof savedEpoch === "number" &&
    Number.isSafeInteger(savedEpoch) &&
    savedEpoch >= 0
      ? Math.min(savedEpoch, currentEpoch)
      : currentEpoch;
  state.resourceDirector = {
    version: 1,
    evaluatedThroughEpoch,
  };
  return state.resourceDirector;
}

export function deterministicRegenerationRoll(
  state: Pick<GameState, "seed">,
  entity: WorldEntity,
  cycle: number,
): { intervalTicks: number; amount: number } {
  const definition = entity.itemId
    ? RESOURCE_REGENERATION[entity.itemId]
    : undefined;
  if (!definition) return { intervalTicks: 1, amount: 1 };

  const [intervalRoll] = nextRandom(
    hashSeed(`${state.seed}:${entity.id}:${cycle}:regeneration-interval`),
  );
  const [amountRoll] = nextRandom(
    hashSeed(`${state.seed}:${entity.id}:${cycle}:regeneration-amount`),
  );
  const minimumHours = Math.max(0, definition.minimumIntervalGameHours);
  const maximumHours = Math.max(
    minimumHours,
    definition.maximumIntervalGameHours,
  );
  const intervalHours =
    minimumHours + (maximumHours - minimumHours) * intervalRoll;
  const minimumAmount = Math.max(1, Math.floor(definition.minimumAmount));
  const maximumAmount = Math.max(
    minimumAmount,
    Math.floor(definition.maximumAmount),
  );
  return {
    intervalTicks: Math.max(1, gameHoursToTicks(intervalHours)),
    amount:
      minimumAmount +
      Math.floor(amountRoll * (maximumAmount - minimumAmount + 1)),
  };
}

export function setResourceRegenerationSchedule(
  state: Pick<GameState, "seed">,
  entity: WorldEntity,
  baseTick: number,
): void {
  const regeneration = entity.regeneration;
  if (!regeneration) return;
  const cycle = Math.max(0, Math.floor(regeneration.cycle ?? 0));
  const roll = deterministicRegenerationRoll(state, entity, cycle);
  regeneration.cycle = cycle;
  regeneration.nextTick = baseTick + roll.intervalTicks;
  regeneration.nextAmount = roll.amount;
}

function recipeIsSatisfied(state: GameState, recipeId: RecipeId): boolean {
  const recipe = RECIPES[recipeId];
  switch (recipe.effect) {
    case "build-fire":
      return state.camp.fire.built;
    case "build-shelter":
      return state.camp.shelterBuilt;
    case "build-bed":
      return state.camp.bedBuilt;
    case "build-beacon":
      return state.camp.beaconBuilt;
    case "build-smoking-rack":
      return Boolean(
        state.camp.structures?.some((structure) => structure.kind === "smoking-rack"),
      );
    case "build-rain-collector":
      return Boolean(
        state.camp.structures?.some((structure) => structure.kind === "rain-collector"),
      );
    case "build-torch-waymark":
      return Boolean(
        state.camp.structures?.some((structure) => structure.kind === "torch-waymark"),
      );
    default:
      return Object.entries(recipe.results ?? {}).some(
        ([itemId, quantity]) =>
          state.inventory[itemId as ItemId] >= Math.max(1, quantity ?? 1),
      );
  }
}

function accumulateRecipeBill(
  state: GameState,
  recipeId: RecipeId,
  totals: Partial<Record<ItemId, number>>,
  visited: Set<RecipeId>,
): void {
  if (visited.has(recipeId) || recipeIsSatisfied(state, recipeId)) return;
  visited.add(recipeId);
  const recipe = RECIPES[recipeId];
  for (const toolId of recipe.tools ?? []) {
    if (state.inventory[toolId] > 0) continue;
    const toolRecipe = Object.values(RECIPES).find(
      (candidate) => (candidate.results?.[toolId] ?? 0) > 0,
    );
    if (toolRecipe) accumulateRecipeBill(state, toolRecipe.id, totals, visited);
  }
  for (const [itemId, quantity] of Object.entries(recipe.ingredients)) {
    const typedItemId = itemId as ItemId;
    totals[typedItemId] = (totals[typedItemId] ?? 0) + Math.max(0, quantity ?? 0);
  }
}

function ownsToolFor(entity: WorldEntity, state: GameState): boolean {
  const toolClass = entity.semantic?.toolClass;
  if (!toolClass || toolClass === "hand") return true;
  if (toolClass === "blade") return state.inventory["stone-blade"] > 0;
  if (toolClass === "axe") return state.inventory.axe > 0;
  return state.inventory["stone-pick"] > 0;
}

function isForbiddenResource(entity: WorldEntity): boolean {
  return (
    entity.kind !== "resource" ||
    !entity.itemId ||
    entity.tags.includes("nonrenewable") ||
    entity.tags.includes("standing-tree") ||
    entity.tags.includes("tree") ||
    entity.tags.includes("rare") ||
    entity.tags.includes("objective") ||
    entity.tags.includes("mineable-rock") ||
    entity.semantic?.category === "tree" ||
    entity.semantic?.category === "mineable-rock"
  );
}

export function evaluateResourceNeeds(
  state: GameState,
): Partial<Record<ItemId, number>> {
  const taskId = state.objectives.currentTaskId;
  if (!taskId) return {};
  const bill: Partial<Record<ItemId, number>> = {};
  const visited = new Set<RecipeId>();
  for (const recipeId of TASK_RECIPE_PLANS[taskId]) {
    accumulateRecipeBill(state, recipeId, bill, visited);
  }

  const localSupply: Partial<Record<ItemId, number>> = {};
  for (const entity of Object.values(state.world.entities)) {
    if (
      entity.kind !== "resource" ||
      !entity.itemId ||
      entity.quantity <= 0 ||
      entity.depleted ||
      !ownsToolFor(entity, state)
    ) {
      continue;
    }
    const distance = Math.hypot(
      entity.position.x - state.player.position.x,
      entity.position.z - state.player.position.z,
    );
    if (distance > RESOURCE_DIRECTOR_LOCAL_SUPPLY_RADIUS) continue;
    localSupply[entity.itemId] =
      (localSupply[entity.itemId] ?? 0) + entity.quantity;
  }

  return Object.fromEntries(
    Object.entries(bill).map(([itemId, target]) => {
      const typedItemId = itemId as ItemId;
      const safeTarget = Math.max(1, target ?? 0);
      const available =
        state.inventory[typedItemId] + (localSupply[typedItemId] ?? 0);
      return [typedItemId, clamp((safeTarget - available) / safeTarget)];
    }),
  );
}

function parseChunkCoordinate(value: string): ChunkCoordinate | null {
  const match = /^(-?\d+):(-?\d+)$/.exec(value);
  if (!match) return null;
  const x = Number(match[1]);
  const z = Number(match[2]);
  return Number.isSafeInteger(x) && Number.isSafeInteger(z) ? { x, z } : null;
}

function cloneCandidateEntity(
  baseline: WorldEntity,
  delta: WorldEntityDelta,
): WorldEntity {
  return {
    ...baseline,
    position: { ...baseline.position },
    tags: [...baseline.tags],
    quantity: delta.quantity,
    depleted: delta.quantity <= 0,
    ...(baseline.semantic ? { semantic: { ...baseline.semantic } } : {}),
    ...(delta.regeneration
      ? { regeneration: { ...delta.regeneration } }
      : {}),
    ...(delta.treeHarvest ? { treeHarvest: { ...delta.treeHarvest } } : {}),
  };
}

function activeCandidateIsHidden(state: GameState, entity: WorldEntity): boolean {
  const offsetX = entity.position.x - state.player.position.x;
  const offsetZ = entity.position.z - state.player.position.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance < RESOURCE_DIRECTOR_ACTIVE_MINIMUM_DISTANCE) return false;
  const yaw = Number.isFinite(state.player.lookYaw)
    ? state.player.lookYaw!
    : Math.PI;
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  return (offsetX * forwardX + offsetZ * forwardZ) / distance < 0;
}

function collectCandidates(state: GameState, epochTick: number): DirectorCandidate[] {
  const candidates: DirectorCandidate[] = [];
  const activeIds = new Set<string>();
  for (const [entityId, entity] of Object.entries(state.world.entities).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    activeIds.add(entityId);
    const regeneration = entity.regeneration;
    if (
      isForbiddenResource(entity) ||
      !entity.itemId ||
      !RESOURCE_REGENERATION[entity.itemId] ||
      !regeneration ||
      regeneration.nextTick === null ||
      regeneration.nextTick > epochTick ||
      entity.quantity >= regeneration.capacity ||
      !activeCandidateIsHidden(state, entity)
    ) {
      continue;
    }
    candidates.push({
      entityId,
      itemId: entity.itemId,
      source: "active",
      entity,
      regeneration,
      commit: () => undefined,
    });
  }

  const activeChunks = new Set(state.world.generatedResourceChunks ?? []);
  const chunkCache = new Map<string, Record<string, WorldEntity>>();
  for (const [entityId, delta] of Object.entries(
    state.world.entityDeltas ?? {},
  ).sort(([left], [right]) => left.localeCompare(right))) {
    if (
      activeIds.has(entityId) ||
      !delta.chunk ||
      activeChunks.has(delta.chunk) ||
      !delta.regeneration ||
      delta.regeneration.nextTick === null ||
      delta.regeneration.nextTick > epochTick ||
      delta.quantity >= delta.regeneration.capacity
    ) {
      continue;
    }
    const coordinate = parseChunkCoordinate(delta.chunk);
    if (!coordinate) continue;
    let baselines = chunkCache.get(delta.chunk);
    if (!baselines) {
      baselines = createGeneratedChunkEntities(state.seed, coordinate);
      chunkCache.set(delta.chunk, baselines);
    }
    const baseline = baselines[entityId];
    if (!baseline) continue;
    const entity = cloneCandidateEntity(baseline, delta);
    if (
      isForbiddenResource(entity) ||
      !entity.itemId ||
      !RESOURCE_REGENERATION[entity.itemId]
    ) {
      continue;
    }
    candidates.push({
      entityId,
      itemId: entity.itemId,
      source: "unloaded",
      entity,
      regeneration: entity.regeneration!,
      commit: (settled) => {
        delta.quantity = settled.quantity;
        delta.regeneration = settled.regeneration
          ? { ...settled.regeneration }
          : undefined;
      },
    });
  }
  return candidates;
}

function habitatSuitability(state: GameState, candidate: DirectorCandidate): number {
  const { entity, itemId } = candidate;
  const bankDistance = riverDistance(entity.position.x, entity.position.z);
  const onRiverBank =
    entity.tags.includes("river-bank") ||
    (bankDistance > RIVER_SURFACE_HALF_WIDTH && bankDistance <= 4.8);
  if (onRiverBank) {
    if (itemId === "stone") return 1;
    if (itemId === "vine" || itemId === "broad-leaf") return 0.92;
    if (itemId === "stick") return 0.82;
  }
  const descriptor = generateChunkDescriptor(
    String(state.seed),
    worldToChunkCoordinate(entity.position.x, entity.position.z),
  );
  return BIOME_ITEM_SUITABILITY[itemId]?.[descriptor.biome] ?? 0.5;
}

function deterministicJitter(
  state: GameState,
  candidate: DirectorCandidate,
  epoch: number,
): number {
  const [roll] = nextRandom(
    hashSeed(
      `${state.seed}:${epoch}:${candidate.entityId}:${candidate.regeneration.cycle ?? 0}:resource-director`,
    ),
  );
  return roll;
}

function scoreCandidates(
  state: GameState,
  candidates: readonly DirectorCandidate[],
  needs: Partial<Record<ItemId, number>>,
  epoch: number,
  epochTick: number,
): ScoredCandidate[] {
  return candidates
    .map((candidate) => {
      const habitat = habitatSuitability(state, candidate);
      const need = clamp(needs[candidate.itemId] ?? 0);
      const nextTick = candidate.regeneration.nextTick ?? epochTick;
      const overdue = clamp(
        (epochTick - nextTick) / (RESOURCE_DIRECTOR_EPOCH_TICKS * 8),
      );
      const jitter = deterministicJitter(state, candidate, epoch);
      const pressure = clamp((candidate.regeneration.cycle ?? 0) / 8);
      return {
        ...candidate,
        habitat,
        need,
        overdue,
        jitter,
        pressure,
        score:
          habitat * 0.45 +
          need * 0.25 +
          overdue * 0.2 +
          jitter * 0.1 -
          pressure * 0.2,
      };
    })
    .filter((candidate) => candidate.habitat > 0.1)
    .sort(
      (left, right) =>
        (left.source === right.source
          ? 0
          : left.source === "unloaded"
            ? -1
            : 1) ||
        right.score - left.score ||
        left.entityId.localeCompare(right.entityId),
    );
}

function settleCandidate(
  state: GameState,
  candidate: DirectorCandidate,
): void {
  const regeneration = candidate.entity.regeneration!;
  const dueTick = regeneration.nextTick!;
  const cycle = Math.max(0, Math.floor(regeneration.cycle ?? 0));
  const pending = deterministicRegenerationRoll(state, candidate.entity, cycle);
  const amount = Math.max(
    1,
    Math.floor(regeneration.nextAmount ?? pending.amount),
  );
  candidate.entity.quantity = Math.min(
    regeneration.capacity,
    candidate.entity.quantity + amount,
  );
  regeneration.cycle = cycle + 1;
  candidate.entity.depleted = candidate.entity.quantity <= 0;
  if (candidate.entity.quantity >= regeneration.capacity) {
    regeneration.nextTick = null;
    regeneration.nextAmount = null;
  } else {
    setResourceRegenerationSchedule(state, candidate.entity, dueTick);
  }
  candidate.commit(candidate.entity);
}

/**
 * Resolves each elapsed half-hour epoch at most once. One epoch can settle at
 * most one already-due node; need only changes ordering and never capacity or
 * the pending batch size.
 */
export function advanceResourceDirector(
  state: GameState,
): ResourceDirectorDecision[] {
  const director = normalizeResourceDirectorState(state);
  const currentEpoch = resourceDirectorEpochForTick(state.clock.tick);
  if (currentEpoch <= director.evaluatedThroughEpoch) return [];

  const firstEpoch = Math.max(
    director.evaluatedThroughEpoch + 1,
    currentEpoch - RESOURCE_DIRECTOR_MAX_CATCH_UP_EPOCHS + 1,
  );
  const needs = evaluateResourceNeeds(state);
  const decisions: ResourceDirectorDecision[] = [];
  for (let epoch = firstEpoch; epoch <= currentEpoch; epoch += 1) {
    const epochTick = epoch * RESOURCE_DIRECTOR_EPOCH_TICKS;
    const candidates = scoreCandidates(
      state,
      collectCandidates(state, epochTick),
      needs,
      epoch,
      epochTick,
    );
    const selected = candidates[0];
    if (!selected) continue;
    settleCandidate(state, selected);
    decisions.push({
      epoch,
      entityId: selected.entityId,
      itemId: selected.itemId,
      source: selected.source,
    });
  }
  director.evaluatedThroughEpoch = currentEpoch;
  return decisions;
}
