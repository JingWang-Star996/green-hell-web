export type PanelId = "watch" | "inventory" | "crafting" | "body" | "notebook" | "map" | "pause";

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
  completed: boolean;
  current: boolean;
};

export type InventoryItemView = {
  id: string;
  label: string;
  count: number;
  description: string;
  category: "material" | "food" | "water" | "medicine" | "tool" | "mission";
  action?: "eat" | "drink" | "use";
  actionLabel?: string;
  statusLabel?: string;
  statusTone?: "stable" | "warning" | "danger";
};

export type RecipeView = {
  id: string;
  label: string;
  description: string;
  ingredients: string[];
  available: boolean;
  reason?: string;
  completed?: boolean;
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
