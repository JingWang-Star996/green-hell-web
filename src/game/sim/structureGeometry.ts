import type {
  PlacedStructureKind,
  Vec3,
} from "./types";
import { isPointBlocked, type WorldCollider } from "../world/interactionGeometry";

export const STRUCTURE_KINDS = [
  "campfire",
  "shelter",
  "bed",
  "radio-beacon",
  "smoking-rack",
  "rain-collector",
  "torch-waymark",
] as const satisfies readonly PlacedStructureKind[];

/** Code-native shape shared by preview, authored model, focus anchor and collision. */
export const RAIN_COLLECTOR_LAYOUT = {
  width: 1.8,
  depth: 1.18,
  frameHeight: 1.22,
  legRadius: 0.075,
  legPositions: [
    { x: -0.76, z: -0.43 },
    { x: 0.76, z: -0.43 },
    { x: -0.76, z: 0.43 },
    { x: 0.76, z: 0.43 },
  ],
  interactionAnchor: { x: 0, z: 0.78, height: 0.92 },
} as const;

/**
 * Code-native torch-waymark contract shared by placement, collision, focus and
 * the later renderer pass. Values describe the visible stone base and pole,
 * rather than an oversized invisible interaction volume.
 */
export const TORCH_WAYMARK_LAYOUT = {
  stoneBaseRadius: 0.46,
  placementRadius: 0.65,
  colliderRadius: 0.38,
  poleHeight: 2.15,
  useRadius: 3.2,
  interactionAnchor: { x: 0, z: 0.7, height: 1 },
} as const;

export interface StructureTransformSource {
  id: string;
  kind: PlacedStructureKind;
  yaw: number;
  x?: number;
  z?: number;
  position?: Pick<Vec3, "x" | "z">;
}

export interface StructureTransform2D {
  id: string;
  kind: PlacedStructureKind;
  x: number;
  z: number;
  yaw: number;
}

export const DEFAULT_STRUCTURE_PLACEMENTS: Readonly<
  Record<PlacedStructureKind, { position: Vec3; yaw: number }>
