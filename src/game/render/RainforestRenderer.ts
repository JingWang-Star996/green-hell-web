import * as THREE from "three";
import {
  WORLD_CHUNK_SIZE,
  activeChunkCoordinates,
  chunkKey,
  generateChunkVisualPlan,
  worldToChunkCoordinate,
  type ChunkVisualPlan,
  type WorldVisualDetail,
} from "../world/generation";
import {
  RIVER_MUD_HALF_WIDTH,
  RIVER_SURFACE_HALF_WIDTH,
  RIVER_SURFACE_Y_OFFSET,
  RIVER_WADING_HALF_WIDTH,
  riverCenter,
  riverDistance,
  riverSurfaceHeight,
  terrainHeight,
  terrainSlopeAcross,
} from "../world/terrain";
import {
  RIVER_WATER_FOCUS_RAY_FAR,
  parseRiverWaterTargetId,
  riverTargetFromFirstRayHit,
  type RiverSurfaceRayHit,
} from "../world/riverWater";
import { rainCollectorSiteEnvironment } from "../sim/rainCollectorRules";
import { RIVER_GAUGE_POSITION } from "../sim/campaignContent";
import { CANOPY_JUNCTION_POSITION } from "../sim/canopyJunction";
import { RIVER_GAUGE_SAFE_LEVEL_METERS } from "../world/riverHydrology";
import type {
  EngineCallbacks,
  EngineDiagnostics,
  InteractionTarget,
  PlayerFrame,
  RenderEntity,
  RenderEntityKind,
  RenderSnapshot,
  RenderStructure,
  TouchInput,
} from "./types";
import {
  SURVEY_ROCK_SHELTER_LAYOUT,
  WEATHER_STATION_LAYOUT,
  authoredWorldColliders,
  canMovePointThroughColliders,
  isPointShelteredBySurveyRockShelter,
  isPointBlocked,
  isWorldLineOfSightBlocked,
  renderTreeCollider,
  type CircleCollider,
  type WorldCollider,
} from "../world/interactionGeometry";
import { isPhysicalActionId, type HitShape, type HitSweep } from "../world/hitGeometry";
import {
  PREDATOR_CONTACT_RANGE,
  PREDATOR_CONTACT_RESET_RANGE,
  buildPredatorContactSweep,
  colliderNearContactSweep,
  predatorContactBlockerShape,
  resolvePredatorContact,
  type PredatorContactPose,
} from "../world/predatorContact";
import { HeldItemRig } from "./HeldItemRig";
import { NightLightRig, daylightAtMinute } from "./NightLightRig";
import { SemanticInstanceLayer } from "./SemanticInstanceLayer";
import {
  actionWindupInterruptReason,
  actionTargetStillValid,
  advanceActionTransaction,
  beginActionTransaction,
  interruptActionTransaction,
  isExecutableActionTarget,
  toActionPhase,
  type ActionInterruptReason,
  type ActionTransaction,
} from "./actionTransaction";
import { looseStonePieceTransforms } from "./rockVisualSemantics";
import {
  PlacementPreview,
  type PlaceableStructureKind,
  type PlacementPreviewStatus,
} from "./PlacementPreview";
import {
  RAIN_COLLECTOR_LAYOUT,
  SHELTER_COVERAGE_RADIUS,
  STRUCTURE_KINDS,
  TORCH_WAYMARK_LAYOUT,
  isWithinStructureRadius,
  resolveStructureTransform,
  structureTransformFromSource,
  structurePlacementRadius,
  structureWorldColliders,
  structurePlacementsOverlap,
  type StructureTransform2D,
} from "../sim/structureGeometry";
import {
  IDLE_PREDATOR_CONTACT,
  advancePredatorContactTransaction,
  settlePredatorContactCommit,
  type PredatorContactTransaction,
} from "./predatorContactTransaction";
import { selectWildlifeViews } from "./wildlifeViewPolicy";
import { CampfireFeedbackRig } from "./CampfireFeedbackRig";
import type { CampfireFeedbackTargets } from "./campfireFeedback";
import {
  TorchWaymarkLayer,
  type TorchWaymarkLayerDiagnostics,
  type TorchWaymarkVisualInput,
} from "./TorchWaymarkLayer";
import {
  projectWindPresentation,
  stableWindObjectPhase,
} from "./windPresentation";

const EYE_HEIGHT = 1.68;
const WALK_SPEED = 3.35;
const SPRINT_SPEED = 5.7;
const FOCUS_ALIGNMENT = 0.44;
const PHYSICAL_FOCUS_ALIGNMENT = 0.92;
const WIND_LEAF_FACE_COLOR = new THREE.Color(0x3f7a47);
const WIND_LEAF_UNDERSIDE_COLOR = new THREE.Color(0x82a968);

function wrapRainCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const extent = 15;
  const span = extent * 2;
  return ((((value + extent) % span) + span) % span) - extent;
}

const defaultSnapshot: RenderSnapshot = {
  worldSeed: "canopy-living-forest-v1",
  streamCenter: { x: 0, z: 0 },
  day: 1,
  minuteOfDay: 13 * 60 + 20,
  rain: 0.12,
  storm: false,
  wind: {
    version: 1,
    directionRadians: 0,
    speed: 0,
    gust: 0,
    targetDirectionRadians: 0,
    targetSpeed: 0,
    nextFrontTick: 2_700,
    lastAdvancedTick: 0,
  },
  canopyJunctionPhase: "obstructed",
  riverLevelMeters: 0,
  riverTrend: "stable",
  fireBuilt: false,
  fireLit: false,
  shelterBuilt: false,
  bedBuilt: false,
  beaconBuilt: false,
  signalActive: false,
  canSprint: true,
  heldItem: null,
  campX: 0,
  campZ: 0,
  structures: [],
  semanticStates: [],
  entities: [],
  wildlife: [],
};

type EntityView = {
  definition: RenderEntity;
  object: THREE.Object3D;
};

type ChunkView = {
  group: THREE.Group;
  colliders: CircleCollider[];
  interactionSurfaces: THREE.Object3D[];
  riverLevelGroup: THREE.Group | null;
};

type WildlifeView = {
  projection: RenderSnapshot["wildlife"][number];
  object: THREE.Object3D;
};

type DynamicStructureView = {
  definition: RenderSnapshot["structures"][number];
  object: THREE.Group;
};

type CampfireStructureView = DynamicStructureView & {
  light: THREE.PointLight;
  primary: boolean;
  rig: CampfireFeedbackRig;
};

type WindIndicatorLeafView = {
  id: string;
  pivot: THREE.Group;
  leaf: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  phaseRadians: number;
};

export type FocusCandidate = {
  target: InteractionTarget;
  alignment: number;
  visible: boolean;
  occluded: boolean;
};

type PendingFocusCandidate = Omit<FocusCandidate, "occluded">;

export type FocusQueryDiagnostics = {
  /** Interactive projections considered before the range/alignment gate. */
  candidateCount: number;
  /** Candidate-level LOS evaluations, not the number of collider groups. */
  lineOfSightChecks: number;
  /** Full authored/chunk/semantic/structure snapshots built this query. */
  colliderSnapshotBuilds: number;
};

type FocusTargetColliderExclusion =
  | "none"
  | "semantic"
  | "legacy-tree"
  | "structure";

type FocusColliderEntry = {
  id: string;
  colliders: readonly WorldCollider[];
};

type FocusOccluderSnapshot = {
  fixed: readonly WorldCollider[];
  semantic: readonly WorldCollider[] | null;
  semanticExcludingTarget: Map<string, readonly WorldCollider[]>;
  legacyTrees: readonly FocusColliderEntry[];
  allLegacyTrees: readonly WorldCollider[];
  structures: readonly FocusColliderEntry[];
  allStructures: readonly WorldCollider[];
};

type FocusQueryContext = {
  candidates: FocusCandidate[];
  diagnostics: FocusQueryDiagnostics;
  occluders: FocusOccluderSnapshot | null;
};

type RiverFocusProjection = {
  candidate: PendingFocusCandidate;
  anchor: Readonly<{ x: number; z: number }>;
};

type EmissiveMaterial = THREE.Material & {
  emissive: THREE.Color;
  emissiveIntensity: number;
};

type HighlightedMaterial = {
  material: EmissiveMaterial;
  emissive: THREE.Color;
  emissiveIntensity: number;
};

/**
 * Pure focus policy used by the renderer and regression tests. A capability's
 * own range is authoritative; blocked and danger targets remain inspectable.
 */
export function selectFocusedTarget(
  candidates: readonly FocusCandidate[],
): InteractionTarget | null {
  let best: InteractionTarget | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate.visible || candidate.occluded) continue;
    if (!focusCandidatePassesCheapGate(candidate)) continue;
    const score = candidate.target.distance + (1 - candidate.alignment) * 1.4;
    if (score >= bestScore) continue;
    best = candidate.target;
    bestScore = score;
  }
  return best;
}

/**
 * The allocation-free gate shared by deferred LOS and final selection. Keep
 * this policy centralized so an optimization cannot widen or narrow focus.
 */
export function focusCandidatePassesCheapGate(
  candidate: PendingFocusCandidate,
): boolean {
  if (!candidate.visible) return false;
  if (candidate.target.distance > candidate.target.affordance.range) {
    return false;
  }
  const alignmentThreshold = isPhysicalActionId(
    candidate.target.affordance.actionId,
  )
    ? PHYSICAL_FOCUS_ALIGNMENT
    : FOCUS_ALIGNMENT;
  return candidate.alignment >= alignmentThreshold;
}

/** Applies a snapshot's authoritative catchment offset to an existing river. */
export function applyRiverLevelToGroup(
  group: THREE.Group,
  levelMeters: number,
): void {
  group.position.y = Number.isFinite(levelMeters) ? levelMeters : 0;
  group.updateMatrixWorld(true);
}

/** Returns true when a 2D world collider interrupts the camera-to-target ray. */
export function isLineOfSightBlocked(
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
  colliders: readonly WorldCollider[],
  options: Readonly<{ ignoreBlockersContainingTarget?: boolean }> = {},
): boolean {
  return isWorldLineOfSightBlocked(from, to, colliders, options);
}

function focusColliderGroupBlocks(
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
  colliders: readonly WorldCollider[],
  strictEndpointOcclusion: boolean,
): boolean {
  return strictEndpointOcclusion
    ? isLineOfSightBlocked(from, to, colliders, {
        ignoreBlockersContainingTarget: false,
      })
    : isLineOfSightBlocked(from, to, colliders);
}

/**
 * Projects renderer-safe waymark state without inventing fuel for legacy or
 * malformed payloads. The dedicated layer remains the final validation gate.
 */
export function torchWaymarkVisualInputsFromStructures(
  structures: readonly RenderStructure[],
): TorchWaymarkVisualInput[] {
  return structures
    .filter((structure) => structure.kind === "torch-waymark")
    .map((structure) => {
      const fuelIsValid =
        Number.isFinite(structure.totalFuelSeconds) &&
        (structure.totalFuelSeconds ?? -1) > 0;
      const slotCountIsValid =
        Number.isSafeInteger(structure.slotCount) &&
        (structure.slotCount ?? 0) >= 1 &&
        (structure.slotCount ?? 3) <= 2;
      const ownsFuel = fuelIsValid && slotCountIsValid;
      return {
        id: structure.id,
        x: structure.x,
        // Structure saves own horizontal authority; terrain owns render Y.
        y: terrainHeight(structure.x, structure.z),
        z: structure.z,
        yaw: structure.yaw,
        lit: ownsFuel && structure.lit === true,
        totalFuelSeconds: ownsFuel ? structure.totalFuelSeconds! : 0,
        slotCount: ownsFuel ? structure.slotCount! : 0,
      };
    });
}

