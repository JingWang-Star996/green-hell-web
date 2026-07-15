export const PANEL_IDS = [
  "watch",
  "inventory",
  "crafting",
  "body",
  "notebook",
  "map",
  "pause",
] as const;

export type PanelId = (typeof PANEL_IDS)[number];

export type MeterView = {
  id: string;
  label: string;
  shortLabel: string;
  value: number;
  tone: "health" | "stamina" | "energy" | "sanity" | "water" | "carbs" | "fat" | "protein";
};

export type ObjectiveView = {
  id: string;
  label: string;
  description: string;
  progressLabel?: string;
  blocker?: string;
  steps?: Array<{ id: string; label: string; completed: boolean }>;
  completed: boolean;
  current: boolean;
};

export type InventoryStatusTone = "stable" | "warning" | "danger";

/**
 * A coconut shell is the physical container. Water counts are occupancy states,
 * not free-standing stacks; every projected row therefore shares this summary.
 */
export type WaterContainerLifecycleView = {
  role: "container" | "dirty-water" | "clean-water";
  total: number;
  empty: number;
  dirtyWater: number;
  cleanWater: number;
};

/** One concrete tool, ordered exactly as the simulation will consume it. */
export type DurableToolUnitView = {
  useOrder: number;
  role: "equipped" | "next-use" | "reserve";
  durability: number;
  maxDurability: number;
  statusLabel: string;
  statusTone: InventoryStatusTone;
  remainingGameMinutes?: number;
};

export type InventoryItemView = {
  id: string;
  label: string;
  count: number;
  description: string;
  category: "material" | "food" | "water" | "medicine" | "tool" | "mission";
  action?: "eat" | "drink" | "use" | "equip";
  actionLabel?: string;
  statusLabel?: string;
  statusTone?: InventoryStatusTone;
  waterContainer?: WaterContainerLifecycleView;
  durableUnits?: DurableToolUnitView[];
};

export type RecipeRequirementKind = "material" | "tool" | "condition" | "time";

/**
 * One player-readable prerequisite. Materials and tools carry live inventory
 * counts; conditions and time use `statusLabel` for their contextual state.
 */
export type RecipeRequirementView = {
  id: string;
  label: string;
  kind: RecipeRequirementKind;
  satisfied: boolean;
  current?: number;
  required?: number;
  consumed?: boolean;
  statusLabel?: string;
  /** Broad ecological or production guidance; never an exact world position. */
  acquisitionHint?: string;
};

export type RecipeView = {
  id: string;
  label: string;
  description: string;
  /** Legacy text projection retained for non-structured consumers. */
  ingredients: string[];
  requirements?: RecipeRequirementView[];
  available: boolean;
  reason?: string;
  completed?: boolean;
  statusLabel?: string;
  statusValue?: number;
};

export type EventView = {
  id: number;
  time: string;
  message: string;
  tone: "neutral" | "good" | "warning" | "danger";
};

export type BodyView = {
  woundOpen: boolean;
  woundTreated: boolean;
  infection: number;
  parasites: number;
  wetness: number;
  dirty: boolean;
  bandages: number;
  antiparasiticHerbs: number;
};

export type WatchView = {
  day: number;
  time: string;
  coordinates: string;
  weather: string;
  biome: string;
  rain: number;
  meters: MeterView[];
};

export type MapLandmark = {
  id: string;
  label: string;
  x: number;
  z: number;
  discovered: boolean;
  kind: "camp" | "water" | "station" | "cave" | "food";
};

export type MapChunkView = {
  key: string;
  x: number;
  z: number;
  biome: string;
  color: string;
  current: boolean;
};
