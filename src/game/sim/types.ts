import type { EcologyState } from "../ecology";
import type { PhysicalActionId } from "../world/hitGeometry";
import type { RiverHydrologyState } from "../world/riverHydrology";
import type { WindFieldState } from "../world/windField";
import type { CanopyJunctionState } from "./canopyJunction";
import type { TreeRegrowthState } from "./treeRegrowth";
export type { TreeRegrowthState } from "./treeRegrowth";
import type {
  ObjectiveFactClause,
  ObjectiveFactRecord,
  ObjectiveGuidanceStep,
} from "./objectiveFacts";

export const ITEM_IDS = [
  "stone",
  "stick",
  "log",
  "vine",
  "broad-leaf",
  "medicinal-leaf",
  "dry-leaf",
  "coconut",
  "coconut-shell",
  "dirty-water",
  "clean-water",
  "stone-blade",
  "axe",
  "stone-pick",
  "torch",
  "bandage",
  "spear",
  "battery",
  "antiparasitic-herb",
  "palm-fruit",
  "brazil-nuts",
  "grubs",
  "raw-meat",
  "cooked-meat",
  "smoked-meat",
  "hide",
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export const EQUIPPABLE_ITEM_IDS = [
  "stone-blade",
  "axe",
  "stone-pick",
  "spear",
  "torch",
] as const;

export type EquippableItemId = (typeof EQUIPPABLE_ITEM_IDS)[number];

export const PERISHABLE_ITEM_IDS = [
  "palm-fruit",
  "brazil-nuts",
  "grubs",
  "raw-meat",
  "cooked-meat",
  "smoked-meat",
] as const;

export type PerishableItemId = (typeof PERISHABLE_ITEM_IDS)[number];

export const DURABLE_TOOL_IDS = [
  "stone-blade",
  "axe",
  "stone-pick",
  "spear",
  "torch",
] as const;

export type DurableToolId = (typeof DURABLE_TOOL_IDS)[number];

export const RECIPE_IDS = [
  "stone-blade",
  "axe",
  "stone-pick",
  "torch",
  "bandage",
  "coconut-shell",
  "campfire",
  "shelter",
  "bed",
  "spear",
  "radio-beacon",
  "cooked-meat",
  "smoking-rack",
  "rain-collector",
  "torch-waymark",
  "split-log",
] as const;

export type RecipeId = (typeof RECIPE_IDS)[number];

export const TASK_IDS = [
  "treat-wound",
  "purify-water",
  "establish-camp",
  "recover-battery",
  "transmit-signal",
  "river-rising",
  "canopy-wind",
] as const;

export type TaskId = (typeof TASK_IDS)[number];
export type Seed = number | string;
export type Inventory = Record<ItemId, number>;
export type GameStatus = "playing" | "won" | "lost";
export type LossReason = "health" | "sanity";
export type RngChannel = "weather" | "conditions" | "loot";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface NutritionState {
  carbohydrates: number;
  protein: number;
  fat: number;
  hydration: number;
}

export interface VitalsState {
  health: number;
  stamina: number;
  energy: number;
  sanity: number;
}

export interface WoundState {
  open: boolean;
  treated: boolean;
  severity: number;
  infection: number;
}

export interface ConditionsState {
  wound: WoundState;
  parasites: number;
  wetness: number;
}

export interface PlayerState {
  position: Vec3;
  /** Authoritative first-person camera pose; optional only for legacy saves. */
  lookYaw?: number;
  lookPitch?: number;
  /** Monotonic session/save token used to reject stale physical commands. */
  poseRevision?: number;
  /** Optional for legacy saves. Null means the player is intentionally empty-handed. */
  equippedItem?: EquippableItemId | null;
  /**
   * Legacy accumulated torch burn debt. Canonical saves keep this at zero;
   * each torch owns its exact remaining fuel in itemLifecycle.tools.torch.
   */
  torchBurnSeconds?: number;
  nutrition: NutritionState;
  vitals: VitalsState;
  conditions: ConditionsState;
}

export interface FireState {
  built: boolean;
  lit: boolean;
  fuelSeconds: number;
  rainExposure: number;
  sheltered: boolean;
}

/** Runtime owned by one placed campfire. `CampState.fire` is a legacy facade. */
export type PlacedCampfireState = Omit<FireState, "built">;

export type PlacedStructureKind =
  | "campfire"
  | "shelter"
  | "bed"
  | "radio-beacon"
  | "smoking-rack"
  | "rain-collector"
  | "torch-waymark";

export interface SmokingRackProcessState {
  kind: "smoking-meat";
  /** The original inventory-batch deadline; loading a rack must not refresh meat. */
  inputExpiresAtTick: number;
  /** Progress in baseline simulation seconds, before biome rate is applied. */
  progressSeconds: number;
  /** Starts when smoking completes so leaving food on the rack is not stasis. */
  outputExpiresAtTick?: number;
  status: "processing" | "ready" | "spoiled";
}

export interface PlacedStructureState {
  id: string;
  kind: PlacedStructureKind;
  position: Vec3;
  yaw: number;
  builtAtTick: number;
  /** Independent fuel/weather state for a placed campfire. */
  fire?: PlacedCampfireState;
  /** Optional so all pre-rack saves remain valid empty structures. */
  process?: SmokingRackProcessState;
  /** Rain collectors own their reservoir; values are optional for old v1 saves. */
  storedUnits?: number;
  capacity?: number;
  /** Last deterministic simulation tick accounted for by the reservoir. */
  lastAdvancedTick?: number;
  /**
   * Exact FIFO fuel ownership for a torch waymark. Each entry is one concrete
   * torch transferred from inventory; at most two entries are valid.
   */
  torchFuelQueueSeconds?: number[];
  /** Empty fuel always implies unlit; optional for legacy structure payloads. */
  lit?: boolean;
  /** Monotonic discovery/presentation memory: once lit, never normalized false. */
  everLit?: boolean;
}

export interface StructurePlacement {
  position: Vec3;
  yaw: number;
}

export interface CampState {
  position: Vec3;
  fire: FireState;
  shelterBuilt: boolean;
  bedBuilt: boolean;
  beaconBuilt: boolean;
  /** First-generation free placement records; absent in legacy saves. */
  structures?: PlacedStructureState[];
}

export interface WeatherState {
  rainIntensity: number;
  targetRainIntensity: number;
  secondsUntilChange: number;
  storm: boolean;
}

export type WorldEntityKind =
  | "resource"
  | "water"
  | "landmark"
  | "radio"
  | "hazard";

/**
 * Persistent lifecycle data for renewable resource nodes. The timestamps use
 * simulation ticks so regeneration is deterministic and survives save/load.
 * Its absence is intentional for finite resources such as the objective
 * battery, and is also accepted when loading a legacy save.
 */
export interface ResourceRegenerationState {
  capacity: number;
  nextTick: number | null;
  /** Ordinal for the pending deterministic pseudo-random growth cycle. */
  cycle?: number;
  /** Units restored when the pending deadline is materialized off-screen. */
  nextAmount?: number | null;
}

export interface ResourceRegenerationDefinition {
  minimumIntervalGameHours: number;
  maximumIntervalGameHours: number;
  minimumAmount: number;
  maximumAmount: number;
  minimumPlayerDistance: number;
}

export interface PerishableBatchState {
  quantity: number;
  /** Fixed simulation tick at which this batch is removed as spoiled. */
  expiresAtTick: number;
}

export interface DurableToolState {
  durability: number;
  maxDurability: number;
  /**
   * Exact authoritative fuel for a concrete torch. Required on canonical torch
   * units and deliberately absent on ordinary durability tools and old saves.
   */
  remainingUseSeconds?: number;
}

/**
 * Per-unit inventory state added after the original save format shipped.
 * Optionality is deliberate: version-1 saves are migrated lazily and safely.
 */
export interface ItemLifecycleState {
  /** Balance migration marker; absent in saves made before the pacing pass. */
  balanceVersion?: 2;
  /** Independent torch-unit ownership migration; must not retrigger food balance. */
  torchFuelVersion?: 1;
  perishables: Partial<Record<PerishableItemId, PerishableBatchState[]>>;
  tools: Partial<Record<DurableToolId, DurableToolState[]>>;
}

export type SemanticWorldEntityCategory =
  | "tree"
  | "mineable-rock"
  | "harvestable-plant";

/**
 * Serializable identity/morphology projected from deterministic semantic
 * generation. These are baseline facts rather than mutable save deltas.
 */
export interface WorldEntitySemanticMetadata {
  generatorVersion: number;
  category: SemanticWorldEntityCategory;
  species?: string;
  material: string;
  growthStage?: string;
  size: "small" | "medium" | "large";
  visualVariant: string;
  yaw: number;
  scale: number;
  action: "pickup" | "cut" | "chop" | "mine";
  toolClass: "hand" | "blade" | "axe" | "pick";
  toolTier: 0 | 1 | 2;
  yieldTableId: string;
  primaryMaterial: string;
  yieldMinimum: number;
  yieldMaximum: number;
  /** Full deterministic node quantity before any player-authored delta. */
  baselineQuantity: number;
}

/**
 * Sparse post-felling state retained on the parent tree. Keeping branches and
 * logs on the deterministic tree identity avoids spawning one save entity per
 * piece of wood during long expeditions.
 */
export interface TreeHarvestState {
  /** Quantized full turn (0..1023), measured from +X toward +Z. */
  fallDirection: number;
  branches: number;
  trunkSegments: number;
  /** At most one processed segment waits in the world for collection. */
  looseLog: boolean;
}

export interface WorldEntity {
  id: string;
  kind: WorldEntityKind;
  label: string;
  position: Vec3;
  interactRadius: number;
  itemId?: ItemId;
  quantity: number;
  depleted: boolean;
  regeneration?: ResourceRegenerationState;
  contamination?: number;
  /** Present for objects rebuilt from the single semantic chunk plan. */
  semantic?: WorldEntitySemanticMetadata;
  /** Present only after a tree has fallen; absent on legacy processed stumps. */
  treeHarvest?: TreeHarvestState;
  /** Sparse staged recovery for an eligible fully processed tree. */
  treeRegrowth?: TreeRegrowthState;
  tags: string[];
}

/** Sparse persistent override for a deterministic authored/generated entity. */
export interface WorldEntityDelta {
  /** Generated chunk key; omitted for authored entities. */
  chunk?: string;
  quantity: number;
  regeneration?: ResourceRegenerationState;
  treeHarvest?: TreeHarvestState;
  treeRegrowth?: TreeRegrowthState;
}

export interface WorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface WorldState {
  bounds: WorldBounds;
  entities: Record<string, WorldEntity>;
  /** Ordered discovery list; omitted by legacy saves. */
  exploredChunks?: string[];
  /** Chunks whose deterministic interactive baseline has been materialized. */
  generatedResourceChunks?: string[];
  /** Player-authored changes retained while deterministic baselines stay absent. */
  entityDeltas?: Record<string, WorldEntityDelta>;
  /** Catchment simulation shared by river rendering, focus and water use. */
  riverHydrology?: RiverHydrologyState;
  /** Seed/tick-authored wind truth shared by simulation and presentation. */
  windField?: WindFieldState;
  /** Sparse persistent state for the authored C-17 canopy junction. */
  canopyJunction?: CanopyJunctionState;
}

export interface ObjectiveFlags {
  woundTreated: boolean;
  waterPurified: boolean;
  campEstablished: boolean;
  batteryRecovered: boolean;
  transmitted: boolean;
  /** Set after the authored rescue ending when the player elects to stay. */
  sandboxContinued?: boolean;
}

export interface ObjectiveState {
  currentTaskId: TaskId | null;
  completedTaskIds: TaskId[];
  flags: ObjectiveFlags;
}

/**
 * Durable discoveries that must outlive the bounded, presentation-oriented
 * event log. Arrays keep the state JSON-safe and deterministic across saves.
 */
export interface KnowledgeState {
  inspectedLandmarkIds: string[];
  observedItemIds: ItemId[];
  craftedRecipeIds: RecipeId[];
  announcedRecipeIds: RecipeId[];
  /** Durable authored-objective truth, independent of the bounded event log. */
  objectiveFacts?: ObjectiveFactRecord[];
}

/** One-time milestones that are not already represented by objective flags. */
export interface ProgressState {
  restEverCompleted: boolean;
  waterEverCollected: boolean;
}

export type GameEventType =
  | "state-created"
  | "command-rejected"
  | "resource-picked"
  | "craft-succeeded"
  | "craft-failed"
  | "recipe-discovered"
  | "landmark-inspected"
  | "item-used"
  | "water-collected"
  | "water-purified"
  | "water-drunk"
  | "wound-treated"
  | "parasite-contracted"
  | "parasite-cleared"
  | "snake-bite"
  | "threat-avoided"
  | "rest-completed"
  | "weather-changed"
  | "fire-lit"
  | "fire-extinguished"
  | "fuel-added"
  | "food-spoiled"
  | "tool-damaged"
  | "tool-broken"
  | "item-equipped"
  | "item-unequipped"
  | "harvest-struck"
  | "wildlife-hit"
  | "wildlife-defeated"
  | "wildlife-attack"
  | "wildlife-loot-collected"
  | "structure-loaded"
  | "structure-process-completed"
  | "structure-process-spoiled"
  | "structure-output-collected"
  | "structure-fuel-added"
  | "structure-ignited"
  | "structure-extinguished"
  | "structure-dismantled"
  | "campaign-fact-recorded"
  | "radio-message-received"
  | "task-completed"
  | "game-won"
  | "sandbox-continued"
  | "game-lost";

export interface GameEventCause {
  source: "command" | "system";
  code: string;
}

export type EventDetailValue = string | number | boolean;

export interface GameEvent {
  id: number;
  tick: number;
  elapsedSeconds: number;
  type: GameEventType;
  message: string;
  cause: GameEventCause;
  details?: Record<string, EventDetailValue>;
}

export interface SimulationClock {
  tick: number;
  elapsedSeconds: number;
  remainderSeconds: number;
  day: number;
  minuteOfDay: number;
  /** Monotonic authored time, optional so version-1 saves remain loadable. */
  gameMinutesElapsed?: number;
}

export interface RngChannels {
  weather: number;
  conditions: number;
  loot: number;
}

/**
 * Minimal persisted cursor for deterministic resource-director epochs. The
 * decision inputs remain ordinary game state, so saves never accumulate a
 * second resource ledger or an unbounded intervention history.
 */
export interface ResourceDirectorState {
  version: 1;
  evaluatedThroughEpoch: number;
}

/**
 * One authoritative interval of health loss. Consecutive applications may be
 * folded only when no other source changed health between them, which keeps
 * `amount === healthBefore - healthAfter` true for every persisted record.
 */
export interface HealthLossRecord {
  id: string;
  sourceCode: string;
  sourceLabel: string;
  amount: number;
  healthBefore: number;
  healthAfter: number;
  /** First sample in a safely merged interval. */
  startedTick: number;
  startedElapsedSeconds: number;
  /** Most recent sample in the interval. */
  tick: number;
  elapsedSeconds: number;
  sampleCount: number;
  lethal: boolean;
}

/**
 * One authoritative interval of sanity loss. As with health evidence, the
 * simulation records the exact boundary that each source crossed instead of
 * reconstructing a cause from the terminal status snapshot.
 */
export interface SanityLossRecord {
  id: string;
  sourceCode: string;
  sourceLabel: string;
  amount: number;
  sanityBefore: number;
  sanityAfter: number;
  /** First sample in a safely merged interval. */
  startedTick: number;
  startedElapsedSeconds: number;
  /** Most recent sample in the interval. */
  tick: number;
  elapsedSeconds: number;
  sampleCount: number;
  lethal: boolean;
}

export interface GameState {
  version: 1;
  seed: number;
  status: GameStatus;
  lossReason: LossReason | null;
  clock: SimulationClock;
  rng: RngChannels;
  player: PlayerState;
  inventory: Inventory;
  itemLifecycle?: ItemLifecycleState;
  weather: WeatherState;
  camp: CampState;
  world: WorldState;
  /** Optional for legacy version-1 saves; migration materializes it. */
  ecology?: EcologyState;
  objectives: ObjectiveState;
  /** Optional only so event-log-era saves remain loadable. */
  knowledge?: KnowledgeState;
  /** Optional only so event-log-era saves remain loadable. */
  progress?: ProgressState;
  /** Optional only so pre-director saves remain loadable. */
  resourceDirector?: ResourceDirectorState;
  /** Optional only so saves created before authoritative damage history load. */
  healthLossHistory?: HealthLossRecord[];
  /** Optional only so saves created before authoritative sanity history load. */
  sanityLossHistory?: SanityLossRecord[];
  eventLog: GameEvent[];
  nextEventId: number;
}

export type UsableItemId = "bandage" | "antiparasitic-herb";
export type WaterItemId = "dirty-water" | "clean-water";

export type GameCommand =
  | {
      type: "move-player";
      position: Vec3;
      look?: { yaw: number; pitch: number };
    }
  | { type: "pick-up"; entityId: string; amount?: number }
  | { type: "harvest"; entityId: string }
  | { type: "inspect-landmark"; entityId: string }
  | { type: "craft"; recipeId: RecipeId; placement?: StructurePlacement }
  | { type: "equip-item"; itemId: EquippableItemId | null }
  | { type: "use-item"; itemId: UsableItemId }
  | { type: "eat"; itemId: ItemId }
  | { type: "collect-water"; sourceEntityId: string }
  | { type: "collect-rainwater" }
  | { type: "boil-water"; structureId?: string }
  | { type: "drink-water"; itemId: WaterItemId }
  | { type: "add-fuel"; structureId?: string }
  | { type: "encounter-hazard"; entityId: string }
  | { type: "attack-wildlife"; individualId: string }
  | {
      type: "physical-action";
      targetId: string;
      actionId: PhysicalActionId;
      poseRevision: number;
    }
  | { type: "encounter-wildlife"; individualId: string }
  | { type: "collect-wildlife-loot"; individualId: string }
  | { type: "use-structure"; structureId: string }
  | { type: "dismantle-structure"; structureId: string }
  | { type: "rest"; structureId?: string }
  | { type: "transmit"; structureId?: string }
  | { type: "continue-expedition" };

export interface MovementInput {
  x: number;
  z: number;
  sprint?: boolean;
  inWater?: boolean;
  sheltered?: boolean;
}

export interface SimulationInput {
  movement?: MovementInput;
  commands?: readonly GameCommand[];
}

export interface NutritionDelta {
  carbohydrates?: number;
  protein?: number;
  fat?: number;
  hydration?: number;
}

export interface ItemDefinition {
  id: ItemId;
  label: string;
  stackLimit: number;
  edible?: NutritionDelta & { energy?: number; sanity?: number };
}

export type RecipeEffect =
  | "build-fire"
  | "build-shelter"
  | "build-bed"
  | "build-beacon"
  | "build-smoking-rack"
  | "build-rain-collector"
  | "build-torch-waymark";

export interface RecipeDefinition {
  id: RecipeId;
  label: string;
  ingredients: Partial<Record<ItemId, number>>;
  tools?: readonly ItemId[];
  results?: Partial<Record<ItemId, number>>;
  effect?: RecipeEffect;
  requiresCamp?: boolean;
  requiresLitFire?: boolean;
  /** In-world work represented by this action. It advances the deterministic simulation without blocking the UI. */
  workSeconds: number;
}

export interface TaskDefinition {
  id: TaskId;
  actId?: string;
  label: string;
  description: string;
  flag?: keyof ObjectiveFlags;
  completion?: readonly ObjectiveFactClause[];
  guidance?: readonly ObjectiveGuidanceStep[];
  supportRecipeIds?: readonly RecipeId[];
  milestoneId?: string;
}

export interface WorldEntityTemplate extends Omit<WorldEntity, "depleted"> {
  depleted?: boolean;
}

export interface CraftCheck {
  ok: boolean;
  missingItems: Partial<Record<ItemId, number>>;
  missingTools: ItemId[];
  reason?:
    | "unknown-recipe"
    | "not-at-camp"
    | "already-built"
    | "inventory-full"
    | "fire-not-lit"
    | "rain-exposed"
    | "missing-empty-containers";
}