export class RainforestRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: EngineCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(72, 1, 0.08, 180);
  private previousFrameTime = performance.now();
  private readonly keys = new Set<string>();
  private readonly entityViews = new Map<string, EntityView>();
  private readonly wildlifeViews = new Map<string, WildlifeView>();
  private readonly smokingRackViews = new Map<string, DynamicStructureView>();
  private readonly rainCollectorViews = new Map<string, DynamicStructureView>();
  private readonly campfireViews = new Map<string, CampfireStructureView>();
  private readonly shelterViews = new Map<string, DynamicStructureView>();
  private readonly bedViews = new Map<string, DynamicStructureView>();
  private primaryCampfireId: string | null = null;
  private readonly chunkViews = new Map<string, ChunkView>();
  private readonly colliders: WorldCollider[] = [];
  private readonly hazardWarned = new Set<string>();
  private readonly hazardTriggered = new Set<string>();
  private readonly hazardTelegraphStarted = new Map<string, number>();
  private readonly hazardBlockedUntil = new Map<string, number>();
  private readonly worldGroup = new THREE.Group();
  private readonly chunkGroup = new THREE.Group();
  private readonly dynamicGroup = new THREE.Group();
  private readonly heldItemRig = new HeldItemRig();
  private readonly nightLightRig = new NightLightRig();
  private readonly placementPreview = new PlacementPreview();
  private readonly torchWaymarkLayer = new TorchWaymarkLayer();
  private readonly torchWaymarkFrustum = new THREE.Frustum();
  private readonly torchWaymarkFrustumMatrix = new THREE.Matrix4();
  private readonly torchWaymarkFrustumSphere = new THREE.Sphere();
  private readonly semanticInstances: SemanticInstanceLayer;
  private readonly focusMarker = createFocusMarker();
  private readonly riverFocusRaycaster = new THREE.Raycaster();
  private readonly rainGeometry = new THREE.BufferGeometry();
  private readonly rainMaterial = new THREE.PointsMaterial({
    color: 0xbdd8d0,
    size: 0.055,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly rainPoints: THREE.Points;
  private readonly windIndicatorLeaves: WindIndicatorLeafView[] = [];
  private readonly hemisphere = new THREE.HemisphereLight(0xcbe2c3, 0x142014, 1.6);
  private readonly sun = new THREE.DirectionalLight(0xffefc9, 2.2);
  private readonly fireGroup = new THREE.Group();
  private readonly fireLight = new THREE.PointLight(0xff7a2d, 0, 12, 2);
  private campfireFeedbackRig!: CampfireFeedbackRig;
  private campfireTransientListener:
    | ((descriptor: CampfireFeedbackTargets["transients"][number]) => void)
    | null = null;
  private readonly signalLight = new THREE.PointLight(0xff3d2e, 0, 20, 2);
  private birdFlock: THREE.InstancedMesh | null = null;
  private birdWingPositions: THREE.BufferAttribute | null = null;
  private birdMaterial: THREE.MeshBasicMaterial | null = null;
  private fireflies: THREE.Points | null = null;
  private fireflyBasePositions: Float32Array | null = null;
  private fireflyMaterial: THREE.PointsMaterial | null = null;
  private readonly wildlifeDummy = new THREE.Object3D();
  private wildlifeTime = 0;
  private snapshot = defaultSnapshot;
  private animationFrame = 0;
  private running = false;
  private paused = false;
  private pointerLocked = false;
  private dragFallbackActive = false;
  private dragPointerId: number | null = null;
  private dragLastX = 0;
  private dragLastY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragMoved = false;
  private yaw = Math.PI;
  private pitch = -0.05;
  private player = new THREE.Vector3(0, 0, 5);
  private lastPlayer = new THREE.Vector3(0, 0, 5);
  private touch: TouchInput = { forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false };
  private currentTarget: InteractionTarget | null = null;
  private currentTargetSignature = "";
  private placementFeedbackSignature = "";
  private actionTransaction: ActionTransaction | null = null;
  private actionPhaseSignature = "";
  private highlightedMaterials: HighlightedMaterial[] = [];
  private lastFrameReport = 0;
  private frameSamples: number[] = [];
  private focusQueryDiagnostics: FocusQueryDiagnostics = {
    candidateCount: 0,
    lineOfSightChecks: 0,
    colliderSnapshotBuilds: 0,
  };
  private diagnostics: EngineDiagnostics = {
    fps: 0,
    frameMs: 0,
    frameP95Ms: 0,
    frameP99Ms: 0,
    drawCalls: 0,
    triangles: 0,
    activeChunks: 0,
    semanticInstances: 0,
    semanticColliders: 0,
    semanticStaticChunkRebuilds: 0,
    semanticLastSyncMs: 0,
    semanticMaxSyncMs: 0,
    semanticTreePoolMeshes: 0,
    semanticTreePoolCapacity: 0,
    semanticTreePoolOccupied: 0,
    semanticTreePoolHighWater: 0,
    semanticTreePoolHoles: 0,
    semanticTreePoolSubmittedInstances: 0,
    semanticTreePoolSlotWrites: 0,
    semanticTreePoolReleases: 0,
    semanticTreePoolOverflows: 0,
    semanticRockPoolMeshes: 0,
    semanticRockPoolCapacity: 0,
    semanticRockPoolOccupied: 0,
    semanticRockPoolHighWater: 0,
    semanticRockPoolHoles: 0,
    semanticRockPoolSubmittedInstances: 0,
    semanticRockPoolSlotWrites: 0,
    semanticRockPoolReleases: 0,
    semanticRockPoolOverflows: 0,
    wildlifeViews: 0,
    wildlifeProtectedViews: 0,
    wildlifeProtectedCandidates: 0,
    wildlifeProtectedDropped: 0,
    wildlifeOverflowViews: 0,
    x: 0,
    z: 0,
  };
  private reducedMotion = false;
  private userReducedMotion = false;
  private playerMoving = false;
  private playerSprinting = false;
  private activeChunkCenter = "";
  private readonly worldVisualDetail: WorldVisualDetail;
  private readonly activeChunkRadius: number;
  private readonly maxWildlifeViews: number;
  private wildlifeProtectedViews = 0;
  private wildlifeProtectedCandidates = 0;
  private wildlifeProtectedDropped = 0;
  private wildlifeOverflowViews = 0;
  private readonly cleanup: Array<() => void> = [];

  constructor(canvas: HTMLCanvasElement, callbacks: EngineCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
    const lowPower = this.isLowPowerDevice();
    this.worldVisualDetail = lowPower ? "low" : "standard";
    this.activeChunkRadius = lowPower ? 1 : 2;
    this.maxWildlifeViews = lowPower ? 10 : 24;
    this.semanticInstances = new SemanticInstanceLayer({
      detail: this.worldVisualDetail,
      shadows: !lowPower,
      terrainHeight,
      maxActiveChunks: (this.activeChunkRadius * 2 + 1) ** 2,
    });
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !lowPower,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = !lowPower;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.fog = new THREE.FogExp2(0x274435, 0.021);
    this.scene.background = new THREE.Color(0x6b8c72);
    this.scene.add(
      this.worldGroup,
      this.dynamicGroup,
      this.torchWaymarkLayer.root,
      this.hemisphere,
      this.sun,
      this.camera,
    );
    this.camera.add(this.heldItemRig.root, this.nightLightRig.root);
    this.dynamicGroup.add(this.placementPreview.root, this.focusMarker);

    this.sun.position.set(-28, 42, 20);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -38;
    this.sun.shadow.camera.right = 38;
    this.sun.shadow.camera.top = 38;
    this.sun.shadow.camera.bottom = -38;
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 95;

    this.camera.rotation.order = "YXZ";
    this.rainPoints = new THREE.Points(this.rainGeometry, this.rainMaterial);
    this.rainPoints.frustumCulled = false;
    this.scene.add(this.rainPoints);
    this.createWorld();
    this.createRain();
    this.createCanopyWindIndicators();
    this.createCampfire();
    this.campfireFeedbackRig = new CampfireFeedbackRig(
      this.fireGroup,
      this.fireLight,
    );
    this.createWildlife();
    this.bindEvents();
    this.resize();
    this.setPlayerPosition(0, 5, Math.PI);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousFrameTime = performance.now();
    this.animate();
  }

  stop(): void {
    this.running = false;
    window.cancelAnimationFrame(this.animationFrame);
  }

  setSnapshot(snapshot: RenderSnapshot): void {
    const seedChanged = snapshot.worldSeed !== this.snapshot.worldSeed;
    this.snapshot = snapshot;
    this.heldItemRig.setKind(snapshot.heldItem);
    this.nightLightRig.update(
      snapshot.minuteOfDay,
      snapshot.heldItem,
      snapshot.rain,
      this.wildlifeTime,
      this.reducedMotion,
    );
    if (seedChanged) this.clearWorldChunks();
    this.syncEntities(snapshot.entities);
    this.syncWildlife(snapshot.wildlife);
    this.syncStructures();
    this.syncTorchWaymarks();
    this.syncWorldChunks(true);
    this.syncRiverLevelGroups();
    if (!this.running) {
      this.updateTarget();
      this.renderer.render(this.scene, this.camera);
    }
  }

  setTouchInput(input: Partial<TouchInput>): void {
    this.touch = { ...this.touch, ...input };
  }

  setPaused(paused: boolean): void {
    if (paused) this.interruptActiveAction("paused");
    this.paused = paused;
    this.keys.clear();
    this.touch = { forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false };
    // Pausing freezes gameplay input and simulation, but the presentation RAF
    // stays alive so feedback triggered from an open panel (for example adding
    // fuel) has the same visual clock as its audio cue.
    if (!this.running) this.start();
  }

  setReducedMotion(enabled: boolean): void {
    this.userReducedMotion = enabled;
    this.reducedMotion = enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  applyCampfireFeedback(
    structureId: string,
    feedback: CampfireFeedbackTargets,
  ): void {
    this.campfireViews.get(structureId)?.rig.apply(feedback);
    if (!this.running) this.renderer.render(this.scene, this.camera);
  }

  setCampfireTransientListener(
    listener: ((descriptor: CampfireFeedbackTargets["transients"][number]) => void) | null,
  ): void {
    this.campfireTransientListener = listener;
    this.campfireFeedbackRig.setTransientStartListener(listener);
    for (const view of this.campfireViews.values()) {
      view.rig.setTransientStartListener(listener);
    }
  }

  resetRun(): void {
    this.hazardWarned.clear();
    this.hazardTriggered.clear();
    this.hazardTelegraphStarted.clear();
    this.hazardBlockedUntil.clear();
    this.currentTarget = null;
    this.currentTargetSignature = "";
    this.actionTransaction = null;
    this.actionPhaseSignature = "";
    this.heldItemRig.cancelUse();
    this.campfireFeedbackRig.reset();
    for (const view of this.campfireViews.values()) view.rig.reset();
    this.clearFocusHighlight();
    this.callbacks.onTargetChange(null);
    this.callbacks.onActionPhaseChange(null);
    this.setPaused(false);
  }

  setPlayerPosition(
    x: number,
    z: number,
    yaw = this.yaw,
    pitch = this.pitch,
  ): void {
    this.player.set(x, 0, z);
    this.lastPlayer.copy(this.player);
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -1.34, 1.34);
    this.camera.position.set(this.player.x, terrainHeight(this.player.x, this.player.z) + EYE_HEIGHT, this.player.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.syncWorldChunks();
    this.syncTorchWaymarks();
  }

  requestPointerLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const request = this.canvas.requestPointerLock?.();
        if (request) void request.catch(() => this.enableDragFallback());
        else this.enableDragFallback();
      } catch {
        this.enableDragFallback();
      }
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.dragFallbackActive = false;
    this.endDragLook();
    this.canvas.style.cursor = "";
    this.callbacks.onPointerLockChange(false);
  }

  interact(): void {
    this.performCurrentAction();
  }

  primaryAction(): void {
    this.performCurrentAction();
  }

  performCurrentAction(): void {
    if (this.placementPreview.getKind()) {
      this.confirmPlacement();
      return;
    }
    if (this.actionTransaction) return;
    const target = this.currentTarget;
    if (!target) return;
    if (!isExecutableActionTarget(target)) {
      this.callbacks.onInteract(target);
      return;
    }
    const transaction = beginActionTransaction(target, {
      x: this.player?.x ?? 0,
      z: this.player?.z ?? 0,
      yaw: this.yaw ?? 0,
      pitch: this.pitch ?? 0,
    });
    if (!transaction) return;
    this.actionTransaction = transaction;
    if (
      target.affordance.animationKey.startsWith("tool.") ||
      target.affordance.animationKey.startsWith("weapon.")
    ) {
      this.heldItemRig.playUse();
    }
    this.publishActionPhase(true);
  }

  beginPlacement(kind: PlaceableStructureKind): void {
    this.placementFeedbackSignature = "";
    this.placementPreview.setKind(kind);
    this.updatePlacementPreview();
  }

  cancelPlacement(): void {
    if (!this.placementPreview.getKind()) return;
    this.placementPreview.setKind(null);
    this.placementFeedbackSignature = "";
    this.callbacks.onPlacementCancelled();
  }

  rotatePlacement(): void {
    if (!this.placementPreview.getKind()) return;
    this.placementPreview.rotateQuarterTurn();
  }

  isPlacementActive(): boolean {
    return this.placementPreview.getKind() !== null;
  }

  playHarvestImpact(entityId: string, depleted = false): void {
    const view = this.entityViews.get(entityId);
    if (!view) return;
    if (view.definition.source === "semantic") {
      this.semanticInstances.playImpact(entityId);
      return;
    }
    view.object.userData.hitStartedAt = performance.now();
    view.object.userData.hideAfterHit = depleted;
    if (depleted) view.object.visible = true;
  }

  getDiagnostics(): EngineDiagnostics {
    return { ...this.diagnostics };
  }

  getFocusQueryDiagnostics(): FocusQueryDiagnostics {
    return { ...this.focusQueryDiagnostics };
  }

  getTorchWaymarkDiagnostics(): TorchWaymarkLayerDiagnostics {
    return this.torchWaymarkLayer.getDiagnostics();
  }

  dispose(): void {
    this.stop();
    this.cleanup.forEach((fn) => fn());
    this.semanticInstances.dispose();
    this.torchWaymarkLayer.dispose();
    this.scene.remove(this.torchWaymarkLayer.root);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.InstancedMesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private bindEvents(): void {
    const onResize = () => this.resize();
    const onKeyDown = (event: KeyboardEvent) => {
      if (this.paused) return;
      if (["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "ShiftRight", "KeyE"].includes(event.code)) {
        if (event.code === "KeyE" && !event.repeat) this.performCurrentAction();
        this.keys.add(event.code);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.code);
    const onMouseMove = (event: MouseEvent) => {
      if (!this.pointerLocked) return;
      const sensitivity = 0.0018;
      this.yaw -= event.movementX * sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * sensitivity, -1.34, 1.34);
    };
    const onPointerLock = () => {
      const wasPointerLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (wasPointerLocked && !this.pointerLocked) {
        this.interruptActiveAction("pointer-lock-lost");
      }
      if (this.pointerLocked) {
        this.dragFallbackActive = false;
        this.endDragLook();
        this.canvas.style.cursor = "";
      }
      this.callbacks.onPointerLockChange(this.pointerLocked || this.dragFallbackActive);
      this.keys.clear();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        !this.paused &&
        this.pointerLocked &&
        event.pointerType === "mouse" &&
        event.button === 0
      ) {
        this.performCurrentAction();
        event.preventDefault();
        return;
      }
      if (
        this.paused ||
        this.pointerLocked ||
        !this.dragFallbackActive ||
        event.pointerType !== "mouse" ||
        event.button !== 0
      ) return;
      this.dragPointerId = event.pointerId;
      this.dragLastX = event.clientX;
      this.dragLastY = event.clientY;
      this.dragStartX = event.clientX;
      this.dragStartY = event.clientY;
      this.dragMoved = false;
      this.canvas.style.cursor = "grabbing";
      try { this.canvas.setPointerCapture(event.pointerId); } catch { /* capture may be denied by embeds */ }
      event.preventDefault();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!this.placementPreview.getKind()) return;
      event.preventDefault();
      this.cancelPlacement();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== this.dragPointerId || this.pointerLocked || this.paused) return;
      const sensitivity = 0.0042;
      const deltaX = event.clientX - this.dragLastX;
      const deltaY = event.clientY - this.dragLastY;
      if (Math.hypot(event.clientX - this.dragStartX, event.clientY - this.dragStartY) > 5) {
        this.dragMoved = true;
      }
      this.dragLastX = event.clientX;
      this.dragLastY = event.clientY;
      this.yaw -= deltaX * sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * sensitivity, -1.34, 1.34);
      event.preventDefault();
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== this.dragPointerId) return;
      const shouldUse = event.type === "pointerup" && !this.dragMoved;
      this.endDragLook(event.pointerId);
      if (shouldUse) this.performCurrentAction();
    };
    const onVisibility = () => {
      if (document.hidden) {
        this.keys.clear();
        this.interruptActiveAction("visibility-lost");
      }
    };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => { this.reducedMotion = media.matches || this.userReducedMotion; };
    onMotion();

    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onPointerLock);
    this.canvas.addEventListener("pointerdown", onPointerDown);
    this.canvas.addEventListener("pointermove", onPointerMove);
    this.canvas.addEventListener("pointerup", onPointerEnd);
    this.canvas.addEventListener("pointercancel", onPointerEnd);
    this.canvas.addEventListener("lostpointercapture", onPointerEnd);
    this.canvas.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("visibilitychange", onVisibility);
    media.addEventListener("change", onMotion);
    this.cleanup.push(
      () => window.removeEventListener("resize", onResize),
      () => window.removeEventListener("keydown", onKeyDown),
      () => window.removeEventListener("keyup", onKeyUp),
      () => document.removeEventListener("mousemove", onMouseMove),
      () => document.removeEventListener("pointerlockchange", onPointerLock),
      () => this.canvas.removeEventListener("pointerdown", onPointerDown),
      () => this.canvas.removeEventListener("pointermove", onPointerMove),
      () => this.canvas.removeEventListener("pointerup", onPointerEnd),
      () => this.canvas.removeEventListener("pointercancel", onPointerEnd),
      () => this.canvas.removeEventListener("lostpointercapture", onPointerEnd),
      () => this.canvas.removeEventListener("contextmenu", onContextMenu),
      () => document.removeEventListener("visibilitychange", onVisibility),
      () => media.removeEventListener("change", onMotion),
    );
  }

  private enableDragFallback(): void {
    if (this.paused || this.pointerLocked) return;
    this.dragFallbackActive = true;
    this.canvas.style.cursor = "grab";
    this.callbacks.onPointerLockChange(true);
  }

  private endDragLook(pointerId = this.dragPointerId): void {
    if (pointerId === null || pointerId !== this.dragPointerId) return;
    if (this.canvas.hasPointerCapture(pointerId)) {
      try { this.canvas.releasePointerCapture(pointerId); } catch { /* already released */ }
    }
    this.dragPointerId = null;
    this.canvas.style.cursor = this.dragFallbackActive ? "grab" : "";
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const dprCap = this.isLowPowerDevice() ? 1 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    if (!this.running) return;
    this.animationFrame = window.requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min((now - this.previousFrameTime) / 1000, 0.05);
    this.previousFrameTime = now;
    if (this.paused) {
      for (const view of this.campfireViews.values()) {
        view.rig.update(delta, now);
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.updatePlayer(delta);
    this.updateEnvironment(delta);
    this.updateTarget();
    this.updateActionTransaction(delta);
    this.updateFocusPulse(now);
    this.updatePlacementPreview();
    this.updateEntityFeedback();
    this.updateSmokingRackEffects(now);
    this.heldItemRig.update(
      delta,
      this.playerMoving,
      this.playerSprinting,
      this.reducedMotion,
    );
    this.renderer.render(this.scene, this.camera);
    this.updateDiagnostics(delta);
  };

  private updateActionTransaction(deltaSeconds: number): void {
    const active = this.actionTransaction;
    if (!active) return;
    const pose = {
      x: this.player?.x ?? 0,
      z: this.player?.z ?? 0,
      yaw: this.yaw ?? 0,
      pitch: this.pitch ?? 0,
    };
    const interruptReason = actionWindupInterruptReason(
      active,
      this.currentTarget,
      pose,
    );
    const targetValid =
      interruptReason === null &&
      actionTargetStillValid(active, this.currentTarget, pose);
    const step = advanceActionTransaction(
      active,
      deltaSeconds * 1_000,
      targetValid,
      interruptReason ?? "target-lost",
    );
    const interrupted =
      active.phase === "windup" &&
      step.transaction?.phase === "interrupted";
    this.actionTransaction = step.transaction;
    if (interrupted) this.heldItemRig.cancelUse();
    this.publishActionPhase();
    if (step.shouldCommit && step.commitTarget) {
      this.callbacks.onInteract(step.commitTarget);
    }
  }

  private interruptActiveAction(reason: ActionInterruptReason): void {
    if (!this.actionTransaction) return;
    const previous = this.actionTransaction;
    const wasWindup = previous.phase === "windup";
    const next = interruptActionTransaction(previous, reason);
    if (next === previous) return;
    this.actionTransaction = next;
    if (wasWindup) this.heldItemRig.cancelUse();
    this.publishActionPhase(true);
  }

  private publishActionPhase(force = false): void {
    const phase = toActionPhase(this.actionTransaction);
    const signature = phase
      ? [
          phase.phase,
          phase.targetId,
          Math.floor(phase.progress * 10),
          phase.interruptReason ?? "",
        ].join("|")
      : "idle";
    if (!force && signature === this.actionPhaseSignature) return;
    this.actionPhaseSignature = signature;
    this.callbacks.onActionPhaseChange(phase);
  }

  private updatePlayer(delta: number): void {
    const forwardInput = this.paused ? 0 : (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0) + this.touch.forward;
    const rightInput = this.paused ? 0 : (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0) + this.touch.right;
    const moving = Math.abs(forwardInput) > 0.05 || Math.abs(rightInput) > 0.05;
    const sprinting = moving && this.snapshot.canSprint && (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.touch.sprint);
    this.playerMoving = moving;
    this.playerSprinting = sprinting;
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
    const movement = new THREE.Vector3();
    if (moving) {
      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      movement.addScaledVector(forward, forwardInput).addScaledVector(right, rightInput);
      if (movement.lengthSq() > 1) movement.normalize();
      movement.multiplyScalar(speed * delta);
    }

    if (!this.paused && (this.touch.lookX || this.touch.lookY)) {
      this.yaw -= this.touch.lookX * delta * 1.8;
      this.pitch = THREE.MathUtils.clamp(this.pitch - this.touch.lookY * delta * 1.5, -1.34, 1.34);
    }

    if (moving) {
      const colliders = this.playerMovementColliders();
      const from = { x: this.player.x, z: this.player.z };
      const candidate = this.player.clone().add(movement);
      const canMoveTo = (point: THREE.Vector3) =>
        canMovePointThroughColliders(colliders, from, point);
      if (canMoveTo(candidate)) this.player.copy(candidate);
      else {
        const slideX = new THREE.Vector3(candidate.x, 0, this.player.z);
        const slideZ = new THREE.Vector3(this.player.x, 0, candidate.z);
        if (canMoveTo(slideX)) this.player.copy(slideX);
        else if (canMoveTo(slideZ)) this.player.copy(slideZ);
      }
    }

    const distance = this.player.distanceTo(this.lastPlayer);
    const bob = moving && !this.reducedMotion ? Math.sin(performance.now() * (sprinting ? 0.013 : 0.009)) * 0.025 : 0;
    this.camera.position.set(this.player.x, terrainHeight(this.player.x, this.player.z) + EYE_HEIGHT + bob, this.player.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.lastPlayer.copy(this.player);
    this.syncWorldChunks();

    const frame: PlayerFrame = {
      x: this.player.x,
      z: this.player.z,
      yaw: this.yaw,
      pitch: this.pitch,
      distance,
      sprinting,
      inWater:
        riverDistance(this.player.x, this.player.z) < RIVER_WADING_HALF_WIDTH,
      sheltered: this.isSheltered(this.player.x, this.player.z),
    };
    this.callbacks.onPlayerFrame(frame);
    this.checkHazards();
  }

  private updateEnvironment(delta: number): void {
    const minute = this.snapshot.minuteOfDay % 1440;
    const daylight = daylightAtMinute(minute);
    const stormDarken = this.snapshot.storm ? 0.42 : 1;
    this.hemisphere.intensity = 0.35 + daylight * 1.35 * stormDarken;
    this.sun.intensity = 0.05 + daylight * 2.15 * stormDarken;
    this.sun.color.set(daylight < 0.35 ? 0xff9b62 : 0xffefc9);
    const skyDay = new THREE.Color(0x789b7d);
    const skyNight = new THREE.Color(0x020807);
    const skyStorm = new THREE.Color(0x263c35);
    const sky = skyNight.clone().lerp(skyDay, daylight).lerp(skyStorm, this.snapshot.rain * 0.62);
    this.scene.background = sky;
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.copy(sky.clone().lerp(new THREE.Color(0x173024), 0.45));
      this.scene.fog.density = 0.016 + this.snapshot.rain * 0.018 + (1 - daylight) * 0.006;
    }

    this.rainMaterial.opacity = THREE.MathUtils.lerp(this.rainMaterial.opacity, this.snapshot.rain * 0.78, 0.07);
    this.rainPoints.visible = this.snapshot.rain > 0.02;
    this.rainPoints.position.set(this.player.x, terrainHeight(this.player.x, this.player.z) + 8, this.player.z);
    const wind = projectWindPresentation(this.snapshot.wind, {
      quality: this.worldVisualDetail === "low" ? "low-power" : "full",
      reducedMotion: this.reducedMotion,
    });
    if (this.rainPoints.visible) {
      const positions = this.rainGeometry.attributes.position as THREE.BufferAttribute;
      const motionScale = this.reducedMotion ? 0.28 : 1;
      const fallSpeed = (11 + this.snapshot.rain * 15) * motionScale;
      const horizontalSpeed =
        fallSpeed * Math.tan(wind.rainLines.tiltRadians);
      for (let i = 0; i < positions.count; i += 1) {
        let x = positions.getX(i) +
          delta * horizontalSpeed * wind.rainLines.directionX;
        let y = positions.getY(i) - delta * fallSpeed;
        let z = positions.getZ(i) +
          delta * horizontalSpeed * wind.rainLines.directionZ;
        if (y < -3) y = 9 + Math.random() * 4;
        x = wrapRainCoordinate(x);
        z = wrapRainCoordinate(z);
        positions.setXYZ(i, x, y, z);
      }
      positions.needsUpdate = true;
    }

    this.updateCanopyWindIndicators(wind, delta);

    for (const view of this.campfireViews.values()) {
      view.rig.update(delta);
    }
    this.signalLight.intensity = this.snapshot.signalActive ? 3 + Math.sin(performance.now() * 0.008) * 1.4 : 0;
    this.nightLightRig.update(
      minute,
      this.snapshot.heldItem,
      this.snapshot.rain,
      this.wildlifeTime,
      this.reducedMotion,
    );
    this.updateWildlife(delta, daylight);
  }

  private updateWildlife(delta: number, daylight: number): void {
    this.wildlifeTime += delta;
    const motionTime = this.reducedMotion ? 0 : this.wildlifeTime;

    if (this.birdFlock && this.birdWingPositions && this.birdMaterial) {
      const clearSky = 1 - THREE.MathUtils.smoothstep(this.snapshot.rain, 0.18, 0.82);
      const birdActivity = THREE.MathUtils.smoothstep(daylight, 0.24, 0.68) * clearSky;
      this.birdFlock.visible = birdActivity > 0.04;
      this.birdMaterial.opacity = birdActivity * 0.78;
      if (this.birdFlock.visible) {
        const wingY = 0.08 + Math.sin(motionTime * 7.4) * 0.13;
        this.birdWingPositions.setY(1, wingY);
        this.birdWingPositions.setY(4, wingY);
        this.birdWingPositions.needsUpdate = true;

        const flockAngle = motionTime * 0.09;
        const centerX = this.player.x + Math.cos(flockAngle) * 14;
        const centerZ = this.player.z + Math.sin(flockAngle) * 14;
        for (let i = 0; i < this.birdFlock.count; i += 1) {
          const column = i - (this.birdFlock.count - 1) * 0.5;
          const x = centerX + column * 1.35 + Math.sin(motionTime * 0.42 + i * 1.7) * 0.7;
          const z = centerZ - Math.abs(column) * 0.62 + Math.cos(motionTime * 0.36 + i) * 0.45;
          const scale = 0.72 + seeded(i * 9.1 + 2) * 0.34;
          this.wildlifeDummy.position.set(x, terrainHeight(x, z) + 9.5 + (i % 3) * 0.38, z);
          this.wildlifeDummy.rotation.set(
            0,
            -flockAngle + Math.PI * 0.5,
            Math.sin(motionTime * 0.5 + i) * 0.08,
          );
          this.wildlifeDummy.scale.setScalar(scale);
          this.wildlifeDummy.updateMatrix();
          this.birdFlock.setMatrixAt(i, this.wildlifeDummy.matrix);
        }
        this.birdFlock.instanceMatrix.needsUpdate = true;
      }
    }

    if (this.fireflies && this.fireflyBasePositions && this.fireflyMaterial) {
      const night = THREE.MathUtils.smoothstep(1 - daylight, 0.3, 0.8);
      const rainShelter = 1 - THREE.MathUtils.smoothstep(this.snapshot.rain, 0.28, 0.94) * 0.88;
      const fireflyActivity = night * rainShelter;
      this.fireflies.visible = fireflyActivity > 0.035;
      this.fireflyMaterial.opacity = fireflyActivity * 0.92;
      if (this.fireflies.visible && !this.reducedMotion) {
        const positions = this.fireflies.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < positions.count; i += 1) {
          const offset = i * 3;
          positions.setXYZ(
            i,
            this.fireflyBasePositions[offset] + Math.sin(motionTime * 0.74 + i * 1.37) * 0.16,
            this.fireflyBasePositions[offset + 1] + Math.sin(motionTime * 1.12 + i * 0.83) * 0.24,
            this.fireflyBasePositions[offset + 2] + Math.cos(motionTime * 0.67 + i * 1.11) * 0.16,
          );
        }
        positions.needsUpdate = true;
      }
    }
    for (const [id, view] of this.wildlifeViews) {
      if (view.projection.speciesId === "coiled-viper") {
        const warningId = `wildlife:${id}`;
        const telegraphStarted = this.hazardTelegraphStarted.get(warningId);
        const telegraphProgress = telegraphStarted === undefined
          ? 0
          : THREE.MathUtils.clamp(
              (performance.now() - telegraphStarted) / 900,
              0,
              1,
            );
        const lungePhase = THREE.MathUtils.clamp(
          (telegraphProgress - 0.58) / 0.42,
          0,
          1,
        );
        const x = view.projection.position.x;
        const z = view.projection.position.z;
        const ground = terrainHeight(x, z);
        const hurtShake =
          view.projection.behavior === "hurt" && !this.reducedMotion
            ? Math.sin(motionTime * 28) * 0.16
            : 0;
        const windupLift = Math.sin(telegraphProgress * Math.PI) * 0.16;
        view.object.position.set(
          x,
          ground +
            (view.projection.behavior === "dead" ? 0.025 : windupLift),
          z,
        );
        view.object.rotation.z =
          view.projection.behavior === "dead" ? Math.PI * 0.5 : hurtShake;
        view.object.rotation.x =
          view.projection.behavior === "recover"
            ? 0.16
            : -Math.sin(lungePhase * Math.PI) * 0.12;
        continue;
      }
      if (view.projection.behavior === "dead") {
        view.object.position.y =
          terrainHeight(view.object.position.x, view.object.position.z) + 0.025;
        view.object.rotation.x = 0;
        view.object.rotation.z = Math.PI * 0.5;
        const body = view.object.getObjectByName("wildlife-body");
        if (body) {
          body.position.set(0, 0, 0);
          body.rotation.set(0, 0, 0);
        }
        continue;
      }
      view.object.rotation.x = 0;
      view.object.rotation.z = 0;
      const fireAvoid = view.projection.behavior === "fire-avoid";
      const fireInfluence = THREE.MathUtils.clamp(
        view.projection.deterrence?.influence ?? 0,
        0,
        1,
      );
      const pace =
        view.projection.behavior === "flee"
          ? 8.5
          : fireAvoid
            ? 6.4
          : view.projection.behavior === "stalk"
            ? 3.2
            : 4.5;
      const phase =
        motionTime * pace + seeded(id.length * 3.7) * Math.PI;
      const bob = this.reducedMotion
        ? 0
        : Math.sin(phase) *
          (view.projection.behavior === "flee"
            ? 0.07
            : fireAvoid
              ? 0.045
              : 0.035);
      view.object.position.y =
        terrainHeight(view.object.position.x, view.object.position.z) + bob;
      // The root remains at the authoritative projected contact position. A
      // small local body recoil makes fire avoidance readable without letting
      // presentation drift manufacture or hide a hit.
      view.object.rotation.y =
        -view.projection.headingRadians +
        (fireAvoid && !this.reducedMotion ? Math.sin(phase * 0.5) * 0.035 : 0);
      const body = view.object.getObjectByName("wildlife-body");
      if (body) {
        body.position.z =
          fireAvoid && !this.reducedMotion
            ? (0.045 + Math.max(0, Math.sin(phase)) * 0.055) * fireInfluence
            : 0;
        body.rotation.x = fireAvoid ? 0.07 * fireInfluence : 0;
        body.rotation.y =
          fireAvoid && !this.reducedMotion
            ? Math.sin(phase * 0.5) * 0.045 * fireInfluence
            : 0;
        body.rotation.z = 0;
      }
    }
  }

  private updateTarget(): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const context: FocusQueryContext = {
      candidates: [],
      diagnostics: {
        candidateCount: 0,
        lineOfSightChecks: 0,
        colliderSnapshotBuilds: 0,
      },
      occluders: null,
    };
    for (const view of this.entityViews.values()) {
      if (!view.definition.interactive || !view.definition.available || !view.object.visible) continue;
      const interactionAnchor = view.definition.interactionAnchor;
      const targetPosition = interactionAnchor
        ? new THREE.Vector3(
            interactionAnchor.x,
            terrainHeight(interactionAnchor.x, interactionAnchor.z) +
              interactionAnchor.height,
            interactionAnchor.z,
          )
        : view.object.position.clone();
      const to = targetPosition.sub(this.camera.position);
      const distance = Math.hypot(to.x, to.z);
      const alignment = forward.dot(to.normalize());
      const target: InteractionTarget = {
          id: view.definition.id,
          kind: view.definition.kind,
          label: view.definition.label,
          distance,
          affordance: view.definition.affordance,
      };
      const exclusion: FocusTargetColliderExclusion =
        view.definition.source === "semantic"
          ? "semantic"
          : view.definition.source === "structure"
            ? "structure"
            : view.definition.kind === "tree"
              ? "legacy-tree"
              : "none";
      this.considerFocusCandidate(
        context,
        { target, alignment, visible: true },
        {
          x: interactionAnchor?.x ?? view.object.position.x,
          z: interactionAnchor?.z ?? view.object.position.z,
        },
        exclusion,
      );
    }
    for (const view of this.wildlifeViews.values()) {
      const projection = view.projection;
      const hasPendingLoot =
        (projection.pendingMeat ?? 0) + (projection.pendingHide ?? 0) > 0;
      if (
        !projection.visible ||
        (projection.health <= 0 && !hasPendingLoot) ||
        !view.object.visible
      ) {
        continue;
      }
      const targetPosition = view.object.position.clone();
      targetPosition.y +=
        projection.speciesId === "coiled-viper"
          ? 0.18
          : projection.role === "large-herbivore"
            ? 0.85
            : 0.55;
      const to = targetPosition.sub(this.camera.position);
      const distance = Math.hypot(to.x, to.z);
      const alignment = forward.dot(to.normalize());
      const targetId = `wildlife:${projection.individualId}`;
      this.considerFocusCandidate(
        context,
        {
          target: {
            id: targetId,
            kind: "animal",
            label: projection.label,
            distance,
            affordance: projection.affordance,
          },
          alignment,
          visible: true,
        },
        { x: view.object.position.x, z: view.object.position.z },
        "none",
      );
    }
    const riverProjection = this.riverFocusCandidate(forward);
    if (riverProjection) {
      this.considerFocusCandidate(
        context,
        riverProjection.candidate,
        riverProjection.anchor,
        "none",
        true,
      );
    }
    const best = selectFocusedTarget(context.candidates);
    this.focusQueryDiagnostics = { ...context.diagnostics };
    const signature = interactionTargetSignature(best);
    if (signature !== this.currentTargetSignature) {
      this.currentTarget = best;
      this.currentTargetSignature = signature;
      this.applyFocusHighlight(best);
      this.callbacks.onTargetChange(best);
    } else if (best) {
      this.currentTarget = best;
    }
  }

  private riverFocusCandidate(forward: THREE.Vector3): RiverFocusProjection | null {
    const affordancePrototype = this.snapshot.riverWaterAffordance;
    if (!affordancePrototype) return null;
    const surfaces = [...this.chunkViews.values()].flatMap(
      (view) => view.interactionSurfaces,
    );
    if (surfaces.length === 0) return null;

    this.chunkGroup.updateMatrixWorld(true);
    this.riverFocusRaycaster.near = 0;
    this.riverFocusRaycaster.far = RIVER_WATER_FOCUS_RAY_FAR;
    this.riverFocusRaycaster.set(this.camera.position, forward);
    const hits: RiverSurfaceRayHit[] = this.riverFocusRaycaster
      .intersectObjects(surfaces, false)
      .map((hit) => ({
        distance: hit.distance,
        kind: hit.object.userData.interactionSurface as RiverSurfaceRayHit["kind"],
        point: { x: hit.point.x, z: hit.point.z },
      }));
    const river = riverTargetFromFirstRayHit(
      hits,
      RIVER_WATER_FOCUS_RAY_FAR,
      this.currentTarget?.id,
    );
    if (!river) return null;

    const targetPosition = new THREE.Vector3(
      river.anchor.x,
      riverSurfaceHeight(river.anchor.x, this.snapshot.riverLevelMeters),
      river.anchor.z,
    );
    const to = targetPosition.sub(this.camera.position);
    const distance = Math.hypot(
      river.anchor.x - this.player.x,
      river.anchor.z - this.player.z,
    );
    const affordance = {
      ...affordancePrototype,
      objectId: river.id,
      preview: {
        ...affordancePrototype.preview,
        label: "流动溪水",
      },
    };
    return {
      candidate: {
        target: {
          id: river.id,
          kind: "water",
          label: "流动溪水",
          distance,
          affordance,
        },
        alignment: forward.dot(to.normalize()),
        visible: true,
      },
      anchor: river.anchor,
    };
  }

  private considerFocusCandidate(
    context: FocusQueryContext,
    candidate: PendingFocusCandidate,
    endpoint: Readonly<{ x: number; z: number }>,
    exclusion: FocusTargetColliderExclusion,
    strictEndpointOcclusion = false,
  ): void {
    context.diagnostics.candidateCount += 1;
    if (!focusCandidatePassesCheapGate(candidate)) return;
    if (!context.occluders) {
      context.occluders = this.buildFocusOccluderSnapshot();
      context.diagnostics.colliderSnapshotBuilds += 1;
    }
    context.diagnostics.lineOfSightChecks += 1;
    context.candidates.push({
      ...candidate,
      occluded: this.isFocusLineOfSightBlocked(
        endpoint,
        candidate.target.id,
        exclusion,
        context.occluders,
        strictEndpointOcclusion,
      ),
    });
  }

  private buildFocusOccluderSnapshot(): FocusOccluderSnapshot {
    const fixed: WorldCollider[] = [...this.colliders];
    for (const view of this.chunkViews.values()) fixed.push(...view.colliders);

    const legacyTrees: FocusColliderEntry[] = [];
    const allLegacyTrees: WorldCollider[] = [];
    for (const [id, view] of this.entityViews) {
      if (
        view.definition.source === "semantic" ||
        view.definition.kind !== "tree"
      ) continue;
      const collider = renderTreeCollider(view.definition);
      legacyTrees.push({ id, colliders: [collider] });
      allLegacyTrees.push(collider);
    }

    const structures: FocusColliderEntry[] = [];
    const allStructures: WorldCollider[] = [];
    for (const structure of this.resolvedStructures()) {
      const colliders = structureWorldColliders(structure);
      structures.push({ id: structure.id, colliders });
      allStructures.push(...colliders);
    }

    return {
      fixed,
      semantic: null,
      semanticExcludingTarget: new Map(),
      legacyTrees,
      allLegacyTrees,
      structures,
      allStructures,
    };
  }

  private isFocusLineOfSightBlocked(
    endpoint: Readonly<{ x: number; z: number }>,
    targetId: string,
    exclusion: FocusTargetColliderExclusion,
    snapshot: FocusOccluderSnapshot,
    strictEndpointOcclusion: boolean,
  ): boolean {
    const origin = { x: this.camera.position.x, z: this.camera.position.z };
    if (
      focusColliderGroupBlocks(
        origin,
        endpoint,
        snapshot.fixed,
        strictEndpointOcclusion,
      )
    ) {
      return true;
    }

    let semanticColliders: readonly WorldCollider[];
    if (exclusion === "semantic") {
      const cached = snapshot.semanticExcludingTarget.get(targetId);
      if (cached) {
        semanticColliders = cached;
      } else {
        semanticColliders = this.semanticInstances.getColliders(targetId);
        snapshot.semanticExcludingTarget.set(targetId, semanticColliders);
      }
    } else {
      snapshot.semantic ??= this.semanticInstances.getColliders();
      semanticColliders = snapshot.semantic;
    }
    if (
      focusColliderGroupBlocks(
        origin,
        endpoint,
        semanticColliders,
        strictEndpointOcclusion,
      )
    ) {
      return true;
    }

    if (exclusion === "legacy-tree") {
      for (const entry of snapshot.legacyTrees) {
        if (entry.id === targetId) continue;
        if (
          focusColliderGroupBlocks(
            origin,
            endpoint,
            entry.colliders,
            strictEndpointOcclusion,
          )
        ) {
          return true;
        }
      }
    } else if (
      focusColliderGroupBlocks(
        origin,
        endpoint,
        snapshot.allLegacyTrees,
        strictEndpointOcclusion,
      )
    ) {
      return true;
    }

    if (exclusion === "structure") {
      for (const entry of snapshot.structures) {
        if (entry.id === targetId) continue;
        if (
          focusColliderGroupBlocks(
            origin,
            endpoint,
            entry.colliders,
            strictEndpointOcclusion,
          )
        ) {
          return true;
        }
      }
      return false;
    }
    return focusColliderGroupBlocks(
      origin,
      endpoint,
      snapshot.allStructures,
      strictEndpointOcclusion,
    );
  }

  private applyFocusHighlight(target: InteractionTarget | null): void {
    this.clearFocusHighlight();
    if (!target) return;
    const view = this.entityViews.get(target.id);
    const wildlifeId = target.id.startsWith("wildlife:")
      ? target.id.slice("wildlife:".length)
      : null;
    const wildlifeView = wildlifeId ? this.wildlifeViews.get(wildlifeId) : null;
    const riverTarget = parseRiverWaterTargetId(target.id);
    if (!view && !wildlifeView && !riverTarget) return;

    const color = focusColor(target.affordance.highlightTone);
    const visual = view
      ? this.focusVisualFor(target, view.object)
      : wildlifeView?.object;
    if (view?.definition.source === "semantic") {
      this.semanticInstances.setFocus(target.id, color);
    } else if (visual) {
      visual.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          if (!isEmissiveMaterial(material)) continue;
          this.highlightedMaterials.push({
            material,
            emissive: material.emissive.clone(),
            emissiveIntensity: material.emissiveIntensity,
          });
          material.emissive.copy(color);
          material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.22);
        }
      });
    }

    const anchor = view
      ? view.definition.interactionAnchor ?? {
          x: view.definition.x,
          z: view.definition.z,
          height: 0,
        }
      : wildlifeView
        ? {
          x: wildlifeView!.projection.position.x,
          z: wildlifeView!.projection.position.z,
          height: 0,
          }
        : {
            x: riverTarget!.anchor.x,
            z: riverTarget!.anchor.z,
            height: 0,
          };
    const markerMaterial = this.focusMarker.material;
    if (markerMaterial instanceof THREE.MeshBasicMaterial) markerMaterial.color.copy(color);
    const baseScale = focusMarkerScale(target.kind);
    this.focusMarker.userData.baseScale = baseScale;
    this.focusMarker.position.set(
      anchor.x,
      riverTarget
        ? riverSurfaceHeight(anchor.x, this.snapshot.riverLevelMeters) + 0.025
        : terrainHeight(anchor.x, anchor.z) + 0.075,
      anchor.z,
    );
    this.focusMarker.scale.setScalar(baseScale);
    this.focusMarker.visible = true;
  }

  private focusVisualFor(
    target: InteractionTarget,
    fallback: THREE.Object3D,
  ): THREE.Object3D {
    if (target.kind === "campfire") {
      return this.campfireViews.get(target.id)?.object ?? fallback;
    }
    if (target.kind === "shelter") {
      return this.shelterViews.get(target.id)?.object ?? fallback;
    }
    if (target.kind === "bed") {
      return this.bedViews.get(target.id)?.object ?? fallback;
    }
    if (target.kind === "radio-beacon") {
      return this.worldGroup.getObjectByName("beacon-antenna") ?? fallback;
    }
    if (target.kind === "smoking-rack") {
      return this.smokingRackViews.get(target.id)?.object ?? fallback;
    }
    if (target.kind === "rain-collector") {
      return this.rainCollectorViews.get(target.id)?.object ?? fallback;
    }
    return fallback;
  }

  private clearFocusHighlight(): void {
    this.semanticInstances.setFocus(null);
    for (const highlighted of this.highlightedMaterials) {
      highlighted.material.emissive.copy(highlighted.emissive);
      highlighted.material.emissiveIntensity = highlighted.emissiveIntensity;
    }
    this.highlightedMaterials = [];
    this.focusMarker.visible = false;
  }

  private updateFocusPulse(now: number): void {
    if (!this.focusMarker.visible) return;
    const baseScale = Number(this.focusMarker.userData.baseScale ?? 1);
    const pulse = this.reducedMotion ? 1 : 1 + Math.sin(now * 0.0045) * 0.035;
    this.focusMarker.scale.setScalar(baseScale * pulse);
  }

  private updatePlacementPreview(): void {
    const kind = this.placementPreview.getKind();
    if (!kind) return;
    const radius = structurePlacementRadius(kind);
    const distance = 2.9 + radius * 0.65;
    const x = this.player.x - Math.sin(this.yaw) * distance;
    const z = this.player.z - Math.cos(this.yaw) * distance;
    const y = terrainHeight(x, z);
    this.placementPreview.setTransform(x, y + 0.03, z);

    const slope = terrainSlopeAcross(x, z, radius);
    const overheadCover =
      kind === "rain-collector" &&
      this.resolvedStructures().some(
        (structure) =>
          structure.kind === "shelter" &&
          isWithinStructureRadius(
            { x, z },
            structure,
            SHELTER_COVERAGE_RADIUS,
          ),
      );
    const valid =
      riverDistance(x, z) > radius + RIVER_SURFACE_HALF_WIDTH &&
      slope <= (kind === "shelter" ? 0.92 : 0.68) &&
      !this.isPlacementBlocked(x, z, radius) &&
      !overheadCover;
    const site =
      kind === "rain-collector"
        ? rainCollectorSiteEnvironment(
            this.snapshot.worldSeed,
            { x, z },
            overheadCover,
          )
        : null;
    const status: PlacementPreviewStatus = !valid
      ? "invalid"
      : site?.siteBand === "low"
        ? "valid-low"
        : "valid-high";
    this.placementPreview.setStatus(status);
    if (site) {
      const signature = `${status}:${site.biome}:${site.siteMultiplier.toFixed(2)}`;
      if (signature !== this.placementFeedbackSignature) {
        this.placementFeedbackSignature = signature;
        this.callbacks.onPlacementFeedback(
          overheadCover
            ? "红色：叶棚会完全挡住集水口；把雨水架移到棚外的开阔处。"
            : status === "invalid"
            ? "红色：地面浸水、过陡或与世界对象重叠，无法稳固放置。"
            : status === "valid-low"
              ? `橙色：可以建造，但冠层遮挡明显，预计集水效率 ×${site.siteMultiplier.toFixed(2)}。`
              : `绿色：上方较开阔，预计集水效率 ×${site.siteMultiplier.toFixed(2)}。`,
        );
      }
    }
  }

  private confirmPlacement(): void {
    const kind = this.placementPreview.getKind();
    if (!kind) return;
    if (!this.placementPreview.isValid()) {
      this.callbacks.onPlacementFeedback("红色预览表示地面过陡、浸水或被树木与建筑占用。转身寻找平地。 ");
      return;
    }
    const position = this.placementPreview.root.position;
    const accepted = this.callbacks.onPlaceStructure({
      kind,
      x: position.x,
      y: position.y,
      z: position.z,
      yaw: this.placementPreview.getYaw(),
    });
    if (accepted) {
      this.placementPreview.setKind(null);
      this.placementFeedbackSignature = "";
    }
    else this.callbacks.onPlacementFeedback("放置条件刚刚发生变化；材料未消耗，请调整绿色预览后重试。");
  }

  private isPlacementBlocked(x: number, z: number, radius: number): boolean {
    for (const collider of this.colliders) {
      if (isPointBlocked(collider, x, z, radius)) return true;
    }
    for (const view of this.chunkViews.values()) {
      for (const collider of view.colliders) {
        if (isPointBlocked(collider, x, z, radius)) return true;
      }
    }
    for (const collider of this.semanticInstances.getColliders()) {
      if (isPointBlocked(collider, x, z, radius)) return true;
    }
    for (const view of this.entityViews.values()) {
      if (
        view.definition.source === "semantic" ||
        view.definition.kind !== "tree"
      ) continue;
      if (isPointBlocked(renderTreeCollider(view.definition), x, z, radius)) {
        return true;
      }
    }
    const nextKind = this.placementPreview.getKind();
    if (!nextKind) return false;
    const candidate: StructureTransform2D = {
      id: `structure.${nextKind}.preview`,
      kind: nextKind,
      x,
      z,
      yaw: this.placementPreview.getYaw(),
    };
    for (const structure of this.resolvedStructures()) {
      if (structurePlacementsOverlap(candidate, structure)) return true;
    }
    return false;
  }

  private updateEntityFeedback(): void {
    const now = performance.now();
    for (const view of this.entityViews.values()) {
      const startedAt = Number(view.object.userData.hitStartedAt ?? 0);
      if (startedAt <= 0) continue;
      const hideAfterHit = view.object.userData.hideAfterHit === true;
      const duration = hideAfterHit ? 520 : 320;
      const progress = (now - startedAt) / duration;
      if (progress >= 1) {
        view.object.rotation.z = 0;
        view.object.visible =
          view.definition.available || view.definition.kind === "tree";
        delete view.object.userData.hitStartedAt;
        delete view.object.userData.hideAfterHit;
        continue;
      }
      view.object.rotation.z = hideAfterHit
        ? THREE.MathUtils.smoothstep(progress, 0.12, 1) * 1.18
        : Math.sin(progress * Math.PI * 4) * (1 - progress) * 0.055;
    }
  }

  private checkHazards(): void {
    const now = performance.now();
    for (const view of this.wildlifeViews.values()) {
      if (
        view.projection.role !== "predator" ||
        !view.projection.visible ||
        view.projection.health <= 0
      ) continue;
      const warningId = `wildlife:${view.projection.individualId}`;
      const distance = Math.hypot(
        this.player.x - view.projection.position.x,
        this.player.z - view.projection.position.z,
      );
      if (distance > view.projection.encounter.awarenessRadius * 1.2) {
        this.hazardWarned.delete(warningId);
      }
      if (
        distance < view.projection.encounter.awarenessRadius &&
        !this.hazardWarned.has(warningId)
      ) {
        this.hazardWarned.add(warningId);
        this.callbacks.onHazardWarning(warningId);
      }
      const windupMilliseconds =
        view.projection.speciesId === "coiled-viper" ? 900 : 1050;
      const withinContactRange = distance < PREDATOR_CONTACT_RANGE;
      const step = advancePredatorContactTransaction(
        this.predatorContactTransaction(warningId),
        {
          now,
          withinContactRange,
          fullyRetreated: distance > PREDATOR_CONTACT_RESET_RANGE,
          contactClear:
            withinContactRange &&
            this.isPredatorContactClear(view.projection),
          windupMilliseconds,
        },
      );
      const transaction = step.shouldCommit
        ? settlePredatorContactCommit(
            this.callbacks.onHazard(warningId),
            now,
          )
        : step.transaction;
      this.applyPredatorContactTransaction(warningId, transaction);
    }
  }

  private predatorContactTransaction(
    warningId: string,
  ): PredatorContactTransaction {
    if (this.hazardTriggered.has(warningId)) return { phase: "triggered" };
    const retryAt = this.hazardBlockedUntil.get(warningId);
    if (retryAt !== undefined) return { phase: "blocked-recovery", retryAt };
    const startedAt = this.hazardTelegraphStarted.get(warningId);
    return startedAt === undefined
      ? IDLE_PREDATOR_CONTACT
      : { phase: "windup", startedAt };
  }

  private applyPredatorContactTransaction(
    warningId: string,
    transaction: PredatorContactTransaction,
  ): void {
    if (transaction.phase === "triggered") {
      this.hazardTriggered.add(warningId);
    } else {
      this.hazardTriggered.delete(warningId);
    }
    if (transaction.phase === "windup") {
      this.hazardTelegraphStarted.set(warningId, transaction.startedAt);
    } else {
      this.hazardTelegraphStarted.delete(warningId);
    }
    if (transaction.phase === "blocked-recovery") {
      this.hazardBlockedUntil.set(warningId, transaction.retryAt);
    } else {
      this.hazardBlockedUntil.delete(warningId);
    }
  }

  private isPredatorContactClear(
    wildlife: RenderSnapshot["wildlife"][number],
  ): boolean {
    const pose: PredatorContactPose = {
      predatorX: wildlife.position.x,
      predatorZ: wildlife.position.z,
      predatorGroundY: terrainHeight(
        wildlife.position.x,
        wildlife.position.z,
      ),
      playerX: this.player.x,
      playerZ: this.player.z,
      playerGroundY: terrainHeight(this.player.x, this.player.z),
      speciesId: wildlife.speciesId,
      scale: wildlife.scale,
    };
    const sweep = buildPredatorContactSweep(pose);
    return resolvePredatorContact(
      pose,
      this.predatorContactBlockers(sweep),
    ).ok;
  }

  private *predatorContactBlockers(sweep: HitSweep): Iterable<HitShape> {
    let index = 0;
    for (const collider of this.colliders) {
      if (!colliderNearContactSweep(collider, sweep)) continue;
      yield predatorContactBlockerShape(`render:authored:${index}`, collider);
      index += 1;
    }
    for (const view of this.chunkViews.values()) {
      for (const collider of view.colliders) {
        if (!colliderNearContactSweep(collider, sweep)) continue;
        yield predatorContactBlockerShape(`render:chunk:${index}`, collider);
        index += 1;
      }
    }
    for (const collider of this.semanticInstances.getColliders()) {
      if (!colliderNearContactSweep(collider, sweep)) continue;
      yield predatorContactBlockerShape(`render:semantic:${index}`, collider);
      index += 1;
    }
    for (const [id, view] of this.entityViews) {
      if (view.definition.source === "semantic" || view.definition.kind !== "tree") {
        continue;
      }
      const collider = renderTreeCollider(view.definition);
      if (!colliderNearContactSweep(collider, sweep)) continue;
      yield predatorContactBlockerShape(`render:tree:${id}`, collider);
    }
    for (const structure of this.resolvedStructures()) {
      for (const [part, collider] of structureWorldColliders(structure).entries()) {
        if (!colliderNearContactSweep(collider, sweep)) continue;
        yield predatorContactBlockerShape(
          `render:${structure.id}:part:${part}`,
          collider,
        );
      }
    }
  }

  private updateDiagnostics(delta: number): void {
    this.frameSamples.push(delta * 1000);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    const now = performance.now();
    if (now - this.lastFrameReport < 500) return;
    const average = this.frameSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.frameSamples.length);
    const sorted = [...this.frameSamples].sort((left, right) => left - right);
    const percentile = (value: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
    const semantic = this.semanticInstances.getDiagnostics();
    this.diagnostics = {
      fps: average ? Math.round(1000 / average) : 0,
      frameMs: Number(average.toFixed(1)),
      frameP95Ms: Number(percentile(0.95).toFixed(1)),
      frameP99Ms: Number(percentile(0.99).toFixed(1)),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      activeChunks: semantic.chunks,
      semanticInstances: semantic.instances,
      semanticColliders: semantic.colliders,
      semanticStaticChunkRebuilds: semantic.staticChunkRebuilds,
      semanticLastSyncMs: Number(semantic.lastSyncMs.toFixed(2)),
      semanticMaxSyncMs: Number(semantic.maxSyncMs.toFixed(2)),
      semanticTreePoolMeshes: semantic.treePool.meshes,
      semanticTreePoolCapacity: semantic.treePool.capacity,
      semanticTreePoolOccupied: semantic.treePool.occupied,
      semanticTreePoolHighWater: semantic.treePool.highWater,
      semanticTreePoolHoles: semantic.treePool.holes,
      semanticTreePoolSubmittedInstances:
        semantic.treePool.submittedInstances,
      semanticTreePoolSlotWrites: semantic.treePool.slotWrites,
      semanticTreePoolReleases: semantic.treePool.releases,
      semanticTreePoolOverflows: semantic.treePool.overflows,
      semanticRockPoolMeshes: semantic.rockPool.meshes,
      semanticRockPoolCapacity: semantic.rockPool.capacity,
      semanticRockPoolOccupied: semantic.rockPool.occupied,
      semanticRockPoolHighWater: semantic.rockPool.highWater,
      semanticRockPoolHoles: semantic.rockPool.holes,
      semanticRockPoolSubmittedInstances:
        semantic.rockPool.submittedInstances,
      semanticRockPoolSlotWrites: semantic.rockPool.slotWrites,
      semanticRockPoolReleases: semantic.rockPool.releases,
      semanticRockPoolOverflows: semantic.rockPool.overflows,
      wildlifeViews: this.wildlifeViews.size,
      wildlifeProtectedViews: this.wildlifeProtectedViews,
      wildlifeProtectedCandidates: this.wildlifeProtectedCandidates,
      wildlifeProtectedDropped: this.wildlifeProtectedDropped,
      wildlifeOverflowViews: this.wildlifeOverflowViews,
      x: Number(this.player.x.toFixed(1)),
      z: Number(this.player.z.toFixed(1)),
    };
    this.lastFrameReport = now;
  }

  private syncEntities(entities: RenderEntity[]): void {
    const incoming = new Set(entities.map((entity) => entity.id));
    for (const [id, view] of this.entityViews) {
      if (!incoming.has(id)) {
        this.dynamicGroup.remove(view.object);
        disposeObject(view.object);
        this.entityViews.delete(id);
      }
    }
    for (const definition of entities) {
      const existing = this.entityViews.get(definition.id);
      if (existing) {
        existing.definition = definition;
        positionEntityObject(existing.object, definition);
        if (definition.kind === "canopy-junction") {
          syncCanopyJunctionModel(
            existing.object,
            this.snapshot.canopyJunctionPhase,
          );
        }
        syncLooseStoneObject(existing.object, definition);
        const finalHitPlaying =
          existing.object.userData.hideAfterHit === true &&
          Number(existing.object.userData.hitStartedAt ?? 0) > 0;
        existing.object.visible =
          definition.available || definition.kind === "tree" || finalHitPlaying;
        continue;
      }
      const object = definition.source === "semantic" || definition.source === "structure"
        ? new THREE.Group()
        : createEntityObject(definition.kind);
      positionEntityObject(object, definition);
      if (definition.kind === "canopy-junction") {
        syncCanopyJunctionModel(object, this.snapshot.canopyJunctionPhase);
      }
      syncLooseStoneObject(object, definition);
      if (definition.kind === "cache") {
        object.rotation.y = SURVEY_ROCK_SHELTER_LAYOUT.yaw;
      }
      object.visible = definition.available || definition.kind === "tree";
      object.userData.entityId = definition.id;
      this.dynamicGroup.add(object);
      this.entityViews.set(definition.id, { definition, object });
    }
  }

  private syncWildlife(wildlife: RenderSnapshot["wildlife"]): void {
    const focusedIndividualId = wildlifeIndividualIdFromTarget(
      this.currentTarget?.id,
    );
    const actionBoundIndividualId = wildlifeIndividualIdFromTarget(
      this.actionTransaction?.targetId,
    );
    const telegraphIndividualIds = wildlifeIndividualIdsFromHazards(
      this.hazardTelegraphStarted.keys(),
    );
    const alertIndividualIds = wildlifeIndividualIdsFromHazards([
      ...this.hazardWarned,
      ...this.hazardTriggered,
      ...this.hazardBlockedUntil.keys(),
    ]);
    const selection = selectWildlifeViews(wildlife, {
      maxViews: this.maxWildlifeViews,
      observerPosition: this.player,
      focusedIndividualId,
      actionBoundIndividualIds: actionBoundIndividualId
        ? [actionBoundIndividualId]
        : [],
      telegraphIndividualIds,
      alertIndividualIds,
    });
    const visible = selection.selected;
    const protectedIds = new Set(
      visible
        .slice(0, selection.protectedCount)
        .map((projection) => projection.individualId),
    );
    this.wildlifeProtectedViews = selection.protectedCount;
    this.wildlifeProtectedCandidates = selection.protectedCandidateCount;
    this.wildlifeProtectedDropped = selection.protectedDroppedCount;
    this.wildlifeOverflowViews = selection.overflowCount;
    const incoming = new Set(visible.map((projection) => projection.individualId));
    for (const [id, view] of this.wildlifeViews) {
      if (incoming.has(id)) continue;
      this.dynamicGroup.remove(view.object);
      disposeObject(view.object);
      this.wildlifeViews.delete(id);
      const warningId = `wildlife:${id}`;
      this.hazardWarned.delete(warningId);
      this.hazardTriggered.delete(warningId);
      this.hazardTelegraphStarted.delete(warningId);
      this.hazardBlockedUntil.delete(warningId);
    }
    for (const projection of visible) {
      let view = this.wildlifeViews.get(projection.individualId);
      if (!view) {
        const object = createWildlifeObject(projection.speciesId);
        object.userData.wildlifeId = projection.individualId;
        this.dynamicGroup.add(object);
        view = { projection, object };
        this.wildlifeViews.set(projection.individualId, view);
      }
      view.projection = projection;
      view.object.position.set(
        projection.position.x,
        terrainHeight(projection.position.x, projection.position.z),
        projection.position.z,
      );
      view.object.rotation.y = -projection.headingRadians;
      view.object.scale.setScalar(projection.scale);
      setWildlifeReadability(
        view.object,
        projection.visibility,
        protectedIds.has(projection.individualId),
      );
      // Selection owns renderer presence. Weather/activity readability must
      // never make an authoritative active-bubble individual disappear.
      view.object.visible = true;
    }
  }

  private isStructureBuilt(kind: PlaceableStructureKind): boolean {
    if (kind === "campfire") return this.snapshot.fireBuilt;
    if (kind === "shelter") return this.snapshot.shelterBuilt;
    if (kind === "bed") return this.snapshot.bedBuilt;
    if (kind === "radio-beacon") return this.snapshot.beaconBuilt;
    return this.snapshot.structures.some((structure) => structure.kind === kind);
  }

  private resolvedStructure(
    kind: PlaceableStructureKind,
  ): StructureTransform2D | null {
    return resolveStructureTransform(
      kind,
      this.snapshot.structures,
      this.isStructureBuilt(kind),
    );
  }

  private resolvedStructures(): StructureTransform2D[] {
    const explicit = this.snapshot.structures
      .map(structureTransformFromSource)
      .filter(
        (structure): structure is StructureTransform2D => structure !== null,
      );
    for (const kind of STRUCTURE_KINDS) {
      if (explicit.some((structure) => structure.kind === kind)) continue;
      const fallback = this.resolvedStructure(kind);
      if (fallback) explicit.push(fallback);
    }
    return explicit;
  }

  private syncStructures(): void {
    this.syncCampfireViews();
    this.syncRepeatedStructureViews(
      "shelter",
      this.shelterViews,
      createShelter,
      0,
    );
    this.syncRepeatedStructureViews(
      "bed",
      this.bedViews,
      createLeafBed,
      0.08,
    );
    const legacyShelter = this.worldGroup.getObjectByName("player-shelter");
    if (legacyShelter) legacyShelter.visible = false;
    const legacyBed = this.worldGroup.getObjectByName("leaf-bed");
    if (legacyBed) legacyBed.visible = false;
    const antenna = this.worldGroup.getObjectByName("beacon-antenna");
    if (antenna) {
      const placed = this.resolvedStructure("radio-beacon");
      if (placed) {
        antenna.position.set(placed.x, terrainHeight(placed.x, placed.z), placed.z);
        antenna.rotation.y = placed.yaw;
      }
      antenna.visible = this.snapshot.beaconBuilt;
    }

    const racks = this.snapshot.structures.filter(
      (structure) => structure.kind === "smoking-rack",
    );
    const incomingRackIds = new Set(racks.map((structure) => structure.id));
    for (const [id, view] of this.smokingRackViews) {
      if (incomingRackIds.has(id)) continue;
      this.worldGroup.remove(view.object);
      disposeObject(view.object);
      this.smokingRackViews.delete(id);
    }
    for (const structure of racks) {
      let view = this.smokingRackViews.get(structure.id);
      if (!view) {
        const object = createSmokingRackObject();
        object.name = `smoking-rack-${structure.id}`;
        object.userData.structureId = structure.id;
        this.worldGroup.add(object);
        view = { definition: structure, object };
        this.smokingRackViews.set(structure.id, view);
      }
      view.definition = structure;
      view.object.position.set(
        structure.x,
        terrainHeight(structure.x, structure.z),
        structure.z,
      );
      view.object.rotation.y = structure.yaw;
      updateSmokingRackObject(view.object, structure);
    }

    const collectors = this.snapshot.structures.filter(
      (structure) => structure.kind === "rain-collector",
    );
    const incomingCollectorIds = new Set(
      collectors.map((structure) => structure.id),
    );
    for (const [id, view] of this.rainCollectorViews) {
      if (incomingCollectorIds.has(id)) continue;
      this.worldGroup.remove(view.object);
      disposeObject(view.object);
      this.rainCollectorViews.delete(id);
    }
    for (const structure of collectors) {
      let view = this.rainCollectorViews.get(structure.id);
      if (!view) {
        const object = createRainCollectorObject();
        object.name = `rain-collector-${structure.id}`;
        object.userData.structureId = structure.id;
        this.worldGroup.add(object);
        view = { definition: structure, object };
        this.rainCollectorViews.set(structure.id, view);
      }
      view.definition = structure;
      view.object.position.set(
        structure.x,
        terrainHeight(structure.x, structure.z),
        structure.z,
      );
      view.object.rotation.y = structure.yaw;
      updateRainCollectorObject(view.object, structure);
    }
  }

  private syncCampfireViews(): void {
    const campfires = this.snapshot.structures.filter(
      (structure) => structure.kind === "campfire",
    );
    const primary = campfires[0] ?? null;
    if (this.primaryCampfireId !== primary?.id) {
      this.campfireFeedbackRig.reset();
      for (const view of this.campfireViews.values()) {
        if (view.primary) continue;
        this.worldGroup.remove(view.object);
        disposeObject(view.object);
      }
      this.campfireViews.clear();
      this.primaryCampfireId = primary?.id ?? null;
    }

    if (!primary) {
      this.fireGroup.visible = false;
      return;
    }
    this.campfireViews.set(primary.id, {
      definition: primary,
      object: this.fireGroup,
      light: this.fireLight,
      primary: true,
      rig: this.campfireFeedbackRig,
    });
    this.fireGroup.position.set(
      primary.x,
      terrainHeight(primary.x, primary.z),
      primary.z,
    );
    this.fireGroup.rotation.y = primary.yaw;

    const incomingIds = new Set(campfires.map((structure) => structure.id));
    for (const [id, view] of this.campfireViews) {
      if (incomingIds.has(id) || view.primary) continue;
      this.worldGroup.remove(view.object);
      disposeObject(view.object);
      this.campfireViews.delete(id);
    }
    for (const structure of campfires.slice(1)) {
      let view = this.campfireViews.get(structure.id);
      if (!view) {
        const created = createSecondaryCampfireObject();
        created.object.name = `campfire-${structure.id}`;
        created.object.userData.structureId = structure.id;
        this.worldGroup.add(created.object);
        view = {
          definition: structure,
          object: created.object,
          light: created.light,
          primary: false,
          rig: new CampfireFeedbackRig(created.object, created.light),
        };
        view.rig.setTransientStartListener(this.campfireTransientListener);
        this.campfireViews.set(structure.id, view);
      }
      view.definition = structure;
      view.object.position.set(
        structure.x,
        terrainHeight(structure.x, structure.z),
        structure.z,
      );
      view.object.rotation.y = structure.yaw;
    }
  }

  private syncRepeatedStructureViews(
    kind: "shelter" | "bed",
    views: Map<string, DynamicStructureView>,
    createObject: () => THREE.Group,
    yOffset: number,
  ): void {
    const structures = this.snapshot.structures.filter(
      (structure) => structure.kind === kind,
    );
    const incomingIds = new Set(structures.map((structure) => structure.id));
    for (const [id, view] of views) {
      if (incomingIds.has(id)) continue;
      this.worldGroup.remove(view.object);
      disposeObject(view.object);
      views.delete(id);
    }
    for (const structure of structures) {
      let view = views.get(structure.id);
      if (!view) {
        const object = createObject();
        object.name = `${kind}-${structure.id}`;
        object.userData.structureId = structure.id;
        this.worldGroup.add(object);
        view = { definition: structure, object };
        views.set(structure.id, view);
      }
      view.definition = structure;
      view.object.position.set(
        structure.x,
        terrainHeight(structure.x, structure.z) + yOffset,
        structure.z,
      );
      view.object.rotation.y = structure.yaw;
      view.object.visible = true;
    }
  }

  private syncTorchWaymarks(): void {
    // Snapshot/teleport cadence is deliberate: matrix batches are rebuilt at
    // simulation cadence, never once per RAF. A sub-100ms light-selection lag
    // is preferable to sorting and uploading seven instance buffers at 60Hz.
    this.camera.updateMatrixWorld(true);
    this.torchWaymarkFrustumMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse,
    );
    this.torchWaymarkFrustum.setFromProjectionMatrix(
      this.torchWaymarkFrustumMatrix,
    );
    const inputs = torchWaymarkVisualInputsFromStructures(
      this.snapshot.structures,
    );
    this.torchWaymarkLayer.sync(
      inputs,
      { x: this.player.x, z: this.player.z },
      (waymark) => {
        this.torchWaymarkFrustumSphere.center.set(
          waymark.x,
          waymark.y + TORCH_WAYMARK_LAYOUT.poleHeight / 2,
          waymark.z,
        );
        this.torchWaymarkFrustumSphere.radius =
          TORCH_WAYMARK_LAYOUT.poleHeight / 2 +
          TORCH_WAYMARK_LAYOUT.stoneBaseRadius;
        return this.torchWaymarkFrustum.intersectsSphere(
          this.torchWaymarkFrustumSphere,
        );
      },
    );
  }

  private updateSmokingRackEffects(now: number): void {
    for (const view of this.smokingRackViews.values()) {
      let index = 0;
      view.object.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || object.name !== "rack-smoke") {
          return;
        }
        const baseY = Number(object.userData.baseY ?? object.position.y);
        object.position.y = this.reducedMotion
          ? baseY
          : baseY + Math.sin(now * 0.0014 + index * 1.7) * 0.08;
        const material = object.material;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = view.definition.processActive
            ? this.reducedMotion
              ? 0.13
              : 0.16 * (0.78 + Math.sin(now * 0.0018 + index) * 0.22)
            : 0;
        }
        index += 1;
      });
    }
  }

  private createWorld(): void {
    this.worldGroup.add(this.chunkGroup, this.semanticInstances.root);
    this.syncWorldChunks();
    this.createLandmarks();
  }

  private syncWorldChunks(force = false): void {
    const center = worldToChunkCoordinate(this.player.x, this.player.z);
    const centerKey = chunkKey(center);
    if (centerKey === this.activeChunkCenter && !force) return;

    const requiredCoordinates = activeChunkCoordinates(
      this.player.x,
      this.player.z,
      this.activeChunkRadius,
    );
    const requiredKeys = new Set(requiredCoordinates.map((coordinate) => chunkKey(coordinate)));
    for (const [key, view] of this.chunkViews) {
      if (requiredKeys.has(key)) continue;
      this.chunkGroup.remove(view.group);
      disposeObject(view.group);
      this.chunkViews.delete(key);
    }

    for (const coordinate of requiredCoordinates) {
      const key = chunkKey(coordinate);
      if (this.chunkViews.has(key)) continue;
      const plan = generateChunkVisualPlan(this.snapshot.worldSeed, coordinate, this.worldVisualDetail);
      const view = this.createChunkView(plan);
      this.chunkViews.set(key, view);
      this.chunkGroup.add(view.group);
    }
    this.semanticInstances.sync(
      this.snapshot.worldSeed,
      requiredCoordinates,
      this.snapshot.semanticStates,
    );
    this.activeChunkCenter = centerKey;
  }

  private clearWorldChunks(): void {
    for (const view of this.chunkViews.values()) {
      this.chunkGroup.remove(view.group);
      disposeObject(view.group);
    }
    this.chunkViews.clear();
    this.semanticInstances.clear();
    this.activeChunkCenter = "";
  }

  private syncRiverLevelGroups(): void {
    for (const view of this.chunkViews.values()) {
      if (!view.riverLevelGroup) continue;
      applyRiverLevelToGroup(
        view.riverLevelGroup,
        this.snapshot.riverLevelMeters,
      );
    }
  }

  private createChunkView(plan: ChunkVisualPlan): ChunkView {
    const group = new THREE.Group();
    const colliders: CircleCollider[] = [];
    group.name = `world-chunk-${plan.descriptor.key}`;
    group.userData.biome = plan.descriptor.biome;
    this.createChunkGround(plan, group);
    const riverLevelGroup = this.createChunkWater(plan, group);
    const interactionSurfaces: THREE.Object3D[] = [];
    group.traverse((object) => {
      if (typeof object.userData.interactionSurface === "string") {
        interactionSurfaces.push(object);
      }
    });
    return { group, colliders, interactionSurfaces, riverLevelGroup };
  }

  private createChunkGround(plan: ChunkVisualPlan, group: THREE.Group): void {
    const coordinate = plan.descriptor.coordinate;
    const centerX = (coordinate.x + 0.5) * WORLD_CHUNK_SIZE;
    const centerZ = (coordinate.z + 0.5) * WORLD_CHUNK_SIZE;
    const segments = this.worldVisualDetail === "low" ? 8 : 12;
    const geometry = new THREE.PlaneGeometry(
      WORLD_CHUNK_SIZE,
      WORLD_CHUNK_SIZE,
      segments,
      segments,
    );
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    const low = new THREE.Color(plan.profile.groundLow);
    const high = new THREE.Color(plan.profile.groundHigh);
    const mud = new THREE.Color(0x4e4933);
    for (let index = 0; index < positions.count; index += 1) {
      const worldX = centerX + positions.getX(index);
      const worldZ = centerZ + positions.getZ(index);
      const height = terrainHeight(worldX, worldZ);
      positions.setY(index, height);
      const color = low.clone().lerp(
        high,
        THREE.MathUtils.clamp((height + 1.8) / 5.6, 0, 1),
      );
      if (riverDistance(worldX, worldZ) < RIVER_MUD_HALF_WIDTH) {
        color.lerp(mud, 0.72);
      }
      color.offsetHSL(0, 0, (hash2(worldX * 3, worldZ * 3) - 0.5) * 0.08);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    );
    ground.position.set(centerX, 0, centerZ);
    ground.userData.interactionSurface = "ground";
    ground.receiveShadow = true;
    group.add(ground);
  }

  private createChunkWater(
    plan: ChunkVisualPlan,
    group: THREE.Group,
  ): THREE.Group | null {
    if (plan.wetPatches.length > 0) {
      const puddles = new THREE.InstancedMesh(
        new THREE.CircleGeometry(1, 18),
        new THREE.MeshPhysicalMaterial({
          color: plan.descriptor.biome === "swamp" ? 0x1d3a31 : 0x356b65,
          roughness: 0.28,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }),
        plan.wetPatches.length,
      );
      const dummy = new THREE.Object3D();
      plan.wetPatches.forEach((spawn, index) => {
        dummy.position.set(spawn.x, terrainHeight(spawn.x, spawn.z) + 0.08, spawn.z);
        dummy.scale.set(spawn.scale * 1.35, spawn.scale * 0.75, 1);
        dummy.rotation.set(-Math.PI / 2, 0, spawn.rotation);
        dummy.updateMatrix();
        puddles.setMatrixAt(index, dummy.matrix);
      });
      puddles.userData.interactionSurface = "mud";
      group.add(puddles);
    }

    const minX = plan.descriptor.coordinate.x * WORLD_CHUNK_SIZE;
    const maxX = minX + WORLD_CHUNK_SIZE;
    const minZ = plan.descriptor.coordinate.z * WORLD_CHUNK_SIZE;
    const maxZ = minZ + WORLD_CHUNK_SIZE;
    const riverSegments: Array<{ x: number; z: number; rotation: number }> = [];
    for (let x = minX + 1.5; x < maxX; x += 3) {
      const z = riverCenter(x);
      if (z < minZ - 2.4 || z > maxZ + 2.4) continue;
      riverSegments.push({ x, z, rotation: -Math.atan(Math.cos(x * 0.09) * 0.27) });
    }
    if (riverSegments.length === 0) return null;
    const riverLevelGroup = new THREE.Group();
    riverLevelGroup.name = `river-level-${plan.descriptor.key}`;
    applyRiverLevelToGroup(riverLevelGroup, this.snapshot.riverLevelMeters);
    const geometry = new THREE.PlaneGeometry(
      3.25,
      RIVER_SURFACE_HALF_WIDTH * 2,
    );
    geometry.rotateX(-Math.PI / 2);
    const river = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: 0x2f756f,
        roughness: 0.22,
        metalness: 0.05,
        transparent: true,
        opacity: 0.78,
        depthWrite: true,
      }),
      riverSegments.length,
    );
    const dummy = new THREE.Object3D();
    riverSegments.forEach((segment, index) => {
      dummy.position.set(
        segment.x,
        terrainHeight(segment.x, segment.z) + RIVER_SURFACE_Y_OFFSET,
        segment.z,
      );
      dummy.rotation.set(0, segment.rotation, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      river.setMatrixAt(index, dummy.matrix);
    });
    river.userData.interactionSurface = "river";
    river.receiveShadow = true;
    riverLevelGroup.add(river);
    group.add(riverLevelGroup);
    return riverLevelGroup;
  }

  private createLandmarks(): void {
    this.colliders.push(...authoredWorldColliders());
    this.worldGroup.add(createWreckage());

    const station = new THREE.Group();
    station.position.set(
      WEATHER_STATION_LAYOUT.centerX,
      terrainHeight(WEATHER_STATION_LAYOUT.centerX, WEATHER_STATION_LAYOUT.centerZ),
      WEATHER_STATION_LAYOUT.centerZ,
    );
    station.name = "weather-station";
    const metal = new THREE.MeshStandardMaterial({ color: 0x8d8b78, roughness: 0.72, metalness: 0.45 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x884529, roughness: 0.92 });
    const hut = new THREE.Mesh(
      new THREE.BoxGeometry(
        WEATHER_STATION_LAYOUT.width,
        WEATHER_STATION_LAYOUT.height,
        WEATHER_STATION_LAYOUT.depth,
      ),
      metal,
    );
    hut.position.y = WEATHER_STATION_LAYOUT.height / 2;
    hut.castShadow = true;
    station.add(hut);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.05, 0.12), rust);
    door.position.set(-0.55, 1.025, -WEATHER_STATION_LAYOUT.depth / 2 - 0.065);
    station.add(door);
    for (const offset of [-1.8, 1.8]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 7.5, 6), metal);
      mast.position.set(offset, 5.3, 0.8);
      mast.castShadow = true;
      station.add(mast);
    }
    this.worldGroup.add(station);

    const surveyShelter = createSurveyRockShelter();
    surveyShelter.position.set(
      SURVEY_ROCK_SHELTER_LAYOUT.centerX,
      terrainHeight(
        SURVEY_ROCK_SHELTER_LAYOUT.centerX,
        SURVEY_ROCK_SHELTER_LAYOUT.centerZ,
      ),
      SURVEY_ROCK_SHELTER_LAYOUT.centerZ,
    );
    surveyShelter.rotation.y = SURVEY_ROCK_SHELTER_LAYOUT.yaw;
    this.worldGroup.add(surveyShelter);

    const shelter = createShelter();
    shelter.name = "player-shelter";
    shelter.visible = false;
    shelter.position.set(3.4, terrainHeight(3.4, 2.4), 2.4);
    this.worldGroup.add(shelter);
    const bed = createLeafBed();
    bed.name = "leaf-bed";
    bed.visible = false;
    bed.position.set(3.4, terrainHeight(3.4, 2.4) + 0.08, 2.4);
    this.worldGroup.add(bed);

    const antenna = createAntenna();
    antenna.name = "beacon-antenna";
    antenna.visible = false;
    antenna.position.set(2.2, terrainHeight(2.2, 6.2), 6.2);
    this.signalLight.position.set(0, 5.8, 0);
    antenna.add(this.signalLight);
    this.worldGroup.add(antenna);
  }

  private createRain(): void {
    const count = this.isLowPowerDevice() ? 520 : 1100;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (seeded(i * 12.7) - 0.5) * 30;
      positions[i * 3 + 1] = seeded(i * 27.1) * 15 - 3;
      positions[i * 3 + 2] = (seeded(i * 18.9 + 4) - 0.5) * 30;
    }
    this.rainGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  }

  private createCanopyWindIndicators(): void {
    const count = this.worldVisualDetail === "low" ? 4 : 8;
    const leafGeometry = new THREE.PlaneGeometry(0.78, 1.55, 2, 2);
    for (let index = 0; index < count; index += 1) {
      const id = `c17-wind-indicator-${index}`;
      const angle = (index / count) * Math.PI * 2 + 0.28;
      const radius = 3.6 + (index % 3) * 0.55;
      const x = CANOPY_JUNCTION_POSITION.x + Math.sin(angle) * radius;
      const z = CANOPY_JUNCTION_POSITION.z + Math.cos(angle) * radius;
      const pivot = new THREE.Group();
      pivot.name = id;
      pivot.position.set(x, terrainHeight(x, z), z);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.05, 1.15, 5),
        new THREE.MeshStandardMaterial({ color: 0x315438, roughness: 1 }),
      );
      stem.position.y = 0.58;
      const leaf = new THREE.Mesh(
        leafGeometry,
        new THREE.MeshStandardMaterial({
          color: 0x3f7a47,
          roughness: 0.92,
          side: THREE.DoubleSide,
        }),
      );
      leaf.name = `${id}-leaf`;
      leaf.position.y = 1.23;
      leaf.rotation.x = -0.82;
      leaf.castShadow = this.worldVisualDetail !== "low";
      pivot.add(stem, leaf);
      this.worldGroup.add(pivot);
      this.windIndicatorLeaves.push({
        id,
        pivot,
        leaf,
        phaseRadians: stableWindObjectPhase(id),
      });
    }
  }

  private updateCanopyWindIndicators(
    wind: ReturnType<typeof projectWindPresentation>,
    delta: number,
  ): void {
    // Reuse the existing renderer clock; no leaf owns gameplay state or a RAF.
    const time = this.wildlifeTime + Math.max(0, delta);
    const directionYaw = Math.atan2(
      wind.canopy.directionX,
      wind.canopy.directionZ,
    );
    for (const view of this.windIndicatorLeaves) {
      const oscillation = Math.sin(
        time * Math.PI * 2 * wind.canopy.swayFrequencyHertz +
          view.phaseRadians,
      );
      view.pivot.rotation.y = directionYaw;
      view.leaf.rotation.z =
        oscillation * wind.canopy.swayAmplitudeRadians;
      view.leaf.rotation.x =
        -0.82 - wind.leafUnderside.flipAmount * 0.22 +
        Math.abs(oscillation) * wind.canopy.swayAmplitudeRadians * 0.35;
      view.leaf.material.color.copy(WIND_LEAF_FACE_COLOR).lerp(
        WIND_LEAF_UNDERSIDE_COLOR,
        wind.leafUnderside.flipAmount * (0.35 + Math.abs(oscillation) * 0.55),
      );
    }
  }

  private createCampfire(): void {
    this.fireGroup.position.set(-1.8, terrainHeight(-1.8, 2.2), 2.2);
    for (const rotation of [-0.65, 0.65]) {
      const log = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.16, 1.65, 7),
        new THREE.MeshStandardMaterial({ color: 0x4e2f20, roughness: 1 }),
      );
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rotation;
      log.position.y = 0.2;
      log.userData.fireLog = true;
      this.fireGroup.add(log);
    }
    for (let i = 0; i < 3; i += 1) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.28 - i * 0.055, 0.8 - i * 0.13, 7),
        new THREE.MeshBasicMaterial({
          color: i === 0 ? 0xff5b22 : i === 1 ? 0xffa12b : 0xffdf6a,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      flame.position.set((i - 1) * 0.12, 0.62 - i * 0.02, (i % 2) * 0.1);
      flame.userData.flame = true;
      this.fireGroup.add(flame);
    }
    this.fireLight.position.set(0, 1.25, 0);
    this.fireGroup.add(this.fireLight);
    this.fireGroup.visible = false;
    this.worldGroup.add(this.fireGroup);
  }

  private createWildlife(): void {
    const birdCount = this.isLowPowerDevice() ? 4 : 7;
    const birdGeometry = new THREE.BufferGeometry();
    const birdPositions = new Float32Array([
      0, 0, 0.18, -0.56, 0.08, 0, -0.08, 0, -0.14,
      0, 0, 0.18, 0.56, 0.08, 0, 0.08, 0, -0.14,
    ]);
    this.birdWingPositions = new THREE.BufferAttribute(birdPositions, 3);
    birdGeometry.setAttribute("position", this.birdWingPositions);
    this.birdMaterial = new THREE.MeshBasicMaterial({
      color: 0x101914,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.birdFlock = new THREE.InstancedMesh(birdGeometry, this.birdMaterial, birdCount);
    this.birdFlock.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.birdFlock.frustumCulled = false;
    this.birdFlock.visible = false;
    this.worldGroup.add(this.birdFlock);

    const clusterCenters = [
      { x: 1, z: 6 },
      { x: 13, z: -12 },
      {
        x: SURVEY_ROCK_SHELTER_LAYOUT.centerX + 2,
        z: SURVEY_ROCK_SHELTER_LAYOUT.centerZ - 3,
      },
      { x: 29, z: 24 },
    ];
    const fireflyCount = this.isLowPowerDevice() ? 24 : 48;
    const fireflyPositions = new Float32Array(fireflyCount * 3);
    for (let i = 0; i < fireflyCount; i += 1) {
      const center = clusterCenters[i % clusterCenters.length];
      const radius = 1.3 + seeded(i * 4.7 + 3) * 3.2;
      const angle = seeded(i * 8.3 + 5) * Math.PI * 2;
      const x = center.x + Math.cos(angle) * radius;
      const z = center.z + Math.sin(angle) * radius;
      fireflyPositions[i * 3] = x;
      fireflyPositions[i * 3 + 1] = terrainHeight(x, z) + 0.5 + seeded(i * 6.1 + 1) * 1.75;
      fireflyPositions[i * 3 + 2] = z;
    }
    this.fireflyBasePositions = fireflyPositions.slice();
    const fireflyGeometry = new THREE.BufferGeometry();
    fireflyGeometry.setAttribute("position", new THREE.BufferAttribute(fireflyPositions, 3));
    this.fireflyMaterial = new THREE.PointsMaterial({
      color: 0xd9ff87,
      size: this.isLowPowerDevice() ? 0.105 : 0.125,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.fireflies = new THREE.Points(fireflyGeometry, this.fireflyMaterial);
    this.fireflies.frustumCulled = false;
    this.fireflies.visible = false;
    this.worldGroup.add(this.fireflies);
  }

  private playerMovementColliders(): WorldCollider[] {
    const colliders: WorldCollider[] = [...this.colliders];
    for (const view of this.chunkViews.values()) {
      colliders.push(...view.colliders);
    }
    colliders.push(...this.semanticInstances.getMovementColliders());
    for (const view of this.entityViews.values()) {
      if (
        view.definition.source === "semantic" ||
        view.definition.kind !== "tree"
      ) continue;
      const completedStump =
        (!view.definition.available && !view.definition.treeHarvest) ||
        view.definition.treeRegrowth?.stage === "stump";
      if (!completedStump) {
        colliders.push(renderTreeCollider(view.definition));
      }
    }
    for (const structure of this.resolvedStructures()) {
      colliders.push(...structureWorldColliders(structure));
    }
    return colliders;
  }

  private isSheltered(x: number, z: number): boolean {
    const point = { x, z };
    if (
      this.resolvedStructures()
        .filter((structure) => structure.kind === "shelter")
        .some((shelter) =>
          isWithinStructureRadius(point, shelter, SHELTER_COVERAGE_RADIUS),
        )
    ) {
      return true;
    }
    if (isPointShelteredBySurveyRockShelter(x, z)) return true;
    if (Math.hypot(x - 33, z - 27) < 5.2) return true;
    return false;
  }

  private isLowPowerDevice(): boolean {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return window.matchMedia("(pointer: coarse)").matches || (nav.deviceMemory ?? 8) <= 4;
  }
}

function isEmissiveMaterial(material: THREE.Material): material is EmissiveMaterial {
  const candidate = material as Partial<EmissiveMaterial>;
  return (
    candidate.emissive instanceof THREE.Color &&
    typeof candidate.emissiveIntensity === "number"
  );
}

function focusColor(
  tone: InteractionTarget["affordance"]["highlightTone"],
): THREE.Color {
  const colors = {
    interactable: 0xb8df77,
    restricted: 0xe7a35d,
    spent: 0x7b8178,
    context: 0x86c9c8,
    threat: 0xff6f53,
  } as const;
  return new THREE.Color(colors[tone]);
}

function focusMarkerScale(kind: RenderEntityKind): number {
  if (kind === "animal") return 0.62;
  if (kind === "tree") return 0.78;
  if (kind === "shelter") return 1.45;
  if (kind === "bed") return 1.05;
  if (kind === "campfire") return 0.82;
  if (kind === "rain-collector" || kind === "smoking-rack") return 0.9;
  if (kind === "torch-waymark") return 0.72;
  if (kind === "radio-beacon" || kind === "station" || kind === "cache") {
    return 0.72;
  }
  return 0.52;
}

function interactionTargetSignature(target: InteractionTarget | null): string {
  if (!target) return "";
  const affordance = target.affordance;
  return [
    target.id,
    affordance.state,
    affordance.actionId,
    affordance.verb,
    affordance.blocker ?? "",
    affordance.requiredItem ?? "",
    affordance.feedbackKey,
    affordance.preview.detail,
    affordance.preview.fuelSeconds ?? "",
    affordance.preview.fuelCapacitySeconds ?? "",
    affordance.preview.health ?? "",
    affordance.preview.maxHealth ?? "",
    affordance.preview.behavior ?? "",
    affordance.preview.lit ?? "",
  ].join("|");
}

function createFocusMarker(): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.58, 0.66, 32),
    new THREE.MeshBasicMaterial({
      color: 0xb8df77,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  marker.name = "interaction-focus-marker";
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 3;
  marker.visible = false;
  return marker;
}

function seeded(value: number): number {
  const raw = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function hash2(x: number, z: number): number {
  return seeded(x * 0.37 + z * 1.73);
}

function wildlifeIndividualIdFromTarget(
  targetId: string | null | undefined,
): string | null {
  if (!targetId?.startsWith("wildlife:")) return null;
  const individualId = targetId.slice("wildlife:".length);
  return individualId.length > 0 ? individualId : null;
}

function wildlifeIndividualIdsFromHazards(
  hazardIds: Iterable<string>,
): string[] {
  const result = new Set<string>();
  for (const hazardId of hazardIds) {
    const individualId = wildlifeIndividualIdFromTarget(hazardId);
    if (individualId) result.add(individualId);
  }
  return [...result].sort((left, right) => left.localeCompare(right));
}

function setWildlifeReadability(
  object: THREE.Object3D,
  visibility: number,
  protectedView: boolean,
): void {
  const readable = Number.isFinite(visibility)
    ? THREE.MathUtils.clamp(visibility, 0, 1)
    : 0;
  const opacity = protectedView ? 1 : 0.5 + readable * 0.5;
  object.userData.wildlifeReadability = readable;
  object.userData.wildlifeProtected = protectedView;
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      const transparent = opacity < 0.999;
      if (
        material.transparent !== transparent ||
        material.depthWrite === transparent
      ) {
        material.transparent = transparent;
        material.depthWrite = !transparent;
        material.needsUpdate = true;
      }
      material.opacity = opacity;
    }
  });
}

function createWildlifeObject(
  speciesId: RenderSnapshot["wildlife"][number]["speciesId"],
): THREE.Object3D {
  const group = new THREE.Group();
  const body = new THREE.Group();
  body.name = "wildlife-body";
  group.add(body);
  const material = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.96 });
  const addMesh = (
    geometry: THREE.BufferGeometry,
    color: number,
    position: readonly [number, number, number],
    scale: readonly [number, number, number] = [1, 1, 1],
  ) => {
    const object = new THREE.Mesh(geometry, material(color));
    object.position.set(...position);
    object.scale.set(...scale);
    object.castShadow = true;
    object.receiveShadow = true;
    body.add(object);
    return object;
  };

  if (speciesId === "coiled-viper") {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.36, 0.12, 0.18),
      new THREE.Vector3(-0.1, 0.1, 0.42),
      new THREE.Vector3(0.28, 0.11, 0.28),
      new THREE.Vector3(0.34, 0.12, -0.08),
      new THREE.Vector3(0.08, 0.14, -0.34),
      new THREE.Vector3(0, 0.2, -0.62),
    ]);
    addMesh(
      new THREE.TubeGeometry(curve, 28, 0.075, 7, false),
      0x5d6b32,
      [0, 0, 0],
    );
    addMesh(
      new THREE.SphereGeometry(0.12, 7, 5),
      0x71833f,
      [0, 0.2, -0.68],
      [1.25, 0.72, 1.45],
    );
    for (const x of [-0.055, 0.055]) {
      addMesh(
        new THREE.SphereGeometry(0.012, 5, 4),
        0xd8b24c,
        [x, 0.225, -0.79],
      );
    }
  } else if (speciesId === "reedtail-scuttler") {
    addMesh(new THREE.SphereGeometry(0.36, 7, 5), 0x826747, [0, 0.34, 0], [1.25, 0.72, 0.72]);
    addMesh(new THREE.SphereGeometry(0.22, 7, 5), 0xa1845d, [0, 0.38, -0.42], [0.9, 0.85, 1]);
    const tail = addMesh(new THREE.ConeGeometry(0.08, 0.82, 5), 0x9c7b52, [0, 0.34, 0.57]);
    tail.rotation.x = Math.PI / 2;
  } else if (speciesId === "mossback-grazer") {
    addMesh(new THREE.SphereGeometry(0.72, 8, 6), 0x42543a, [0, 0.82, 0], [1.35, 0.82, 0.82]);
    addMesh(new THREE.SphereGeometry(0.42, 7, 5), 0x526348, [0, 0.82, -0.82], [0.9, 0.78, 1.2]);
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.42, 0.42]) {
        addMesh(new THREE.CylinderGeometry(0.08, 0.1, 0.78, 5), 0x383b2c, [x, 0.38, z]);
      }
    }
    const moss = addMesh(new THREE.ConeGeometry(0.5, 0.28, 7), 0x65824b, [0.1, 1.38, 0.08], [1.3, 1, 0.9]);
    moss.rotation.z = Math.PI;
  } else {
    addMesh(new THREE.SphereGeometry(0.56, 8, 6), 0x6b4a2f, [0, 0.62, 0], [1.5, 0.62, 0.72]);
    addMesh(new THREE.SphereGeometry(0.34, 7, 5), 0x8b6037, [0, 0.69, -0.67], [0.9, 0.72, 1.15]);
    const tail = addMesh(new THREE.ConeGeometry(0.1, 1.05, 6), 0x5b3928, [0, 0.58, 0.82]);
    tail.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.045, 5, 12),
      new THREE.MeshBasicMaterial({ color: 0xd58a35 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.72, -0.02);
    body.add(ring);
  }
  return group;
}

