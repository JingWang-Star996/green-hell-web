import type { BiomeId, ChunkDescriptor } from "../world/generation";

export const ECOLOGY_SPECIES_IDS = [
  "reedtail-scuttler",
  "mossback-grazer",
  "glassfang-stalker",
] as const;

/**
 * Authored actors share the ecology combat/render protocol without being
 * seeded by the procedural population ledger.
 */
export const AUTHORED_ECOLOGY_SPECIES_IDS = ["coiled-viper"] as const;

export type EcologySpeciesId =
  | (typeof ECOLOGY_SPECIES_IDS)[number]
  | (typeof AUTHORED_ECOLOGY_SPECIES_IDS)[number];
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
  combat: Readonly<{
    maxHealth: number;
    spearDamage: number;
    contactDamage: number;
    recoveryGameHours: number;
  }>;
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
  /** Sparse player-authored changes; untouched individuals cost no save bytes. */
  individuals?: Record<string, EcologyIndividualState>;
}

export interface EcologyIndividualState {
  speciesId: EcologySpeciesId;
  health: number;
  maxHealth: number;
  lastHitTick: number;
  defeatedAtTick: number | null;
  respawnAtTick: number | null;
  lastContactTick?: number | null;
  /** Unclaimed kill yield; keeps a corpse recoverable when inventory is full. */
  pendingMeat?: number;
  pendingHide?: number;
  /** Frozen death transform for a recoverable procedural corpse. */
  corpse?: EcologyCorpseSnapshot;
}

export interface EcologyCorpseSnapshot {
  chunkKey: string;
  position: EcologyVector3;
  headingRadians: number;
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
  /** Optional observer gives deterministic, presentation-safe awareness behavior. */
  observerPosition?: EcologyVector3;
  /**
   * Small authoritative influence set supplied by the simulation. Projection
   * validates this boundary again: invalid, duplicate or over-budget sources
   * cannot manufacture an ecology response.
   */
  deterrents?: readonly EcologyDeterrent[];
}

export interface EcologyFireDeterrent {
  kind: "fire";
  id: string;
  position: EcologyVector3;
  /** Metres from the source centre; projection accepts (0, 64]. */
  radius: number;
  /** Normalized source potency; projection accepts (0, 1]. */
  strength: number;
}

export type EcologyDeterrent = EcologyFireDeterrent;

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

export type EcologyBehavior =
  | "forage"
  | "browse"
  | "stalk"
  | "shelter"
  | "flee"
  | "defend"
  | "coil"
  | "hurt"
  | "recover"
  | "fire-avoid"
  | "dead";

export interface EcologyVector3 {
  x: number;
  y: number;
  z: number;
}

/** Continuous, renderer/simulation-neutral evidence of an avoidance response. */
export interface EcologyDeterrenceProjection {
  kind: "fire";
  /** Deterministic strongest contributor (lexical id breaks equal-strength ties). */
  sourceId: string;
  /** Every contributing source, sorted for input-order-independent replay. */
  sourceIds: readonly string[];
  /** Bounded combined influence after radial falloff. */
  influence: number;
  /** Actual bounded offset applied relative to the no-fire projection. */
  displacement: number;
  /** Direction the animal faces and retreats toward. */
  retreatHeadingRadians: number;
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
  /** Continuous presentation/readability scalar; never a presence roll. */
  visibility: number;
  /** True while this authoritative individual exists in the active bubble. */
  visible: boolean;
  behavior: EcologyBehavior;
  awareness: number;
  /** Present only for a living procedural predator currently influenced by fire. */
  deterrence?: EcologyDeterrenceProjection;
  health: number;
  maxHealth: number;
  pendingMeat?: number;
  pendingHide?: number;
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
