import type {
  TreeHarvestState,
  TreeRegrowthState,
  Vec3,
  WorldEntity,
  WorldEntitySemanticMetadata,
} from "./types";
import {
  effectiveTreeGrowthStage,
  effectiveTreeSize,
} from "./treeRegrowthRuntime";

export type TreeHarvestPhase =
  | "standing"
  | "branches"
  | "buck"
  | "loose-log"
  | "stump";

export interface TreeGeometrySource {
  id: string;
  position: Pick<Vec3, "x" | "y" | "z">;
  quantity: number;
  semantic?: Partial<Pick<
    WorldEntitySemanticMetadata,
    | "category"
    | "species"
    | "growthStage"
    | "scale"
    | "size"
    | "material"
    | "action"
  >>;
  treeHarvest?: TreeHarvestState;
  treeRegrowth?: TreeRegrowthState;
}

export interface TreeInteractionAnchor {
  x: number;
  z: number;
  height: number;
}

export interface FallenTreeGeometry {
  angle: number;
  length: number;
  radius: number;
  start: { x: number; z: number };
  end: { x: number; z: number };
}

const FULL_TURN_STEPS = 1024;
const TWO_PI = Math.PI * 2;

export function isTreeEntity(
  entity: Pick<WorldEntity, "semantic" | "tags">,
): boolean {
  return (
    entity.semantic?.category === "tree" ||
    entity.tags.includes("standing-tree")
  );
}

export function normalizeTreeHarvestState(
  value: TreeHarvestState | undefined,
): TreeHarvestState | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (
    !Number.isFinite(value.fallDirection) ||
    !Number.isFinite(value.branches) ||
    !Number.isFinite(value.trunkSegments)
  ) {
    return undefined;
  }
  return {
    fallDirection:
      ((Math.floor(value.fallDirection) % FULL_TURN_STEPS) +
        FULL_TURN_STEPS) %
      FULL_TURN_STEPS,
    branches: Math.max(0, Math.min(99, Math.floor(value.branches))),
    trunkSegments: Math.max(
      0,
      Math.min(99, Math.floor(value.trunkSegments)),
    ),
    looseLog: value.looseLog === true,
  };
}

export function treeHarvestPhase(source: TreeGeometrySource): TreeHarvestPhase {
  if (source.quantity > 0) return "standing";
  const harvest = source.treeHarvest;
  // A zero-quantity legacy tree without the new state is an already-processed
  // stump. Migration must never invent a second set of materials for it.
  if (!harvest) return "stump";
  if (harvest.branches > 0) return "branches";
  if (harvest.looseLog) return "loose-log";
  if (harvest.trunkSegments > 0) return "buck";
  return "stump";
}

export function treeHarvestFinished(
  harvest: TreeHarvestState | undefined,
): boolean {
  return Boolean(
    harvest &&
      harvest.branches <= 0 &&
      harvest.trunkSegments <= 0 &&
      !harvest.looseLog,
  );
}

export function treeIsDepleted(source: TreeGeometrySource): boolean {
  if (source.quantity > 0) return false;
  return !source.treeHarvest || treeHarvestFinished(source.treeHarvest);
}

/** Normalizes only the new tree state while preserving legacy stump meaning. */
export function normalizeTreeEntityRuntime(entity: WorldEntity): void {
  if (!isTreeEntity(entity)) return;
  entity.quantity = Number.isFinite(entity.quantity)
    ? Math.max(0, Math.min(999, Math.floor(entity.quantity)))
    : 0;
  if (entity.quantity > 0) {
    delete entity.treeHarvest;
    entity.depleted = false;
    return;
  }
  const normalized = normalizeTreeHarvestState(entity.treeHarvest);
  if (normalized && !treeHarvestFinished(normalized)) {
    entity.treeHarvest = normalized;
  } else {
    delete entity.treeHarvest;
  }
  entity.depleted = treeIsDepleted(entity);
}

export function treeMaterialYield(source: TreeGeometrySource): {
  branches: number;
  trunkSegments: number;
} {
  const stage = effectiveTreeGrowthStage(source);
  const base =
    stage === "sapling"
      ? { branches: 1, trunkSegments: 0 }
      : stage === "mature"
        ? { branches: 3, trunkSegments: 2 }
        : stage === "old-growth"
          ? { branches: 4, trunkSegments: 3 }
          : { branches: 2, trunkSegments: 1 };
  return {
    branches:
      base.branches + (source.semantic?.species === "rain-palm" ? 1 : 0),
    trunkSegments: base.trunkSegments,
  };
}

function stableDirectionForId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % FULL_TURN_STEPS;
}

