import {
  RIVER_SURFACE_HALF_WIDTH,
  riverCenter,
} from "./terrain";

export const RIVER_WATER_TARGET_PREFIX = "water:river:v1:";
export const RIVER_WATER_GRID_STEP = 0.5;
export const RIVER_WATER_MIN_LANE = -4;
export const RIVER_WATER_MAX_LANE = 4;
export const RIVER_WATER_CONTAMINATION = 0.62;
export const RIVER_WATER_FOCUS_RAY_FAR = 3.5;
export const RIVER_WATER_FOCUS_HYSTERESIS = 0.08;

const CANONICAL_RIVER_ID =
  /^water:river:v1:(0|-?[1-9]\d{0,15}):(0|[1-4]|-[1-4])$/;

export interface RiverWaterTarget {
  id: string;
  qx: number;
  lane: number;
  anchor: { x: number; z: number };
}

export type RiverSurfaceRayKind = "river" | "ground" | "mud" | "occluder";

export interface RiverSurfaceRayHit {
  distance: number;
  kind: RiverSurfaceRayKind;
  point: { x: number; z: number };
}

function canonicalInteger(value: number): string | null {
  if (!Number.isSafeInteger(value)) return null;
  return Object.is(value, -0) ? "0" : String(value);
}

export function isRiverSurfacePoint(
  point: Readonly<{ x: number; z: number }>,
): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.z) &&
    Math.abs(point.z - riverCenter(point.x)) <= RIVER_SURFACE_HALF_WIDTH
  );
}

/**
 * Quantizes a real river hit to a small reversible identity. The identity is
 * ephemeral: callers may put it in a command or focus target, never in world
 * entities or save deltas.
 */
export function createRiverWaterTarget(
  point: Readonly<{ x: number; z: number }>,
): RiverWaterTarget | null {
  if (!isRiverSurfacePoint(point)) return null;
  const roundedQx = Math.round(point.x / RIVER_WATER_GRID_STEP);
  const qx = Object.is(roundedQx, -0) ? 0 : roundedQx;
  if (!Number.isSafeInteger(qx)) return null;
  const anchorX = qx * RIVER_WATER_GRID_STEP;
  if (!Number.isFinite(anchorX)) return null;
  const roundedLane = Math.round(
    (point.z - riverCenter(anchorX)) / RIVER_WATER_GRID_STEP,
  );
  const lane = Object.is(roundedLane, -0) ? 0 : roundedLane;
  if (
    !Number.isSafeInteger(lane) ||
    lane < RIVER_WATER_MIN_LANE ||
    lane > RIVER_WATER_MAX_LANE
  ) {
    return null;
  }
  const qxText = canonicalInteger(qx);
  const laneText = canonicalInteger(lane);
  if (qxText === null || laneText === null) return null;
  const id = `${RIVER_WATER_TARGET_PREFIX}${qxText}:${laneText}`;
  return {
    id,
    qx,
    lane,
    anchor: {
      x: anchorX,
      z: riverCenter(anchorX) + lane * RIVER_WATER_GRID_STEP,
    },
  };
}

/** Strict canonical decoder: malformed aliases can never smuggle coordinates. */
export function parseRiverWaterTargetId(id: string): RiverWaterTarget | null {
  if (typeof id !== "string" || !CANONICAL_RIVER_ID.test(id)) return null;
  const suffix = id.slice(RIVER_WATER_TARGET_PREFIX.length);
  const separator = suffix.lastIndexOf(":");
  if (separator <= 0) return null;
  const qx = Number(suffix.slice(0, separator));
  const lane = Number(suffix.slice(separator + 1));
  if (
    !Number.isSafeInteger(qx) ||
    !Number.isSafeInteger(lane) ||
    lane < RIVER_WATER_MIN_LANE ||
    lane > RIVER_WATER_MAX_LANE
  ) {
    return null;
  }
  const anchorX = qx * RIVER_WATER_GRID_STEP;
  if (!Number.isFinite(anchorX)) return null;
  const decoded: RiverWaterTarget = {
    id,
    qx,
    lane,
    anchor: {
      x: anchorX,
      z: riverCenter(anchorX) + lane * RIVER_WATER_GRID_STEP,
    },
  };
  const reencoded = createRiverWaterTarget(decoded.anchor);
  return reencoded?.id === id ? decoded : null;
}

/**
 * Keeps tiny centre-ray tremors inside the current 0.5m address. Crossing the
 * extended cell still produces a new ID so the action transaction can cancel
 * when the player genuinely changes water target.
 */
export function createStableRiverWaterTarget(
  point: Readonly<{ x: number; z: number }>,
  currentTargetId: string | null | undefined,
  hysteresis = RIVER_WATER_FOCUS_HYSTERESIS,
): RiverWaterTarget | null {
  if (!isRiverSurfacePoint(point)) return null;
  const current = currentTargetId
    ? parseRiverWaterTargetId(currentTargetId)
    : null;
  if (current) {
    const halfCell = RIVER_WATER_GRID_STEP / 2 + Math.max(0, hysteresis);
    const crossStreamOffset = point.z - riverCenter(point.x);
    const currentCrossStreamOffset = current.lane * RIVER_WATER_GRID_STEP;
    if (
      Math.abs(point.x - current.anchor.x) <= halfCell &&
      Math.abs(crossStreamOffset - currentCrossStreamOffset) <= halfCell
    ) {
      return current;
    }
  }
  return createRiverWaterTarget(point);
}

/**
 * Converts the centre-screen ray's nearest semantic surface into a target.
 * Ground, wet mud and blockers win when they are in front of the river.
 */
export function riverTargetFromFirstRayHit(
  hits: readonly RiverSurfaceRayHit[],
  far = RIVER_WATER_FOCUS_RAY_FAR,
  currentTargetId?: string | null,
): RiverWaterTarget | null {
  const first = hits
    .filter(
      (hit) =>
        Number.isFinite(hit.distance) && hit.distance >= 0 && hit.distance <= far,
    )
    .reduce<RiverSurfaceRayHit | null>(
      (closest, hit) => {
        if (closest === null || hit.distance < closest.distance - 0.0001) {
          return hit;
        }
        if (
          Math.abs(hit.distance - closest.distance) <= 0.0001 &&
          closest.kind === "river" &&
          hit.kind !== "river"
        ) {
          return hit;
        }
        return closest;
      },
      null,
    );
  if (!first || first.kind !== "river") return null;
  return createStableRiverWaterTarget(first.point, currentTargetId);
}