function positionEntityObject(object: THREE.Object3D, definition: RenderEntity): void {
  if (definition.kind === "tree") {
    object.position.set(
      definition.x,
      terrainHeight(definition.x, definition.z),
      definition.z,
    );
    updateAuthoredTreeObject(object, definition);
    return;
  }
  const anchor = definition.interactionAnchor ?? {
    x: definition.x,
    z: definition.z,
    height: 0,
  };
  object.position.set(anchor.x, terrainHeight(anchor.x, anchor.z), anchor.z);
}

function updateAuthoredTreeObject(
  object: THREE.Object3D,
  definition: RenderEntity,
): void {
  const body = object.getObjectByName("authored-tree-fall-body");
  const stump = object.getObjectByName("authored-tree-stump");
  const looseLog = object.getObjectByName("authored-tree-loose-log");
  const harvest = definition.treeHarvest;
  const regrowthStage = definition.treeRegrowth?.stage;
  const growthScale =
    regrowthStage === "sapling"
      ? 0.48
      : regrowthStage === "young"
        ? 0.74
        : 1;
  const standing =
    !harvest && definition.available && regrowthStage !== "stump";
  const unfinished = Boolean(
    harvest &&
      (harvest.branches > 0 ||
        harvest.trunkSegments > 0 ||
        harvest.looseLog),
  );
  if (body) {
    body.visible = standing || unfinished;
    body.scale.setScalar(growthScale);
    body.quaternion.identity();
    if (harvest) {
      const angle = (harvest.fallDirection / 1024) * Math.PI * 2;
      body.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
      );
      body.traverse((child) => {
        if (child.name === "authored-tree-crown") {
          child.visible = harvest.branches > 0;
        }
      });
    } else {
      body.traverse((child) => {
        if (child.name === "authored-tree-crown") child.visible = true;
      });
    }
  }
  if (stump) {
    stump.visible =
      Boolean(harvest) || !definition.available || regrowthStage === "stump";
  }
  if (looseLog) {
    looseLog.visible = harvest?.looseLog === true;
    if (harvest) {
      const angle = (harvest.fallDirection / 1024) * Math.PI * 2;
      looseLog.position.set(Math.cos(angle) * 1.2, 0.24, Math.sin(angle) * 1.2);
      looseLog.rotation.set(0, -angle, Math.PI / 2);
    }
  }
}