> = {
  campfire: { position: { x: -1.8, y: 0, z: 2.2 }, yaw: 0 },
  shelter: { position: { x: 3.4, y: 0, z: 2.4 }, yaw: 0 },
  bed: { position: { x: 3.4, y: 0, z: 2.4 }, yaw: 0 },
  "radio-beacon": { position: { x: 2.2, y: 0, z: 6.2 }, yaw: 0 },
  "smoking-rack": { position: { x: -3.2, y: 0, z: 2.2 }, yaw: 0 },
  "rain-collector": { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
  "torch-waymark": { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
};

const PLACEMENT_RADII: Readonly<Record<PlacedStructureKind, number>> = {
  campfire: 0.72,
  shelter: 1.7,
  bed: 1.05,
  "radio-beacon": 0.85,
  "smoking-rack": 0.9,
  "rain-collector": 1.08,
  "torch-waymark": TORCH_WAYMARK_LAYOUT.placementRadius,
};

/** Distance from the structure origin at which its direct action is usable. */
export const STRUCTURE_USE_RADII: Readonly<
  Record<PlacedStructureKind, number>
> = {
  campfire: 3.2,
  shelter: 3.2,
  bed: 2.8,
  "radio-beacon": 2.8,
  "smoking-rack": 3.2,
  "rain-collector": 3.2,
  "torch-waymark": TORCH_WAYMARK_LAYOUT.useRadius,
};

/** The authored fire light reaches farther than the direct fuel interaction. */
export const FIRE_COMFORT_RADIUS = 5.5;
export const SHELTER_COVERAGE_RADIUS = 3.2;

export function structurePlacementRadius(kind: PlacedStructureKind): number {
  return PLACEMENT_RADII[kind];
}

export function structureTransformFromSource(
  source: StructureTransformSource,
): StructureTransform2D | null {
  const x = source.position?.x ?? source.x;
  const z = source.position?.z ?? source.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return {
    id: source.id,
    kind: source.kind,
    x: x!,
    z: z!,
    yaw: Number.isFinite(source.yaw) ? source.yaw : 0,
  };
}

export function rainCollectorInteractionAnchor(source: {
  position: Pick<Vec3, "x" | "z">;
  yaw: number;
}): { x: number; z: number; height: number } {
  const local = RAIN_COLLECTOR_LAYOUT.interactionAnchor;
  const cosine = Math.cos(source.yaw);
  const sine = Math.sin(source.yaw);
  return {
    x: source.position.x + local.x * cosine + local.z * sine,
    z: source.position.z - local.x * sine + local.z * cosine,
    height: local.height,
  };
}

export function torchWaymarkInteractionAnchor(source: {
  position: Pick<Vec3, "x" | "z">;
  yaw: number;
}): { x: number; z: number; height: number } {
  const local = TORCH_WAYMARK_LAYOUT.interactionAnchor;
  const cosine = Math.cos(source.yaw);
  const sine = Math.sin(source.yaw);
  return {
    x: source.position.x + local.x * cosine + local.z * sine,
    z: source.position.z - local.x * sine + local.z * cosine,
    height: local.height,
  };
}

/**
 * Resolves a built structure to its saved transform. Event-log-era saves had
 * only booleans, so a missing transform falls back to the original authored
 * location instead of silently moving every proximity check to camp center.
 */
export function resolveStructureTransform(
  kind: PlacedStructureKind,
  sources: readonly StructureTransformSource[] | undefined,
  built: boolean,
): StructureTransform2D | null {
  if (!built) return null;
  const explicit = sources
    ?.filter((source) => source.kind === kind)
    .map(structureTransformFromSource)
    .find((transform): transform is StructureTransform2D => transform !== null);
  if (explicit) return explicit;
  const fallback = DEFAULT_STRUCTURE_PLACEMENTS[kind];
  return {
    id: `structure.${kind}.legacy-fallback`,
    kind,
    x: fallback.position.x,
    z: fallback.position.z,
    yaw: fallback.yaw,
  };
}

export function horizontalDistanceToStructure(
  point: Pick<Vec3, "x" | "z">,
  structure: StructureTransform2D,
): number {
  return Math.hypot(point.x - structure.x, point.z - structure.z);
}

export function isWithinStructureRadius(
  point: Pick<Vec3, "x" | "z">,
  structure: StructureTransform2D,
  radius: number,
): boolean {
  return horizontalDistanceToStructure(point, structure) <= radius;
}

function localToWorldPoint(
  structure: StructureTransform2D,
  x: number,
  z: number,
): { x: number; z: number } {
  const cosine = Math.cos(structure.yaw);
  const sine = Math.sin(structure.yaw);
  return {
    x: structure.x + x * cosine + z * sine,
    z: structure.z - x * sine + z * cosine,
  };
}

/** Exact visible support footprints shared by movement and melee occlusion. */
export function structureWorldColliders(
  structure: StructureTransform2D,
): WorldCollider[] {
  if (structure.kind === "campfire") {
    return [{ kind: "circle", x: structure.x, z: structure.z, radius: 0.58 }];
  }
  if (structure.kind === "radio-beacon") {
    return [{ kind: "circle", x: structure.x, z: structure.z, radius: 0.28 }];
  }
  if (structure.kind === "torch-waymark") {
    return [{
      kind: "circle",
      x: structure.x,
      z: structure.z,
      radius: TORCH_WAYMARK_LAYOUT.colliderRadius,
    }];
  }
  if (structure.kind === "shelter") {
    return [-1.3, 1.3].map((poleX) => {
      const pole = localToWorldPoint(structure, poleX, 0);
      return { kind: "circle" as const, x: pole.x, z: pole.z, radius: 0.16 };
    });
  }
  if (structure.kind === "rain-collector") {
    return RAIN_COLLECTOR_LAYOUT.legPositions.map((leg) => {
      const point = localToWorldPoint(structure, leg.x, leg.z);
      return {
        kind: "circle" as const,
        x: point.x,
        z: point.z,
        radius: RAIN_COLLECTOR_LAYOUT.legRadius,
      };
    });
  }
  const halfLength = structure.kind === "bed" ? 1.18 : 0.88;
  const radius = structure.kind === "bed" ? 0.55 : 0.24;
  const start = localToWorldPoint(structure, -halfLength + radius, 0);
  const end = localToWorldPoint(structure, halfLength - radius, 0);
  return [{
    kind: "capsule",
    startX: start.x,
    startZ: start.z,
    endX: end.x,
    endZ: end.z,
    radius,
  }];
}

/**
 * Ground-level collision follows the visible model: a shelter remains
 * enterable and only its support poles block, while the bed, fire, and mast
 * have solid footprints.
 */
export function isPointBlockedByStructure(
  structure: StructureTransform2D,
  x: number,
  z: number,
  padding = 0.28,
): boolean {
  return structureWorldColliders(structure).some((collider) =>
    isPointBlocked(collider, x, z, padding),
  );
}

export function structurePlacementsOverlap(
  left: StructureTransform2D,
  right: StructureTransform2D,
  gap = 0.18,
): boolean {
  const shelterInteriorPair =
    (left.kind === "shelter" &&
      (right.kind === "campfire" ||
        right.kind === "bed" ||
        right.kind === "smoking-rack" ||
        right.kind === "rain-collector" ||
        right.kind === "torch-waymark")) ||
    (right.kind === "shelter" &&
      (left.kind === "campfire" ||
        left.kind === "bed" ||
        left.kind === "smoking-rack" ||
        left.kind === "rain-collector" ||
        left.kind === "torch-waymark"));
  if (shelterInteriorPair) return false;
  return (
    Math.hypot(left.x - right.x, left.z - right.z) <
    structurePlacementRadius(left.kind) +
      structurePlacementRadius(right.kind) +
      gap
  );
}