export function quantizeTreeFallDirection(
  source: TreeGeometrySource,
  playerPosition: Pick<Vec3, "x" | "z">,
): number {
  const dx = source.position.x - playerPosition.x;
  const dz = source.position.z - playerPosition.z;
  if (Math.hypot(dx, dz) <= 0.0001) return stableDirectionForId(source.id);
  const normalized = ((Math.atan2(dz, dx) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round((normalized / TWO_PI) * FULL_TURN_STEPS) % FULL_TURN_STEPS;
}

export function treeFallAngle(direction: number): number {
  const normalized =
    ((Math.floor(direction) % FULL_TURN_STEPS) + FULL_TURN_STEPS) %
    FULL_TURN_STEPS;
  return (normalized / FULL_TURN_STEPS) * TWO_PI;
}

export function createFelledTreeHarvestState(
  source: TreeGeometrySource,
  playerPosition: Pick<Vec3, "x" | "z">,
): TreeHarvestState {
  const material = treeMaterialYield(source);
  return {
    fallDirection: quantizeTreeFallDirection(source, playerPosition),
    branches: material.branches,
    trunkSegments: material.trunkSegments,
    looseLog: false,
  };
}

export function treeFallenGeometry(
  source: TreeGeometrySource,
): FallenTreeGeometry | null {
  if (!source.treeHarvest) return null;
  const stage = effectiveTreeGrowthStage(source);
  const baseLength =
    stage === "sapling"
      ? 1.8
      : stage === "mature"
        ? 5.1
        : stage === "old-growth"
          ? 6.2
          : 3.6;
  const scale = Math.max(0.5, Math.min(1.8, source.semantic?.scale ?? 1));
  const length = baseLength * scale;
  const angle = treeFallAngle(source.treeHarvest.fallDirection);
  const directionX = Math.cos(angle);
  const directionZ = Math.sin(angle);
  return {
    angle,
    length,
    radius: (effectiveTreeSize(source) === "large" ? 0.38 : 0.3) * scale,
    start: {
      x: source.position.x + directionX * 0.35,
      z: source.position.z + directionZ * 0.35,
    },
    end: {
      x: source.position.x + directionX * length * 0.88,
      z: source.position.z + directionZ * length * 0.88,
    },
  };
}

export function treeInteractionAnchor(
  source: TreeGeometrySource,
): TreeInteractionAnchor {
  const phase = treeHarvestPhase(source);
  if (phase === "standing" || phase === "stump") {
    const stage = effectiveTreeGrowthStage(source);
    return {
      x: source.position.x,
      z: source.position.z,
      height:
        phase === "stump"
          ? 0.24
          : stage === "sapling"
            ? 0.62
            : stage === "young"
              ? 0.95
              : 1.25,
    };
  }
  const geometry = treeFallenGeometry(source);
  if (!geometry || !source.treeHarvest) {
    return { x: source.position.x, z: source.position.z, height: 0.24 };
  }
  const directionX = Math.cos(geometry.angle);
  const directionZ = Math.sin(geometry.angle);
  let distance = geometry.length * 0.72;
  if (phase === "buck" || phase === "loose-log") {
    const maximum = treeMaterialYield(source).trunkSegments;
    const processed = Math.max(0, maximum - source.treeHarvest.trunkSegments);
    const ordinal = phase === "loose-log" ? Math.max(0, processed - 1) : processed;
    distance = Math.min(
      geometry.length * 0.78,
      0.8 + ordinal * Math.max(0.85, geometry.length / Math.max(2, maximum + 1)),
    );
  }
  return {
    x: source.position.x + directionX * distance,
    z: source.position.z + directionZ * distance,
    height: phase === "branches" ? 0.42 : 0.3,
  };
}

export function treeHorizontalDistanceToInteraction(
  source: TreeGeometrySource,
  position: Pick<Vec3, "x" | "z">,
): number {
  const anchor = treeInteractionAnchor(source);
  return Math.hypot(position.x - anchor.x, position.z - anchor.z);
}

export function treeWorkMultiplier(source: TreeGeometrySource): number {
  const material = source.semantic?.material;
  const stage = effectiveTreeGrowthStage(source);
  return (
    (material === "hardwood" ? 1.45 : material === "palmwood" ? 0.9 : 1) *
    (stage === "old-growth" ? 1.35 : stage === "mature" ? 1.15 : 1)
  );
}

/** One pacing formula shared by capability previews and authoritative work. */
export function treeStandingWorkSeconds(source: TreeGeometrySource): number {
  const baseSeconds = source.semantic?.action === "cut" ? 2 : 3;
  const sizeSeconds =
    effectiveTreeSize(source) === "large"
      ? 1
      : effectiveTreeSize(source) === "medium"
        ? 0.5
        : 0;
  return Math.max(
    2,
    Math.round((baseSeconds + sizeSeconds) * treeWorkMultiplier(source)),
  );
}