function createSecondaryCampfireObject(): {
  object: THREE.Group;
  light: THREE.PointLight;
} {
  const object = new THREE.Group();
  for (const rotation of [-0.65, 0.65]) {
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.16, 1.65, 7),
      new THREE.MeshStandardMaterial({ color: 0x4e2f20, roughness: 1 }),
    );
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rotation;
    log.position.y = 0.2;
    log.userData.fireLog = true;
    object.add(log);
  }
  for (let index = 0; index < 3; index += 1) {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.28 - index * 0.055, 0.8 - index * 0.13, 7),
      new THREE.MeshBasicMaterial({
        color: index === 0 ? 0xff5b22 : index === 1 ? 0xffa12b : 0xffdf6a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );
    flame.position.set((index - 1) * 0.12, 0.62 - index * 0.02, (index % 2) * 0.1);
    flame.userData.flame = true;
    object.add(flame);
  }
  const light = new THREE.PointLight(0xff7a2d, 0, 9, 2);
  light.position.set(0, 1.25, 0);
  object.add(light);
  return { object, light };
}

function createSmokingRackObject(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0x6d4b2f,
    roughness: 0.96,
  });
  const binding = new THREE.MeshStandardMaterial({
    color: 0x92744b,
    roughness: 1,
  });
  const meatMaterial = new THREE.MeshStandardMaterial({
    color: 0x9c4b3c,
    roughness: 0.82,
  });
  const addCylinder = (
    radius: number,
    height: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.78, radius, height, 6),
      wood,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.27, 0.27]) {
      const leg = addCylinder(0.065, 1.48, x, 0.72, z);
      leg.rotation.z = x < 0 ? -0.1 : 0.1;
      leg.rotation.x = z < 0 ? -0.07 : 0.07;
    }
  }
  const rail = addCylinder(0.055, 1.72, 0, 1.38, 0);
  rail.rotation.z = Math.PI / 2;
  for (const x of [-0.46, 0, 0.46]) {
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5),
      binding,
    );
    cord.position.set(x, 1.19, 0);
    cord.name = "rack-load";
    const meat = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.38, 0.1),
      meatMaterial.clone(),
    );
    meat.position.set(x, 0.95, 0);
    meat.rotation.z = x * 0.12;
    meat.castShadow = true;
    meat.name = "rack-meat";
    group.add(cord, meat);
  }
  for (let index = 0; index < 3; index += 1) {
    const smoke = new THREE.Mesh(
      new THREE.SphereGeometry(0.11 + index * 0.035, 6, 4),
      new THREE.MeshBasicMaterial({
        color: 0xc5c8bc,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    smoke.name = "rack-smoke";
    smoke.position.set((index - 1) * 0.22, 1.58 + index * 0.2, 0.02);
    smoke.userData.baseY = smoke.position.y;
    group.add(smoke);
  }
  return group;
}

export function createRainCollectorObject(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0x705034,
    roughness: 0.97,
  });
  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f7f3c,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x5e3d24,
    roughness: 0.92,
  });
  const addWood = (
    radius: number,
    height: number,
    position: readonly [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.78, radius, height, 6),
      wood,
    );
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  for (const leg of RAIN_COLLECTOR_LAYOUT.legPositions) {
    addWood(
      RAIN_COLLECTOR_LAYOUT.legRadius,
      RAIN_COLLECTOR_LAYOUT.frameHeight,
      [leg.x, RAIN_COLLECTOR_LAYOUT.frameHeight / 2, leg.z],
    );
  }
  for (const z of [-0.47, 0.47]) {
    const rail = addWood(0.052, RAIN_COLLECTOR_LAYOUT.width, [
      0,
      RAIN_COLLECTOR_LAYOUT.frameHeight,
      z,
    ]);
    rail.rotation.z = Math.PI / 2;
  }
  for (const x of [-0.47, 0.47]) {
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 1.02),
      leafMaterial,
    );
    leaf.position.set(x, 1.08, 0);
    leaf.rotation.set(-Math.PI / 2, 0, x < 0 ? -0.28 : 0.28);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
  }
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.28, 0.2, 10, 1, true),
    shellMaterial,
  );
  basin.position.y = 0.75;
  basin.castShadow = true;
  basin.receiveShadow = true;
  group.add(basin);
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(0.29, 16),
    new THREE.MeshStandardMaterial({
      color: 0x75b7b2,
      roughness: 0.2,
      metalness: 0.05,
      transparent: true,
      opacity: 0.76,
      side: THREE.DoubleSide,
    }),
  );
  water.name = "rain-collector-water";
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.855;
  group.add(water);
  return group;
}

