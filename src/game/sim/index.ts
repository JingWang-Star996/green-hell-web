export {
  ITEMS,
  RECIPES,
  TASKS,
  TASK_SEQUENCE,
  TORCH_BURN_SEGMENT_GAME_HOURS,
  TORCH_BURN_SEGMENT_SECONDS,
  TORCH_BURN_SEGMENTS,
  WORLD_ENTITY_TEMPLATES,
} from "./content";
export { hashSeed, createRngChannels, nextRandom } from "./rng";
export {
  RESOURCE_DIRECTOR_ACTIVE_MINIMUM_DISTANCE,
  RESOURCE_DIRECTOR_EPOCH_TICKS,
  RESOURCE_DIRECTOR_LOCAL_SUPPLY_RADIUS,
  RESOURCE_DIRECTOR_MAX_CATCH_UP_EPOCHS,
  advanceResourceDirector,
  deterministicRegenerationRoll,
  evaluateResourceNeeds,
  normalizeResourceDirectorState,
  resourceDirectorEpochForTick,
  setResourceRegenerationSchedule,
} from "./resourceDirector";
export type { ResourceDirectorDecision } from "./resourceDirector";
export {
  CAMPAIGN_FACTS,
  CANOPY_PREPARATION_CLAUSE,
  CANOPY_RADIO_MESSAGES,
  CANOPY_REPORT_PREREQUISITES,
  CANOPY_WIND_TASK,
  EMERGENCY_CANOPY_RESPONSE,
  EMERGENCY_RIVER_RESPONSE,
  RIVER_GAUGE_ID,
  RIVER_GAUGE_OBSTRUCTION_ID,
  RIVER_GAUGE_POSITION,
  RIVER_RISING_TASK,
  canopyRadioMessageForPhase,
  canopyReportReady,
  campaignTaskSatisfied,
  preparedCanopyExpeditionFacts,
  preparedRiverExpeditionFacts,
  radioResponseDue,
} from "./campaignContent";
export {
  CANOPY_JUNCTION_ID,
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  CANOPY_JUNCTION_PHASES,
  CANOPY_JUNCTION_POSITION,
  CANOPY_JUNCTION_TENSION_VINE_IDS,
  CANOPY_JUNCTION_VERSION,
  CANOPY_SAMPLE_MIN_STRENGTH,
  CANOPY_SAMPLE_STABLE_TICKS,
  advanceCanopyJunctionSampling,
  canopyJunctionObstructionCleared,
  createCanopyJunctionState,
  normalizeCanopyJunctionState,
  recordCanopyObstructionCleared,
  transitionCanopyJunctionPhase,
} from "./canopyJunction";
export type {
  CanopyJunctionPhase,
  CanopyJunctionState,
  CanopySamplingAdvanceInput,
  CanopyWindSample,
} from "./canopyJunction";
export {
  WIND_FIELD_FIXED_HZ,
  WIND_FIELD_VERSION,
  WIND_FRONT_INTERVAL_TICKS,
  WIND_GUST_INTERVAL_TICKS,
  advanceWindField,
  createWindFieldState,
  normalizeWindFieldState,
  windFieldStrength,
} from "../world/windField";
export type {
  WindFieldAdvanceInput,
  WindFieldState,
} from "../world/windField";
export {
  clauseSatisfied,
  firstUnsatisfiedGuidanceStep,
  hasObjectiveFact,
  normalizeObjectiveFacts,
  objectiveFactTick,
  recordObjectiveFact,
  taskRequirementsSatisfied,
} from "./objectiveFacts";
export type {
  ObjectiveFactClause,
  ObjectiveFactRecord,
  ObjectiveFactReference,
  ObjectiveFactVerb,
  ObjectiveGuidanceStep,
} from "./objectiveFacts";
export {
  DAMAGE_INCIDENT_VISIBLE_MILLISECONDS,
  deriveDamageIncidents,
  deriveDeathReview,
  deriveStatusSignals,
  MAX_VISIBLE_DAMAGE_INCIDENTS,
  mergeTimedDamageIncidents,
  pruneExpiredDamageIncidents,
} from "./playerStatus";
export type {
  DamageIncident,
  DeathReviewModel,
  DeathReviewStep,
  StatusCategory,
  StatusSeverity,
  StatusSignal,
  TimedDamageIncident,
} from "./playerStatus";
export {
  createEmptyInventory,
  createInitialState,
  cloneGameState,
  ensureProgressMemory,
  MAX_HEALTH_LOSS_HISTORY,
  MAX_SANITY_LOSS_HISTORY,
  migrateGameState,
  normalizeHealthLossHistory,
  normalizeSanityLossHistory,
  SIMULATION_VERSION,
} from "./state";
export {
  addTorchInventoryUnit,
  addPerishableInventoryUnitWithExpiry,
  burnEquippedTorchFuel,
  getDurableToolInventoryStatus,
  getPerishableInventoryStatus,
  ITEM_LIFECYCLE_BALANCE_VERSION,
  isDurableTool,
  isPerishableItem,
  LIFECYCLE_TICKS_PER_SECOND,
  takeNextTorchInventoryUnit,
  TORCH_FUEL_VERSION,
  TORCH_MAX_BURN_SECONDS,
} from "./lifecycle";
export type {
  TakenTorchFuelUnit,
  TorchBurnResult,
  TorchFuelUnit,
} from "./lifecycle";
export {
  activeWildlifeProjections,
  applyCommand,
  stepSimulation,
  FIXED_HZ,
  FIXED_DT_SECONDS,
  MAX_EVENT_LOG,
  REST_SIMULATION_SECONDS,
} from "./simulation";
export {
  CAMPFIRE_WILDLIFE_DETERRENT_ID,
  CAMPFIRE_WILDLIFE_DETERRENT_RADIUS,
  CAMPFIRE_WILDLIFE_DETERRENT_STRENGTH,
  TORCH_WAYMARK_WILDLIFE_DETERRENT_RADIUS,
  TORCH_WAYMARK_WILDLIFE_DETERRENT_STRENGTH,
  activeFireDeterrents,
  projectActiveWildlife,
} from "./wildlifeProjection";
export type { ActiveWildlifeProjection } from "./wildlifeProjection";
export {
  GAME_DAY_SIMULATION_SECONDS,
  GAME_MINUTES_PER_DAY,
  FIRE_FUEL_PER_STICK_SECONDS,
  MAXIMUM_FIRE_FUEL_SECONDS,
  gameMinuteForDisplay,
  gameHoursToSimulationSeconds,
  gameHoursToTicks,
  gameMinutesToSimulationSeconds,
  inferGameMinutesElapsed,
  REST_GAME_HOURS,
  simulationSecondsToGameMinutes,
  START_MINUTE_OF_DAY,
} from "./time";
export {
  CAMP_RADIUS,
  canCraft,
  canCraftAtPlacement,
  distanceBetween,
  distanceSquared,
  getConditionSummary,
  getCampStructureTransform,
  getCampStructureTransforms,
  getNearestCampStructureTransform,
  getNearestLitCampfireTransform,
  getAvailableWaterContainerCount,
  getCurrentTask,
  getDiscoveredRecipeIds,
  hasCollectedWater,
  hasCompletedRest,
  hasInspectedLandmark,
  getInventoryCount,
  getNearbyEntities,
  getObjectiveProgress,
  getSurvivalScore,
  getTimeOfDayHours,
  isAtCamp,
  isNearCampStructure,
  isNearLitCampfire,
  isShelteredByCampStructures,
  selectGameView,
} from "./selectors";
export {
  CAMPFIRE_IGNITION_BLOCKING_RAIN_INTENSITY,
  CAMPFIRE_RAIN_EXPOSED_GUIDANCE,
  resolveCampfireIgnition,
  resolveCampfireIgnitionAtPoint,
  resolveCurrentCampfireIgnition,
  resolvePotentialCampfireIgnition,
} from "./campfireIgnitionRules";
export {
  campfireStateForStructure,
  ensureCampfireState,
  materializeLegacyStructure,
  nearestLitCampfire,
  nearestPlacedStructure,
  normalizePlacedCampfireState,
  placedStructuresOfKind,
  syncLegacyCampFacades,
} from "./campStructures";
export {
  DEFAULT_STRUCTURE_PLACEMENTS,
  FIRE_COMFORT_RADIUS,
  RAIN_COLLECTOR_LAYOUT,
  TORCH_WAYMARK_LAYOUT,
  SHELTER_COVERAGE_RADIUS,
  STRUCTURE_KINDS,
  STRUCTURE_USE_RADII,
  horizontalDistanceToStructure,
  isPointBlockedByStructure,
  isWithinStructureRadius,
  resolveStructureTransform,
  rainCollectorInteractionAnchor,
  torchWaymarkInteractionAnchor,
  structurePlacementRadius,
  structurePlacementsOverlap,
  structureTransformFromSource,
} from "./structureGeometry";
export {
  RAIN_COLLECTOR_BIOME_MULTIPLIERS,
  RAIN_COLLECTOR_CAPACITY,
  RAIN_COLLECTOR_DRY_THRESHOLD,
  RAIN_COLLECTOR_FULL_RAIN_SECONDS_PER_UNIT,
  rainCollectorEnvironment,
  rainCollectorEnvironmentForStructure,
  rainCollectorSiteEnvironment,
} from "./rainCollectorRules";
export {
  TORCH_WAYMARK_INSERT_SECONDS,
  TORCH_WAYMARK_MAX_FUEL_SLOTS,
  TORCH_WAYMARK_RELIGHT_SECONDS,
  TORCH_WAYMARK_TOP_UP_SECONDS,
  advanceTorchWaymarkFuel,
  classifyTorchWaymarkUseOperation,
  normalizeTorchWaymarkFuelQueue,
  normalizeTorchWaymarkState,
  torchWaymarkOperationSeconds,
  torchWaymarkTotalFuelSeconds,
} from "./torchWaymarkRules";
export type {
  NormalizedTorchWaymarkState,
  TorchWaymarkAdvanceResult,
  TorchWaymarkUseOperation,
} from "./torchWaymarkRules";
export type {
  StructureTransform2D,
  StructureTransformSource,
} from "./structureGeometry";
export type {
  SimulationDurableToolView,
  SimulationPerishableView,
  SimulationView,
  SimulationViewEntity,
} from "./selectors";
export { resolveAffordance, resolveWildlifeAffordance } from "./affordances";
export {
  AUTHORED_SNAKE_CONTACT_RANGE,
  AUTHORED_SNAKE_DEATH_PRESENTATION_TICKS,
  AUTHORED_SNAKE_SPECIES_ID,
  authoredSnakeIndividualId,
  isAuthoredSnakeEntity,
  migrateLegacyAuthoredSnakes,
  projectAuthoredSnakesForRender,
} from "./authoredSnakes";
export type {
  AffordanceActionId,
  AffordanceAlternative,
  AffordanceBlocker,
  AffordanceEntitySemantic,
  AffordanceHighlightTone,
  AffordanceInteractionMode,
  AffordancePreview,
  AffordanceRequiredItem,
  AffordanceSemanticKind,
  AffordanceState,
  AffordanceTarget,
  ResolvedAffordance,
} from "./affordances";
export {
  affordanceAcceptsInput,
  interactionModeForAffordance,
} from "./affordances";
export {
  DURABLE_TOOL_IDS,
  EQUIPPABLE_ITEM_IDS,
  ITEM_IDS,
  PERISHABLE_ITEM_IDS,
  RECIPE_IDS,
  TASK_IDS,
} from "./types";
export type * from "./types";
