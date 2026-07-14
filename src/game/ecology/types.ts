import type { BiomeId, ChunkDescriptor } from "../world/generation";

export const ECOLOGY_SPECIES_IDS = [
  "reedtail-scuttler",
  "mossback-grazer",
  "glassfang-stalker",
] as const;

export type EcologySpeciesId = (typeof ECOLOGY_SPECIES_IDS)[number];
export type EcologyTrophicRole = "small-prey" | "large-herbivore" | "predator";
export type EcologyActivityPattern = "diurnal" | "crepuscular" | "nocturnal";
export type EcologyEncounterKind = "huntable-prey" | "wary-herbivore" | "danger";

export interface EcologySpeciesDefinition {
  id: EcologySpeciesId;
  label: string;
  role: EcologyTrophicRole;
  activityPattern: EcologyActivityPattern;
  biomeAffinity: Readonly<Record<BiomeId, number>>;
  preferredMoisture: readonly [minimum: number, maximum: number];
  preferredCanopy: readonly [minimum: number, maximum: number];
  preferredRain: readonly [minimum: number, maximum: number];
  baseCarryingCapacity: number;
  birthChancePerStep: number;
  immigrationChancePerStep: number;
  departureChancePerStep: number;
  migrationChancePerStep: number;
  minimumResidentsBeforeMigration: number;
  movementRadius: number;
  encounter: Readonly<{
    kind: EcologyEncounterKind;
    awarenessRadius: number;
    dangerLevel: number;
  }>;
}
export interface EcologyPopulationState {
  speciesId: EcologySpeciesId;
  chunkKey: string;
  count: number;
}

/**
 * Versioned, JSON-safe ecology state. Chunk descriptors stay in the generated
 * world layer and are intentionally not duplicated in saves.
 */
export interface EcologyState {
  version: 1;
  worldSeed: string;
  simulatedThroughTick: number;
  populations: Record<string, EcologyPopulationState>;
}

export interface EcologyEnvironmentFrame {
  /** Inclusive destination tick for this update. */
  tick: number;
  rainIntensity: number;
  activeChunks: readonly ChunkDescriptor[];
  /** Defaults to the current 20-minute game day at 30 fixed ticks per second. */
  ticksPerDay?: number;
  /** Defaults to 14:00, matching a newly-created simulation. */
  startMinuteOfDay?: number;
}

export type EcologyTransitionType =
  | "birth"
  | "immigration"
  | "migration"
  | "departure";

export interface EcologyTransition {
  id: string;
  tick: number;
  type: EcologyTransitionType;
  speciesId: EcologySpeciesId;
  amount: number;
  fromChunkKey?: string;
  toChunkKey?: string;
}

export interface EcologyAdvanceResult {
  state: EcologyState;
  transitions: EcologyTransition[];
}

export type EcologyBehavior = "forage" | "browse" | "stalk" | "shelter";

export interface EcologyVector3 {
  x: number;
  y: number;
  z: number;
}

/** A renderer-facing individual snapshot derived from population summaries. */
export interface EcologyRenderProjection {
  individualId: string;
  populationKey: string;
  speciesId: EcologySpeciesId;
  label: string;
  role: EcologyTrophicRole;
  chunkKey: string;
  position: EcologyVector3;
  headingRadians: number;
  scale: number;
  activity: number;
  visibility: number;
  visible: boolean;
  behavior: EcologyBehavior;
  encounter: EcologySpeciesDefinition["encounter"];
}

/** A narrow encounter-system view; it contains no renderer objects or AI state. */
export interface EcologyEncounterProjection {
  individualId: string;
  speciesId: EcologySpeciesId;
  kind: EcologyEncounterKind;
  distance: number;
  urgency: number;
  dangerLevel: number;
  awarenessRadius: number;
  position: EcologyVector3;
}