export function updateRainCollectorObject(
  object: THREE.Group,
  definition: RenderSnapshot["structures"][number],
): void {
  const capacity = Math.max(1e-6, definition.storageCapacity ?? 4);
  const stored = THREE.MathUtils.clamp(
    definition.storedUnits ?? 0,
    0,
    capacity,
  );
  const ratio = stored / capacity;
  const water = object.getObjectByName("rain-collector-water");
  if (water instanceof THREE.Mesh) {
    water.visible = stored > 0.01;
    water.position.y = 0.835 + ratio * 0.04;
    water.scale.setScalar(0.62 + ratio * 0.38);
    const material = water.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.opacity = 0.52 + ratio * 0.34;
    }
  }
}

function updateSmokingRackObject(
  object: THREE.Group,
  definition: RenderSnapshot["structures"][number],
): void {
  const hasMeat = definition.processStatus !== undefined;
  const progress = THREE.MathUtils.clamp(definition.processProgress ?? 0, 0, 1);
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (child.name === "rack-load") {
      child.visible = hasMeat;
    } else if (child.name === "rack-meat") {
      child.visible = hasMeat;
      const material = child.material;
      if (material instanceof THREE.MeshStandardMaterial) {
        if (definition.processStatus === "spoiled") {
          material.color.setHex(0x55613d);
        } else if (definition.processStatus === "ready") {
          material.color.setHex(0x5f2d23);
        } else {
          material.color
            .setHex(0xa95142)
            .lerp(new THREE.Color(0x6a3327), progress);
        }
      }
    } else if (child.name === "rack-smoke") {
      child.visible = Boolean(definition.processActive);
    }
  });
}

