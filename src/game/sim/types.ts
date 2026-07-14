export const ITEM_IDS = [
  "stone",
  "stick",
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
  "bandage",
  "spear",
  "battery",
  "antiparasitic-herb",
  "palm-fruit",
  "brazil-nuts",
  "grubs",
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export const RECIPE_IDS = [
  "stone-blade",
  "axe",
  "bandage",
  "coconut-shell",
  "campfire",
  "shelter",
  "bed",
  "spear",
  "radio-beacon",
] as const;

export type RecipeId = (typeof RECIPE_IDS)[number];

export const TASK_IDS = [
  "treat-wound",
  "purify-water",
  "establish-camp",
  "recover-battery",
  "transmit-signal",
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

export interface CampState {
  position: Vec3;
  fire: FireState;
  shelterBuilt: boolean;
  bedBuilt: boolean;
  beaconBuilt: boolean;
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
}

export interface ResourceRegenerationDefinition {
  intervalSeconds: number;
  amount: number;
  minimumPlayerDistance: number;
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
  tags: string[];
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
}

export interface ObjectiveFlags {
  woundTreated: boolean;
  waterPurified: boolean;
  campEstablished: boolean;
  batteryRecovered: boolean;
  transmitted: boolean;
}

export interface ObjectiveState {
  currentTaskId: TaskId | null;
  completedTaskIds: TaskId[];
  flags: ObjectiveFlags;
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
  | "task-completed"
  | "game-won"
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
}

export interface RngChannels {
  weather: number;
  conditions: number;
  loot: number;
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
  weather: WeatherState;
  camp: CampState;
  world: WorldState;
  objectives: ObjectiveState;
  eventLog: GameEvent[];
  nextEventId: number;
}

export type UsableItemId = "bandage" | "antiparasitic-herb";
export type WaterItemId = "dirty-water" | "clean-water";

export type GameCommand =
  | { type: "move-player"; position: Vec3 }
  | { type: "pick-up"; entityId: string; amount?: number }
  | { type: "inspect-landmark"; entityId: string }
  | { type: "craft"; recipeId: RecipeId }
  | { type: "use-item"; itemId: UsableItemId }
  | { type: "eat"; itemId: ItemId }
  | { type: "collect-water"; sourceEntityId: string }
  | { type: "collect-rainwater" }
  | { type: "boil-water" }
  | { type: "drink-water"; itemId: WaterItemId }
  | { type: "add-fuel" }
  | { type: "encounter-hazard"; entityId: string }
  | { type: "rest" }
  | { type: "transmit" };

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
  | "build-beacon";

export interface RecipeDefinition {
  id: RecipeId;
  label: string;
  ingredients: Partial<Record<ItemId, number>>;
  tools?: readonly ItemId[];
  results?: Partial<Record<ItemId, number>>;
  effect?: RecipeEffect;
  requiresCamp?: boolean;
  /** In-world work represented by this action. It advances the deterministic simulation without blocking the UI. */
  workSeconds: number;
}

export interface TaskDefinition {
  id: TaskId;
  label: string;
  description: string;
  flag: keyof ObjectiveFlags;
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
    | "inventory-full";
}
