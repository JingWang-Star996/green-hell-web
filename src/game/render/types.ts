import type { EcologyRenderProjection } from "../ecology";
import type { ResolvedAffordance } from "../sim/affordances";
import type { ChunkCoordinate } from "../world/generation";
import type { HeldItemKind } from "./HeldItemRig";
import type { InteractionAnchor } from "../world/interactionGeometry";
import type { PlaceableStructureKind } from "./PlacementPreview";
import type { TreeHarvestState, TreeRegrowthState } from "../sim/types";
import type { CanopyJunctionPhase } from "../sim/canopyJunction";
import type { WindFieldState } from "../world/windField";

export type RenderEntityKind =
  | "stick"
  | "stone"
  | "vine"
  | "herb"
  | "tinder"
  | "tobacco"
  | "palm"
  | "coconut"
  | "banana"
  | "nut"
  | "mushroom"
  | "water"
  | "wreck"
  | "station"
  | "canopy-junction"
  | "river-gauge"
  | "cache"
  | "beacon"
  | "snake"
  | "animal"
  | "tree"
  | "campfire"
  | "bed"
  | "shelter"
  | "radio-beacon"
  | "smoking-rack"
  | "rain-collector"
  | "torch-waymark";

export type RenderEntity = {
  id: string;
  source: "semantic" | "authored" | "legacy" | "structure";
  kind: RenderEntityKind;
  label: string;
  x: number;
  z: number;
  quantity?: number;
  interactionAnchor?: InteractionAnchor;
  interactRadius: number;
  interactive: boolean;
  available: boolean;
  affordance: ResolvedAffordance;
  treeHarvest?: TreeHarvestState;
  treeRegrowth?: TreeRegrowthState;
};

export type SemanticRenderState = {
  id: string;
  chunkKey: string;
  quantity: number;
  nextRegenerationTick: number | null;
  treeHarvest?: TreeHarvestState;
  treeRegrowth?: TreeRegrowthState;
};

export type RenderStructure = {
  id: string;
  kind: PlaceableStructureKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  processStatus?: "processing" | "ready" | "spoiled";
  processProgress?: number;
  processActive?: boolean;
  storedUnits?: number;
  storageCapacity?: number;
  siteMultiplier?: number;
  /** Authoritative torch-waymark presentation state; omitted by legacy saves. */
  lit?: boolean;
  totalFuelSeconds?: number;
  slotCount?: number;
  /** Campfire-local coverage state. */
  sheltered?: boolean;
};

export type WildlifeRenderProjection = EcologyRenderProjection & {
  affordance: ResolvedAffordance;
};

export type RenderSnapshot = {
  worldSeed: string;
  streamCenter: ChunkCoordinate;
  /** Selector truth for ephemeral continuous-river focus targets. */
  riverWaterAffordance?: ResolvedAffordance;
  day: number;
  minuteOfDay: number;
  rain: number;
  storm: boolean;
  /** One authoritative field shared by rain, leaves, audio and C-17. */
  wind: WindFieldState;
  canopyJunctionPhase: CanopyJunctionPhase;
  riverLevelMeters: number;
  riverTrend: "rising" | "stable" | "falling";
  fireBuilt: boolean;
  fireLit: boolean;
  shelterBuilt: boolean;
  bedBuilt: boolean;
  beaconBuilt: boolean;
  signalActive: boolean;
  canSprint: boolean;
  heldItem: HeldItemKind;
  campX: number;
  campZ: number;
  structures: RenderStructure[];
  semanticStates: SemanticRenderState[];
  entities: RenderEntity[];
  wildlife: WildlifeRenderProjection[];
};

export type InteractionTarget = {
  id: string;
  kind: RenderEntityKind;
  label: string;
  distance: number;
  affordance: ResolvedAffordance;
};

export type ActionPhaseName =
  | "windup"
  | "hit-window"
  | "recovery"
  | "interrupted";

/** Session-only presentation state; simulation events remain authoritative. */
export type ActionPhase = {
  phase: ActionPhaseName;
  targetId: string;
  targetLabel: string;
  verb: string;
  progress: number;
  interruptReason?:
    | "target-lost"
    | "moved"
    | "turned"
    | "aim-lost"
    | "paused"
    | "visibility-lost"
    | "pointer-lock-lost";
};

export type PlayerFrame = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  distance: number;
  sprinting: boolean;
  inWater: boolean;
  sheltered: boolean;
};

export type EngineDiagnostics = {
  fps: number;
  frameMs: number;
  frameP95Ms: number;
  frameP99Ms: number;
  drawCalls: number;
  triangles: number;
  activeChunks: number;
  semanticInstances: number;
  semanticColliders: number;
  semanticStaticChunkRebuilds: number;
  semanticLastSyncMs: number;
  semanticMaxSyncMs: number;
  semanticTreePoolMeshes: number;
  semanticTreePoolCapacity: number;
  semanticTreePoolOccupied: number;
  semanticTreePoolHighWater: number;
  semanticTreePoolHoles: number;
  semanticTreePoolSubmittedInstances: number;
  semanticTreePoolSlotWrites: number;
  semanticTreePoolReleases: number;
  semanticTreePoolOverflows: number;
  semanticRockPoolMeshes: number;
  semanticRockPoolCapacity: number;
  semanticRockPoolOccupied: number;
  semanticRockPoolHighWater: number;
  semanticRockPoolHoles: number;
  semanticRockPoolSubmittedInstances: number;
  semanticRockPoolSlotWrites: number;
  semanticRockPoolReleases: number;
  semanticRockPoolOverflows: number;
  wildlifeViews: number;
  wildlifeProtectedViews: number;
  wildlifeProtectedCandidates: number;
  wildlifeProtectedDropped: number;
  wildlifeOverflowViews: number;
  x: number;
  z: number;
};

export type EngineCallbacks = {
  onTargetChange: (target: InteractionTarget | null) => void;
  onActionPhaseChange: (phase: ActionPhase | null) => void;
  onInteract: (target: InteractionTarget) => void;
  onPlayerFrame: (frame: PlayerFrame) => void;
  onHazardWarning: (hazardId: string) => void;
  /** Returns true only when simulation committed a real contact event. */
  onHazard: (hazardId: string) => boolean;
  onPointerLockChange: (locked: boolean) => void;
  onPlaceStructure: (placement: {
    kind: PlaceableStructureKind;
    x: number;
    y: number;
    z: number;
    yaw: number;
  }) => boolean;
  onPlacementCancelled: () => void;
  onPlacementFeedback: (message: string) => void;
};

export type TouchInput = {
  forward: number;
  right: number;
  lookX: number;
  lookY: number;
  sprint: boolean;
};