function syncLooseStoneObject(
  object: THREE.Object3D,
  definition: RenderEntity,
): void {
  if (definition.kind !== "stone" || definition.source === "semantic") return;
  const visibleCount = looseStonePieceTransforms(
    definition.available ? definition.quantity ?? 1 : 0,
  ).length;
  object.traverse((child) => {
    const index = Number(child.userData.looseStoneIndex);
    if (Number.isInteger(index)) child.visible = index < visibleCount;
  });
}

/** Dedicated authored model: black/white survey scale, orange safety line/cap. */
export function createRiverGaugeModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = "river-gauge-model";
  const dark = new THREE.MeshStandardMaterial({ color: 0x202621, roughness: 0.82 });
  const light = new THREE.MeshStandardMaterial({ color: 0xe5e1cc, roughness: 0.76 });
  const orange = new THREE.MeshStandardMaterial({
    color: 0xf27632,
    emissive: 0x6b1f05,
    emissiveIntensity: 0.32,
    roughness: 0.65,
  });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.4, 0.16), dark);
  post.name = "river-gauge-post";
  post.position.y = 1.2;
  post.castShadow = true;
  group.add(post);
  for (let index = 0; index < 8; index += 1) {
    const mark = new THREE.Mesh(
      new THREE.BoxGeometry(index % 2 === 0 ? 0.52 : 0.36, 0.2, 0.045),
      index % 2 === 0 ? light : dark,
    );
    mark.name = `river-gauge-mark-${index}`;
    mark.position.set(0, 0.22 + index * 0.25, -0.105);
    group.add(mark);
  }
  const safeLine = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.075, 0.075), orange);
  safeLine.name = "river-gauge-safe-line";
  safeLine.position.set(
    0,
    riverSurfaceHeight(
      RIVER_GAUGE_POSITION.x,
      RIVER_GAUGE_SAFE_LEVEL_METERS,
    ) - terrainHeight(RIVER_GAUGE_POSITION.x, RIVER_GAUGE_POSITION.z),
    -0.14,
  );
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.18, 0.52), orange);
  cap.name = "river-gauge-orange-cap";
  cap.position.y = 2.46;
  group.add(safeLine, cap);
  return group;
}

