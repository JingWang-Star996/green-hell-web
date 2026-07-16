import {
  FOOD_SPOILAGE,
  ITEMS,
  RECIPES,
  RESOURCE_REGENERATION,
  TASKS,
  TASK_SEQUENCE,
  WORLD_ENTITY_TEMPLATES,
} from "./content";
import {
  ECOLOGY_SPECIES,
  advanceEcology,
  createEcologyState,
  type EcologyIndividualState,
  type EcologyRenderProjection,
  type EcologySpeciesId,
} from "../ecology";
import {
  activeChunkCoordinates,
  chunkKey,
  generateChunkDescriptor,
  worldToChunkCoordinate,
} from "../world/generation";
import { syncGeneratedWorldBubble } from "../world/saveDelta";
import {
  RIVER_SURFACE_HALF_WIDTH,
  RIVER_USE_RANGE,
  riverDistance,
  riverSurfaceHeight,
  terrainHeight,
  terrainSlopeAcross,
} from "../world/terrain";
import {
  RIVER_WATER_CONTAMINATION,
  isRiverSurfacePoint,
  parseRiverWaterTargetId,
} from "../world/riverWater";
import { drawRandom } from "./rng";
import {
  advanceResourceDirector,
  deterministicRegenerationRoll,
  setResourceRegenerationSchedule as setRegenerationSchedule,
} from "./resourceDirector";
import {
  AUTHORED_SNAKE_SPECIES_ID,
  authoredSnakeIndividualId,
  isAuthoredSnakeEntity,
} from "./authoredSnakes";
import { projectActiveWildlife } from "./wildlifeProjection";
import {
  addLifecycleInventory,
  addPerishableInventoryUnitWithExpiry,
  burnEquippedTorchFuel,
  consumeLifecycleInventory,
  damageDurableTool,
  ensureItemLifecycleState,
  expireSpoiledFood,
  isDurableTool,
  LIFECYCLE_TICKS_PER_SECOND,
  takeNextTorchInventoryUnit,
  takePerishableInventoryUnit,
} from "./lifecycle";
import {
  canCraft,
  canCraftAtPlacement,
  distanceBetween,
  getCampStructureById,
  getCampStructureTransforms,
  getAvailableWaterContainerCount,
  getDiscoveredRecipeIds,
  getTimeOfDayHours,
  hasCompletedRest,
  hasInspectedLandmark,
  isAtCamp,
  isNearLitCampfire,
  isPointShelteredByCampStructures,
  isShelteredByCampStructures,
} from "./selectors";
import {
  campfireStateForStructure,
  ensureCampfireState,
  materializeLegacyStructure,
  nearestLitCampfire,
  nearestPlacedStructure,
  normalizePlacedCampfireState,
  placedStructuresOfKind,
  syncLegacyCampFacades,
} from "./campStructures";
import {
  CAMPFIRE_RAIN_EXPOSED_GUIDANCE,
  resolveCampfireIgnitionAtPoint,
  resolveCurrentCampfireIgnition,
} from "./campfireIgnitionRules";
import {
  cloneGameState,
  DYNAMIC_WORLD_LIMIT,
  MAX_HEALTH_LOSS_HISTORY,
  MAX_SANITY_LOSS_HISTORY,
  recordProgressEvent,
} from "./state";
import {
  DEFAULT_STRUCTURE_PLACEMENTS,
  FIRE_COMFORT_RADIUS,
  STRUCTURE_KINDS,
  STRUCTURE_USE_RADII,
  isPointBlockedByStructure,
  structurePlacementRadius,
  structurePlacementsOverlap,
  structureTransformFromSource,
  type StructureTransform2D,
} from "./structureGeometry";
import {
  RAIN_COLLECTOR_CAPACITY,
  rainCollectorEnvironmentForStructure,
  rainCollectorHasOverheadCoverAtPoint,
} from "./rainCollectorRules";
import {
  formatStructureRefund,
  getStructureDismantlePlan,
} from "./structureDismantle";
import {
  resolveSmokingRackEnvironment,
  SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
} from "./smokingRackRules";
import {
  advanceTorchWaymarkFuel,
  classifyTorchWaymarkUseOperation,
  normalizeTorchWaymarkState,
  torchWaymarkOperationSeconds,
  torchWaymarkTotalFuelSeconds,
  type TorchWaymarkUseOperation,
} from "./torchWaymarkRules";
import {
  advanceClockOneTick,
  FIXED_DT_SECONDS,
  FIXED_HZ,
  GAME_DAY_SIMULATION_SECONDS,
  FIRE_FUEL_PER_STICK_SECONDS,
  MAXIMUM_FIRE_FUEL_SECONDS,
  gameMinuteForDisplay,
  gameHoursToSimulationSeconds,
  gameHoursToTicks,
  REST_GAME_HOURS,
} from "./time";
import { EQUIPPABLE_ITEM_IDS, ITEM_IDS } from "./types";
import {
  createFelledTreeHarvestState,
  isTreeEntity,
  normalizeTreeEntityRuntime,
  treeHarvestPhase,
  treeHarvestFinished,
  treeHorizontalDistanceToInteraction,
  treeIsDepleted,
  treeStandingWorkSeconds,
  treeWorkMultiplier,
} from "./treeHarvest";
import {
  advanceActiveTreeRegrowth,
  advanceTreeRegrowthEntity,
  beginTreeRegrowth,
} from "./treeRegrowthRuntime";
import {
  isMineableRockEntity,
  normalizeMineableRockRuntime,
  rockMiningProfile,
} from "./rockHarvest";
import { resolveAffordance } from "./affordances";
import { deriveDeathReview } from "./playerStatus";
import {
  CAMPAIGN_FACTS,
  EMERGENCY_CANOPY_RESPONSE,
  EMERGENCY_RIVER_RESPONSE,
  RIVER_GAUGE_ID,
  RIVER_GAUGE_OBSTRUCTION_ID,
  canopyRadioMessageForPhase,
  canopyReportReady,
  preparedCanopyExpeditionFacts,
  preparedRiverExpeditionFacts,
  radioResponseDue,
  riverReportReady,
} from "./campaignContent";
import {
  CANOPY_JUNCTION_ID,
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  CANOPY_JUNCTION_POSITION,
  CANOPY_JUNCTION_TENSION_VINE_IDS,
  CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD,
  CANOPY_FORWARD_OUTPOST_RADIUS,
  advanceCanopyJunctionSampling,
  createCanopyJunctionState,
  normalizeCanopyJunctionState,
  recordCanopyObstructionCleared,
  transitionCanopyJunctionPhase,
} from "./canopyJunction";
import {
  hasObjectiveFact,
  taskRequirementsSatisfied,
  type ObjectiveFactReference,
} from "./objectiveFacts";
import {
  RIVER_GAUGE_SAFE_LEVEL_METERS,
  advanceRiverHydrology,
  createRiverHydrologyState,
  normalizeRiverHydrologyState,
  riverLevelTrend,
} from "../world/riverHydrology";
import {
  advanceWindField,
  createWindFieldState,
  normalizeWindFieldState,
  windFieldStrength,
} from "../world/windField";
import {
  validateEntityPhysicalHit,
  validateWaterReachHit,
  validateWildlifeContactHit,
  validateWildlifePhysicalHit,
  type PhysicalHitValidationResult,
} from "./hitValidation";
import { isPhysicalActionId } from "../world/hitGeometry";
import { PREDATOR_CONTACT_RANGE } from "../world/predatorContact";
import type {
  EventDetailValue,
  DurableToolId,
  GameCommand,
  GameEvent,
  GameEventCause,
  GameEventType,
  GameState,
  HealthLossRecord,
  SanityLossRecord,
  EquippableItemId,
  ItemId,
  MovementInput,
  NutritionDelta,
  PlacedStructureKind,
  PlacedStructureState,
  SimulationInput,
  StructurePlacement,
  Vec3,
  WorldEntity,
  WorldEntitySemanticMetadata,
} from "./types";

export { FIXED_DT_SECONDS, FIXED_HZ } from "./time";
export const MAX_EVENT_LOG = 256;

const WALK_SPEED = 2.7;
const SPRINT_SPEED = 4.8;
const STREAM_PARASITE_CHANCE = 0.56;
const FIRE_RAIN_EXPOSURE_LIMIT = 4.5;
const LEGACY_DAY_SIMULATION_SECONDS = 20 * 60;
const METABOLISM_RATE_SCALE =
  LEGACY_DAY_SIMULATION_SECONDS / GAME_DAY_SIMULATION_SECONDS;
const MINIMUM_WEATHER_FRONT_SECONDS = gameHoursToSimulationSeconds(0.75);
const MAXIMUM_WEATHER_FRONT_SECONDS = gameHoursToSimulationSeconds(2);
const INITIAL_FIRE_FUEL_SECONDS = gameHoursToSimulationSeconds(6);
const WILDLIFE_ATTACK_RANGE = 3.2;
const WILDLIFE_CONTACT_COOLDOWN_TICKS = gameHoursToTicks(0.2);
const WILDLIFE_INJURY_RECOVERY_TICKS = gameHoursToTicks(6);
const HEALTH_LOSS_MERGE_WINDOW_SECONDS = 5;
const SANITY_LOSS_MERGE_WINDOW_SECONDS = 5;
const WILDLIFE_YIELDS: Readonly<
  Record<EcologySpeciesId, { meat: number; hide: number }>
> = {
  "reedtail-scuttler": { meat: 1, hide: 0 },
  "mossback-grazer": { meat: 3, hide: 2 },
  "glassfang-stalker": { meat: 2, hide: 1 },
  "coiled-viper": { meat: 1, hide: 0 },
};
export const REST_SIMULATION_SECONDS = gameHoursToSimulationSeconds(
  REST_GAME_HOURS,
);
const INITIAL_RESOURCE_CAPACITY = new Map(
  WORLD_ENTITY_TEMPLATES.filter(
    (entity) => entity.kind === "resource" && entity.itemId,
  ).map((entity) => [entity.id, Math.max(1, Math.floor(entity.quantity))]),
);
const AXE_HARVEST_ITEMS = new Set<ItemId>([
  "stick",
  "vine",
  "broad-leaf",
  "dry-leaf",
]);

type SemanticHarvestAction = WorldEntitySemanticMetadata["action"];
type SemanticToolClass = WorldEntitySemanticMetadata["toolClass"];
type SemanticToolTier = WorldEntitySemanticMetadata["toolTier"];

interface EquippedHarvestTool {
  itemId: EquippableItemId;
  toolClass: Exclude<SemanticToolClass, "hand">;
  tier: 1;
}

interface HarvestIntent {
  action: SemanticHarvestAction;
  toolClass: SemanticToolClass;
  toolTier: SemanticToolTier;
  category: WorldEntitySemanticMetadata["category"] | "legacy-tree";
}

const HARVEST_TOOL_PROFILES: Partial<
  Record<EquippableItemId, EquippedHarvestTool>
> = {
  "stone-blade": { itemId: "stone-blade", toolClass: "blade", tier: 1 },
  axe: { itemId: "axe", toolClass: "axe", tier: 1 },
  "stone-pick": { itemId: "stone-pick", toolClass: "pick", tier: 1 },
};

const REQUIRED_HARVEST_ITEM: Record<
  Exclude<SemanticToolClass, "hand">,
  EquippableItemId
> = {
  blade: "stone-blade",
  axe: "axe",
  pick: "stone-pick",
};

const HARVEST_ACTION_COSTS: Record<
  SemanticHarvestAction,
  { workSeconds: number; stamina: number }
> = {
  pickup: { workSeconds: 2, stamina: 0.5 },
  cut: { workSeconds: 2, stamina: 1 },
  chop: { workSeconds: 3, stamina: 2 },
  mine: { workSeconds: 4, stamina: 3 },
};