/** Readable authored C-17 prop: raised yellow cabinet, cable, door and pulse. */
export function createCanopyJunctionModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = "canopy-junction-c17-model";
  const yellow = new THREE.MeshStandardMaterial({
    color: 0xd5a62e,
    roughness: 0.68,
    metalness: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x252c27,
    roughness: 0.72,
    metalness: 0.5,
  });
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.82, 0.38),
    yellow,
  );
  cabinet.name = "c17-cabinet";
  cabinet.position.y = 0.82;
  cabinet.castShadow = true;
  for (const x of [-0.31, 0.31]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.82, 0.1),
      dark,
    );
    leg.position.set(x, 0.41, 0);
    leg.castShadow = true;
    group.add(leg);
  }
  const doorPivot = new THREE.Group();
  doorPivot.name = "c17-door-pivot";
  doorPivot.position.set(-0.46, 0.82, -0.205);
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.8, 0.055),
    yellow.clone(),
  );
  door.name = "c17-door";
  door.position.x = 0.45;
  doorPivot.add(door);
  const display = new THREE.Mesh(
    new THREE.PlaneGeometry(0.36, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x8a2f1b }),
  );
  display.name = "c17-display";
  display.position.set(0.12, 0.92, -0.237);
  const status = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff6b2c }),
  );
  status.name = "c17-status-light";
  status.position.set(0.31, 1.02, -0.24);
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xf26f2e, side: THREE.DoubleSide }),
  );
  mark.name = "c17-orange-mark";
  mark.position.set(-0.19, 0.66, -0.238);
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 2.25, 6),
    dark,
  );
  cable.name = "c17-uplink-cable";
  cable.position.set(0.28, 2.02, 0.05);
  cable.rotation.z = -0.08;
  group.add(cabinet, doorPivot, display, status, mark, cable);
  return group;
}

export function syncCanopyJunctionModel(
  object: THREE.Object3D,
  phase: RenderSnapshot["canopyJunctionPhase"],
): void {
  const phaseIndex = [
    "obstructed",
    "exposed",
    "connector-open",
    "link-restored",
    "sampling",
    "sample-ready",
    "reported",
  ].indexOf(phase);
  const door = object.getObjectByName("c17-door-pivot");
  if (door) {
    door.rotation.y = phase === "connector-open" ? -Math.PI * 0.62 : 0;
  }
  const display = object.getObjectByName("c17-display") as THREE.Mesh | undefined;
  const displayMaterial = display?.material instanceof THREE.MeshBasicMaterial
    ? display.material
    : null;
  if (displayMaterial) {
    displayMaterial.color.setHex(
      phaseIndex >= 5 ? 0x7ed58a : phaseIndex >= 3 ? 0x75c7bb : 0x8a2f1b,
    );
  }
  const status = object.getObjectByName("c17-status-light") as THREE.Mesh | undefined;
  const statusMaterial = status?.material instanceof THREE.MeshBasicMaterial
    ? status.material
    : null;
  if (statusMaterial) {
    statusMaterial.color.setHex(
      phaseIndex >= 5 ? 0x99ef72 : phaseIndex >= 3 ? 0x6ed7d0 : 0xff6b2c,
    );
  }
}

/**
 * A low, radial ochre fan that cannot be mistaken for the upright green herb
 * silhouette. The pile stays code-native and receives the normal focus
 * emissive treatment only after the player aims at it.
 */
export function createDryLeafPileModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = "dry-leaf-resource-pile";

  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, -0.42);
  leafShape.bezierCurveTo(0.16, -0.2, 0.15, 0.24, 0, 0.46);
  leafShape.bezierCurveTo(-0.15, 0.24, -0.16, -0.2, 0, -0.42);
  const leafGeometry = new THREE.ShapeGeometry(leafShape, 3);
  leafGeometry.rotateX(-Math.PI / 2);
  const leafColors = [0xb18a42, 0x8e6b32, 0xc09a50] as const;

  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2 + (index % 2) * 0.16;
    const material = new THREE.MeshStandardMaterial({
      color: leafColors[index % leafColors.length],
      emissive: 0x211305,
      emissiveIntensity: 0.1,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    const leaf = new THREE.Mesh(leafGeometry, material);
    leaf.name = "dry-leaf-fan";
    leaf.position.set(Math.sin(angle) * 0.23, 0.035 + (index % 3) * 0.018, Math.cos(angle) * 0.23);
    leaf.rotation.y = angle;
    leaf.rotation.z = (index % 2 === 0 ? 1 : -1) * 0.08;
    leaf.scale.set(0.92 + (index % 3) * 0.08, 1, 0.86 + (index % 2) * 0.12);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
  }

  const ribMaterial = new THREE.MeshStandardMaterial({
    color: 0x5d4121,
    roughness: 1,
  });
  for (const angle of [0.3, 2.45, 4.55]) {
    const rib = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.026, 0.66, 5),
      ribMaterial,
    );
    rib.name = "dry-leaf-rib";
    rib.position.set(Math.sin(angle) * 0.08, 0.065, Math.cos(angle) * 0.08);
    rib.rotation.set(Math.PI / 2, 0, -angle);
    rib.castShadow = true;
    group.add(rib);
  }
  return group;
}

function createEntityObject(kind: RenderEntityKind): THREE.Object3D {
  if (kind === "river-gauge") return createRiverGaugeModel();
  if (kind === "canopy-junction") return createCanopyJunctionModel();
  if (kind === "tinder") return createDryLeafPileModel();
  const group = new THREE.Group();
  if (
    kind === "campfire" ||
    kind === "shelter" ||
    kind === "bed" ||
    kind === "radio-beacon" ||
    kind === "torch-waymark"
  ) {
    // Placed structures already have authored world models. This empty group
    // is only a focus proxy, preventing duplicate geometry and collision.
    group.userData.focusProxy = true;
    return group;
  }
  const rough = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.94 });
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const result = new THREE.Mesh(geometry, material);
    result.castShadow = true;
    result.receiveShadow = true;
    return result;
  };
  if (kind === "stick" || kind === "vine") {
    const branch = mesh(new THREE.CylinderGeometry(0.045, 0.07, kind === "vine" ? 1.5 : 1.05, 6), rough(kind === "vine" ? 0x55733b : 0x725039));
    branch.rotation.z = Math.PI / 2.25;
    branch.position.y = 0.18;
    group.add(branch);
  } else if (kind === "stone") {
    const geometry = new THREE.DodecahedronGeometry(1, 0);
    looseStonePieceTransforms(5).forEach((piece, index) => {
      const stone = mesh(geometry, rough(0x74796f));
      stone.name = "loose-stone-piece";
      stone.userData.looseStoneIndex = index;
      stone.position.set(piece.x, piece.y, piece.z);
      stone.rotation.y = piece.yaw;
      stone.scale.set(piece.scaleX, piece.scaleY, piece.scaleZ);
      group.add(stone);
    });
  } else if (["herb", "tobacco", "palm"].includes(kind)) {
    const color = kind === "tobacco" ? 0x6d893f : kind === "palm" ? 0x4f8b43 : 0x79a95b;
    for (let i = 0; i < (kind === "palm" ? 7 : 5); i += 1) {
      const leaf = mesh(new THREE.PlaneGeometry(kind === "palm" ? 0.85 : 0.46, kind === "palm" ? 1.7 : 0.88), new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
      leaf.position.set(Math.sin(i * 2.1) * 0.25, 0.45 + (i % 2) * 0.12, Math.cos(i * 2.1) * 0.25);
      leaf.rotation.set(-0.55, i * 2.1, 0.12);
      group.add(leaf);
    }
  } else if (["coconut", "banana", "nut", "mushroom"].includes(kind)) {
    if (kind === "mushroom") {
      const cap = mesh(new THREE.SphereGeometry(0.18, 8, 5), rough(0xf1b45d));
      cap.scale.y = 0.45;
      cap.position.y = 0.32;
      const stem = mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.26, 6), rough(0xd9d0a5));
      stem.position.y = 0.13;
      group.add(cap, stem);
    } else {
      const colors: Record<string, number> = { coconut: 0x6a4a29, banana: 0xd3bd3f, nut: 0x80532d };
      const fruit = mesh(kind === "banana" ? new THREE.CapsuleGeometry(0.12, 0.42, 4, 8) : new THREE.SphereGeometry(kind === "coconut" ? 0.3 : 0.2, 9, 7), rough(colors[kind]));
      fruit.position.y = kind === "coconut" ? 0.3 : 0.22;
      if (kind === "banana") fruit.rotation.z = 0.85;
      group.add(fruit);
    }
  } else if (kind === "tree") {
    const fallBody = new THREE.Group();
    fallBody.name = "authored-tree-fall-body";
    const trunk = mesh(
      new THREE.CylinderGeometry(0.2, 0.28, 3.6, 7),
      rough(0x60452f),
    );
    trunk.position.y = 1.8;
    fallBody.add(trunk);
    const crownMaterial = rough(0x285b32);
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2;
      const crown = mesh(new THREE.IcosahedronGeometry(0.92, 0), crownMaterial);
      crown.name = "authored-tree-crown";
      crown.position.set(Math.cos(angle) * 0.46, 3.45 + (index % 2) * 0.34, Math.sin(angle) * 0.46);
      crown.scale.set(1.05, 1.18, 1.05);
      fallBody.add(crown);
    }
    const scar = mesh(
      new THREE.PlaneGeometry(0.28, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xc49a61, side: THREE.DoubleSide }),
    );
    scar.position.set(0, 1.28, -0.235);
    fallBody.add(scar);
    const stump = mesh(
      new THREE.CylinderGeometry(0.25, 0.31, 0.42, 7),
      rough(0x59402d),
    );
    stump.name = "authored-tree-stump";
    stump.position.y = 0.21;
    stump.visible = false;
    const looseLog = mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 1.45, 7),
      rough(0x79553a),
    );
    looseLog.name = "authored-tree-loose-log";
    looseLog.visible = false;
    group.add(fallBody, stump, looseLog);
  } else if (kind === "snake") {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.6, 0.12, -0.1),
      new THREE.Vector3(-0.22, 0.12, 0.2),
      new THREE.Vector3(0.18, 0.13, -0.2),
      new THREE.Vector3(0.55, 0.16, 0.08),
    ]);
    const snake = mesh(new THREE.TubeGeometry(curve, 24, 0.07, 6, false), rough(0x53612d));
    group.add(snake);
  } else if (kind === "water") {
    const marker = mesh(new THREE.RingGeometry(0.28, 0.4, 16), new THREE.MeshBasicMaterial({ color: 0x83d7cf, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.1;
    group.add(marker);
  } else if (kind === "cache") {
    const crateMaterial = new THREE.MeshStandardMaterial({
      color: 0x9a7840,
      emissive: 0x1b1205,
      emissiveIntensity: 0.34,
      roughness: 0.88,
    });
    const crate = mesh(new THREE.BoxGeometry(1.14, 0.56, 0.78), crateMaterial);
    crate.position.y = 0.3;
    const lid = mesh(new THREE.BoxGeometry(1.2, 0.12, 0.84), rough(0xb08a4a));
    lid.position.y = 0.62;
    const metal = rough(0x343a34);
    for (const x of [-0.36, 0.36]) {
      const strap = mesh(new THREE.BoxGeometry(0.1, 0.7, 0.82), metal);
      strap.position.set(x, 0.35, 0);
      group.add(strap);
    }
    const surveyMark = mesh(
      new THREE.PlaneGeometry(0.34, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xf0d077, side: THREE.DoubleSide }),
    );
    surveyMark.position.set(0, 0.38, -0.397);
    group.add(crate, lid, surveyMark);
  } else if (kind === "station") {
    const cabinet = mesh(
      new THREE.BoxGeometry(0.92, 1.42, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x6f756c, roughness: 0.68, metalness: 0.5 }),
    );
    cabinet.position.y = 0.72;
    const panel = mesh(
      new THREE.BoxGeometry(0.68, 0.66, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x222a25, roughness: 0.52, metalness: 0.35 }),
    );
    panel.position.set(0, 0.86, -0.2);
    const display = mesh(
      new THREE.PlaneGeometry(0.38, 0.18),
      new THREE.MeshBasicMaterial({ color: 0xb7d579 }),
    );
    display.position.set(-0.08, 0.98, -0.244);
    const handle = mesh(new THREE.BoxGeometry(0.08, 0.24, 0.07), rough(0xc47442));
    handle.position.set(0.25, 0.72, -0.25);
    const beacon = mesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffcf6d }),
    );
    beacon.position.set(0.29, 1.1, -0.24);
    group.add(cabinet, panel, display, handle, beacon);
  } else if (kind === "beacon") {
    const caseMesh = mesh(
      new THREE.BoxGeometry(0.62, 0.92, 0.28),
      new THREE.MeshStandardMaterial({ color: 0x3b403c, roughness: 0.62, metalness: 0.42 }),
    );
    caseMesh.position.y = 0.54;
    const batteryFace = mesh(new THREE.BoxGeometry(0.42, 0.58, 0.08), rough(0x9b6a32));
    batteryFace.position.set(0, 0.56, -0.18);
    const grip = mesh(new THREE.TorusGeometry(0.17, 0.035, 5, 10, Math.PI), rough(0x252a27));
    grip.rotation.z = Math.PI;
    grip.position.set(0, 1.04, 0);
    group.add(caseMesh, batteryFace, grip);
  } else if (kind === "wreck") {
    const marker = mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: 0xf2763d }));
    marker.position.y = 2.3;
    group.add(marker);
  }
  return group;
}

export function createSurveyRockShelter(): THREE.Group {
  const group = new THREE.Group();
  group.name = "survey-rock-shelter";
  const layout = SURVEY_ROCK_SHELTER_LAYOUT;
  const stone = new THREE.MeshStandardMaterial({
    color: 0x454b40,
    roughness: 1,
  });
  const stoneEdge = new THREE.MeshStandardMaterial({
    color: 0x343a33,
    roughness: 1,
  });
  const makeSlab = (
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material = stone,
  ) => {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      material,
    );
    slab.name = name;
    slab.position.set(x, y, z);
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);
    return slab;
  };

  const roof = makeSlab(
    "survey-shelter-roof",
    layout.roof.width,
    layout.roof.thickness,
    layout.roof.depth,
    0,
    layout.roof.height,
    0.05,
  );
  roof.rotation.set(-0.035, 0.02, -0.018);

  const wallDepth = 2.9;
  for (const side of [-1, 1]) {
    const support = makeSlab(
      "survey-shelter-side-support",
      0.62,
      layout.entrance.height,
      wallDepth,
      side * 2.05,
      layout.entrance.height / 2,
      0.2,
      side < 0 ? stone : stoneEdge,
    );
    support.rotation.z = side * 0.035;
  }
  makeSlab(
    "survey-shelter-back-support",
    4.1,
    1.86,
    0.62,
    0,
    0.93,
    1.65,
    stoneEdge,
  );

  const interior = new THREE.Mesh(
    new THREE.PlaneGeometry(3.38, 1.72),
    new THREE.MeshBasicMaterial({ color: 0x070b08, side: THREE.DoubleSide }),
  );
  interior.name = "survey-shelter-dark-interior";
  interior.position.set(0, 1.02, 1.325);
  group.add(interior);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 3.05),
    new THREE.MeshStandardMaterial({ color: 0x252a20, roughness: 1, side: THREE.DoubleSide }),
  );
  floor.name = "survey-shelter-floor";
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.035, 0.18);
  floor.receiveShadow = true;
  group.add(floor);

  const moss = new THREE.Mesh(
    new THREE.PlaneGeometry(3.5, 0.38),
    new THREE.MeshStandardMaterial({ color: 0x53663a, roughness: 1, side: THREE.DoubleSide }),
  );
  moss.name = "survey-shelter-roof-moss";
  moss.position.set(0, layout.roof.height + 0.22, -1.15);
  moss.rotation.x = -0.32;
  group.add(moss);
  return group;
}

function createWreckage(): THREE.Group {
  const group = new THREE.Group();
  group.position.set(0, terrainHeight(0, 3), 3);
  group.name = "wreckage";
  const orange = new THREE.MeshStandardMaterial({ color: 0xc9572e, roughness: 0.78, metalness: 0.24 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x252b29, roughness: 0.9, metalness: 0.35 });
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.15, 1.7), orange);
  fuselage.rotation.z = -0.1;
  fuselage.rotation.y = 0.34;
  fuselage.position.set(0, 0.75, 0);
  fuselage.castShadow = true;
  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.35), dark);
  cockpit.position.set(-2.55, 1.05, 0.82);
  cockpit.rotation.y = 0.34;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.15, 6.8), orange);
  wing.position.set(0.4, 0.66, 0.1);
  wing.rotation.y = 0.25;
  group.add(fuselage, cockpit, wing);
  return group;
}

function createShelter(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x67462f, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6939, roughness: 1, side: THREE.DoubleSide });
  for (const x of [-1.3, 1.3]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.5, 6), wood);
    pole.position.set(x, 1.25, 0);
    pole.castShadow = true;
    group.add(pole);
  }
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.2, 2, 2), leaf);
  roof.position.set(0, 2.15, 0.45);
  roof.rotation.set(-1.08, 0, 0);
  roof.castShadow = true;
  group.add(roof);
  return group;
}

function createLeafBed(): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 9; i += 1) {
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(0.65, 1.9),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x587843 : 0x6b874d, roughness: 1, side: THREE.DoubleSide }),
    );
    leaf.rotation.x = -Math.PI / 2;
    leaf.rotation.z = (i - 4) * 0.08;
    leaf.position.set((i - 4) * 0.22, 0.02 + i * 0.002, 0);
    group.add(leaf);
  }
  return group;
}

function createAntenna(): THREE.Group {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x929990, roughness: 0.55, metalness: 0.65 });
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.11, 5.8, 6), metal);
  mast.position.y = 2.9;
  mast.castShadow = true;
  group.add(mast);
  for (let i = 0; i < 3; i += 1) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.8 - i * 0.3, 5), metal);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = i * Math.PI / 3;
    arm.position.y = 4.7 + i * 0.38;
    group.add(arm);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3d2e }));
  lamp.position.y = 5.85;
  group.add(lamp);
  return group;
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}