interface EventInput {
  type: GameEventType;
  message: string;
  cause: GameEventCause;
  details?: Record<string, EventDetailValue>;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

interface HealthLossInput {
  sourceCode: string;
  sourceLabel: string;
  amount: number;
}

/**
 * The only path for subtracting player health. It records the exact boundary
 * values immediately, before another source can contribute, so the lethal
 * crossing is never reconstructed heuristically after the fact.
 */
function applyHealthLoss(
  state: GameState,
  input: HealthLossInput,
): HealthLossRecord | null {
  const requested = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0;
  const healthBefore = clamp(state.player.vitals.health);
  const healthAfter = clamp(healthBefore - requested);
  const amount = healthBefore - healthAfter;
  state.player.vitals.health = healthAfter;
  if (amount <= 0) return null;

  const history = Array.isArray(state.healthLossHistory)
    ? state.healthLossHistory
    : [];
  const previous = history.at(-1);
  const canMerge = Boolean(
    previous &&
      !previous.lethal &&
      previous.sourceCode === input.sourceCode &&
      previous.sourceLabel === input.sourceLabel &&
      Math.abs(previous.healthAfter - healthBefore) <= 1e-9 &&
      state.clock.elapsedSeconds >= previous.elapsedSeconds &&
      state.clock.elapsedSeconds - previous.elapsedSeconds <=
        HEALTH_LOSS_MERGE_WINDOW_SECONDS,
  );
  const record: HealthLossRecord = canMerge
    ? {
        ...previous!,
        amount: previous!.healthBefore - healthAfter,
        healthAfter,
        tick: state.clock.tick,
        elapsedSeconds: state.clock.elapsedSeconds,
        sampleCount: previous!.sampleCount + 1,
        lethal: previous!.healthBefore > 0 && healthAfter <= 0,
      }
    : {
        id: `health-loss:${state.clock.tick}:${state.nextEventId}:${history.length}:${input.sourceCode}`,
        sourceCode: input.sourceCode,
        sourceLabel: input.sourceLabel,
        amount,
        healthBefore,
        healthAfter,
        startedTick: state.clock.tick,
        startedElapsedSeconds: state.clock.elapsedSeconds,
        tick: state.clock.tick,
        elapsedSeconds: state.clock.elapsedSeconds,
        sampleCount: 1,
        lethal: healthBefore > 0 && healthAfter <= 0,
      };
  if (canMerge) history[history.length - 1] = record;
  else history.push(record);
  if (history.length > MAX_HEALTH_LOSS_HISTORY) {
    history.splice(0, history.length - MAX_HEALTH_LOSS_HISTORY);
  }
  state.healthLossHistory = history;
  return record;
}

interface SanityLossInput {
  sourceCode: string;
  sourceLabel: string;
  amount: number;
}

/**
 * The only path for subtracting player sanity. Recording happens at the exact
 * boundary so concurrent night, exposure, parasite and attack pressure cannot
 * be misidentified later from a terminal snapshot.
 */
function applySanityLoss(
  state: GameState,
  input: SanityLossInput,
): SanityLossRecord | null {
  const requested = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0;
  const sanityBefore = clamp(state.player.vitals.sanity);
  const sanityAfter = clamp(sanityBefore - requested);
  const amount = sanityBefore - sanityAfter;
  state.player.vitals.sanity = sanityAfter;
  if (amount <= 0) return null;

  const history = Array.isArray(state.sanityLossHistory)
    ? state.sanityLossHistory
    : [];
  const previous = history.at(-1);
  const canMerge = Boolean(
    previous &&
      !previous.lethal &&
      previous.sourceCode === input.sourceCode &&
      previous.sourceLabel === input.sourceLabel &&
      Math.abs(previous.sanityAfter - sanityBefore) <= 1e-9 &&
      state.clock.elapsedSeconds >= previous.elapsedSeconds &&
      state.clock.elapsedSeconds - previous.elapsedSeconds <=
        SANITY_LOSS_MERGE_WINDOW_SECONDS,
  );
  const record: SanityLossRecord = canMerge
    ? {
        ...previous!,
        amount: previous!.sanityBefore - sanityAfter,
        sanityAfter,
        tick: state.clock.tick,
        elapsedSeconds: state.clock.elapsedSeconds,
        sampleCount: previous!.sampleCount + 1,
        lethal: previous!.sanityBefore > 0 && sanityAfter <= 0,
      }
    : {
        id: `sanity-loss:${state.clock.tick}:${state.nextEventId}:${history.length}:${input.sourceCode}`,
        sourceCode: input.sourceCode,
        sourceLabel: input.sourceLabel,
        amount,
        sanityBefore,
        sanityAfter,
        startedTick: state.clock.tick,
        startedElapsedSeconds: state.clock.elapsedSeconds,
        tick: state.clock.tick,
        elapsedSeconds: state.clock.elapsedSeconds,
        sampleCount: 1,
        lethal: sanityBefore > 0 && sanityAfter <= 0,
      };
  if (canMerge) history[history.length - 1] = record;
  else history.push(record);
  if (history.length > MAX_SANITY_LOSS_HISTORY) {
    history.splice(0, history.length - MAX_SANITY_LOSS_HISTORY);
  }
  state.sanityLossHistory = history;
  return record;
}

function moveTowards(current: number, target: number, maximumDelta: number): number {
  if (Math.abs(target - current) <= maximumDelta) return target;
  return current + Math.sign(target - current) * maximumDelta;
}

function appendEvent(state: GameState, event: EventInput): GameEvent {
  const entry: GameEvent = {
    id: state.nextEventId,
    tick: state.clock.tick,
    elapsedSeconds: state.clock.elapsedSeconds,
    ...event,
  };
  state.nextEventId += 1;
  recordProgressEvent(state, entry);
  state.eventLog.push(entry);
  if (state.eventLog.length > MAX_EVENT_LOG) {
    state.eventLog.splice(0, state.eventLog.length - MAX_EVENT_LOG);
  }
  return entry;
}

function objectiveFacts(state: GameState) {
  return state.knowledge?.objectiveFacts ?? [];
}

/** Records authored progress once; the durable fact, not the event log, is truth. */
function appendCampaignFact(
  state: GameState,
  fact: ObjectiveFactReference,
  message: string,
  options: Readonly<{
    eventType?: "campaign-fact-recorded" | "radio-message-received";
    causeCode: string;
    details?: Record<string, EventDetailValue>;
  }>,
): boolean {
  if (hasObjectiveFact(objectiveFacts(state), fact)) return false;
  appendEvent(state, {
    type: options.eventType ?? "campaign-fact-recorded",
    message,
    cause: { source: "system", code: options.causeCode },
    details: {
      ...options.details,
      factVerb: fact.verb,
      factSubjectId: fact.subjectId,
    },
  });
  return true;
}

function rejectCommand(
  state: GameState,
  command: GameCommand,
  message: string,
  details?: Record<string, EventDetailValue>,
): void {
  appendEvent(state, {
    type: "command-rejected",
    message,
    cause: { source: "command", code: command.type },
    details,
  });
}

function addInventory(state: GameState, itemId: ItemId, amount: number): number {
  return addLifecycleInventory(state, itemId, amount);
}

function refreshItemLifecycle(state: GameState): void {
  ensureItemLifecycleState(state);
  for (const spoiled of expireSpoiledFood(state)) {
    appendEvent(state, {
      type: "food-spoiled",
      message: `${ITEMS[spoiled.itemId].label} ×${spoiled.quantity} 已腐坏，只能丢弃。`,
      cause: { source: "system", code: `spoilage:${spoiled.itemId}` },
      details: { itemId: spoiled.itemId, amount: spoiled.quantity },
    });
  }
}

function damageToolAndReport(
  state: GameState,
  itemId: DurableToolId,
  cost: number,
  causeCode: string,
): void {
  const wear = damageDurableTool(state, itemId, cost);
  if (!wear) return;
  const torch = itemId === "torch";
  appendEvent(state, {
    type: wear.broken ? "tool-broken" : "tool-damaged",
    message: wear.broken
      ? torch
        ? "火把最后的余烬熄灭了。"
        : `${ITEMS[itemId].label}在使用中损坏，已无法继续使用。`
      : torch
        ? `火把还剩 ${wear.durability}/${wear.maxDurability} 段燃料。`
        : `${ITEMS[itemId].label}耐久降至 ${wear.durability}/${wear.maxDurability}。`,
    cause: { source: "system", code: causeCode },
    details: {
      itemId,
      cost: wear.cost,
      durability: wear.durability,
      maxDurability: wear.maxDurability,
      broken: wear.broken,
    },
  });
  if (
    wear.broken &&
    (torch || state.inventory[itemId] <= 0) &&
    state.player.equippedItem === itemId
  ) {
    state.player.equippedItem = null;
    if (torch) state.player.torchBurnSeconds = 0;
    appendEvent(state, {
      type: "item-unequipped",
      message: torch
        ? "燃尽的火把被收起，你重新空出了双手。"
        : `${ITEMS[itemId].label}损坏后，你重新空出了双手。`,
      cause: { source: "system", code: `equipment:broken:${itemId}` },
      details: { itemId },
    });
  }
}

function updateEquippedTorch(state: GameState, dt: number): void {
  if (state.player.equippedItem !== "torch" || state.inventory.torch <= 0) return;

  const sheltered = isShelteredByCampStructures(state);
  const exposedRain = sheltered ? state.weather.rainIntensity * 0.2 : state.weather.rainIntensity;
  const burn = burnEquippedTorchFuel(
    state,
    dt * (1 + exposedRain * 0.65),
  );
  if (!burn) return;

  if (burn.broken) {
    appendEvent(state, {
      type: "tool-broken",
      message: "火把最后的余烬熄灭了。",
      cause: { source: "system", code: "tool-use:torch-burn" },
      details: {
        itemId: "torch",
        cost: burn.previousDurability,
        durability: 0,
        maxDurability: burn.maxDurability,
        broken: true,
        remainingUseSeconds: 0,
      },
    });
    appendEvent(state, {
      type: "item-unequipped",
      message: "燃尽的火把被收起，你重新空出了双手。",
      cause: { source: "system", code: "equipment:broken:torch" },
      details: { itemId: "torch" },
    });
  } else if (burn.durability < burn.previousDurability) {
    appendEvent(state, {
      type: "tool-damaged",
      message: `火把还剩 ${burn.durability}/${burn.maxDurability} 段燃料。`,
      cause: { source: "system", code: "tool-use:torch-burn" },
      details: {
        itemId: "torch",
        cost: burn.previousDurability - burn.durability,
        durability: burn.durability,
        maxDurability: burn.maxDurability,
        broken: false,
        remainingUseSeconds: burn.remainingBurnSeconds,
      },
    });
  }
}

function isPositionValid(position: Vec3): boolean {
  return [position.x, position.y, position.z].every(Number.isFinite);
}

function horizontalDistanceBetween(left: Vec3, right: Vec3): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function ensureCanopyJunctionRuntime(state: GameState) {
  state.world.canopyJunction = normalizeCanopyJunctionState(
    state.world.canopyJunction,
    state.clock.tick,
  );
  return state.world.canopyJunction;
}

function syncCanopyJunctionObstructions(state: GameState): void {
  let junction = ensureCanopyJunctionRuntime(state);
  const tree = state.world.entities[CANOPY_JUNCTION_OBSTRUCTION_TREE_ID];
  if (
    tree &&
    treeIsDepleted(tree) &&
    !junction.clearedObstructionIds.includes(tree.id)
  ) {
    junction = recordCanopyObstructionCleared(
      junction,
      tree.id,
      state.clock.tick,
    );
  }
  for (const id of CANOPY_JUNCTION_TENSION_VINE_IDS) {
    const vine = state.world.entities[id];
    if (
      vine &&
      (vine.depleted || vine.quantity <= 0) &&
      !junction.clearedObstructionIds.includes(id)
    ) {
      junction = recordCanopyObstructionCleared(junction, id, state.clock.tick);
    }
  }
  state.world.canopyJunction = junction;
}

function recordCanopyRepairRouteUsed(
  state: GameState,
  route: "axe" | "tension-vines",
): void {
  appendCampaignFact(
    state,
    CAMPAIGN_FACTS.canopyRepairKitPrepared,
    route === "axe"
      ? "石斧已经实际用于处理 C-17 倒木；清障方案得到验证，工具仍归玩家使用。"
      : "两根受力藤本已经用石刃切断；杠杆清障方案得到验证。",
    {
      causeCode: `campaign:canopy-repair-route:${route}`,
      details: {
        route,
        milestoneId: "a2-canopy-repair-route",
        createsMilestone: true,
      },
    },
  );
}

function canopyForwardOutpostExists(state: GameState): boolean {
  const nearby = (state.camp.structures ?? []).filter(
    (structure) =>
      horizontalDistanceBetween(structure.position, CANOPY_JUNCTION_POSITION) <=
      CANOPY_FORWARD_OUTPOST_RADIUS,
  );
  const hasShelter = nearby.some((structure) => structure.kind === "shelter");
  const hasCompanion = nearby.some((structure) => {
    if (structure.kind === "bed" ||
        structure.kind === "rain-collector" ||
        structure.kind === "smoking-rack") {
      return true;
    }
    return (
      structure.kind === "campfire" &&
      campfireStateForStructure(state, structure).lit
    );
  });
  return hasShelter && hasCompanion;
}

function refreshCanopyForwardOutpostFact(state: GameState): void {
  if (
    !hasObjectiveFact(
      objectiveFacts(state),
      CAMPAIGN_FACTS.canopyRequestHeard,
    ) ||
    !canopyForwardOutpostExists(state)
  ) {
    return;
  }
  appendCampaignFact(
    state,
    CAMPAIGN_FACTS.canopyForwardOutpostPrepared,
    "C-17 路线附近已有叶棚与配套设施，可以作为持续经营的前哨。",
    {
      causeCode: "campaign:canopy-forward-outpost",
      details: {
        landmarkId: CANOPY_JUNCTION_ID,
        radiusMeters: CANOPY_FORWARD_OUTPOST_RADIUS,
        milestoneId: "a2-canopy-forward-outpost",
        createsMilestone: true,
      },
    },
  );
}

function recordCanopyProvisionedDeparture(state: GameState): void {
  const provisioned = preparedCanopyExpeditionFacts(state.inventory).find(
    (fact) =>
      fact.subjectId === CAMPAIGN_FACTS.canopyProvisioned.subjectId,
  );
  if (!provisioned) return;
  appendCampaignFact(
    state,
    provisioned,
    "离开主营地时确认了火把、两份净水与远征口粮；补给仍由玩家自由使用。",
    {
      causeCode: "campaign:canopy-provisioned-departure",
      details: {
        milestoneId: "a2-canopy-provisioned",
        createsMilestone: true,
      },
    },
  );
}

function compassBearingFromPlayer(
  state: GameState,
  target: Readonly<Pick<Vec3, "x" | "z">>,
): number {
  const dx = target.x - state.player.position.x;
  const dz = target.z - state.player.position.z;
  const targetYaw = Math.atan2(-dx, -dz);
  return ((targetYaw * 180) / Math.PI + 180 + 360) % 360;
}

function setPlayerPosition(
  state: GameState,
  position: Vec3,
  look?: Readonly<{ yaw: number; pitch: number }>,
): void {
  const wasAtCamp = isAtCamp(state);
  const previous = state.player.position;
  const nextPosition = {
    x: clamp(position.x, state.world.bounds.minX, state.world.bounds.maxX),
    y: clamp(position.y, -20, 50),
    z: clamp(position.z, state.world.bounds.minZ, state.world.bounds.maxZ),
  };
  const previousYaw = normalizedLookYaw(state.player.lookYaw);
  const previousPitch = normalizedLookPitch(state.player.lookPitch);
  const nextYaw = look ? normalizedLookYaw(look.yaw) : previousYaw;
  const nextPitch = look ? normalizedLookPitch(look.pitch) : previousPitch;
  const changed =
    quantizedPoseValue(previous.x) !== quantizedPoseValue(nextPosition.x) ||
    quantizedPoseValue(previous.y) !== quantizedPoseValue(nextPosition.y) ||
    quantizedPoseValue(previous.z) !== quantizedPoseValue(nextPosition.z) ||
    quantizedPoseValue(previousYaw) !== quantizedPoseValue(nextYaw) ||
    quantizedPoseValue(previousPitch) !== quantizedPoseValue(nextPitch);
  state.player.position = nextPosition;
  state.player.lookYaw = nextYaw;
  state.player.lookPitch = nextPitch;
  if (changed) {
    state.player.poseRevision =
      Math.max(0, Math.floor(state.player.poseRevision ?? 0)) + 1;
  }
  const exploredCoordinate = worldToChunkCoordinate(
    state.player.position.x,
    state.player.position.z,
  );
  const exploredKey = chunkKey(exploredCoordinate);
  state.world.exploredChunks ??= [];
  if (state.world.exploredChunks.at(-1) !== exploredKey) {
    const existingIndex = state.world.exploredChunks.indexOf(exploredKey);
    if (existingIndex >= 0) state.world.exploredChunks.splice(existingIndex, 1);
    state.world.exploredChunks.push(exploredKey);
    if (state.world.exploredChunks.length > 4096) {
      state.world.exploredChunks.splice(0, state.world.exploredChunks.length - 4096);
    }
  }
  const desiredBubble = activeChunkCoordinates(
    state.player.position.x,
    state.player.position.z,
    1,
  ).map(chunkKey);
  const materialized = state.world.generatedResourceChunks ?? [];
  if (
    materialized.length !== desiredBubble.length ||
    desiredBubble.some((key) => !materialized.includes(key))
  ) {
    syncGeneratedWorldBubble(state, exploredCoordinate, 1);
  }
  if (
    wasAtCamp &&
    !isAtCamp(state) &&
    hasObjectiveFact(objectiveFacts(state), CAMPAIGN_FACTS.riverRequestHeard)
  ) {
    const prepared = preparedRiverExpeditionFacts(state.inventory);
    for (const fact of prepared) {
      const kit =
        fact.subjectId === CAMPAIGN_FACTS.riverLightKitPrepared.subjectId
          ? "照明套装"
          : fact.subjectId === CAMPAIGN_FACTS.riverDefenseKitPrepared.subjectId
            ? "防卫套装"
            : "野外保障套装";
      appendCampaignFact(
        state,
        fact,
        `离开营地时确认携带${kit}；物资仍归玩家使用。`,
        { causeCode: `campaign:prepared:${fact.subjectId}` },
      );
    }
  }
  if (
    wasAtCamp &&
    !isAtCamp(state) &&
    hasObjectiveFact(
      objectiveFacts(state),
      CAMPAIGN_FACTS.canopyRequestHeard,
    )
  ) {
    recordCanopyProvisionedDeparture(state);
  }
  refreshCanopyForwardOutpostFact(state);
}

function quantizedPoseValue(value: number): number {
  return Math.round(value * 10_000);
}

function normalizedLookYaw(value: number | undefined): number {
  if (!Number.isFinite(value)) return Math.PI;
  const twoPi = Math.PI * 2;
  return ((value! + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

function normalizedLookPitch(value: number | undefined): number {
  return Number.isFinite(value) ? clamp(value!, -1.34, 1.34) : -0.05;
}

function applyNutritionDelta(state: GameState, delta: NutritionDelta): void {
  const nutrition = state.player.nutrition;
  nutrition.carbohydrates += delta.carbohydrates ?? 0;
  nutrition.protein += delta.protein ?? 0;
  nutrition.fat += delta.fat ?? 0;
  nutrition.hydration += delta.hydration ?? 0;
}

function effectAlreadyBuilt(state: GameState, effect: string): boolean {
  if (effect === "build-beacon") return state.camp.beaconBuilt;
  return false;
}

function structureKindForEffect(effect: string): PlacedStructureKind | null {
  if (effect === "build-fire") return "campfire";
  if (effect === "build-shelter") return "shelter";
  if (effect === "build-bed") return "bed";
  if (effect === "build-beacon") return "radio-beacon";
  if (effect === "build-smoking-rack") return "smoking-rack";
  if (effect === "build-rain-collector") return "rain-collector";
  if (effect === "build-torch-waymark") return "torch-waymark";
  return null;
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

function rainCollectorSurfaceIsValid(
  position: Pick<Vec3, "x" | "z">,
): boolean {
  const radius = structurePlacementRadius("rain-collector");
  return (
    riverDistance(position.x, position.z) >
      radius + RIVER_SURFACE_HALF_WIDTH &&
    terrainSlopeAcross(position.x, position.z, radius) <= 0.68
  );
}

function torchWaymarkSurfaceIsValid(
  position: Pick<Vec3, "x" | "z">,
): boolean {
  const radius = structurePlacementRadius("torch-waymark");
  return (
    riverDistance(position.x, position.z) >
      radius + RIVER_SURFACE_HALF_WIDTH &&
    terrainSlopeAcross(position.x, position.z, radius) <= 0.68
  );
}

function placementObstacleTransforms(state: GameState): StructureTransform2D[] {
  const explicit = (state.camp.structures ?? [])
    .map(structureTransformFromSource)
    .filter((structure): structure is StructureTransform2D => structure !== null);
  for (const kind of STRUCTURE_KINDS) {
    if (
      explicit.some((structure) => structure.kind === kind) ||
      !structureIsBuilt(state, kind)
    ) {
      continue;
    }
    const fallback = DEFAULT_STRUCTURE_PLACEMENTS[kind];
    explicit.push({
      id: `structure.${kind}.legacy-fallback`,
      kind,
      x: fallback.position.x,
      z: fallback.position.z,
      yaw: fallback.yaw,
    });
  }
  return explicit;
}

function placementIsValid(
  state: GameState,
  effect: string | undefined,
  placement: StructurePlacement | undefined,
): boolean {
  if (!effect) return true;
  const kind = structureKindForEffect(effect);
  if (!placement) {
    return (
      kind !== "smoking-rack" &&
      kind !== "rain-collector" &&
      kind !== "torch-waymark"
    );
  }
  if (!isPositionValid(placement.position) || !Number.isFinite(placement.yaw)) return false;
  if (
    placement.position.x < state.world.bounds.minX ||
    placement.position.x > state.world.bounds.maxX ||
    placement.position.z < state.world.bounds.minZ ||
    placement.position.z > state.world.bounds.maxZ
  ) {
    return false;
  }
  if (horizontalDistanceBetween(state.player.position, placement.position) > 6) return false;
  if (kind === "rain-collector" && !rainCollectorSurfaceIsValid(placement.position)) {
    return false;
  }
  if (
    kind === "rain-collector" &&
    rainCollectorHasOverheadCoverAtPoint(state, placement.position)
  ) {
    return false;
  }
  if (kind === "torch-waymark" && !torchWaymarkSurfaceIsValid(placement.position)) {
    return false;
  }
  if (!kind) return true;
  const candidate: StructureTransform2D = {
    id: `structure.${kind}.candidate`,
    kind,
    x: placement.position.x,
    z: placement.position.z,
    yaw: placement.yaw,
  };
  for (const structure of placementObstacleTransforms(state)) {
    if (structurePlacementsOverlap(candidate, structure)) return false;
  }
  return true;
}

function refreshShelterCoverage(state: GameState): void {
  for (const structure of placedStructuresOfKind(state, "campfire")) {
    const fire = ensureCampfireState(state, structure);
    fire.sheltered = isPointShelteredByCampStructures(
      state,
      structure.position,
    );
  }
  syncLegacyCampFacades(state);
}

function allocateStructureId(
  state: GameState,
  kind: PlacedStructureKind,
): string {
  let sequence = Math.max(1, Math.floor(state.nextEventId));
  const occupied = new Set(
    (state.camp.structures ?? []).map((structure) => structure.id),
  );
  let candidate = `structure.${kind}.${sequence}`;
  while (occupied.has(candidate)) {
    sequence += 1;
    candidate = `structure.${kind}.${sequence}`;
  }
  return candidate;
}

function applyRecipeEffect(
  state: GameState,
  effect: string | undefined,
  placement?: StructurePlacement,
  torchWaymarkFuelSeconds?: number,
): PlacedStructureState | null {
  if (!effect || effectAlreadyBuilt(state, effect)) return null;
  const kind = structureKindForEffect(effect);
  let placedStructure: PlacedStructureState | null = null;
  if (kind) {
    const fallback = DEFAULT_STRUCTURE_PLACEMENTS[kind];
    const position = placement?.position ?? fallback.position;
    state.camp.structures ??= [];
    placedStructure = {
      id: allocateStructureId(state, kind),
      kind,
      position: { ...position },
      yaw: placement?.yaw ?? fallback.yaw,
      builtAtTick: state.clock.tick,
      ...(kind === "campfire"
        ? {
            fire: {
              lit: true,
              fuelSeconds: INITIAL_FIRE_FUEL_SECONDS,
              rainExposure: 0,
              sheltered: false,
            },
          }
        : {}),
      ...(kind === "rain-collector"
        ? {
            storedUnits: 0,
            capacity: RAIN_COLLECTOR_CAPACITY,
            lastAdvancedTick: state.clock.tick,
          }
        : {}),
      ...(kind === "torch-waymark"
        ? {
            torchFuelQueueSeconds: [torchWaymarkFuelSeconds!],
            lit: true,
            everLit: true,
            lastAdvancedTick: state.clock.tick,
          }
        : {}),
    };
    state.camp.structures.push(placedStructure);
  }
  if (effect === "build-fire") {
    appendEvent(state, {
      type: "fire-lit",
      message: "干叶接住火星，营火开始燃烧。",
      cause: { source: "command", code: "craft:campfire" },
      ...(placedStructure
        ? { details: { structureId: placedStructure.id } }
        : {}),
    });
  } else if (effect === "build-shelter") {
    state.camp.shelterBuilt = true;
  } else if (effect === "build-bed") {
    state.camp.bedBuilt = true;
  } else if (effect === "build-beacon") {
    state.camp.beaconBuilt = true;
  }
  syncLegacyCampFacades(state);
  refreshShelterCoverage(state);
  return placedStructure;
}

function smokingRackEnvironmentForState(
  state: GameState,
  rack: PlacedStructureState,
) {
  const descriptor = generateChunkDescriptor(
    String(state.seed),
    worldToChunkCoordinate(rack.position.x, rack.position.z),
  );
  const fire = nearestLitCampfire(state, rack.position);
  return resolveSmokingRackEnvironment({
    biome: descriptor.biome,
    rainIntensity: state.weather.rainIntensity,
    sheltered: isPointShelteredByCampStructures(state, rack.position),
    fireLit: fire !== null,
    distanceToFire: fire
      ? Math.hypot(
          rack.position.x - fire.position.x,
          rack.position.z - fire.position.z,
        )
      : null,
  });
}

function rainCollectorCollectableUnits(
  state: GameState,
  structure: PlacedStructureState,
): number {
  const wholeStoredUnits = Math.max(
    0,
    Math.floor((structure.storedUnits ?? 0) + 1e-9),
  );
  return Math.min(
    wholeStoredUnits,
    getAvailableWaterContainerCount(state),
    Math.max(
      0,
      ITEMS["clean-water"].stackLimit - state.inventory["clean-water"],
    ),
  );
}

function handleUseRainCollector(
  state: GameState,
  structure: PlacedStructureState,
  command: Extract<GameCommand, { type: "use-structure" }>,
): void {
  if (distanceBetween(state.player.position, structure.position) > 3.2) {
    rejectCommand(state, command, "需要靠近这座雨水收集架才能取水。", {
      structureId: structure.id,
    });
    return;
  }
  if (
    state.inventory["clean-water"] >= ITEMS["clean-water"].stackLimit
  ) {
    rejectCommand(state, command, "背包中的安全饮水已经装满；储水仍留在架上。", {
      structureId: structure.id,
      itemId: "clean-water",
    });
    return;
  }
  if (getAvailableWaterContainerCount(state) <= 0) {
    rejectCommand(state, command, "需要额外的空椰壳才能从收集架取水。", {
      structureId: structure.id,
      requiredItem: "coconut-shell",
    });
    return;
  }
  if ((structure.storedUnits ?? 0) < 1 - 1e-9) {
    rejectCommand(
      state,
      command,
      `目前只有 ${(structure.storedUnits ?? 0).toFixed(2)} 份雨水；集满一份后才能装入椰壳。`,
      { structureId: structure.id, storedUnits: structure.storedUnits ?? 0 },
    );
    return;
  }

  advanceWorkTime(state, 2);
  if (state.status !== "playing") return;
  const refreshed = getCampStructureById(state, structure.id);
  if (!refreshed || refreshed.kind !== "rain-collector") {
    rejectCommand(state, command, "收取时结构状态已经改变；没有转移雨水。", {
      structureId: structure.id,
      interrupted: true,
    });
    return;
  }
  const amount = rainCollectorCollectableUnits(state, refreshed);
  if (amount <= 0) {
    rejectCommand(state, command, "收取条件已经改变；储水与背包都保持原样。", {
      structureId: structure.id,
      interrupted: true,
    });
    return;
  }
  state.inventory["clean-water"] += amount;
  refreshed.storedUnits = Math.max(0, (refreshed.storedUnits ?? 0) - amount);
  appendEvent(state, {
    type: "structure-output-collected",
    message: `从雨水架装走 ${amount} 份安全雨水；不足一份的余量继续保留。`,
    cause: { source: "command", code: "rain-collector:collect" },
    details: {
      structureId: structure.id,
      itemId: "clean-water",
      amount,
      storedUnits: refreshed.storedUnits,
    },
  });
  announceRecipeDiscoveries(state);
}

function torchWaymarkOperationNeedsTorch(
  operation: TorchWaymarkUseOperation,
): boolean {
  return (
    operation === "insert-torch-waymark" ||
    operation === "top-up-torch-waymark"
  );
}

function torchWaymarkOperationNeedsIgnition(
  operation: TorchWaymarkUseOperation,
): boolean {
  return (
    operation === "insert-torch-waymark" ||
    operation === "relight-torch-waymark"
  );
}

function normalizeTorchWaymarkRuntime(
  structure: PlacedStructureState,
  currentTick: number,
): void {
  const normalized = normalizeTorchWaymarkState(structure, currentTick);
  structure.torchFuelQueueSeconds = normalized.torchFuelQueueSeconds;
  structure.lit = normalized.lit;
  structure.everLit = normalized.everLit;
  structure.lastAdvancedTick = normalized.lastAdvancedTick;
}

function handleUseTorchWaymark(
  state: GameState,
  structure: PlacedStructureState,
  command: Extract<GameCommand, { type: "use-structure" }>,
): void {
  normalizeTorchWaymarkRuntime(structure, state.clock.tick);
  if (
    horizontalDistanceBetween(state.player.position, structure.position) >
    STRUCTURE_USE_RADII["torch-waymark"]
  ) {
    rejectCommand(state, command, "需要靠近火把路标才能维护燃料。", {
      structureId: structure.id,
      range: STRUCTURE_USE_RADII["torch-waymark"],
    });
    return;
  }

  const expectedOperation = classifyTorchWaymarkUseOperation(structure);
  if (expectedOperation === "fuel-slots-full") {
    rejectCommand(state, command, "路标已经装满两支火把，无需继续添加。", {
      structureId: structure.id,
      reason: "fuel-slots-full",
      fuelSlots: structure.torchFuelQueueSeconds!.length,
      totalFuelSeconds: torchWaymarkTotalFuelSeconds(structure),
    });
    return;
  }
  if (
    torchWaymarkOperationNeedsTorch(expectedOperation) &&
    state.inventory.torch <= 0
  ) {
    rejectCommand(state, command, "需要一支仍有燃料的实体火把。", {
      structureId: structure.id,
      reason: "missing-torch",
      requiredItem: "torch",
      expectedOperation,
    });
    return;
  }
  const preflightIgnition = resolveCampfireIgnitionAtPoint(
    state,
    structure.position,
  );
  if (
    torchWaymarkOperationNeedsIgnition(expectedOperation) &&
    !preflightIgnition.canIgnite
  ) {
    rejectCommand(state, command, CAMPFIRE_RAIN_EXPOSED_GUIDANCE, {
      structureId: structure.id,
      reason: preflightIgnition.blocker ?? "rain-exposed",
      expectedOperation,
    });
    return;
  }

  const workSeconds = torchWaymarkOperationSeconds(expectedOperation)!;
  advanceWorkTime(state, workSeconds);
  if (state.status !== "playing") return;

  const refreshed = getCampStructureById(state, structure.id);
  if (!refreshed || refreshed.kind !== "torch-waymark") {
    rejectCommand(state, command, "维护期间路标状态发生变化；没有转移火把。", {
      structureId: structure.id,
      expectedOperation,
      actualOperation: "structure-missing",
      interrupted: true,
    });
    return;
  }
  normalizeTorchWaymarkRuntime(refreshed, state.clock.tick);
  const actualOperation = classifyTorchWaymarkUseOperation(refreshed);
  if (actualOperation !== expectedOperation) {
    rejectCommand(state, command, "维护期间燃烧状态发生变化；火把仍留在背包。", {
      structureId: structure.id,
      expectedOperation,
      actualOperation,
      interrupted: true,
    });
    return;
  }
  const settlementIgnition = resolveCampfireIgnitionAtPoint(
    state,
    refreshed.position,
  );
  if (
    torchWaymarkOperationNeedsIgnition(expectedOperation) &&
    !settlementIgnition.canIgnite
  ) {
    rejectCommand(
      state,
      command,
      `维护期间雨势增强。${CAMPFIRE_RAIN_EXPOSED_GUIDANCE}`,
      {
        structureId: structure.id,
        reason: settlementIgnition.blocker ?? "rain-exposed",
        expectedOperation,
        actualOperation,
        interrupted: true,
      },
    );
    return;
  }

  const transferredTorch = torchWaymarkOperationNeedsTorch(expectedOperation)
    ? takeNextTorchInventoryUnit(state)
    : null;
  if (torchWaymarkOperationNeedsTorch(expectedOperation) && !transferredTorch) {
    rejectCommand(state, command, "实体火把已经不可用；路标燃料保持原样。", {
      structureId: structure.id,
      reason: "missing-usable-torch",
      expectedOperation,
      actualOperation,
      interrupted: true,
    });
    return;
  }
  if (transferredTorch?.wasEquipped) {
    appendEvent(state, {
      type: "item-unequipped",
      message: "手中的火把被固定到路标上，你重新空出了双手。",
      cause: { source: "command", code: `torch-waymark:${expectedOperation}:transfer` },
      details: { itemId: "torch", structureId: refreshed.id },
    });
  }

  if (transferredTorch) {
    refreshed.torchFuelQueueSeconds!.push(
      transferredTorch.remainingBurnSeconds,
    );
    appendEvent(state, {
      type: "structure-fuel-added",
      message:
        expectedOperation === "insert-torch-waymark"
          ? "将实体火把插入路标，剩余燃料被完整接管。"
          : "把备用火把装入路标；当前火把燃尽后会按顺序接续。",
      cause: { source: "command", code: `torch-waymark:${expectedOperation}` },
      details: {
        structureId: refreshed.id,
        itemId: "torch",
        fuelAddedSeconds: transferredTorch.remainingBurnSeconds,
        totalFuelSeconds: torchWaymarkTotalFuelSeconds(refreshed),
        fuelSlots: refreshed.torchFuelQueueSeconds!.length,
      },
    });
  }
  if (
    expectedOperation === "insert-torch-waymark" ||
    expectedOperation === "relight-torch-waymark"
  ) {
    refreshed.lit = true;
    refreshed.everLit = true;
    appendEvent(state, {
      type: "structure-ignited",
      message: "火把路标重新亮起。",
      cause: { source: "command", code: `torch-waymark:${expectedOperation}` },
      details: {
        structureId: refreshed.id,
        totalFuelSeconds: torchWaymarkTotalFuelSeconds(refreshed),
        fuelSlots: refreshed.torchFuelQueueSeconds!.length,
      },
    });
  }
  refreshed.lastAdvancedTick = state.clock.tick;
}

function handleUseStructure(
  state: GameState,
  command: Extract<GameCommand, { type: "use-structure" }>,
): void {
  const structure = getCampStructureById(state, command.structureId);
  if (!structure) {
    rejectCommand(state, command, "没有找到可操作的建筑。", {
      structureId: command.structureId,
    });
    return;
  }
  if (structure.kind === "rain-collector") {
    handleUseRainCollector(state, structure, command);
    return;
  }
  if (structure.kind === "torch-waymark") {
    handleUseTorchWaymark(state, structure, command);
    return;
  }
  if (structure.kind === "campfire") {
    handleAddFuel(state, {
      type: "add-fuel",
      structureId: structure.id,
    });
    return;
  }
  if (structure.kind === "bed") {
    handleRest(state, { type: "rest", structureId: structure.id });
    return;
  }
  if (structure.kind !== "smoking-rack") {
    rejectCommand(state, command, "这座建筑当前没有可执行的快速操作。", {
      structureId: command.structureId,
    });
    return;
  }
  if (distanceBetween(state.player.position, structure.position) > 3.2) {
    rejectCommand(state, command, "需要靠近这座烟熏架才能操作。", {
      structureId: structure.id,
    });
    return;
  }

  const process = structure.process;
  if (!process) {
    if (state.inventory["raw-meat"] <= 0) {
      rejectCommand(state, command, "需要一份生肉才能开始烟熏。", {
        structureId: structure.id,
        requiredItem: "raw-meat",
      });
      return;
    }
    advanceWorkTime(state, 3);
    if (state.status !== "playing") return;
    const input = takePerishableInventoryUnit(state, "raw-meat");
    if (!input) {
      rejectCommand(state, command, "生肉在装架前已经腐坏。", {
        structureId: structure.id,
        requiredItem: "raw-meat",
      });
      return;
    }
    structure.process = {
      kind: "smoking-meat",
      inputExpiresAtTick: input.expiresAtTick,
      progressSeconds: 0,
      status: "processing",
    };
    appendEvent(state, {
      type: "structure-loaded",
      message: "一份生肉挂上烟熏架；火、雨和当地湿度会决定加工速度。",
      cause: { source: "command", code: "smoking-rack:load" },
      details: {
        structureId: structure.id,
        itemId: "raw-meat",
        inputExpiresAtTick: input.expiresAtTick,
      },
    });
    return;
  }

  if (process.status === "processing") {
    const environment = smokingRackEnvironmentForState(state, structure);
    rejectCommand(
      state,
      command,
      environment.active
        ? "生肉仍在烟熏中。"
        : environment.blocker === "fire-unlit"
          ? "营火已经熄灭，烟熏进度暂停。"
          : environment.blocker === "fire-too-far"
            ? "烟熏架离营火太远，进度暂停。"
            : "露天雨势超过当地条件，进度暂停。",
      {
        structureId: structure.id,
        progressSeconds: process.progressSeconds,
      },
    );
    return;
  }

  if (process.status === "spoiled") {
    advanceWorkTime(state, 2);
    delete structure.process;
    appendEvent(state, {
      type: "structure-output-collected",
      message: "腐坏的肉被清理掉，烟熏架重新空出来。",
      cause: { source: "command", code: "smoking-rack:clear-spoiled" },
      details: { structureId: structure.id, spoiled: true },
    });
    return;
  }

  if (state.inventory["smoked-meat"] >= ITEMS["smoked-meat"].stackLimit) {
    rejectCommand(state, command, "背包装不下烟熏肉；成品会继续留在架上。", {
      structureId: structure.id,
      itemId: "smoked-meat",
    });
    return;
  }
  advanceWorkTime(state, 2);
  if (state.status !== "playing") return;
  const refreshedStructure = getCampStructureById(state, structure.id);
  const refreshedProcess = refreshedStructure?.process;
  if (!refreshedProcess || refreshedProcess.status !== "ready") {
    rejectCommand(
      state,
      command,
      refreshedProcess?.status === "spoiled"
        ? "收取时成品已经腐坏；先清理烟熏架。"
        : "烟熏架上的成品状态已经改变。",
      { structureId: structure.id },
    );
    return;
  }
  const outputExpiresAtTick =
    refreshedProcess.outputExpiresAtTick ??
    state.clock.tick +
      FOOD_SPOILAGE["smoked-meat"].shelfLifeSeconds *
        LIFECYCLE_TICKS_PER_SECOND;
  if (outputExpiresAtTick <= state.clock.tick) {
    refreshedProcess.status = "spoiled";
    rejectCommand(state, command, "收取时成品已经腐坏；先清理烟熏架。", {
      structureId: structure.id,
    });
    return;
  }
  if (
    !addPerishableInventoryUnitWithExpiry(
      state,
      "smoked-meat",
      outputExpiresAtTick,
    )
  ) {
    rejectCommand(state, command, "背包装不下烟熏肉；成品会继续留在架上。", {
      structureId: structure.id,
      itemId: "smoked-meat",
    });
    return;
  }
  delete refreshedStructure.process;
  appendEvent(state, {
    type: "structure-output-collected",
    message: "收下一份烟熏肉；它比烤肉更适合长期远征。",
    cause: { source: "command", code: "smoking-rack:collect" },
    details: {
      structureId: structure.id,
      itemId: "smoked-meat",
      amount: 1,
    },
  });
  announceRecipeDiscoveries(state);
}

function handleDismantleStructure(
  state: GameState,
  command: Extract<GameCommand, { type: "dismantle-structure" }>,
): void {
  const preflight = getStructureDismantlePlan(state, command.structureId);
  if (!preflight.ok) {
    rejectCommand(state, command, preflight.message, {
      structureId: command.structureId,
      blocker: preflight.blocker ?? "unknown",
    });
    return;
  }

  advanceWorkTime(state, preflight.workSeconds);
  if (state.status !== "playing") return;

  const settlement = getStructureDismantlePlan(state, command.structureId);
  if (!settlement.ok || settlement.kind !== preflight.kind) {
    rejectCommand(
      state,
      command,
      settlement.ok
        ? "拆除期间目标已经改变；建筑与材料都保持原样。"
        : settlement.message,
      {
        structureId: command.structureId,
        blocker: settlement.blocker ?? "target-changed",
        interrupted: true,
      },
    );
    return;
  }

  const structures = state.camp.structures ?? [];
  const structureIndex = structures.findIndex(
    (structure) => structure.id === command.structureId,
  );
  if (structureIndex < 0) {
    rejectCommand(
      state,
      command,
      "拆除结算时目标已经消失；没有返还材料。",
      {
        structureId: command.structureId,
        interrupted: true,
      },
    );
    return;
  }

  structures.splice(structureIndex, 1);
  for (const [itemId, amount] of Object.entries(settlement.refund) as Array<
    [ItemId, number]
  >) {
    addInventory(state, itemId, amount);
  }
  appendEvent(state, {
    type: "structure-dismantled",
    message: `已拆除${settlement.label}，返还 ${formatStructureRefund(settlement.refund)}。`,
    cause: { source: "command", code: `dismantle:${settlement.kind}` },
    details: {
      structureId: command.structureId,
      kind: settlement.kind!,
      refundStick: settlement.refund.stick ?? 0,
      refundVine: settlement.refund.vine ?? 0,
      refundBroadLeaf: settlement.refund["broad-leaf"] ?? 0,
      refundCoconutShell: settlement.refund["coconut-shell"] ?? 0,
    },
  });
}

function updateSmokingRacks(state: GameState): void {
  if (state.clock.tick % LIFECYCLE_TICKS_PER_SECOND !== 0) return;
  for (const structure of state.camp.structures ?? []) {
    const process = structure.process;
    if (structure.kind !== "smoking-rack" || !process) {
      continue;
    }
    if (process.status === "ready") {
      if (
        process.outputExpiresAtTick !== undefined &&
        process.outputExpiresAtTick <= state.clock.tick
      ) {
        process.status = "spoiled";
        appendEvent(state, {
          type: "structure-process-spoiled",
          message: "烟熏肉在架上放置过久，已经腐坏。",
          cause: { source: "system", code: "smoking-rack:output-spoiled" },
          details: { structureId: structure.id, itemId: "smoked-meat" },
        });
      }
      continue;
    }
    if (process.status !== "processing") continue;
    const environment = smokingRackEnvironmentForState(state, structure);
    if (environment.active) {
      process.progressSeconds = Math.min(
        SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
        process.progressSeconds + environment.rateMultiplier,
      );
    }
    if (process.progressSeconds >= SMOKING_RACK_REQUIRED_PROGRESS_SECONDS) {
      process.status = "ready";
      process.outputExpiresAtTick =
        state.clock.tick +
        FOOD_SPOILAGE["smoked-meat"].shelfLifeSeconds *
          LIFECYCLE_TICKS_PER_SECOND;
      appendEvent(state, {
        type: "structure-process-completed",
        message: "烟熏架上的肉颜色变深，已经可以收取。",
        cause: { source: "system", code: "smoking-rack:complete" },
        details: {
          structureId: structure.id,
          itemId: "smoked-meat",
        },
      });
    } else if (process.inputExpiresAtTick <= state.clock.tick) {
      process.status = "spoiled";
      appendEvent(state, {
        type: "structure-process-spoiled",
        message: "烟熏条件中断太久，架上的生肉已经腐坏。",
        cause: { source: "system", code: "smoking-rack:spoiled" },
        details: { structureId: structure.id, itemId: "raw-meat" },
      });
    }
  }
}

function updateRainCollectors(state: GameState): void {
  if (state.clock.tick % LIFECYCLE_TICKS_PER_SECOND !== 0) return;
  for (const structure of state.camp.structures ?? []) {
    if (structure.kind !== "rain-collector") continue;
    const capacity = RAIN_COLLECTOR_CAPACITY;
    const previousTick = Math.max(
      0,
      Math.min(
        state.clock.tick,
        Number.isFinite(structure.lastAdvancedTick)
          ? Math.floor(structure.lastAdvancedTick ?? state.clock.tick)
          : state.clock.tick,
      ),
    );
    const elapsedSeconds =
      (state.clock.tick - previousTick) / LIFECYCLE_TICKS_PER_SECOND;
    structure.capacity = capacity;
    structure.storedUnits = Math.max(
      0,
      Math.min(capacity, structure.storedUnits ?? 0),
    );
    if (elapsedSeconds > 0 && structure.storedUnits < capacity) {
      const environment = rainCollectorEnvironmentForStructure(
        state,
        structure,
      );
      structure.storedUnits = Math.min(
        capacity,
        structure.storedUnits + environment.ratePerSecond * elapsedSeconds,
      );
    }
    // Dry and full intervals are accounted too; future rain must not backfill them.
    structure.lastAdvancedTick = state.clock.tick;
  }
}

function updateTorchWaymarks(state: GameState): void {
  if (state.clock.tick % LIFECYCLE_TICKS_PER_SECOND !== 0) return;
  const extinguished: Array<{
    structure: PlacedStructureState;
    reason: "rain-exposed" | "fuel-exhausted";
  }> = [];
  const waymarks = (state.camp.structures ?? [])
    .filter((structure) => structure.kind === "torch-waymark")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const structure of waymarks) {
    normalizeTorchWaymarkRuntime(structure, state.clock.tick);
    const previousTick = structure.lastAdvancedTick!;
    const elapsedSeconds =
      (state.clock.tick - previousTick) / LIFECYCLE_TICKS_PER_SECOND;
    const ignition = resolveCampfireIgnitionAtPoint(
      state,
      structure.position,
    );
    const advanced = advanceTorchWaymarkFuel({
      torchFuelQueueSeconds: structure.torchFuelQueueSeconds,
      lit: structure.lit === true,
      elapsedSeconds,
      rainIntensity: state.weather.rainIntensity,
      sheltered: ignition.sheltered,
      ignitionAllowed: ignition.canIgnite,
    });
    structure.torchFuelQueueSeconds = advanced.torchFuelQueueSeconds;
    structure.lit = advanced.lit;
    structure.lastAdvancedTick = state.clock.tick;
    if (advanced.extinguished && advanced.extinguishReason) {
      extinguished.push({
        structure,
        reason: advanced.extinguishReason,
      });
    }
  }

  // One deterministic nearby event per second is enough feedback; every
  // distant structure still advances authoritatively without flooding saves.
  const reported = extinguished
    .filter(
      ({ structure }) =>
        horizontalDistanceBetween(
          state.player.position,
          structure.position,
        ) <= 18,
    )
    .sort(
      (left, right) =>
        horizontalDistanceBetween(
          state.player.position,
          left.structure.position,
        ) -
          horizontalDistanceBetween(
            state.player.position,
            right.structure.position,
          ) || left.structure.id.localeCompare(right.structure.id),
    )[0];
  if (!reported) return;
  appendEvent(state, {
    type: "structure-extinguished",
    message:
      reported.reason === "rain-exposed"
        ? "附近一座露天火把路标被暴雨压灭，燃料仍保留在架上。"
        : "附近一座火把路标燃尽，石基与木杆仍可重新装入火把。",
    cause: {
      source: "system",
      code: `torch-waymark:${reported.reason}`,
    },
    details: {
      structureId: reported.structure.id,
      reason: reported.reason,
      totalFuelSeconds: torchWaymarkTotalFuelSeconds(reported.structure),
    },
  });
}

function refreshCampObjective(state: GameState): void {
  if (
    state.camp.fire.built &&
    placedStructuresOfKind(state, "campfire").some(
      (structure) => campfireStateForStructure(state, structure).lit,
    ) &&
    state.camp.shelterBuilt &&
    state.camp.bedBuilt &&
    hasCompletedRest(state)
  ) {
    state.objectives.flags.campEstablished = true;
  }
}

/**
 * Resolves useful field work immediately for the player while allowing weather,
 * fire, wounds and metabolism to react to the time the work represents.
 */
function advanceWorkTime(state: GameState, seconds: number): void {
  const ticks = Math.max(0, Math.round(seconds * FIXED_HZ));
  for (let index = 0; index < ticks && state.status === "playing"; index += 1) {
    runFixedTick(state, undefined);
  }
}

function harvestLimit(state: GameState, itemId: ItemId): number {
  return AXE_HARVEST_ITEMS.has(itemId) && state.player.equippedItem === "axe" ? 3 : 1;
}

function harvestWorkSeconds(state: GameState, itemId: ItemId, amount: number): number {
  if (itemId === "battery") return 12;
  if (itemId === "stone") return 8 * amount;
  if (["stick", "vine", "broad-leaf", "dry-leaf"].includes(itemId)) {
    return state.player.equippedItem === "axe" ? 5 + amount * 2 : 7 * amount;
  }
  return 5 * amount;
}

function resolveHarvestIntent(entity: WorldEntity): HarvestIntent | null {
  if (entity.semantic) {
    return {
      action: entity.semantic.action,
      toolClass: entity.semantic.toolClass,
      toolTier:
        entity.semantic.category === "mineable-rock"
          ? 1
          : entity.semantic.toolTier,
      category: entity.semantic.category,
    };
  }
  if (
    entity.kind === "resource" &&
    entity.itemId === "stick" &&
    entity.tags.includes("standing-tree")
  ) {
    return {
      action: "chop",
      toolClass: "axe",
      toolTier: 1,
      category: "legacy-tree",
    };
  }
  return null;
}

function equippedHarvestTool(state: GameState): EquippedHarvestTool | null {
  const equipped = state.player.equippedItem;
  if (!equipped || state.inventory[equipped] <= 0) return null;
  return HARVEST_TOOL_PROFILES[equipped] ?? null;
}

function actionNoun(action: SemanticHarvestAction): string {
  if (action === "chop") return "砍伐";
  if (action === "mine") return "开采";
  if (action === "cut") return "收割";
  return "摘取";
}

function actionHitMessage(
  entity: WorldEntity,
  action: SemanticHarvestAction,
): string {
  const item = entity.itemId ? ITEMS[entity.itemId].label : "材料";
  if (action === "chop") {
    return entity.depleted
      ? `最后一击切断纤维，${entity.label}倒下；取得${item} ×1。`
      : `斧刃咬进${entity.label}，取得${item} ×1；还需继续处理。`;
  }
  if (action === "mine") {
    return entity.depleted
      ? `岩体最后一处可用裂隙被凿开；取得${item} ×1。`
      : `石镐沿裂隙剥下一块${item}；岩体仍可继续开采。`;
  }
  if (action === "cut") {
    return entity.depleted
      ? `完成收割${entity.label}；取得${item} ×1，植株进入恢复期。`
      : `切下${entity.label}的可用部分，取得${item} ×1。`;
  }
  return entity.depleted
    ? `摘取${item} ×1，当前植株已采完。`
    : `摘取${item} ×1。`;
}

function validateTreeTool(
  state: GameState,
  command: Extract<GameCommand, { type: "harvest" }>,
  entity: WorldEntity,
  toolClass: Exclude<SemanticToolClass, "hand">,
  toolTier: SemanticToolTier,
  action: SemanticHarvestAction,
): EquippedHarvestTool | null {
  const requiredItem = REQUIRED_HARVEST_ITEM[toolClass];
  const tool = equippedHarvestTool(state);
  const equippedTier = tool?.toolClass === toolClass ? tool.tier : 0;
  if (!tool || tool.toolClass !== toolClass) {
    rejectCommand(
      state,
      command,
      `需要先装备${ITEMS[requiredItem].label}才能${actionNoun(action)}。`,
      {
        entityId: entity.id,
        action,
        requiredItem,
        requiredToolClass: toolClass,
        requiredToolTier: toolTier,
        equippedToolTier: equippedTier,
      },
    );
    return null;
  }
  if (tool.tier < toolTier) {
    rejectCommand(
      state,
      command,
      `${ITEMS[tool.itemId].label}等级不足，需要 ${toolTier} 阶工具。`,
      {
        entityId: entity.id,
        action,
        requiredItem,
        equippedItem: tool.itemId,
        requiredToolClass: toolClass,
        requiredToolTier: toolTier,
        equippedToolTier: tool.tier,
      },
    );
    return null;
  }
  return tool;
}

function recordRiverGaugeClearanceIfNeeded(
  state: GameState,
  entity: WorldEntity,
): void {
  if (
    entity.id !== RIVER_GAUGE_OBSTRUCTION_ID ||
    !treeIsDepleted(entity)
  ) {
    return;
  }
  appendCampaignFact(
    state,
    CAMPAIGN_FACTS.riverGaugeCleared,
    "最后一段倒木已经搬离，水尺下部刻度重新露出。",
    {
      causeCode: "campaign:river-gauge-access-cleared",
      details: { entityId: entity.id },
    },
  );
}

function handleTreeHarvest(
  state: GameState,
  command: Extract<GameCommand, { type: "harvest" }>,
  entity: WorldEntity,
): void {
  const phase = treeHarvestPhase(entity);
  if (treeIsDepleted(entity) || phase === "stump") {
    rejectCommand(state, command, "这棵树只剩下已经处理完的树桩。", {
      entityId: entity.id,
      treePhase: "stump",
    });
    return;
  }
  if (
    treeHorizontalDistanceToInteraction(entity, state.player.position) >
    entity.interactRadius
  ) {
    rejectCommand(
      state,
      command,
      phase === "standing"
        ? `需要靠近${entity.label}的树干才能砍伐。`
        : "需要靠近高亮的倒木处理点。",
      { entityId: entity.id, treePhase: phase },
    );
    return;
  }

  if (phase === "branches" || phase === "loose-log") {
    const itemId: ItemId = phase === "branches" ? "stick" : "log";
    if (state.inventory[itemId] >= ITEMS[itemId].stackLimit) {
      rejectCommand(
        state,
        command,
        `背包装不下更多${ITEMS[itemId].label}；材料仍留在原处。`,
        { entityId: entity.id, itemId, treePhase: phase },
      );
      return;
    }
    const signature = `${entity.treeHarvest?.branches ?? 0}:${entity.treeHarvest?.trunkSegments ?? 0}:${entity.treeHarvest?.looseLog === true}`;
    advanceWorkTime(state, 2);
    if (state.status !== "playing") return;
    const current = state.world.entities[entity.id];
    if (
      !current?.treeHarvest ||
      treeHarvestPhase(current) !== phase ||
      `${current.treeHarvest.branches}:${current.treeHarvest.trunkSegments}:${current.treeHarvest.looseLog}` !==
        signature
    ) {
      rejectCommand(state, command, "倒木状态已经变化，本次没有取走材料。", {
        entityId: entity.id,
        treePhase: phase,
      });
      return;
    }
    const accepted = addInventory(state, itemId, 1);
    if (accepted !== 1) {
      rejectCommand(state, command, "背包容量在动作完成前发生变化，材料仍留在原处。", {
        entityId: entity.id,
        itemId,
        treePhase: phase,
      });
      return;
    }
    if (phase === "branches") current.treeHarvest.branches -= 1;
    else current.treeHarvest.looseLog = false;
    current.depleted = treeIsDepleted(current);
    const settledHarvest = { ...current.treeHarvest };
    state.player.vitals.stamina = clamp(
      state.player.vitals.stamina - (phase === "branches" ? 0.5 : 1),
    );
    appendEvent(state, {
      type: "harvest-struck",
      message:
        phase === "branches"
          ? `从倒下的树冠取下一根木棍；还剩 ${current.treeHarvest.branches} 根枝条。`
          : "搬起一根分段原木；下一处切口已经显露。",
      cause: { source: "command", code: `tree:${phase}` },
      details: {
        entityId: current.id,
        itemId,
        amount: 1,
        treePhase: phase,
        branches: settledHarvest.branches,
        trunkSegments: settledHarvest.trunkSegments,
        looseLog: settledHarvest.looseLog,
        depleted: current.depleted,
        workSeconds: 2,
      },
    });
    recordRiverGaugeClearanceIfNeeded(state, current);
    syncCanopyJunctionObstructions(state);
    if (treeHarvestFinished(settledHarvest)) {
      delete current.treeHarvest;
      beginTreeRegrowth(state.seed, state.clock.tick, current);
    }
    announceRecipeDiscoveries(state);
    return;
  }

  if (phase === "buck") {
    const tool = validateTreeTool(state, command, entity, "axe", 1, "chop");
    if (!tool) return;
    const multiplier = treeWorkMultiplier(entity);
    const workSeconds = Math.max(5, Math.round(6 * multiplier));
    const signature = `${entity.treeHarvest?.branches ?? 0}:${entity.treeHarvest?.trunkSegments ?? 0}:${entity.treeHarvest?.looseLog === true}`;
    advanceWorkTime(state, workSeconds);
    if (state.status !== "playing") return;
    const current = state.world.entities[entity.id];
    if (
      !current?.treeHarvest ||
      treeHarvestPhase(current) !== "buck" ||
      `${current.treeHarvest.branches}:${current.treeHarvest.trunkSegments}:${current.treeHarvest.looseLog}` !==
        signature
    ) {
      rejectCommand(state, command, "倒木切口已经变化，本次没有生成重复原木。", {
        entityId: entity.id,
        treePhase: "buck",
      });
      return;
    }
    current.treeHarvest.trunkSegments -= 1;
    current.treeHarvest.looseLog = true;
    current.depleted = false;
    state.player.vitals.stamina = clamp(
      state.player.vitals.stamina - 3 * multiplier,
    );
    damageToolAndReport(
      state,
      tool.itemId,
      Math.max(1, Math.round(1.5 * multiplier)),
      `tool-use:tree-buck:${current.id}`,
    );
    appendEvent(state, {
      type: "harvest-struck",
      message: "斧刃切断树干纤维，一根原木落在切口旁；先搬走才能继续分段。",
      cause: { source: "command", code: "tree:buck" },
      details: {
        entityId: current.id,
        amount: 0,
        treePhase: "buck",
        branches: current.treeHarvest.branches,
        trunkSegments: current.treeHarvest.trunkSegments,
        looseLog: true,
        depleted: false,
        workSeconds,
        staminaCost: 3 * multiplier,
        action: "chop",
        requiredToolClass: "axe",
        requiredToolTier: 1,
        equippedItem: tool.itemId,
        equippedToolTier: tool.tier,
      },
    });
    if (current.id === CANOPY_JUNCTION_OBSTRUCTION_TREE_ID) {
      recordCanopyRepairRouteUsed(state, "axe");
    }
    syncCanopyJunctionObstructions(state);
    return;
  }

  const intent = resolveHarvestIntent(entity);
  if (!intent || intent.toolClass === "hand") {
    rejectCommand(state, command, "这棵树没有可用的砍伐工具定义。", {
      entityId: entity.id,
    });
    return;
  }
  const tool = validateTreeTool(
    state,
    command,
    entity,
    intent.toolClass,
    intent.toolTier,
    intent.action,
  );
  if (!tool) return;
  const baseCost = HARVEST_ACTION_COSTS[intent.action];
  const multiplier = treeWorkMultiplier(entity);
  const workSeconds = treeStandingWorkSeconds(entity);
  const startingQuantity = entity.quantity;
  advanceWorkTime(state, workSeconds);
  if (state.status !== "playing") return;
  const current = state.world.entities[entity.id];
  if (
    !current ||
    treeHarvestPhase(current) !== "standing" ||
    current.quantity !== startingQuantity
  ) {
    rejectCommand(state, command, "树干状态已经变化，本次挥砍没有重复结算。", {
      entityId: entity.id,
      treePhase: "standing",
    });
    return;
  }
  current.quantity = Math.max(0, current.quantity - 1);
  if (current.quantity === 0) {
    current.treeHarvest = createFelledTreeHarvestState(
      current,
      state.player.position,
    );
  }
  current.depleted = treeIsDepleted(current);
  state.player.vitals.stamina = clamp(
    state.player.vitals.stamina - baseCost.stamina * multiplier,
  );
  damageToolAndReport(
    state,
    tool.itemId,
    Math.max(1, Math.round(multiplier)),
    `tool-use:tree-fell:${current.id}`,
  );
  const fallen = current.quantity === 0 && Boolean(current.treeHarvest);
  appendEvent(state, {
    type: "harvest-struck",
    message: fallen
      ? `${current.label}沿受力方向倒下；枝条与树干仍在世界中，尚未进入背包。`
      : `斧刃咬进${current.label}，砍痕继续加深；这次没有凭空掉落材料。`,
    cause: { source: "command", code: "tree:fell" },
    details: {
      entityId: current.id,
      amount: 0,
      remaining: current.quantity,
      depleted: current.depleted,
      fallen,
      treePhase: "standing",
      ...(current.treeHarvest
        ? {
            fallDirection: current.treeHarvest.fallDirection,
            branches: current.treeHarvest.branches,
            trunkSegments: current.treeHarvest.trunkSegments,
            looseLog: false,
          }
        : {}),
      workSeconds,
      staminaCost: baseCost.stamina * multiplier,
      action: intent.action,
      semanticCategory: intent.category,
      requiredToolClass: intent.toolClass,
      requiredToolTier: intent.toolTier,
      equippedItem: tool.itemId,
      equippedToolTier: tool.tier,
    },
  });
  if (current.id === CANOPY_JUNCTION_OBSTRUCTION_TREE_ID) {
    recordCanopyRepairRouteUsed(state, "axe");
  }
  syncCanopyJunctionObstructions(state);
}

function isRenewableResource(entity: WorldEntity): boolean {
  return Boolean(
    entity.kind === "resource" &&
      entity.itemId &&
      RESOURCE_REGENERATION[entity.itemId] &&
      !entity.tags.includes("nonrenewable") &&
      !entity.tags.includes("standing-tree") &&
      !entity.tags.includes("objective") &&
      !entity.tags.includes("rare"),
  );
}

function ensureResourceRegenerationState(
  state: GameState,
  entity: WorldEntity,
): void {
  if (entity.kind !== "resource" || !entity.itemId) return;
  if (!isRenewableResource(entity)) {
    // Finite resources stay finite even if a malformed or experimental legacy
    // save happened to contain lifecycle fields for them.
    delete entity.regeneration;
    return;
  }
  const definition = RESOURCE_REGENERATION[entity.itemId]!;

  const templateCapacity = INITIAL_RESOURCE_CAPACITY.get(entity.id) ?? 1;
  const savedCapacity = entity.regeneration?.capacity;
  const capacity = Math.min(
    999,
    Math.max(
      1,
      templateCapacity,
      entity.quantity,
      Number.isFinite(savedCapacity) ? Math.floor(savedCapacity!) : 0,
    ),
  );
  const savedNextTick = entity.regeneration?.nextTick;
  const nextTick =
    typeof savedNextTick === "number" &&
    Number.isFinite(savedNextTick) &&
    savedNextTick >= 0
      ? Math.floor(savedNextTick)
      : null;

  const savedCycle = entity.regeneration?.cycle;
  const cycle =
    typeof savedCycle === "number" &&
    Number.isFinite(savedCycle) &&
    savedCycle >= 0
      ? Math.floor(savedCycle)
      : 0;
  const savedNextAmount = entity.regeneration?.nextAmount;
  const nextAmount =
    nextTick === null
      ? null
      : typeof savedNextAmount === "number" &&
          Number.isFinite(savedNextAmount) &&
          savedNextAmount >= 1
        ? Math.max(
            definition.minimumAmount,
            Math.min(definition.maximumAmount, Math.floor(savedNextAmount)),
          )
        : deterministicRegenerationRoll(state, entity, cycle).amount;

  entity.regeneration = { capacity, nextTick, cycle, nextAmount };
  if (entity.quantity >= capacity) {
    entity.regeneration.nextTick = null;
    entity.regeneration.nextAmount = null;
  } else if (entity.regeneration.nextTick === null) {
    // Legacy saves did not record the harvest time. Starting a fresh interval
    // is deterministic and avoids granting an unexplained instant refill.
    setRegenerationSchedule(state, entity, state.clock.tick);
  }
}

function scheduleResourceRegeneration(state: GameState, entity: WorldEntity): void {
  if (!entity.itemId || !entity.regeneration) return;
  if (
    entity.quantity < entity.regeneration.capacity &&
    entity.regeneration.nextTick === null
  ) {
    setRegenerationSchedule(state, entity, state.clock.tick);
  }
}

function completeAvailableTasks(state: GameState, causeCode: string): void {
  let currentTaskId = state.objectives.currentTaskId;
  while (currentTaskId) {
    const task = TASKS[currentTaskId];
    const satisfied = task.flag
      ? state.objectives.flags[task.flag] === true
      : task.completion
        ? taskRequirementsSatisfied(objectiveFacts(state), task.completion)
        : false;
    if (!satisfied) break;

    if (!state.objectives.completedTaskIds.includes(currentTaskId)) {
      state.objectives.completedTaskIds.push(currentTaskId);
      appendEvent(state, {
        type: "task-completed",
        message: `任务完成：${task.label}`,
        cause: { source: "system", code: `objective:${causeCode}` },
        details: {
          taskId: currentTaskId,
          ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}),
        },
      });
    }

    const currentIndex = TASK_SEQUENCE.indexOf(currentTaskId);
    currentTaskId = TASK_SEQUENCE[currentIndex + 1] ?? null;
    state.objectives.currentTaskId = currentTaskId;
  }

}

function announceRecipeDiscoveries(state: GameState): void {
  const announced = new Set(
    [
      ...(state.knowledge?.announcedRecipeIds ?? []),
      ...state.eventLog
        .filter((event) => event.type === "recipe-discovered")
        .map((event) => event.details?.recipeId)
        .filter((recipeId): recipeId is string => typeof recipeId === "string"),
    ],
  );
  for (const recipeId of getDiscoveredRecipeIds(state)) {
    if (recipeId === "stone-blade" || announced.has(recipeId)) continue;
    announced.add(recipeId);
    appendEvent(state, {
      type: "recipe-discovered",
      message: `观察材料后，你在笔记里记下了新配方：${RECIPES[recipeId].label}。`,
      cause: { source: "system", code: `knowledge:${recipeId}` },
      details: { recipeId },
    });
  }
}

function handlePickUp(
  state: GameState,
  command: Extract<GameCommand, { type: "pick-up" }>,
): void {
  const entity = state.world.entities[command.entityId];
  if (!entity || entity.depleted || !entity.itemId || entity.kind !== "resource") {
    rejectCommand(state, command, "这里已经没有可拾取的资源。", {
      entityId: command.entityId,
    });
    return;
  }
  if (
    distanceBetween(state.player.position, entity.position) > entity.interactRadius
  ) {
    rejectCommand(state, command, "距离资源太远。", { entityId: entity.id });
    return;
  }
  if (entity.semantic) {
    if (entity.semantic.action === "pickup") {
      // Compatibility path for existing E/pick-up callers. Semantic plants
      // still settle through the same authoritative harvest validator.
      handleHarvest(state, { type: "harvest", entityId: entity.id });
      return;
    }
    const requiredItem =
      entity.semantic.toolClass === "hand"
        ? undefined
        : REQUIRED_HARVEST_ITEM[entity.semantic.toolClass];
    rejectCommand(
      state,
      command,
      `这不是地面散落物。需要${actionNoun(entity.semantic.action)}${entity.label}。`,
      {
        entityId: entity.id,
        action: entity.semantic.action,
        requiredToolClass: entity.semantic.toolClass,
        requiredToolTier: entity.semantic.toolTier,
        ...(requiredItem ? { requiredItem } : {}),
      },
    );
    return;
  }
  if (entity.tags.includes("standing-tree")) {
    rejectCommand(state, command, "这不是地上的木棍。先装备石斧，再挥砍树干。", {
      entityId: entity.id,
      requiredItem: "axe",
    });
    return;
  }

  if (entity.itemId === "battery") {
    const missingClue = [
      "landmark.camp-radio",
      "landmark.survey-cache",
      "landmark.weather-station",
    ].find((entityId) => !hasInspectedLandmark(state, entityId));
    if (!state.objectives.flags.campEstablished) {
      rejectCommand(state, command, "先证明营地能安全度过一次休息，再拆下远征唯一电源。", {
        entityId: entity.id,
      });
      return;
    }
    if (missingClue) {
      rejectCommand(state, command, "线路与固定结构还没有调查清楚，直接拆卸可能毁掉电池。", {
        entityId: entity.id,
        missingClue,
      });
      return;
    }
    if (state.player.equippedItem !== "axe" || state.inventory.axe <= 0) {
      rejectCommand(state, command, "锈死的电池托架需要先装备石斧再撬开。", {
        entityId: entity.id,
        requiredItem: "axe",
      });
      return;
    }
  }

  const requestedAmount = Math.floor(command.amount ?? 1);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    rejectCommand(state, command, "拾取数量无效。", { entityId: entity.id });
    return;
  }

  const perActionLimit = harvestLimit(state, entity.itemId);
  const usesAxe =
    state.player.equippedItem === "axe" &&
    state.inventory.axe > 0 &&
    (AXE_HARVEST_ITEMS.has(entity.itemId) || entity.itemId === "battery");
  const availableAmount = Math.min(requestedAmount, entity.quantity, perActionLimit);
  const acceptedAmount = Math.max(
    0,
    Math.min(availableAmount, ITEMS[entity.itemId].stackLimit - state.inventory[entity.itemId]),
  );
  if (acceptedAmount <= 0) {
    rejectCommand(state, command, "背包中没有足够空间。", {
      itemId: entity.itemId,
    });
    return;
  }


  const workSeconds = harvestWorkSeconds(state, entity.itemId, acceptedAmount);
  advanceWorkTime(state, workSeconds);
  if (state.status !== "playing") return;
  addInventory(state, entity.itemId, acceptedAmount);

  entity.quantity -= acceptedAmount;
  entity.depleted = entity.quantity <= 0;
  if (entity.depleted) entity.quantity = 0;
  scheduleResourceRegeneration(state, entity);

  if (usesAxe) {
    damageToolAndReport(
      state,
      "axe",
      entity.itemId === "battery" ? 4 : 1,
      `tool-use:harvest:${entity.itemId}`,
    );
  }

  appendEvent(state, {
    type: "resource-picked",
    message: `拾取 ${ITEMS[entity.itemId].label} ×${acceptedAmount}。`,
    cause: { source: "command", code: "pick-up" },
    details: {
      entityId: entity.id,
      itemId: entity.itemId,
      amount: acceptedAmount,
      remaining: entity.quantity,
      depleted: entity.depleted,
      harvestLimit: perActionLimit,
      workSeconds,
    },
  });

  if (entity.itemId === "battery") {
    state.objectives.flags.batteryRecovered = true;
  }
  announceRecipeDiscoveries(state);
}

function handleEquipItem(
  state: GameState,
  command: Extract<GameCommand, { type: "equip-item" }>,
): void {
  if (command.itemId === null) {
    const previous = state.player.equippedItem ?? null;
    state.player.equippedItem = null;
    if (previous) {
      appendEvent(state, {
        type: "item-unequipped",
        message: `收起${ITEMS[previous].label}，双手恢复空闲。`,
        cause: { source: "command", code: "equipment:stow" },
        details: { itemId: previous },
      });
    }
    return;
  }
  if (state.inventory[command.itemId] <= 0) {
    rejectCommand(state, command, `背包里没有可装备的${ITEMS[command.itemId].label}。`, {
      itemId: command.itemId,
    });
    return;
  }
  state.player.equippedItem = command.itemId;
  appendEvent(state, {
    type: "item-equipped",
    message: `装备${ITEMS[command.itemId].label}。`,
    cause: { source: "command", code: `equipment:equip:${command.itemId}` },
    details: { itemId: command.itemId },
  });
}

function handleHarvest(
  state: GameState,
  command: Extract<GameCommand, { type: "harvest" }>,
  physicalValidated = false,
): void {
  const entity = state.world.entities[command.entityId];
  if (entity && !physicalValidated) {
    const actionId = resolveAffordance(state, entity).actionId;
    if (isPhysicalActionId(actionId)) {
      const validation = validateEntityPhysicalHit(
        state,
        entity,
        actionId,
        Math.max(0, Math.floor(state.player.poseRevision ?? 0)),
      );
      if (!validation.ok) {
        rejectPhysicalHit(state, command, validation);
        return;
      }
    }
  }
  if (entity && isMineableRockEntity(entity)) {
    normalizeMineableRockRuntime(entity);
  }
  if (entity && entity.kind === "resource" && isTreeEntity(entity)) {
    handleTreeHarvest(state, command, entity);
    return;
  }
  const intent = entity ? resolveHarvestIntent(entity) : null;
  if (
    !entity ||
    entity.kind !== "resource" ||
    entity.depleted ||
    entity.quantity <= 0 ||
    !entity.itemId ||
    !intent
  ) {
    rejectCommand(state, command, "这里没有可继续处理的采集目标。", {
      entityId: command.entityId,
    });
    return;
  }
  if (distanceBetween(state.player.position, entity.position) > entity.interactRadius) {
    rejectCommand(state, command, `需要靠近${entity.label}才能${actionNoun(intent.action)}。`, {
      entityId: entity.id,
      action: intent.action,
    });
    return;
  }

  let tool: EquippedHarvestTool | null = null;
  let requiredItem: EquippableItemId | null = null;
  if (intent.toolClass === "hand") {
    if (intent.toolTier > 0) {
      rejectCommand(state, command, "这项动作标记了不可用的徒手工具等级。", {
        entityId: entity.id,
        action: intent.action,
        requiredToolClass: intent.toolClass,
        requiredToolTier: intent.toolTier,
        equippedToolTier: 0,
      });
      return;
    }
  } else {
    requiredItem = REQUIRED_HARVEST_ITEM[intent.toolClass];
    tool = equippedHarvestTool(state);
    const equippedTier =
      tool?.toolClass === intent.toolClass ? tool.tier : 0;
    if (!tool || tool.toolClass !== intent.toolClass) {
      rejectCommand(
        state,
        command,
        `需要先装备${ITEMS[requiredItem].label}才能${actionNoun(intent.action)}。`,
        {
          entityId: entity.id,
          action: intent.action,
          requiredItem,
          requiredToolClass: intent.toolClass,
          requiredToolTier: intent.toolTier,
          equippedToolTier: equippedTier,
        },
      );
      return;
    }
    if (tool.tier < intent.toolTier) {
      rejectCommand(
        state,
        command,
        `这件${ITEMS[tool.itemId].label}只有 ${tool.tier} 阶，${entity.label}需要 ${intent.toolTier} 阶${actionNoun(intent.action)}工具。`,
        {
          entityId: entity.id,
          action: intent.action,
          requiredItem,
          equippedItem: tool.itemId,
          requiredToolClass: intent.toolClass,
          requiredToolTier: intent.toolTier,
          equippedToolTier: tool.tier,
        },
      );
      return;
    }
  }

  if (state.inventory[entity.itemId] >= ITEMS[entity.itemId].stackLimit) {
    rejectCommand(state, command, `背包装不下更多${ITEMS[entity.itemId].label}。`, {
      entityId: entity.id,
      itemId: entity.itemId,
      action: intent.action,
    });
    return;
  }

  const baseCost = HARVEST_ACTION_COSTS[intent.action];
  const rockProfile = isMineableRockEntity(entity)
    ? rockMiningProfile(entity)
    : null;
  const sizeSeconds = entity.semantic
    ? entity.semantic.size === "large"
      ? 1
      : entity.semantic.size === "medium"
        ? 0.5
        : 0
    : 0;
  const workSeconds = rockProfile
    ? rockProfile.workSeconds
    : baseCost.workSeconds + sizeSeconds;
  const staminaCost = rockProfile?.staminaCost ?? baseCost.stamina;
  const durabilityCost = rockProfile?.durabilityCost ?? 1;
  advanceWorkTime(state, workSeconds);
  if (state.status !== "playing") return;

  const accepted = addInventory(state, entity.itemId, 1);
  if (accepted !== 1) {
    // The capacity check above is authoritative for normal execution. This
    // guard prevents future inventory modifiers from consuming the node when
    // they reject a unit during the represented work interval.
    rejectCommand(state, command, "采集完成前背包容量发生变化，资源没有被消耗。", {
      entityId: entity.id,
      itemId: entity.itemId,
      action: intent.action,
    });
    return;
  }
  entity.quantity = Math.max(0, entity.quantity - accepted);
  entity.depleted = entity.quantity <= 0;
  scheduleResourceRegeneration(state, entity);
  state.player.vitals.stamina = clamp(
    state.player.vitals.stamina - staminaCost,
  );
  if (tool && isDurableTool(tool.itemId)) {
    damageToolAndReport(
      state,
      tool.itemId,
      durabilityCost,
      `tool-use:${intent.action}:${entity.id}`,
    );
  }
  appendEvent(state, {
    // Kept for save/progression compatibility; action/details distinguish the
    // concrete chop, mine, cut, and hand-pick settlements.
    type: "harvest-struck",
    message: actionHitMessage(entity, intent.action),
    cause: { source: "command", code: `harvest:${intent.action}` },
    details: {
      entityId: entity.id,
      itemId: entity.itemId,
      amount: accepted,
      remaining: entity.quantity,
      depleted: entity.depleted,
      workSeconds,
      staminaCost,
      durabilityCost,
      action: intent.action,
      semanticCategory: intent.category,
      requiredToolClass: intent.toolClass,
      requiredToolTier: intent.toolTier,
      ...(tool
        ? { equippedItem: tool.itemId, equippedToolTier: tool.tier }
        : { equippedToolTier: 0 }),
    },
  });
  if (CANOPY_JUNCTION_TENSION_VINE_IDS.includes(entity.id as typeof CANOPY_JUNCTION_TENSION_VINE_IDS[number])) {
    syncCanopyJunctionObstructions(state);
    const bothVinesCleared = CANOPY_JUNCTION_TENSION_VINE_IDS.every((id) => {
      const vine = state.world.entities[id];
      return Boolean(vine && (vine.depleted || vine.quantity <= 0));
    });
    if (bothVinesCleared) recordCanopyRepairRouteUsed(state, "tension-vines");
  }
  announceRecipeDiscoveries(state);
}

function canopyDirectionSector(directionRadians: number): string {
  const labels = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  const degrees =
    (((directionRadians * 180) / Math.PI) % 360 + 360) % 360;
  return labels[Math.round(degrees / 45) % labels.length];
}

function canopyConnectorRainBlocked(state: GameState): boolean {
  return (
    state.weather.rainIntensity >= CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD &&
    !isPointShelteredByCampStructures(state, CANOPY_JUNCTION_POSITION)
  );
}

function currentCanopyWind(state: GameState) {
  state.world.windField = normalizeWindFieldState(
    state.world.windField,
    state.seed,
    state.clock.tick,
  );
  return state.world.windField;
}

function handleInspectCanopyJunction(
  state: GameState,
  command: Extract<GameCommand, { type: "inspect-landmark" }>,
  entity: WorldEntity,
): void {
  syncCanopyJunctionObstructions(state);
  let junction = ensureCanopyJunctionRuntime(state);
  if (junction.phase === "obstructed") {
    const tree = state.world.entities[CANOPY_JUNCTION_OBSTRUCTION_TREE_ID];
    const cutVines = CANOPY_JUNCTION_TENSION_VINE_IDS.filter((id) => {
      const vine = state.world.entities[id];
      return Boolean(vine && (vine.depleted || vine.quantity <= 0));
    }).length;
    rejectCommand(
      state,
      command,
      `倒木仍压住箱门，受力藤本已切断 ${cutVines}/2；可继续分段搬走倒木，或用石刃切断两根藤本。`,
      {
        entityId: entity.id,
        blockingEntityId: tree?.id ?? CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
        cutTensionVines: cutVines,
        requiredTensionVines: CANOPY_JUNCTION_TENSION_VINE_IDS.length,
        reason: "access-obstructed",
      },
    );
    return;
  }

  if (junction.phase === "exposed") {
    if (canopyConnectorRainBlocked(state)) {
      rejectCommand(
        state,
        command,
        "强雨正冲刷箱门；现在开盖会进水。可在 C-17 上方搭叶棚，或等待雨势减弱。",
        {
          entityId: entity.id,
          reason: "rain-exposed",
          rainIntensity: state.weather.rainIntensity,
          shelterRequired: true,
        },
      );
      return;
    }
    advanceWorkTime(state, 6);
    if (state.status !== "playing") return;
    syncCanopyJunctionObstructions(state);
    junction = ensureCanopyJunctionRuntime(state);
    if (junction.phase !== "exposed" || canopyConnectorRainBlocked(state)) {
      rejectCommand(state, command, "检查期间雨势增强，防水接头没有被打开。", {
        entityId: entity.id,
        reason: "rain-exposed-settlement",
      });
      return;
    }
    const wind = currentCanopyWind(state);
    const strength = windFieldStrength(wind);
    state.world.canopyJunction = transitionCanopyJunctionPhase(
      junction,
      "connector-open",
      state.clock.tick,
    );
    const firstContradiction = !hasObjectiveFact(
      objectiveFacts(state),
      CAMPAIGN_FACTS.canopyContradictionObserved,
    );
    appendEvent(state, {
      type: "landmark-inspected",
      message: `受风叶片显示强度 ${strength.toFixed(2)}，但 C-17 面板仍固定在 0.0；防水盖已打开，插头退出了半圈。`,
      cause: { source: "command", code: `inspect:${entity.id}:contradiction` },
      details: {
        entityId: entity.id,
        workSeconds: 6,
        realWindStrength: strength,
        reportedWindStrength: 0,
        junctionPhase: "connector-open",
        ...(firstContradiction
          ? {
              factVerb: CAMPAIGN_FACTS.canopyContradictionObserved.verb,
              factSubjectId:
                CAMPAIGN_FACTS.canopyContradictionObserved.subjectId,
              milestoneId: "a2-canopy-contradiction-observed",
              createsMilestone: true,
            }
          : {}),
      },
    });
    return;
  }

  if (junction.phase === "connector-open") {
    if (canopyConnectorRainBlocked(state)) {
      rejectCommand(
        state,
        command,
        "接头仍暴露在强雨下；先搭叶棚或等雨势减弱，再复位防水环。",
        {
          entityId: entity.id,
          reason: "rain-exposed",
          rainIntensity: state.weather.rainIntensity,
        },
      );
      return;
    }
    const expectedPhaseTick = junction.phaseEnteredTick;
    advanceWorkTime(state, 25);
    if (state.status !== "playing") return;
    junction = ensureCanopyJunctionRuntime(state);
    if (
      junction.phase !== "connector-open" ||
      junction.phaseEnteredTick !== expectedPhaseTick ||
      canopyConnectorRainBlocked(state)
    ) {
      rejectCommand(
        state,
        command,
        "复位过程中现场条件发生变化；接头没有半写入，仍保持开放。",
        { entityId: entity.id, reason: "connector-settlement-changed" },
      );
      return;
    }
    state.world.canopyJunction = transitionCanopyJunctionPhase(
      junction,
      "link-restored",
      state.clock.tick,
    );
    appendCampaignFact(
      state,
      CAMPAIGN_FACTS.canopyLinkRestored,
      "防水插头已经对齐、压入并锁紧；C-17 载波灯恢复了真实脉冲。",
      {
        causeCode: "campaign:canopy-link-restored",
        details: {
          entityId: entity.id,
          workSeconds: 25,
          junctionPhase: "link-restored",
          milestoneId: "a2-canopy-link-restored",
          createsMilestone: true,
        },
      },
    );
    return;
  }

  if (junction.phase === "link-restored" || junction.phase === "sampling") {
    const wind = currentCanopyWind(state);
    appendEvent(state, {
      type: "landmark-inspected",
      message: `C-17 正在等待稳定阵风；当前现场强度 ${windFieldStrength(wind).toFixed(2)}，采样会在离开时继续。`,
      cause: { source: "command", code: `inspect:${entity.id}:sampling` },
      details: {
        entityId: entity.id,
        junctionPhase: junction.phase,
        readableTicks: junction.consecutiveReadableTicks,
      },
    });
    return;
  }

  const sample = junction.sample;
  if (junction.phase === "sample-ready" && sample) {
    const firstObservation = !hasObjectiveFact(
      objectiveFacts(state),
      CAMPAIGN_FACTS.canopyLiveSampleObserved,
    );
    appendEvent(state, {
      type: "landmark-inspected",
      message: `有效样本：${canopyDirectionSector(sample.directionRadians)}向，强度 ${sample.strength.toFixed(2)}，信号质量 ${Math.round(sample.signalQuality * 100)}%。`,
      cause: { source: "command", code: `inspect:${entity.id}:sample` },
      details: {
        entityId: entity.id,
        junctionPhase: junction.phase,
        directionSector: canopyDirectionSector(sample.directionRadians),
        windStrength: sample.strength,
        signalQuality: sample.signalQuality,
        capturedAtTick: sample.capturedAtTick,
        ...(firstObservation
          ? {
              factVerb: CAMPAIGN_FACTS.canopyLiveSampleObserved.verb,
              factSubjectId: CAMPAIGN_FACTS.canopyLiveSampleObserved.subjectId,
              milestoneId: "a2-canopy-live-sample-observed",
              createsMilestone: true,
            }
          : {}),
      },
    });
    return;
  }

  appendEvent(state, {
    type: "landmark-inspected",
    message: "C-17 样本已经上报；现场链路继续提供真实林冠风数据。",
    cause: { source: "command", code: `inspect:${entity.id}:reported` },
    details: { entityId: entity.id, junctionPhase: junction.phase },
  });
}

function handleInspectLandmark(
  state: GameState,
  command: Extract<GameCommand, { type: "inspect-landmark" }>,
): void {
  const entity = state.world.entities[command.entityId];
  if (!entity || (entity.kind !== "landmark" && entity.kind !== "radio")) {
    rejectCommand(state, command, "这里没有可调查的地标。", { entityId: command.entityId });
    return;
  }
  if (distanceBetween(state.player.position, entity.position) > entity.interactRadius) {
    rejectCommand(state, command, "需要靠近后才能仔细调查。", { entityId: entity.id });
    return;
  }
  if (entity.id === CANOPY_JUNCTION_ID) {
    handleInspectCanopyJunction(state, command, entity);
    return;
  }
  if (entity.id === RIVER_GAUGE_ID) {
    const obstruction = state.world.entities[RIVER_GAUGE_OBSTRUCTION_ID];
    if (obstruction && !treeIsDepleted(obstruction)) {
      rejectCommand(
        state,
        command,
        "倒木仍压住水尺下部刻度；先装备石斧分段并搬走原木。",
        {
          entityId: entity.id,
          blockingEntityId: obstruction.id,
          reason: "access-obstructed",
        },
      );
      return;
    }
    if (obstruction) recordRiverGaugeClearanceIfNeeded(state, obstruction);
    const firstReading = !hasObjectiveFact(
      objectiveFacts(state),
      CAMPAIGN_FACTS.riverTrendObserved,
    );
    const workSeconds = 6;
    advanceWorkTime(state, workSeconds);
    if (state.status !== "playing") return;
    const hydrology = normalizeRiverHydrologyState(
      state.world.riverHydrology,
      state.clock.tick,
    );
    state.world.riverHydrology = hydrology;
    const trend = riverLevelTrend(hydrology);
    const trendLabel =
      trend === "rising" ? "上涨" : trend === "falling" ? "回落" : "稳定";
    const safetyDelta = RIVER_GAUGE_SAFE_LEVEL_METERS - hydrology.levelMeters;
    appendEvent(state, {
      type: "landmark-inspected",
      message: `水尺读数 ${hydrology.levelMeters.toFixed(2)} 米，趋势${trendLabel}；距橙色安全线 ${Math.abs(safetyDelta).toFixed(2)} 米${safetyDelta >= 0 ? "" : "（已越线）"}。`,
      cause: { source: "command", code: `inspect:${entity.id}` },
      details: {
        entityId: entity.id,
        workSeconds,
        riverLevelMeters: hydrology.levelMeters,
        riverTrend: trend,
        safetyDeltaMeters: safetyDelta,
        createsMilestone: firstReading,
        factVerb: CAMPAIGN_FACTS.riverTrendObserved.verb,
        factSubjectId: CAMPAIGN_FACTS.riverTrendObserved.subjectId,
      },
    });
    return;
  }
  if (hasInspectedLandmark(state, entity.id)) {
    rejectCommand(state, command, "这处线索已经记录在笔记里。", { entityId: entity.id });
    return;
  }
  if (
    entity.id === "landmark.weather-station" &&
    (!hasInspectedLandmark(state, "landmark.camp-radio") ||
      !hasInspectedLandmark(state, "landmark.survey-cache"))
  ) {
    rejectCommand(state, command, "缺少电台故障记录与勘测坐标，无法判断该从哪组设备入手。", {
      entityId: entity.id,
    });
    return;
  }

  const workSeconds = 12;
  advanceWorkTime(state, workSeconds);
  if (state.status !== "playing") return;
  const message =
    entity.id === "landmark.camp-radio"
      ? "拆开电台后确认：发射机仍能工作，缺少的是气象站制式电池；旧航线指向西北岩棚。"
      : entity.id === "landmark.survey-cache"
        ? "勘测箱里的防水图标出了气象站坐标，以及一条避开沼地的山脊路线。"
        : "气象站控制柜仍有余电。电池托架已经锈死，可以用石斧从侧面撬开。";
  appendEvent(state, {
    type: "landmark-inspected",
    message,
    cause: { source: "command", code: `inspect:${entity.id}` },
    details: { entityId: entity.id, workSeconds },
  });
}

function handleCraft(
  state: GameState,
  command: Extract<GameCommand, { type: "craft" }>,
): void {
  const recipe = RECIPES[command.recipeId];
  const reportCheckFailure = (
    check: ReturnType<typeof canCraft>,
    phase: "preflight" | "settlement",
  ) => {
    const missingItems = Object.entries(check.missingItems)
      .map(([itemId, amount]) => `${itemId}:${amount}`)
      .join(",");
    appendEvent(state, {
      type: "craft-failed",
      message:
        check.reason === "rain-exposed"
          ? phase === "settlement"
            ? `制作期间雨势增强。${CAMPFIRE_RAIN_EXPOSED_GUIDANCE}`
            : CAMPFIRE_RAIN_EXPOSED_GUIDANCE
          : phase === "settlement"
          ? `制作期间条件发生变化，未消耗材料：${recipe?.label ?? command.recipeId}。`
          : `无法制作${recipe?.label ?? command.recipeId}。`,
      cause: {
        source: "command",
        code:
          phase === "settlement"
            ? `craft:${command.recipeId}:settlement`
            : `craft:${command.recipeId}`,
      },
      details: {
        recipeId: command.recipeId,
        reason: check.reason ?? "missing-materials",
        missingItems,
        missingTools: check.missingTools.join(","),
        phase,
      },
    });
  };

  const preflightCheck = canCraftAtPlacement(
    state,
    command.recipeId,
    command.placement,
  );
  if (!preflightCheck.ok) {
    reportCheckFailure(preflightCheck, "preflight");
    return;
  }
  if (!placementIsValid(state, recipe.effect, command.placement)) {
    appendEvent(state, {
      type: "craft-failed",
      message: "这里无法稳固放置该建筑；靠近目标位置并留出平整空间。",
      cause: { source: "command", code: `craft:${command.recipeId}:placement` },
      details: {
        recipeId: command.recipeId,
        reason: "invalid-placement",
      },
    });
    return;
  }

  advanceWorkTime(state, recipe.workSeconds);
  if (state.status !== "playing") return;

  // Work can advance spoilage, fire, tools and other deterministic systems.
  // Revalidate every crafting prerequisite before entering the commit section;
  // nothing below this point can reject a partial inventory settlement.
  const settlementCheck = canCraftAtPlacement(
    state,
    command.recipeId,
    command.placement,
  );
  if (!settlementCheck.ok) {
    reportCheckFailure(settlementCheck, "settlement");
    return;
  }
  if (!placementIsValid(state, recipe.effect, command.placement)) {
    appendEvent(state, {
      type: "craft-failed",
      message: "制作期间放置位置发生变化；材料仍保留在背包中。",
      cause: {
        source: "command",
        code: `craft:${command.recipeId}:placement-settlement`,
      },
      details: {
        recipeId: command.recipeId,
        reason: "invalid-placement",
        phase: "settlement",
      },
    });
    return;
  }

  const transferredTorch =
    recipe.id === "torch-waymark"
      ? takeNextTorchInventoryUnit(state)
      : null;
  if (recipe.id === "torch-waymark" && !transferredTorch) {
    appendEvent(state, {
      type: "craft-failed",
      message: "制作完成前没有找到仍有燃料的实体火把；其他材料保持原样。",
      cause: {
        source: "command",
        code: "craft:torch-waymark:torch-settlement",
      },
      details: {
        recipeId: recipe.id,
        reason: "missing-usable-torch",
        phase: "settlement",
        interrupted: true,
      },
    });
    return;
  }
  if (transferredTorch?.wasEquipped) {
    appendEvent(state, {
      type: "item-unequipped",
      message: "手中的火把被固定到路标上，你重新空出了双手。",
      cause: { source: "command", code: "craft:torch-waymark:transfer" },
      details: { itemId: "torch", recipeId: recipe.id },
    });
  }

  for (const [itemId, amount] of Object.entries(recipe.ingredients) as [
    ItemId,
    number,
  ][]) {
    if (recipe.id === "torch-waymark" && itemId === "torch") continue;
    consumeLifecycleInventory(state, itemId, amount);
  }
  for (const [itemId, amount] of Object.entries(recipe.results ?? {}) as [
    ItemId,
    number,
  ][]) {
    addInventory(state, itemId, amount);
  }
  const placedStructure = applyRecipeEffect(
    state,
    recipe.effect,
    command.placement,
    transferredTorch?.remainingBurnSeconds,
  );

  if (recipe.id === "torch-waymark" && placedStructure && transferredTorch) {
    appendEvent(state, {
      type: "structure-fuel-added",
      message: "把实体火把固定进路标；剩余燃料被完整保留。",
      cause: { source: "command", code: "torch-waymark:build-fuel" },
      details: {
        structureId: placedStructure.id,
        itemId: "torch",
        fuelAddedSeconds: transferredTorch.remainingBurnSeconds,
        totalFuelSeconds: transferredTorch.remainingBurnSeconds,
        fuelSlots: 1,
      },
    });
    appendEvent(state, {
      type: "structure-ignited",
      message: "火把路标亮起，为下一段远征留下可维护的光点。",
      cause: { source: "command", code: "torch-waymark:build-ignite" },
      details: {
        structureId: placedStructure.id,
        totalFuelSeconds: transferredTorch.remainingBurnSeconds,
      },
    });
  }

  for (const toolId of recipe.tools ?? []) {
    if (!isDurableTool(toolId)) continue;
    const cost = recipe.id === "shelter" ? 4 : recipe.id === "bed" ? 3 : 1;
    damageToolAndReport(
      state,
      toolId,
      cost,
      `tool-use:craft:${recipe.id}`,
    );
  }

  appendEvent(state, {
    type: "craft-succeeded",
    message: `完成制作：${recipe.label}。`,
    cause: { source: "command", code: `craft:${recipe.id}` },
    details: {
      recipeId: recipe.id,
      workSeconds: recipe.workSeconds,
      ...(placedStructure ? { structureId: placedStructure.id } : {}),
      ...(command.placement
        ? {
            placed: true,
            placementX: command.placement.position.x,
            placementY: command.placement.position.y,
            placementZ: command.placement.position.z,
            placementYaw: command.placement.yaw,
          }
        : {}),
    },
  });
  announceRecipeDiscoveries(state);
  refreshCampObjective(state);
}

function handleUseItem(
  state: GameState,
  command: Extract<GameCommand, { type: "use-item" }>,
): void {
  if (state.inventory[command.itemId] <= 0) {
    rejectCommand(state, command, `没有可用的${ITEMS[command.itemId].label}。`, {
      itemId: command.itemId,
    });
    return;
  }

  if (command.itemId === "bandage" && !state.player.conditions.wound.open) {
    rejectCommand(state, command, "当前没有需要包扎的开放伤口。");
    return;
  }
  if (command.itemId === "antiparasitic-herb" && state.player.conditions.parasites <= 0) {
    rejectCommand(state, command, "目前没有检测到寄生虫。");
    return;
  }
  advanceWorkTime(state, 8);
  if (state.status !== "playing") return;

  if (command.itemId === "bandage") {
    const wound = state.player.conditions.wound;
    state.inventory.bandage -= 1;
    wound.open = false;
    wound.treated = true;
    wound.severity = Math.max(0, wound.severity - 16);
    wound.infection = Math.max(0, wound.infection - 6);
    state.player.vitals.health += 6;
    state.player.vitals.sanity += 4;
    state.objectives.flags.woundTreated = true;
    appendEvent(state, {
      type: "wound-treated",
      message: "草药绷带压住伤口，出血终于停止。",
      cause: { source: "command", code: "use-item:bandage" },
    });
  } else {
    state.inventory["antiparasitic-herb"] -= 1;
    state.player.conditions.parasites -= 1;
    appendEvent(state, {
      type: "parasite-cleared",
      message: "苦味草药缓解了腹部绞痛。",
      cause: { source: "command", code: "use-item:antiparasitic-herb" },
      details: { remaining: state.player.conditions.parasites },
    });
  }

  appendEvent(state, {
    type: "item-used",
    message: `使用了${ITEMS[command.itemId].label}。`,
    cause: { source: "command", code: command.type },
    details: { itemId: command.itemId },
  });
}

function handleEat(
  state: GameState,
  command: Extract<GameCommand, { type: "eat" }>,
): void {
  const definition = ITEMS[command.itemId];
  if (state.inventory[command.itemId] <= 0 || !definition.edible) {
    rejectCommand(state, command, "该物品不能食用或数量不足。", {
      itemId: command.itemId,
    });
    return;
  }
  consumeLifecycleInventory(state, command.itemId, 1);
  advanceWorkTime(state, 5);
  if (state.status !== "playing") return;
  applyNutritionDelta(state, definition.edible);
  state.player.vitals.energy += definition.edible.energy ?? 0;
  const sanityDelta = definition.edible.sanity ?? 0;
  if (sanityDelta < 0) {
    applySanityLoss(state, {
      sourceCode: `consumption:${command.itemId}`,
      sourceLabel: `食用${definition.label}`,
      amount: -sanityDelta,
    });
  } else {
    state.player.vitals.sanity += sanityDelta;
  }
  let contractedParasite = false;
  if (command.itemId === "raw-meat") {
    const riskRoll = drawRandom(state.rng, "conditions");
    if (riskRoll < 0.45 && state.player.conditions.parasites < 3) {
      state.player.conditions.parasites += 1;
      contractedParasite = true;
      appendEvent(state, {
        type: "parasite-contracted",
        message: "没有熟透的猎物肉带来了寄生虫。",
        cause: { source: "command", code: "eat:raw-meat" },
        details: { itemId: command.itemId, riskRoll },
      });
    }
  }
  appendEvent(state, {
    type: "item-used",
    message: `食用了${definition.label}。`,
    cause: { source: "command", code: "eat" },
    details: { itemId: command.itemId, contractedParasite },
  });
}

export function activeWildlifeProjections(
  state: GameState,
): EcologyRenderProjection[] {
  const active = projectActiveWildlife(state);
  // Legacy states may reach a command before explicit migration. Retain the
  // exact ledger already used above so combat never swaps projection sources.
  state.ecology ??= active.ecology;
  return active.wildlife;
}

function wildlifeById(
  state: GameState,
  individualId: string,
): EcologyRenderProjection | null {
  return (
    activeWildlifeProjections(state).find(
      (projection) => projection.individualId === individualId,
    ) ?? null
  );
}

function horizontalWildlifeDistance(
  state: GameState,
  wildlife: EcologyRenderProjection,
): number {
  return Math.hypot(
    state.player.position.x - wildlife.position.x,
    state.player.position.z - wildlife.position.z,
  );
}

function handleAttackWildlife(
  state: GameState,
  command: Extract<GameCommand, { type: "attack-wildlife" }>,
  physicalValidated = false,
): void {
  const wildlife = wildlifeById(state, command.individualId);
  if (wildlife && !physicalValidated) {
    const validation = validateWildlifePhysicalHit(
      state,
      wildlife,
      "attack",
      Math.max(0, Math.floor(state.player.poseRevision ?? 0)),
    );
    if (!validation.ok) {
      rejectPhysicalHit(state, command, validation);
      return;
    }
  }
  if (!wildlife || !wildlife.visible || wildlife.health <= 0) {
    rejectCommand(state, command, "目标已经离开视线或倒下。", {
      individualId: command.individualId,
    });
    return;
  }
  const distance = horizontalWildlifeDistance(state, wildlife);
  if (distance > WILDLIFE_ATTACK_RANGE) {
    rejectCommand(state, command, "猎物不在石矛的有效攻击距离内。", {
      individualId: wildlife.individualId,
      distance,
      range: WILDLIFE_ATTACK_RANGE,
    });
    return;
  }
  if (state.inventory.spear <= 0 || state.player.equippedItem !== "spear") {
    rejectCommand(state, command, "需要先装备石矛才能主动攻击动物。", {
      individualId: wildlife.individualId,
      requiredItem: "spear",
    });
    return;
  }
  if (state.player.vitals.stamina < 4) {
    rejectCommand(state, command, "体力不足，无法完成一次稳定刺击。", {
      individualId: wildlife.individualId,
    });
    return;
  }

  advanceWorkTime(state, 2);
  if (state.status !== "playing") return;
  const species = ECOLOGY_SPECIES[wildlife.speciesId];
  const previousHealth = wildlife.health;
  const health = Math.max(0, previousHealth - species.combat.spearDamage);
  const defeated = health <= 0;
  state.ecology ??= createEcologyState(state.seed, { activeChunks: [] });
  state.ecology.individuals ??= {};
  const previousCondition = state.ecology.individuals[wildlife.individualId];
  const condition: EcologyIndividualState = {
    speciesId: wildlife.speciesId,
    health,
    maxHealth: wildlife.maxHealth,
    lastHitTick: state.clock.tick,
    defeatedAtTick: defeated ? state.clock.tick : null,
    respawnAtTick: defeated
      ? state.clock.tick + gameHoursToTicks(species.combat.recoveryGameHours)
      : null,
    lastContactTick: previousCondition?.lastContactTick ?? null,
  };
  const retainsProceduralCorpse =
    defeated && wildlife.speciesId !== AUTHORED_SNAKE_SPECIES_ID;
  if (retainsProceduralCorpse) {
    const yields = WILDLIFE_YIELDS[wildlife.speciesId];
    condition.pendingMeat = yields.meat;
    condition.pendingHide = yields.hide;
    condition.corpse = {
      chunkKey: wildlife.chunkKey,
      position: { ...wildlife.position },
      headingRadians: wildlife.headingRadians,
    };
  }
  state.ecology.individuals[wildlife.individualId] = condition;
  state.player.vitals.stamina = clamp(state.player.vitals.stamina - 6);
  damageToolAndReport(
    state,
    "spear",
    defeated ? 3 : 2,
    `tool-use:wildlife:${wildlife.speciesId}`,
  );

  if (!defeated) {
    appendEvent(state, {
      type: "wildlife-hit",
      message: `${wildlife.label}受伤后改变方向，仍有反击或逃脱能力。`,
      cause: { source: "command", code: `wildlife:hit:${wildlife.speciesId}` },
      details: {
        individualId: wildlife.individualId,
        speciesId: wildlife.speciesId,
        previousHealth,
        health,
        maxHealth: wildlife.maxHealth,
      },
    });
    return;
  }

  const yields = WILDLIFE_YIELDS[wildlife.speciesId];
  const meatAccepted = retainsProceduralCorpse
    ? 0
    : addInventory(state, "raw-meat", yields.meat);
  const hideAccepted = retainsProceduralCorpse
    ? 0
    : addInventory(state, "hide", yields.hide);
  const pendingMeat = retainsProceduralCorpse
    ? yields.meat
    : Math.max(0, yields.meat - meatAccepted);
  const pendingHide = retainsProceduralCorpse
    ? yields.hide
    : Math.max(0, yields.hide - hideAccepted);
  const lootRetained = pendingMeat + pendingHide > 0;
  if (!retainsProceduralCorpse && lootRetained) {
    condition.pendingMeat = pendingMeat;
    condition.pendingHide = pendingHide;
  }
  appendEvent(state, {
    type: "wildlife-defeated",
    message: retainsProceduralCorpse
      ? `${wildlife.label}倒下。${pendingMeat > 0 ? `生肉 ×${pendingMeat}` : ""}${pendingMeat > 0 && pendingHide > 0 ? "、" : ""}${pendingHide > 0 ? `兽皮 ×${pendingHide}` : ""}留在尸体上，靠近后收取。`
      : `${wildlife.label}倒下。处理获得生肉 ×${meatAccepted}${hideAccepted > 0 ? `、兽皮 ×${hideAccepted}` : ""}。${lootRetained ? "背包装不下的部分仍留在尸体上。" : ""}`,
    cause: { source: "command", code: `wildlife:defeated:${wildlife.speciesId}` },
    details: {
      individualId: wildlife.individualId,
      speciesId: wildlife.speciesId,
      ...(meatAccepted > 0
        ? { itemId: "raw-meat" }
        : hideAccepted > 0
          ? { itemId: "hide" }
          : { lootItemId: "raw-meat" }),
      ...(meatAccepted > 0 && hideAccepted > 0
        ? { secondaryItemId: "hide" }
        : {}),
      amount: meatAccepted,
      hideAmount: hideAccepted,
      pendingMeat,
      pendingHide,
      corpseRetained: lootRetained,
      ...(condition.corpse
        ? {
            corpseX: condition.corpse.position.x,
            corpseY: condition.corpse.position.y,
            corpseZ: condition.corpse.position.z,
          }
        : {}),
      respawnAtTick: condition.respawnAtTick ?? 0,
    },
  });
  announceRecipeDiscoveries(state);
}

function rejectPhysicalHit(
  state: GameState,
  command: GameCommand,
  validation: Extract<PhysicalHitValidationResult, { ok: false }>,
): void {
  const message = validation.reason === "stale-pose"
    ? "动作姿态已经变化，请重新瞄准后再出手。"
    : validation.reason === "occluded"
      ? "工具挥击路径被前方物体挡住了。"
      : validation.reason === "target-missed"
        ? "这次挥击没有碰到目标。"
        : validation.reason === "action-mismatch"
          ? "目标当前已不再接受这项动作。"
          : "当前目标无法完成这次实体交互。";
  rejectCommand(state, command, message, {
    targetId: validation.targetId,
    hitReason: validation.reason,
    ...(validation.blockerId ? { blockerId: validation.blockerId } : {}),
  });
}

function handlePhysicalAction(
  state: GameState,
  command: Extract<GameCommand, { type: "physical-action" }>,
): void {
  if (command.targetId.startsWith("wildlife:")) {
    const individualId = command.targetId.slice("wildlife:".length);
    const wildlife = wildlifeById(state, individualId);
    if (!wildlife) {
      rejectCommand(state, command, "目标已经离开当前活动区域。", {
        targetId: command.targetId,
      });
      return;
    }
    const validation = validateWildlifePhysicalHit(
      state,
      wildlife,
      command.actionId,
      command.poseRevision,
    );
    if (!validation.ok) {
      rejectPhysicalHit(state, command, validation);
      return;
    }
    handleAttackWildlife(
      state,
      { type: "attack-wildlife", individualId },
      true,
    );
    return;
  }

  const entity = state.world.entities[command.targetId];
  if (!entity) {
    rejectCommand(state, command, "目标已经不在当前世界状态中。", {
      targetId: command.targetId,
    });
    return;
  }
  const validation = validateEntityPhysicalHit(
    state,
    entity,
    command.actionId,
    command.poseRevision,
  );
  if (!validation.ok) {
    rejectPhysicalHit(state, command, validation);
    return;
  }
  handleHarvest(state, { type: "harvest", entityId: entity.id }, true);
}

function handleCollectWildlifeLoot(
  state: GameState,
  command: Extract<GameCommand, { type: "collect-wildlife-loot" }>,
): void {
  const wildlife = wildlifeById(state, command.individualId);
  const condition = state.ecology?.individuals?.[command.individualId];
  if (!wildlife || !condition || condition.health > 0) {
    rejectCommand(state, command, "猎物已经消失或恢复活动。", {
      individualId: command.individualId,
    });
    return;
  }
  const distance = horizontalWildlifeDistance(state, wildlife);
  if (distance > WILDLIFE_ATTACK_RANGE) {
    rejectCommand(state, command, "需要靠近尸体才能收取剩余物资。", {
      individualId: wildlife.individualId,
      distance,
      range: WILDLIFE_ATTACK_RANGE,
    });
    return;
  }
  const pendingMeat = Math.max(0, condition.pendingMeat ?? 0);
  const pendingHide = Math.max(0, condition.pendingHide ?? 0);
  if (pendingMeat + pendingHide <= 0) {
    rejectCommand(state, command, "尸体上已经没有可收取的物资。", {
      individualId: wildlife.individualId,
    });
    return;
  }
  const hasCapacity =
    (pendingMeat > 0 &&
      state.inventory["raw-meat"] < ITEMS["raw-meat"].stackLimit) ||
    (pendingHide > 0 && state.inventory.hide < ITEMS.hide.stackLimit);
  if (!hasCapacity) {
    rejectCommand(state, command, "背包仍然没有空间；物资会继续留在尸体中。", {
      individualId: wildlife.individualId,
      pendingMeat,
      pendingHide,
    });
    return;
  }
  const meatAccepted = addInventory(state, "raw-meat", pendingMeat);
  const hideAccepted = addInventory(state, "hide", pendingHide);
  if (meatAccepted + hideAccepted <= 0) {
    rejectCommand(state, command, "背包仍然没有空间；物资会继续留在尸体上。", {
      individualId: wildlife.individualId,
    });
    return;
  }
  condition.pendingMeat = pendingMeat - meatAccepted;
  condition.pendingHide = pendingHide - hideAccepted;
  const remainingLoot = condition.pendingMeat + condition.pendingHide;
  if (remainingLoot <= 0) delete condition.corpse;
  appendEvent(state, {
    type: "wildlife-loot-collected",
    message: `从${wildlife.label}上收取${meatAccepted > 0 ? `生肉 ×${meatAccepted}` : ""}${meatAccepted > 0 && hideAccepted > 0 ? "、" : ""}${hideAccepted > 0 ? `兽皮 ×${hideAccepted}` : ""}。`,
    cause: { source: "command", code: "wildlife:loot-collected" },
    details: {
      individualId: wildlife.individualId,
      speciesId: wildlife.speciesId,
      ...(meatAccepted > 0
        ? { itemId: "raw-meat" }
        : hideAccepted > 0
          ? { itemId: "hide" }
          : {}),
      ...(meatAccepted > 0 && hideAccepted > 0
        ? { secondaryItemId: "hide" }
        : {}),
      amount: meatAccepted,
      hideAmount: hideAccepted,
      pendingMeat: condition.pendingMeat,
      pendingHide: condition.pendingHide,
      corpseRetained: remainingLoot > 0,
    },
  });
  announceRecipeDiscoveries(state);
}

function handleWildlifeEncounter(
  state: GameState,
  command: Extract<GameCommand, { type: "encounter-wildlife" }>,
): void {
  const wildlife = wildlifeById(state, command.individualId);
  if (
    !wildlife ||
    !wildlife.visible ||
    wildlife.role !== "predator" ||
    wildlife.health <= 0
  ) {
    rejectCommand(state, command, "捕食者已经离开接触范围。", {
      individualId: command.individualId,
    });
    return;
  }
  const distance = horizontalWildlifeDistance(state, wildlife);
  if (distance > PREDATOR_CONTACT_RANGE) {
    rejectCommand(state, command, "你及时与捕食者拉开了距离。", {
      individualId: wildlife.individualId,
      distance,
    });
    return;
  }
  const current = state.ecology?.individuals?.[wildlife.individualId];
  if (
    current?.lastContactTick !== undefined &&
    current.lastContactTick !== null &&
    state.clock.tick - current.lastContactTick < WILDLIFE_CONTACT_COOLDOWN_TICKS
  ) {
    return;
  }
  const contact = validateWildlifeContactHit(state, wildlife);
  if (!contact.ok) return;
  state.ecology ??= createEcologyState(state.seed, { activeChunks: [] });
  state.ecology.individuals ??= {};
  const species = ECOLOGY_SPECIES[wildlife.speciesId];
  state.ecology.individuals[wildlife.individualId] = {
    speciesId: wildlife.speciesId,
    health: current?.health ?? wildlife.health,
    maxHealth: wildlife.maxHealth,
    lastHitTick: current?.lastHitTick ?? state.clock.tick,
    defeatedAtTick: current?.defeatedAtTick ?? null,
    respawnAtTick: current?.respawnAtTick ?? null,
    lastContactTick: state.clock.tick,
  };
  const snake = wildlife.speciesId === AUTHORED_SNAKE_SPECIES_ID;
  const healthBefore = state.player.vitals.health;
  applyHealthLoss(state, {
    sourceCode: `wildlife:contact:${wildlife.speciesId}`,
    sourceLabel: wildlife.label,
    amount: species.combat.contactDamage,
  });
  const healthAfter = state.player.vitals.health;
  applySanityLoss(state, {
    sourceCode: `wildlife:contact:${wildlife.speciesId}`,
    sourceLabel: `${wildlife.label}的袭击`,
    amount: snake ? 8 : 6,
  });
  state.player.conditions.wound.open = true;
  state.player.conditions.wound.treated = false;
  state.player.conditions.wound.severity = clamp(
    state.player.conditions.wound.severity + (snake ? 20 : 12),
  );
  if (snake) {
    state.player.conditions.wound.infection = clamp(
      state.player.conditions.wound.infection + 4,
    );
  }
  appendEvent(state, {
    type: snake ? "snake-bite" : "wildlife-attack",
    message: snake
      ? `${wildlife.label}完成扑咬。它正在回缩；立刻拉开距离，处理开放伤口。`
      : `${wildlife.label}完成扑击。拉开距离、观察其动向，再决定反击或撤退。`,
    cause: { source: "system", code: `wildlife:contact:${wildlife.speciesId}` },
    details: {
      individualId: wildlife.individualId,
      speciesId: wildlife.speciesId,
      sourceLabel: wildlife.label,
      healthLost: healthBefore - healthAfter,
      healthBefore,
      healthAfter,
      lethal: healthBefore > 0 && healthAfter <= 0,
      directionDegrees: compassBearingFromPlayer(state, wildlife.position),
    },
  });
}

interface ResolvedWaterSource {
  id: string;
  kind: "authored" | "river";
  anchor: { x: number; z: number };
  range: number;
  contamination: number;
  surfaceY: number;
}

interface WaterSourceBlocker {
  message: string;
  details: Record<string, EventDetailValue>;
}

function resolveWaterSource(
  state: GameState,
  sourceEntityId: string,
): ResolvedWaterSource | null {
  const riverLevelMeters = normalizeRiverHydrologyState(
    state.world.riverHydrology,
    state.clock.tick,
  ).levelMeters;
  const authored = state.world.entities[sourceEntityId];
  if (authored?.kind === "water") {
    return {
      id: authored.id,
      kind: "authored",
      anchor: { x: authored.position.x, z: authored.position.z },
      range: authored.interactRadius,
      contamination: authored.contamination ?? RIVER_WATER_CONTAMINATION,
      surfaceY: isRiverSurfacePoint(authored.position)
        ? riverSurfaceHeight(authored.position.x, riverLevelMeters)
        : authored.position.y,
    };
  }
  const river = parseRiverWaterTargetId(sourceEntityId);
  if (!river || !isRiverSurfacePoint(river.anchor)) return null;
  return {
    id: river.id,
    kind: "river",
    anchor: river.anchor,
    range: RIVER_USE_RANGE,
    contamination: RIVER_WATER_CONTAMINATION,
    surfaceY: riverSurfaceHeight(river.anchor.x, riverLevelMeters),
  };
}

function validateWaterSourceAccess(
  state: GameState,
  source: ResolvedWaterSource,
): WaterSourceBlocker | null {
  if (source.kind === "river" && !isRiverSurfacePoint(source.anchor)) {
    return {
      message: "目标不在真实河面上。",
      details: { entityId: source.id },
    };
  }
  const distance = Math.hypot(
    state.player.position.x - source.anchor.x,
    state.player.position.z - source.anchor.z,
  );
  if (distance > source.range) {
    return {
      message: "距离水源太远。",
      details: { entityId: source.id, distance, range: source.range },
    };
  }
  const reach = validateWaterReachHit(state, {
    playerX: state.player.position.x,
    playerZ: state.player.position.z,
    playerGroundY: terrainHeight(
      state.player.position.x,
      state.player.position.z,
    ),
    targetId: source.id,
    targetX: source.anchor.x,
    targetZ: source.anchor.z,
    targetSurfaceY: source.surfaceY,
  });
  if (!reach.ok) {
    return {
      message: "水源被墙体或建筑遮挡；需要走到能直接够到河面的地方。",
      details: {
        entityId: source.id,
        blockedByWorldGeometry: true,
        hitReason: reach.reason,
        ...(reach.blocker ? { blockerId: reach.blocker.id } : {}),
      },
    };
  }
  return null;
}

function handleCollectWater(
  state: GameState,
  command: Extract<GameCommand, { type: "collect-water" }>,
): void {
  const source = resolveWaterSource(state, command.sourceEntityId);
  if (!source) {
    rejectCommand(state, command, "没有找到可取水的水源。", {
      entityId: command.sourceEntityId,
    });
    return;
  }
  const blocker = validateWaterSourceAccess(state, source);
  if (blocker) {
    rejectCommand(state, command, blocker.message, blocker.details);
    return;
  }
  if (getAvailableWaterContainerCount(state) <= 0) {
    rejectCommand(state, command, "需要一个空椰壳容器。", {
      requiredItem: "coconut-shell",
    });
    return;
  }
  advanceWorkTime(state, 10);
  if (state.status !== "playing") return;
  const refreshed = resolveWaterSource(state, command.sourceEntityId);
  if (!refreshed) {
    rejectCommand(state, command, "取水时水源已经失去；没有装入任何溪水。", {
      entityId: command.sourceEntityId,
      interrupted: true,
    });
    return;
  }
  const refreshedBlocker = validateWaterSourceAccess(state, refreshed);
  if (refreshedBlocker) {
    rejectCommand(state, command, refreshedBlocker.message, {
      ...refreshedBlocker.details,
      interrupted: true,
    });
    return;
  }
  if (getAvailableWaterContainerCount(state) <= 0) {
    rejectCommand(state, command, "取水完成前空椰壳已不可用；背包保持原样。", {
      requiredItem: "coconut-shell",
      interrupted: true,
    });
    return;
  }
  state.inventory["dirty-water"] += 1;
  appendEvent(state, {
    type: "water-collected",
    message: "椰壳里盛满了浑浊溪水。",
    cause: { source: "command", code: "collect-water" },
    details: {
      sourceEntityId: refreshed.id,
      sourceKind: refreshed.kind,
      itemId: "dirty-water",
      contamination: refreshed.contamination,
    },
  });
}

function handleCollectRainwater(
  state: GameState,
  command: Extract<GameCommand, { type: "collect-rainwater" }>,
): void {
  if (state.weather.rainIntensity < 0.35) {
    rejectCommand(state, command, "雨势太小，暂时接不到足量雨水。");
    return;
  }
  if (getAvailableWaterContainerCount(state) <= 0) {
    rejectCommand(state, command, "需要一个空椰壳容器。", {
      requiredItem: "coconut-shell",
    });
    return;
  }
  advanceWorkTime(state, 12);
  if (state.status !== "playing") return;
  state.inventory["clean-water"] += 1;
  appendEvent(state, {
    type: "water-collected",
    message: "椰壳接到了一份干净雨水。",
    cause: { source: "command", code: "collect-rainwater" },
    details: { clean: true, itemId: "clean-water", sourceKind: "rain" },
  });
}

function resolveLitCampfireForCommand(
  state: GameState,
  structureId: string | undefined,
): PlacedStructureState | null {
  if (structureId) {
    const exact = getCampStructureById(state, structureId);
    return exact?.kind === "campfire" ? exact : null;
  }
  const lit = nearestLitCampfire(state);
  if (lit) return lit;
  if (placedStructuresOfKind(state, "campfire").length > 0) return null;
  return materializeLegacyStructure(state, "campfire");
}

function resolveNearestCampfireForCommand(
  state: GameState,
  structureId: string | undefined,
): PlacedStructureState | null {
  if (structureId) {
    const exact = getCampStructureById(state, structureId);
    return exact?.kind === "campfire" ? exact : null;
  }
  const nearest = nearestPlacedStructure(state, "campfire");
  if (nearest) return nearest;
  return materializeLegacyStructure(state, "campfire");
}

function handleBoilWater(
  state: GameState,
  command: Extract<GameCommand, { type: "boil-water" }>,
): void {
  const structure = resolveLitCampfireForCommand(state, command.structureId);
  const fire = structure ? ensureCampfireState(state, structure) : null;
  if (!structure || !fire?.lit) {
    rejectCommand(state, command, "需要燃烧中的营火才能煮水。");
    return;
  }
  if (
    distanceBetween(state.player.position, structure.position) >
    STRUCTURE_USE_RADII.campfire
  ) {
    rejectCommand(state, command, "需要靠近实际放置的营火才能煮水。", {
      requiredStructure: "campfire",
    });
    return;
  }
  if (state.inventory["dirty-water"] <= 0) {
    rejectCommand(state, command, "没有需要煮沸的溪水。");
    return;
  }
  advanceWorkTime(state, 45);
  if (state.status !== "playing") return;
  if (!ensureCampfireState(state, structure).lit) {
    rejectCommand(state, command, "煮水途中营火熄灭了；补充燃料后再试。", {
      interrupted: true,
    });
    return;
  }
  state.inventory["dirty-water"] -= 1;
  state.inventory["clean-water"] += 1;
  appendEvent(state, {
    type: "water-purified",
    message: "水面持续翻滚，寄生虫风险被消除。",
    cause: { source: "command", code: "boil-water" },
    details: { structureId: structure.id },
  });
}

function handleDrinkWater(
  state: GameState,
  command: Extract<GameCommand, { type: "drink-water" }>,
): void {
  if (state.inventory[command.itemId] <= 0) {
    rejectCommand(state, command, "没有可饮用的水。", {
      itemId: command.itemId,
    });
    return;
  }
  advanceWorkTime(state, 4);
  if (state.status !== "playing") return;
  state.inventory[command.itemId] -= 1;
  state.player.nutrition.hydration += command.itemId === "clean-water" ? 34 : 28;
  if (command.itemId === "clean-water") state.objectives.flags.waterPurified = true;

  let contractedParasite = false;
  if (command.itemId === "dirty-water") {
    const riskRoll = drawRandom(state.rng, "conditions");
    if (
      riskRoll < STREAM_PARASITE_CHANCE &&
      state.player.conditions.parasites < 3
    ) {
      state.player.conditions.parasites += 1;
      contractedParasite = true;
      appendEvent(state, {
        type: "parasite-contracted",
        message: "腹部突然绞痛，浑水带来了寄生虫。",
        cause: { source: "command", code: "drink-water:dirty" },
        details: { parasites: state.player.conditions.parasites, riskRoll },
      });
    }
  }

  appendEvent(state, {
    type: "water-drunk",
    message:
      command.itemId === "clean-water"
        ? "煮沸后的水恢复了体力。"
        : "浑水暂时缓解了口渴。",
    cause: { source: "command", code: `drink-water:${command.itemId}` },
    details: { itemId: command.itemId, contractedParasite },
  });
}

function handleAddFuel(
  state: GameState,
  command: Extract<GameCommand, { type: "add-fuel" }>,
): void {
  const structure = resolveNearestCampfireForCommand(state, command.structureId);
  if (!structure) {
    rejectCommand(state, command, "营地里还没有火堆。");
    return;
  }
  if (
    distanceBetween(state.player.position, structure.position) >
    STRUCTURE_USE_RADII.campfire
  ) {
    rejectCommand(state, command, "需要靠近实际放置的营火才能添柴。", {
      requiredStructure: "campfire",
    });
    return;
  }
  let fire = ensureCampfireState(state, structure);
  const relighting = !fire.lit;
  const fuelFull =
    fire.fuelSeconds >= MAXIMUM_FIRE_FUEL_SECONDS - 1e-6;
  const needsStick = relighting
    ? fire.fuelSeconds <= 1e-6
    : true;
  if (!relighting && fuelFull) {
    rejectCommand(state, command, "营火燃料已经达到上限；木棍没有消耗。", {
      structureId: structure.id,
      fuelSeconds: fire.fuelSeconds,
      fuelCapacitySeconds: MAXIMUM_FIRE_FUEL_SECONDS,
    });
    return;
  }
  if (needsStick && state.inventory.stick <= 0) {
    rejectCommand(state, command, "需要一根木棍添火。");
    return;
  }
  if (relighting && state.inventory["dry-leaf"] <= 0) {
    rejectCommand(state, command, "熄灭的火堆需要干叶引火。");
    return;
  }
  const preflightIgnition = resolveCurrentCampfireIgnition(
    state,
    structure.id,
  );
  if (relighting && !preflightIgnition.canIgnite) {
    rejectCommand(state, command, CAMPFIRE_RAIN_EXPOSED_GUIDANCE, {
      reason: preflightIgnition.blocker ?? "rain-exposed",
      rainIntensity: preflightIgnition.rainIntensity,
      sheltered: preflightIgnition.sheltered,
      phase: "preflight",
    });
    return;
  }

  advanceWorkTime(state, 6);
  if (state.status !== "playing") return;

  const refreshedStructure = getCampStructureById(state, structure.id);
  if (!refreshedStructure || refreshedStructure.kind !== "campfire") {
    rejectCommand(state, command, "操作期间火堆状态发生变化；材料没有消耗。", {
      structureId: structure.id,
      phase: "settlement",
    });
    return;
  }
  fire = ensureCampfireState(state, refreshedStructure);

  const settlementIgnition = resolveCurrentCampfireIgnition(
    state,
    structure.id,
  );
  if (relighting && !settlementIgnition.canIgnite) {
    rejectCommand(
      state,
      command,
      `操作期间雨势增强。${CAMPFIRE_RAIN_EXPOSED_GUIDANCE}`,
      {
        reason: settlementIgnition.blocker ?? "rain-exposed",
        rainIntensity: settlementIgnition.rainIntensity,
        sheltered: settlementIgnition.sheltered,
        phase: "settlement",
      },
    );
    return;
  }

  const previousFuelSeconds = fire.fuelSeconds;
  const stickConsumed = !relighting || needsStick;
  if (stickConsumed) state.inventory.stick -= 1;
  if (relighting) state.inventory["dry-leaf"] -= 1;
  if (stickConsumed) {
    fire.fuelSeconds = Math.min(
      MAXIMUM_FIRE_FUEL_SECONDS,
      fire.fuelSeconds + FIRE_FUEL_PER_STICK_SECONDS,
    );
  }
  fire.rainExposure = 0;
  fire.sheltered = settlementIgnition.sheltered;
  fire.lit = true;
  syncLegacyCampFacades(state);
  appendEvent(state, {
    type: "fuel-added",
    message: relighting ? "火堆重新燃烧起来。" : "营火又添了一根木柴。",
    cause: { source: "command", code: "add-fuel" },
    details: {
      relit: relighting,
      structureId: structure.id,
      previousFuelSeconds,
      fuelSeconds: fire.fuelSeconds,
      fuelAddedSeconds: fire.fuelSeconds - previousFuelSeconds,
      fuelCapacitySeconds: MAXIMUM_FIRE_FUEL_SECONDS,
      stickConsumed,
    },
  });
  if (relighting) {
    appendEvent(state, {
      type: "fire-lit",
      message: "余烬重新接住了火苗。",
      cause: { source: "command", code: "add-fuel" },
      details: { structureId: structure.id },
    });
  }
  refreshCampObjective(state);
}

function handleTransmit(
  state: GameState,
  command: Extract<GameCommand, { type: "transmit" }>,
): void {
  const beacon = command.structureId
    ? getCampStructureById(state, command.structureId)
    : nearestPlacedStructure(state, "radio-beacon");
  if (!beacon || beacon.kind !== "radio-beacon" || !state.camp.beaconBuilt) {
    rejectCommand(state, command, "求救信标还没有修复。");
    return;
  }
  if (
    horizontalDistanceBetween(state.player.position, beacon.position) >
    STRUCTURE_USE_RADII["radio-beacon"]
  ) {
    rejectCommand(state, command, "需要靠近实际放置的求救信标才能使用频道。", {
      structureId: beacon.id,
    });
    return;
  }
  const currentTaskId = state.objectives.currentTaskId;
  if (
    currentTaskId !== "transmit-signal" &&
    currentTaskId !== "river-rising" &&
    currentTaskId !== "canopy-wind"
  ) {
    rejectCommand(state, command, "还没有完成发送信号前的生存任务。");
    return;
  }
  if (
    currentTaskId === "river-rising" &&
    !riverReportReady(objectiveFacts(state))
  ) {
    const hasReading = hasObjectiveFact(
      objectiveFacts(state),
      CAMPAIGN_FACTS.riverTrendObserved,
    );
    rejectCommand(
      state,
      command,
      hasReading
        ? "上报链路尚不完整：先确认应急回执、远征准备、倒木清障和实测读数。"
        : "没有水尺实测记录，无法向应急频道上报猜测。",
      {
        structureId: beacon.id,
        reason: hasReading
          ? "river-report-prerequisites"
          : "river-reading-required",
      },
    );
    return;
  }
  if (currentTaskId === "canopy-wind") {
    const junction = ensureCanopyJunctionRuntime(state);
    const ready =
      junction.phase === "sample-ready" &&
      junction.sample !== null &&
      canopyReportReady(objectiveFacts(state));
    if (!ready) {
      const hasSample = hasObjectiveFact(
        objectiveFacts(state),
        CAMPAIGN_FACTS.canopyLiveSampleObserved,
      );
      rejectCommand(
        state,
        command,
        hasSample
          ? "C-17 上报链路尚不完整：确认矛盾记录、实际远征方案和已恢复的接头。"
          : "没有亲自查看 C-17 的有效阵风样本，不能把未验证数据发给应急网络。",
        {
          structureId: beacon.id,
          reason: hasSample
            ? "canopy-report-prerequisites"
            : "canopy-sample-observation-required",
          junctionPhase: junction.phase,
        },
      );
      return;
    }
  }
  advanceWorkTime(state, 18);
  if (state.status !== "playing") return;
  if (currentTaskId === "transmit-signal") {
    state.objectives.flags.transmitted = true;
    appendCampaignFact(
      state,
      CAMPAIGN_FACTS.distressReported,
      "求救信号已发出。频道保持开放，等待应急网络回执。",
      {
        causeCode: "campaign:distress-reported",
        details: { structureId: beacon.id },
      },
    );
    return;
  }
  if (currentTaskId === "river-rising") {
    appendCampaignFact(
      state,
      CAMPAIGN_FACTS.riverTrendReported,
      "水尺读数已经通过应急频道上报；下游警戒站确认收到。",
      {
        causeCode: "campaign:river-trend-reported",
        details: { structureId: beacon.id },
      },
    );
    return;
  }
  const junction = ensureCanopyJunctionRuntime(state);
  if (junction.phase !== "sample-ready" || !junction.sample) {
    rejectCommand(state, command, "发送前 C-17 样本状态发生变化；没有提交猜测。", {
      structureId: beacon.id,
      junctionPhase: junction.phase,
      reason: "canopy-sample-settlement-changed",
    });
    return;
  }
  state.world.canopyJunction = transitionCanopyJunctionPhase(
    junction,
    "reported",
    state.clock.tick,
  );
  appendCampaignFact(
    state,
    CAMPAIGN_FACTS.canopyWindSampleReported,
    "C-17 有效阵风样本已通过求救信标上报；应急网络确认零值来自失联链路。",
    {
      causeCode: "campaign:canopy-wind-sample-reported",
      details: {
        structureId: beacon.id,
        junctionPhase: "reported",
        milestoneId: "a2-canopy-wind-reported",
        createsMilestone: true,
      },
    },
  );
  state.objectives.flags.sandboxContinued = true;
}

function advanceCampaignRadio(state: GameState): void {
  if (radioResponseDue(objectiveFacts(state), state.clock.tick)) {
    appendCampaignFact(
      state,
      EMERGENCY_RIVER_RESPONSE.produces,
      "应急频道回执：下游河流正在上升。携带一套远征装备，读取旧水尺并回报趋势。",
      {
        eventType: "radio-message-received",
        causeCode: `radio:${EMERGENCY_RIVER_RESPONSE.id}`,
        details: { responseId: EMERGENCY_RIVER_RESPONSE.id },
      },
    );
  }
  if (
    radioResponseDue(
      objectiveFacts(state),
      state.clock.tick,
      EMERGENCY_CANOPY_RESPONSE,
    )
  ) {
    const junction = ensureCanopyJunctionRuntime(state);
    appendCampaignFact(
      state,
      EMERGENCY_CANOPY_RESPONSE.produces,
      canopyRadioMessageForPhase(junction.phase),
      {
        eventType: "radio-message-received",
        causeCode: `radio:${EMERGENCY_CANOPY_RESPONSE.id}`,
        details: {
          responseId: EMERGENCY_CANOPY_RESPONSE.id,
          junctionPhase: junction.phase,
          milestoneId: "a2-canopy-request-heard",
          createsMilestone: true,
        },
      },
    );
  }
}

function handleHazardEncounter(
  state: GameState,
  command: Extract<GameCommand, { type: "encounter-hazard" }>,
): void {
  const entity = state.world.entities[command.entityId];
  if (!entity || entity.kind !== "hazard" || entity.depleted) {
    rejectCommand(state, command, "危险已经离开。", { entityId: command.entityId });
    return;
  }
  if (isAuthoredSnakeEntity(entity)) {
    // Compatibility for pre-embodied clients. The ecology actor is now the
    // sole combat authority; entering range never consumes the authored node.
    handleWildlifeEncounter(state, {
      type: "encounter-wildlife",
      individualId: authoredSnakeIndividualId(entity.id),
    });
    return;
  }
  if (distanceBetween(state.player.position, entity.position) > entity.interactRadius) {
    rejectCommand(state, command, "危险仍在远处。", { entityId: entity.id });
    return;
  }

  advanceWorkTime(state, 3);
  if (state.status !== "playing") return;

  entity.depleted = true;
  entity.quantity = 0;
  if (state.inventory.spear > 0 && state.player.equippedItem === "spear") {
    state.player.vitals.stamina = clamp(state.player.vitals.stamina - 5);
    state.player.vitals.sanity = clamp(state.player.vitals.sanity + 2);
    damageToolAndReport(
      state,
      "spear",
      6,
      `tool-use:hazard:${entity.id}`,
    );
    appendEvent(state, {
      type: "threat-avoided",
      message: "嘶声从脚边炸开。石矛逼退了眼镜蛇。",
      cause: { source: "command", code: "hazard:snake:spear" },
      details: { entityId: entity.id },
    });
    return;
  }

  const wound = state.player.conditions.wound;
  wound.open = true;
  wound.treated = false;
  wound.severity = clamp(wound.severity + 20);
  wound.infection = clamp(wound.infection + 4);
  const healthBefore = state.player.vitals.health;
  applyHealthLoss(state, {
    sourceCode: "hazard:snake:bite",
    sourceLabel: "眼镜蛇",
    amount: 12,
  });
  const healthAfter = state.player.vitals.health;
  applySanityLoss(state, {
    sourceCode: "hazard:snake:bite",
    sourceLabel: "眼镜蛇的袭击",
    amount: 8,
  });
  appendEvent(state, {
    type: "snake-bite",
    message: "眼镜蛇咬中你伸出的左臂。没有长矛，伤口重新成为最高优先级。",
    cause: { source: "command", code: "hazard:snake:bite" },
    details: {
      entityId: entity.id,
      speciesId: "coiled-viper",
      sourceLabel: "眼镜蛇",
      bodyPart: "左臂",
      healthLost: healthBefore - healthAfter,
      healthBefore,
      healthAfter,
      lethal: healthBefore > 0 && healthAfter <= 0,
      directionDegrees: compassBearingFromPlayer(state, entity.position),
    },
  });
}

function handleRest(
  state: GameState,
  command: Extract<GameCommand, { type: "rest" }>,
): void {
  const bed = command.structureId
    ? getCampStructureById(state, command.structureId)
    : nearestPlacedStructure(state, "bed") ??
      materializeLegacyStructure(state, "bed");
  if (
    !bed ||
    bed.kind !== "bed" ||
    distanceBetween(state.player.position, bed.position) >
      STRUCTURE_USE_RADII.bed
  ) {
    rejectCommand(state, command, "需要回到营地的棕榈床才能休息。");
    return;
  }

  const startDay = state.clock.day;
  const startMinute = state.clock.minuteOfDay;
  if (state.player.equippedItem === "torch") {
    state.player.equippedItem = null;
    state.player.torchBurnSeconds = 0;
    appendEvent(state, {
      type: "item-unequipped",
      message: "入睡前收起火把；它会保留当前剩余燃料。",
      cause: { source: "command", code: "rest:auto-stow" },
      details: { itemId: "torch" },
    });
  }
  advanceWorkTime(state, REST_SIMULATION_SECONDS);
  if (state.status !== "playing") return;

  // The elapsed sleep already paid the ordinary metabolism, wound, weather,
  // wetness, fire and spoilage costs through runFixedTick. Only restorative
  // effects are applied here, preventing the former double/partial accounting.
  state.player.vitals.energy += 60;
  state.player.vitals.stamina = 100;
  state.player.vitals.sanity +=
    isNearLitCampfire(state, FIRE_COMFORT_RADIUS)
      ? 12
      : 6;
  normalizeState(state, false);
  appendEvent(state, {
    type: "rest-completed",
    message: "离开湿地休息了片刻。能量恢复，但饥渴继续累积。",
    cause: { source: "command", code: "rest:leaf-bed" },
    details: {
      restGameHours: REST_GAME_HOURS,
      restSeconds: REST_SIMULATION_SECONDS,
      startDay,
      startMinute: gameMinuteForDisplay(startMinute),
      endDay: state.clock.day,
      endMinute: gameMinuteForDisplay(state.clock.minuteOfDay),
      structureId: bed.id,
      fireStillLit: isNearLitCampfire(state, FIRE_COMFORT_RADIUS),
    },
  });
}

function applyCommandMutable(state: GameState, command: GameCommand): void {
  refreshItemLifecycle(state);
  if (command.type === "continue-expedition") {
    if (state.status !== "won") return;
    state.status = "playing";
    state.lossReason = null;
    state.objectives.flags.sandboxContinued = true;
    appendEvent(state, {
      type: "sandbox-continued",
      message: "应答已经收到，但你选择留下。雨林不再是一次性任务，而是一片持续变化的远征区。",
      cause: { source: "command", code: "continue-expedition" },
      details: { day: state.clock.day },
    });
    return;
  }
  if (state.status !== "playing") return;

  switch (command.type) {
    case "move-player":
      if (
        !isPositionValid(command.position) ||
        (command.look &&
          (!Number.isFinite(command.look.yaw) ||
            !Number.isFinite(command.look.pitch)))
      ) {
        rejectCommand(state, command, "玩家坐标无效。");
      } else {
        setPlayerPosition(state, command.position, command.look);
      }
      break;
    case "pick-up":
      handlePickUp(state, command);
      break;
    case "harvest":
      handleHarvest(state, command);
      break;
    case "inspect-landmark":
      handleInspectLandmark(state, command);
      break;
    case "craft":
      handleCraft(state, command);
      break;
    case "equip-item":
      handleEquipItem(state, command);
      break;
    case "use-item":
      handleUseItem(state, command);
      break;
    case "eat":
      handleEat(state, command);
      break;
    case "collect-water":
      handleCollectWater(state, command);
      break;
    case "collect-rainwater":
      handleCollectRainwater(state, command);
      break;
    case "boil-water":
      handleBoilWater(state, command);
      break;
    case "drink-water":
      handleDrinkWater(state, command);
      break;
    case "add-fuel":
      handleAddFuel(state, command);
      break;
    case "encounter-hazard":
      handleHazardEncounter(state, command);
      break;
    case "attack-wildlife":
      handleAttackWildlife(state, command);
      break;
    case "physical-action":
      handlePhysicalAction(state, command);
      break;
    case "encounter-wildlife":
      handleWildlifeEncounter(state, command);
      break;
    case "collect-wildlife-loot":
      handleCollectWildlifeLoot(state, command);
      break;
    case "use-structure":
      handleUseStructure(state, command);
      break;
    case "dismantle-structure":
      handleDismantleStructure(state, command);
      break;
    case "rest":
      handleRest(state, command);
      break;
    case "transmit":
      handleTransmit(state, command);
      break;
  }

  normalizeState(state);
  advanceResourceDirector(state);
  refreshCampObjective(state);
  completeAvailableTasks(state, command.type);
  checkTerminalState(state);
}

/** Applies one discrete action without mutating the supplied state. */
export function applyCommand(state: GameState, command: GameCommand): GameState {
  const nextState = cloneGameState(state);
  applyCommandMutable(nextState, command);
  return nextState;
}

function updateClock(state: GameState): void {
  advanceClockOneTick(state.clock);
}

function isBlockedByCampStructure(
  state: GameState,
  x: number,
  z: number,
): boolean {
  return STRUCTURE_KINDS.some((kind) =>
    getCampStructureTransforms(state, kind).some((structure) =>
      isPointBlockedByStructure(structure, x, z),
    ),
  );
}

function movePlayerWithStructureCollision(
  state: GameState,
  x: number,
  z: number,
): void {
  if (!isBlockedByCampStructure(state, x, z)) {
    setPlayerPosition(state, { x, y: state.player.position.y, z });
    return;
  }
  if (!isBlockedByCampStructure(state, x, state.player.position.z)) {
    setPlayerPosition(state, {
      x,
      y: state.player.position.y,
      z: state.player.position.z,
    });
    return;
  }
  if (!isBlockedByCampStructure(state, state.player.position.x, z)) {
    setPlayerPosition(state, {
      x: state.player.position.x,
      y: state.player.position.y,
      z,
    });
  }
}

function updateMovement(
  state: GameState,
  movement: MovementInput | undefined,
  dt: number,
): void {
  const x = movement?.x ?? 0;
  const z = movement?.z ?? 0;
  const magnitude = Math.hypot(x, z);
  const moving = magnitude > 0.0001;
  const sprinting = Boolean(
    moving && movement?.sprint && state.player.vitals.stamina > 1,
  );

  if (moving) {
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
    const scale = speed * dt / Math.max(1, magnitude);
    movePlayerWithStructureCollision(
      state,
      state.player.position.x + x * scale,
      state.player.position.z + z * scale,
    );
    state.player.vitals.stamina -= (sprinting ? 10 : 1.2) * dt;
    state.player.vitals.energy -= (sprinting ? 0.035 : 0.012) * dt;
  } else {
    const carbohydrateFactor = 0.3 + state.player.nutrition.carbohydrates / 140;
    const recovery = 7 * (0.25 + state.player.vitals.energy / 150) * carbohydrateFactor;
    state.player.vitals.stamina += recovery * dt;
  }
}

function updateWeather(state: GameState, dt: number): void {
  state.weather.secondsUntilChange -= dt;
  if (state.weather.secondsUntilChange <= 0) {
    const weatherRoll = drawRandom(state.rng, "weather");
    const durationRoll = drawRandom(state.rng, "weather");
    state.weather.targetRainIntensity =
      weatherRoll < 0.28 ? 0.05 : weatherRoll < 0.64 ? 0.46 : 0.9;
    state.weather.secondsUntilChange =
      MINIMUM_WEATHER_FRONT_SECONDS +
      Math.floor(
        durationRoll *
          (MAXIMUM_WEATHER_FRONT_SECONDS -
            MINIMUM_WEATHER_FRONT_SECONDS +
            1),
      );
    appendEvent(state, {
      type: "weather-changed",
      message:
        state.weather.targetRainIntensity >= 0.72
          ? "树冠上方传来雷声，暴雨正在逼近。"
          : state.weather.targetRainIntensity >= 0.3
            ? "雨势重新变得密集。"
            : "雨声逐渐减弱。",
      cause: { source: "system", code: "weather-front" },
      details: {
        targetRainIntensity: state.weather.targetRainIntensity,
        durationSeconds: state.weather.secondsUntilChange,
      },
    });
  }

  state.weather.rainIntensity = moveTowards(
    state.weather.rainIntensity,
    state.weather.targetRainIntensity,
    0.055 * dt,
  );
  state.weather.storm = state.weather.rainIntensity >= 0.72;
}

function refreshEcology(state: GameState): void {
  const activeChunks = activeChunkCoordinates(
    state.player.position.x,
    state.player.position.z,
    1,
  ).map((coordinate) => generateChunkDescriptor(String(state.seed), coordinate));
  const current = state.ecology ?? createEcologyState(state.seed, {
    tick: state.clock.tick,
    rainIntensity: state.weather.rainIntensity,
    activeChunks,
  });
  state.ecology = advanceEcology(current, {
    tick: state.clock.tick,
    rainIntensity: state.weather.rainIntensity,
    activeChunks,
  }).state;
  const individuals = state.ecology.individuals ?? {};
  for (const [id, individual] of Object.entries(individuals)) {
    if (individual.health > 0) {
      delete individual.pendingMeat;
      delete individual.pendingHide;
      delete individual.corpse;
    }
    const hasPendingLoot =
      (individual.pendingMeat ?? 0) + (individual.pendingHide ?? 0) > 0;
    if (!hasPendingLoot) delete individual.corpse;
    const respawned =
      individual.health <= 0 &&
      !hasPendingLoot &&
      individual.respawnAtTick !== null &&
      individual.respawnAtTick <= state.clock.tick;
    const injuryRecovered =
      individual.health > 0 &&
      state.clock.tick - individual.lastHitTick >= WILDLIFE_INJURY_RECOVERY_TICKS;
    if (respawned || injuryRecovered) delete individuals[id];
  }
}

function extinguishFire(
  state: GameState,
  structure: PlacedStructureState,
  code: string,
  message: string,
): void {
  const fire = ensureCampfireState(state, structure);
  if (!fire.lit) return;
  fire.lit = false;
  fire.rainExposure = 0;
  appendEvent(state, {
    type: "fire-extinguished",
    message,
    cause: { source: "system", code },
    details: { structureId: structure.id },
  });
}

function updateFire(state: GameState, dt: number): void {
  refreshShelterCoverage(state);
  for (const structure of placedStructuresOfKind(state, "campfire")) {
    const fire = ensureCampfireState(state, structure);
    if (!fire.lit) continue;

    fire.fuelSeconds -= dt * (1 + state.weather.rainIntensity * 0.15);
    if (!fire.sheltered && state.weather.rainIntensity > 0.5) {
      fire.rainExposure +=
        (state.weather.rainIntensity - 0.5) * 1.4 * dt;
    } else {
      fire.rainExposure = Math.max(0, fire.rainExposure - 0.8 * dt);
    }

    if (fire.fuelSeconds <= 0) {
      fire.fuelSeconds = 0;
      extinguishFire(
        state,
        structure,
        "fuel-exhausted",
        "最后一截木柴化成了灰，营火熄灭。",
      );
    } else if (fire.rainExposure >= FIRE_RAIN_EXPOSURE_LIMIT) {
      extinguishFire(
        state,
        structure,
        "rain-exposure",
        "暴雨浇灭了没有遮蔽的营火。",
      );
    }
  }
  syncLegacyCampFacades(state);
}

function updateWetness(state: GameState, movement: MovementInput | undefined, dt: number): void {
  const sheltered =
    isShelteredByCampStructures(state) || Boolean(movement?.sheltered);
  const nearFire =
    isNearLitCampfire(state, FIRE_COMFORT_RADIUS);
  if (!sheltered) {
    state.player.conditions.wetness += state.weather.rainIntensity * 0.12 * dt;
  } else {
    state.player.conditions.wetness -= 0.055 * dt;
  }
  if (movement?.inWater) state.player.conditions.wetness += 1.8 * dt;
  if (state.weather.rainIntensity < 0.1) {
    state.player.conditions.wetness -= 0.02 * dt;
  }
  if (nearFire) state.player.conditions.wetness -= 0.14 * dt;
}

function updateMetabolism(state: GameState, dt: number): void {
  const { nutrition, vitals, conditions } = state.player;
  const metabolicDt = dt * METABOLISM_RATE_SCALE;
  const nearFire = isNearLitCampfire(state, FIRE_COMFORT_RADIUS);
  // Apply comfort before this tick's pressure sources. A loss record that
  // crosses zero must still be terminal at the end of the tick; a later gain
  // must never turn an authoritative lethal boundary into a false claim.
  if (nearFire) {
    vitals.sanity = clamp(vitals.sanity + 0.009 * metabolicDt);
  }
  nutrition.carbohydrates -= 0.015 * metabolicDt;
  nutrition.protein -= 0.0075 * metabolicDt;
  nutrition.fat -= 0.0065 * metabolicDt;
  nutrition.hydration -=
    (0.045 + conditions.parasites * 0.009) * metabolicDt;
  const fatEfficiency = 1.25 - nutrition.fat / 200;
  vitals.energy -=
    (0.008 + conditions.parasites * 0.006) *
    fatEfficiency *
    metabolicDt;

  if (conditions.wound.open) {
    const proteinPenalty = 1.35 - nutrition.protein / 200;
    conditions.wound.infection +=
      (0.006 + conditions.wetness * 0.00009) *
      proteinPenalty *
      metabolicDt;
    const infected = conditions.wound.infection >= 40;
    applyHealthLoss(state, {
      sourceCode: infected
        ? "condition:infected-wound"
        : "condition:open-wound",
      sourceLabel: infected ? "感染的开放伤口" : "未处理的开放伤口",
      amount:
        (0.008 +
          conditions.wound.severity * 0.00016 +
          conditions.wound.infection * 0.00022) *
        metabolicDt,
    });
  } else {
    const proteinRecovery = 0.35 + nutrition.protein / 100;
    conditions.wound.infection -=
      0.004 * proteinRecovery * metabolicDt;
    conditions.wound.severity -= 0.006 * proteinRecovery * metabolicDt;
  }

  if (conditions.parasites > 0) {
    nutrition.protein -= conditions.parasites * 0.004 * metabolicDt;
    applySanityLoss(state, {
      sourceCode: "condition:parasites",
      sourceLabel: `寄生虫负担 ×${conditions.parasites}`,
      amount: conditions.parasites * 0.005 * metabolicDt,
    });
  }
  if (nutrition.hydration <= 0) {
    applyHealthLoss(state, {
      sourceCode: "condition:dehydration",
      sourceLabel: "持续脱水",
      amount: 0.14 * metabolicDt,
    });
  }
  const emptyMacroCount = [
    nutrition.carbohydrates,
    nutrition.protein,
    nutrition.fat,
  ].filter((value) => value <= 0).length;
  if (emptyMacroCount > 0) {
    applyHealthLoss(state, {
      sourceCode: "condition:starvation",
      sourceLabel: `${emptyMacroCount} 类营养归零`,
      amount: emptyMacroCount * 0.035 * metabolicDt,
    });
  }
  if (vitals.energy <= 0) {
    applyHealthLoss(state, {
      sourceCode: "condition:exhaustion",
      sourceLabel: "极度衰竭",
      amount: 0.04 * metabolicDt,
    });
  }
  if (conditions.wetness >= 75) {
    vitals.energy -= 0.012 * metabolicDt;
    applySanityLoss(state, {
      sourceCode: "condition:wet-cold",
      sourceLabel: "持续湿冷暴露",
      amount: 0.004 * metabolicDt,
    });
  }

  const hour = getTimeOfDayHours(state);
  const night = hour >= 19 || hour < 5;
  if (night && !nearFire) {
    applySanityLoss(state, {
      sourceCode: "condition:night-isolation",
      sourceLabel: "无火照明的黑夜",
      amount: 0.006 * metabolicDt,
    });
  }
}

function normalizeState(state: GameState, normalizeCollections = true): void {
  const { nutrition, vitals, conditions } = state.player;
  nutrition.carbohydrates = clamp(nutrition.carbohydrates);
  nutrition.protein = clamp(nutrition.protein);
  nutrition.fat = clamp(nutrition.fat);
  nutrition.hydration = clamp(nutrition.hydration);
  vitals.health = clamp(vitals.health);
  vitals.stamina = clamp(vitals.stamina);
  vitals.energy = clamp(vitals.energy);
  vitals.sanity = clamp(vitals.sanity);
  conditions.wetness = clamp(conditions.wetness);
  conditions.parasites = Math.round(clamp(conditions.parasites, 0, 3));
  conditions.wound.severity = clamp(conditions.wound.severity);
  conditions.wound.infection = clamp(conditions.wound.infection);
  state.player.torchBurnSeconds = Number.isFinite(
    state.player.torchBurnSeconds,
  )
    ? Math.max(0, state.player.torchBurnSeconds ?? 0)
    : 0;
  state.weather.rainIntensity = clamp(state.weather.rainIntensity, 0, 1);
  state.weather.targetRainIntensity = clamp(
    state.weather.targetRainIntensity,
    0,
    1,
  );
  state.world.riverHydrology = normalizeRiverHydrologyState(
    state.world.riverHydrology,
    state.clock.tick,
  );
  const legacyKind =
    state.camp.fire.built && placedStructuresOfKind(state, "campfire").length === 0
      ? "campfire"
      : state.camp.shelterBuilt &&
          placedStructuresOfKind(state, "shelter").length === 0
        ? "shelter"
        : state.camp.bedBuilt && placedStructuresOfKind(state, "bed").length === 0
          ? "bed"
          : state.camp.beaconBuilt &&
              placedStructuresOfKind(state, "radio-beacon").length === 0
            ? "radio-beacon"
            : null;
  if (legacyKind) materializeLegacyStructure(state, legacyKind);
  for (const structure of placedStructuresOfKind(state, "campfire")) {
    structure.fire = normalizePlacedCampfireState(
      structure.fire,
      state.camp.fire,
    );
  }
  syncLegacyCampFacades(state);
  if (normalizeCollections) {
    state.world.bounds = {
      minX: -DYNAMIC_WORLD_LIMIT,
      maxX: DYNAMIC_WORLD_LIMIT,
      minZ: -DYNAMIC_WORLD_LIMIT,
      maxZ: DYNAMIC_WORLD_LIMIT,
    };
    for (const itemId of ITEM_IDS) {
      const count = state.inventory[itemId];
      state.inventory[itemId] = Number.isFinite(count)
        ? Math.max(0, Math.min(999, Math.floor(count)))
        : 0;
    }
    if (
      state.player.equippedItem &&
      (!EQUIPPABLE_ITEM_IDS.includes(state.player.equippedItem) ||
        state.inventory[state.player.equippedItem] <= 0)
    ) {
      state.player.equippedItem = null;
    }
    ensureItemLifecycleState(state);
    // Lifecycle reconciliation may discard an unbacked current-format torch
    // count. Equipment must follow the concrete unit truth in the same pass.
    if (
      state.player.equippedItem &&
      state.inventory[state.player.equippedItem] <= 0
    ) {
      state.player.equippedItem = null;
    }
    for (const entity of Object.values(state.world.entities)) {
      entity.quantity = Number.isFinite(entity.quantity)
        ? Math.max(0, Math.min(999, Math.floor(entity.quantity)))
        : 0;
      if (isTreeEntity(entity)) {
        normalizeTreeEntityRuntime(entity);
        advanceTreeRegrowthEntity(state.clock.tick, entity);
      } else entity.depleted = entity.quantity <= 0;
      ensureResourceRegenerationState(state, entity);
    }
    if (!isPositionValid(state.player.position)) {
      state.player.position = { ...state.camp.position };
      setPlayerPosition(state, state.player.position);
    } else {
      setPlayerPosition(state, state.player.position);
    }
  }
}

function checkTerminalState(state: GameState): void {
  if (state.status !== "playing") return;
  const reason =
    state.player.vitals.health <= 0
      ? "health"
      : state.player.vitals.sanity <= 0
        ? "sanity"
        : null;
  if (!reason) return;
  state.status = "lost";
  state.lossReason = reason;
  const review = deriveDeathReview(state);
  appendEvent(state, {
    type: "game-lost",
    message: `${review.directCauseLabel}：${review.summary}`,
    cause: { source: "system", code: `terminal:${reason}` },
    details: {
      reason,
      directCauseCode: review.directCauseCode,
      directCauseLabel: review.directCauseLabel,
      inferred: review.inferred,
    },
  });
}

function runFixedTick(
  state: GameState,
  movement: MovementInput | undefined,
): void {
  updateClock(state);
  if (state.clock.tick % LIFECYCLE_TICKS_PER_SECOND === 0) {
    refreshItemLifecycle(state);
    advanceActiveTreeRegrowth(state);
    refreshEcology(state);
  }
  updateMovement(state, movement, FIXED_DT_SECONDS);
  updateWeather(state, FIXED_DT_SECONDS);
  state.world.riverHydrology = advanceRiverHydrology(
    state.world.riverHydrology ?? createRiverHydrologyState(state.clock.tick),
    {
      tick: state.clock.tick,
      rainIntensity: state.weather.rainIntensity,
      stormActive: state.weather.storm,
    },
  );
  state.world.windField = advanceWindField(
    state.world.windField ?? createWindFieldState(state.seed, state.clock.tick),
    { worldSeed: state.seed, tick: state.clock.tick },
  );
  syncCanopyJunctionObstructions(state);
  state.world.canopyJunction = advanceCanopyJunctionSampling(
    state.world.canopyJunction ?? createCanopyJunctionState(state.clock.tick),
    { worldSeed: state.seed, tick: state.clock.tick },
  );
  refreshCanopyForwardOutpostFact(state);
  advanceCampaignRadio(state);
  updateFire(state, FIXED_DT_SECONDS);
  updateTorchWaymarks(state);
  updateSmokingRacks(state);
  updateRainCollectors(state);
  updateEquippedTorch(state, FIXED_DT_SECONDS);
  updateWetness(state, movement, FIXED_DT_SECONDS);
  updateMetabolism(state, FIXED_DT_SECONDS);
  normalizeState(state, false);
  advanceResourceDirector(state);
  refreshCampObjective(state);
  completeAvailableTasks(state, "simulation-tick");
  checkTerminalState(state);
}

/**
 * Advances the deterministic simulation. The caller may pass any positive dt;
 * it is accumulated and evaluated as fixed 30 Hz ticks. The input state is not
 * mutated. Render loops should cap catch-up work before calling this function.
 */
export function stepSimulation(
  state: GameState,
  input: SimulationInput = {},
  dtSeconds: number,
): GameState {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new RangeError("dtSeconds must be a finite, non-negative number");
  }

  const nextState = cloneGameState(state);
  // Validate legacy/external payload collections once per public step. The
  // fixed loop then normalizes only continuously changing vitals; scanning
  // hundreds of deterministic semantic nodes 30 times per second made sleep
  // and other fast-forward actions block the UI for several seconds.
  normalizeState(nextState);
  for (const command of input.commands ?? []) {
    applyCommandMutable(nextState, command);
  }
  if (nextState.status !== "playing") return nextState;

  const accumulated = nextState.clock.remainderSeconds + dtSeconds;
  const stepCount = Math.floor(accumulated * FIXED_HZ + 1e-9);
  nextState.clock.remainderSeconds = Math.max(
    0,
    accumulated - stepCount * FIXED_DT_SECONDS,
  );

  for (
    let stepIndex = 0;
    stepIndex < stepCount && nextState.status === "playing";
    stepIndex += 1
  ) {
    runFixedTick(nextState, input.movement);
  }

  return nextState;
}
