import type { WorldCollider } from "./interactionGeometry";

export type PhysicalActionId = "cut" | "chop" | "mine" | "attack";

export type HitProfile = Readonly<{
  actionId: PhysicalActionId;
  reach: number;
  radius: number;
  originHeight: number;
  startForwardOffset: number;
  maximumWindupDrift: number;
  maximumWindupTurnRadians: number;
  maximumWindupPitchRadians: number;
}>;

export type HitPose = Readonly<{
  x: number;
  z: number;
  groundY: number;
  yaw: number;
  pitch: number;
}>;

export type HitSweep = Readonly<{
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  radius: number;
}>;

export type HitShape = Readonly<{
  id: string;
  collider: WorldCollider;
  minimumY: number;
  maximumY: number;
  blocksHit?: boolean;
}>;

export type HitEntry = Readonly<{
  id: string;
  entry: number;
}>;

export type NearestBlockerResult = Readonly<{
  hit: HitEntry | null;
  scanned: number;
  truncated: boolean;
}>;

export type BoundHitResult =
  | Readonly<{
      ok: true;
      targetEntry: number;
      blocker: null;
      scanned: number;
    }>
  | Readonly<{
      ok: false;
      reason: "target-missed" | "occluded" | "geometry-budget";
      targetEntry: number | null;
      blocker: HitEntry | null;
      scanned: number;
    }>;

const TWO_PI = Math.PI * 2;
const GEOMETRY_EPSILON = 1e-7;
export const MAX_HIT_BLOCKER_SHAPES = 512;
export const HIT_OCCLUSION_EPSILON = 1e-4;

export const PHYSICAL_HIT_PROFILES: Readonly<
  Record<PhysicalActionId, HitProfile>
> = {
  cut: {
    actionId: "cut",
    reach: 1.65,
    radius: 0.24,
    originHeight: 1.12,
    startForwardOffset: 0.16,
    maximumWindupDrift: 0.3,
    maximumWindupTurnRadians: degreesToRadians(20),
    maximumWindupPitchRadians: degreesToRadians(18),
  },
  chop: {
    actionId: "chop",
    reach: 2.1,
    radius: 0.32,
    originHeight: 1.18,
    startForwardOffset: 0.18,
    maximumWindupDrift: 0.35,
    maximumWindupTurnRadians: degreesToRadians(22),
    maximumWindupPitchRadians: degreesToRadians(18),
  },
  mine: {
    actionId: "mine",
    reach: 1.9,
    radius: 0.28,
    originHeight: 1.08,
    startForwardOffset: 0.16,
    maximumWindupDrift: 0.3,
    maximumWindupTurnRadians: degreesToRadians(18),
    maximumWindupPitchRadians: degreesToRadians(16),
  },
  attack: {
    actionId: "attack",
    reach: 2.75,
    radius: 0.2,
    originHeight: 1.02,
    startForwardOffset: 0.2,
    maximumWindupDrift: 0.45,
    maximumWindupTurnRadians: degreesToRadians(14),
    maximumWindupPitchRadians: degreesToRadians(14),
  },
};

export function hitProfileFor(actionId: PhysicalActionId): HitProfile {
  return PHYSICAL_HIT_PROFILES[actionId];
}

export function isPhysicalActionId(value: string): value is PhysicalActionId {
  return value === "cut" || value === "chop" || value === "mine" || value === "attack";
}

/**
 * Builds the authoritative analytic melee volume. The held-item mesh never
 * participates: both renderer preview and simulation reproduce this sweep
 * from the same normalized player pose and action profile.
 */
export function buildPhysicalHitSweep(
  pose: HitPose,
  profile: HitProfile,
): HitSweep {
  const pitch = clamp(pose.pitch, -Math.PI / 2, Math.PI / 2);
  const horizontal = Math.cos(pitch);
  const forwardX = -Math.sin(pose.yaw);
  const forwardZ = -Math.cos(pose.yaw);
  const startX = pose.x + forwardX * profile.startForwardOffset;
  const startZ = pose.z + forwardZ * profile.startForwardOffset;
  const startY = pose.groundY + profile.originHeight;
  return {
    startX,
    startY,
    startZ,
    endX: startX + forwardX * horizontal * profile.reach,
    endY: startY + Math.sin(pitch) * profile.reach,
    endZ: startZ + forwardZ * horizontal * profile.reach,
    radius: profile.radius,
  };
}

/** Returns the first normalized sweep time at which the volumes overlap. */
export function sweptCapsuleFirstEntry(
  sweep: HitSweep,
  shape: HitShape,
): number {
  if (!validShape(shape) || !validSweep(sweep)) return Number.POSITIVE_INFINITY;
  const horizontal = segmentColliderInterval(
    sweep.startX,
    sweep.startZ,
    sweep.endX,
    sweep.endZ,
    shape.collider,
    sweep.radius,
  );
  if (!horizontal) return Number.POSITIVE_INFINITY;
  const vertical = segmentSlabInterval(
    sweep.startY,
    sweep.endY,
    shape.minimumY - sweep.radius,
    shape.maximumY + sweep.radius,
  );
  if (!vertical) return Number.POSITIVE_INFINITY;
  const entry = Math.max(horizontal.entry, vertical.entry);
  const exit = Math.min(horizontal.exit, vertical.exit);
  return entry <= exit + GEOMETRY_EPSILON
    ? clamp(entry, 0, 1)
    : Number.POSITIVE_INFINITY;
}

/**
 * Scans a bounded active-world shape list without sorting or allocating a
 * second list. A truncated query fails closed at the simulation boundary.
 */
export function nearestBlockingEntry(
  sweep: HitSweep,
  blockers: Iterable<HitShape>,
  excludingId: string,
  maximumShapes = MAX_HIT_BLOCKER_SHAPES,
): NearestBlockerResult {
  let scanned = 0;
  let hit: HitEntry | null = null;
  for (const shape of blockers) {
    if (shape.id === excludingId || shape.blocksHit === false) continue;
    if (scanned >= maximumShapes) {
      return { hit, scanned, truncated: true };
    }
    scanned += 1;
    const entry = sweptCapsuleFirstEntry(sweep, shape);
    if (!Number.isFinite(entry) || (hit && entry >= hit.entry)) continue;
    hit = { id: shape.id, entry };
  }
  return { hit, scanned, truncated: false };
}

export function resolveBoundPhysicalHit(
  sweep: HitSweep,
  target: HitShape,
  blockers: Iterable<HitShape>,
  maximumShapes = MAX_HIT_BLOCKER_SHAPES,
): BoundHitResult {
  const targetEntry = sweptCapsuleFirstEntry(sweep, target);
  if (!Number.isFinite(targetEntry)) {
    return {
      ok: false,
      reason: "target-missed",
      targetEntry: null,
      blocker: null,
      scanned: 0,
    };
  }
  const nearest = nearestBlockingEntry(
    sweep,
    blockers,
    target.id,
    maximumShapes,
  );
  if (nearest.truncated) {
    return {
      ok: false,
      reason: "geometry-budget",
      targetEntry,
      blocker: nearest.hit,
      scanned: nearest.scanned,
    };
  }
  if (
    nearest.hit &&
    nearest.hit.entry + HIT_OCCLUSION_EPSILON < targetEntry
  ) {
    return {
      ok: false,
      reason: "occluded",
      targetEntry,
      blocker: nearest.hit,
      scanned: nearest.scanned,
    };
  }
  return {
    ok: true,
    targetEntry,
    blocker: null,
    scanned: nearest.scanned,
  };
}

export function shortestAngleDelta(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.POSITIVE_INFINITY;
  }
  const wrapped = ((right - left + Math.PI) % TWO_PI + TWO_PI) % TWO_PI;
  return wrapped - Math.PI;
}

export function hitPoseWithinWindupTolerance(
  start: Pick<HitPose, "x" | "z" | "yaw" | "pitch">,
  current: Pick<HitPose, "x" | "z" | "yaw" | "pitch">,
  profile: HitProfile,
): boolean {
  return (
    Math.hypot(current.x - start.x, current.z - start.z) <=
      profile.maximumWindupDrift + GEOMETRY_EPSILON &&
    Math.abs(shortestAngleDelta(start.yaw, current.yaw)) <=
      profile.maximumWindupTurnRadians + GEOMETRY_EPSILON &&
    Math.abs(shortestAngleDelta(start.pitch, current.pitch)) <=
      profile.maximumWindupPitchRadians + GEOMETRY_EPSILON
  );
}

type SegmentInterval = Readonly<{ entry: number; exit: number }>;

function segmentColliderInterval(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  collider: WorldCollider,
  inflation: number,
): SegmentInterval | null {
  if (collider.kind === "circle") {
    return segmentCircleInterval(
      startX,
      startZ,
      endX,
      endZ,
      collider.x,
      collider.z,
      collider.radius + inflation,
    );
  }
  if (collider.kind === "box") {
    return segmentAabbInterval(
      startX,
      startZ,
      endX,
      endZ,
      collider.x - collider.halfWidth - inflation,
      collider.x + collider.halfWidth + inflation,
      collider.z - collider.halfDepth - inflation,
      collider.z + collider.halfDepth + inflation,
    );
  }
  return segmentCapsuleInterval(
    startX,
    startZ,
    endX,
    endZ,
    collider.startX,
    collider.startZ,
    collider.endX,
    collider.endZ,
    collider.radius + inflation,
  );
}

function segmentCircleInterval(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  centerX: number,
  centerZ: number,
  radius: number,
): SegmentInterval | null {
  const directionX = endX - startX;
  const directionZ = endZ - startZ;
  const offsetX = startX - centerX;
  const offsetZ = startZ - centerZ;
  const a = directionX * directionX + directionZ * directionZ;
  const c = offsetX * offsetX + offsetZ * offsetZ - radius * radius;
  if (a <= GEOMETRY_EPSILON) {
    return c <= 0 ? { entry: 0, exit: 1 } : null;
  }
  const b = 2 * (offsetX * directionX + offsetZ * directionZ);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -GEOMETRY_EPSILON) return null;
  const root = Math.sqrt(Math.max(0, discriminant));
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  const entry = Math.max(0, Math.min(first, second));
  const exit = Math.min(1, Math.max(first, second));
  return entry <= exit + GEOMETRY_EPSILON ? { entry, exit } : null;
}

function segmentAabbInterval(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
): SegmentInterval | null {
  let entry = 0;
  let exit = 1;
  const starts = [startX, startZ];
  const deltas = [endX - startX, endZ - startZ];
  const minimums = [minimumX, minimumZ];
  const maximums = [maximumX, maximumZ];
  for (let axis = 0; axis < 2; axis += 1) {
    const start = starts[axis];
    const delta = deltas[axis];
    if (Math.abs(delta) <= GEOMETRY_EPSILON) {
      if (start < minimums[axis] || start > maximums[axis]) return null;
      continue;
    }
    let near = (minimums[axis] - start) / delta;
    let far = (maximums[axis] - start) / delta;
    if (near > far) [near, far] = [far, near];
    entry = Math.max(entry, near);
    exit = Math.min(exit, far);
    if (entry > exit + GEOMETRY_EPSILON) return null;
  }
  return entry <= 1 + GEOMETRY_EPSILON && exit >= -GEOMETRY_EPSILON
    ? { entry: clamp(entry, 0, 1), exit: clamp(exit, 0, 1) }
    : null;
}

/**
 * A 2D capsule is a rectangle in segment-local space plus its two circular
 * end caps. The capsule is convex, so the union of intersecting intervals is
 * one continuous interval and its minimum/maximum are the true entry/exit.
 */
function segmentCapsuleInterval(
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  capsuleStartX: number,
  capsuleStartZ: number,
  capsuleEndX: number,
  capsuleEndZ: number,
  radius: number,
): SegmentInterval | null {
  const axisX = capsuleEndX - capsuleStartX;
  const axisZ = capsuleEndZ - capsuleStartZ;
  const length = Math.hypot(axisX, axisZ);
  if (length <= GEOMETRY_EPSILON) {
    return segmentCircleInterval(
      startX,
      startZ,
      endX,
      endZ,
      capsuleStartX,
      capsuleStartZ,
      radius,
    );
  }
  const unitX = axisX / length;
  const unitZ = axisZ / length;
  const startOffsetX = startX - capsuleStartX;
  const startOffsetZ = startZ - capsuleStartZ;
  const endOffsetX = endX - capsuleStartX;
  const endOffsetZ = endZ - capsuleStartZ;
  const startAlong = startOffsetX * unitX + startOffsetZ * unitZ;
  const startAcross = -startOffsetX * unitZ + startOffsetZ * unitX;
  const endAlong = endOffsetX * unitX + endOffsetZ * unitZ;
  const endAcross = -endOffsetX * unitZ + endOffsetZ * unitX;
  const rectangle = segmentAabbInterval(
    startAlong,
    startAcross,
    endAlong,
    endAcross,
    0,
    length,
    -radius,
    radius,
  );
  const startCap = segmentCircleInterval(
    startAlong,
    startAcross,
    endAlong,
    endAcross,
    0,
    0,
    radius,
  );
  const endCap = segmentCircleInterval(
    startAlong,
    startAcross,
    endAlong,
    endAcross,
    length,
    0,
    radius,
  );
  let entry = Number.POSITIVE_INFINITY;
  let exit = Number.NEGATIVE_INFINITY;
  if (rectangle) {
    entry = Math.min(entry, rectangle.entry);
    exit = Math.max(exit, rectangle.exit);
  }
  if (startCap) {
    entry = Math.min(entry, startCap.entry);
    exit = Math.max(exit, startCap.exit);
  }
  if (endCap) {
    entry = Math.min(entry, endCap.entry);
    exit = Math.max(exit, endCap.exit);
  }
  return Number.isFinite(entry) ? { entry, exit } : null;
}

function segmentSlabInterval(
  start: number,
  end: number,
  minimum: number,
  maximum: number,
): SegmentInterval | null {
  const delta = end - start;
  if (Math.abs(delta) <= GEOMETRY_EPSILON) {
    return start >= minimum && start <= maximum
      ? { entry: 0, exit: 1 }
      : null;
  }
  let first = (minimum - start) / delta;
  let second = (maximum - start) / delta;
  if (first > second) [first, second] = [second, first];
  const entry = Math.max(0, first);
  const exit = Math.min(1, second);
  return entry <= exit + GEOMETRY_EPSILON ? { entry, exit } : null;
}

function validSweep(sweep: HitSweep): boolean {
  return (
    [
      sweep.startX,
      sweep.startY,
      sweep.startZ,
      sweep.endX,
      sweep.endY,
      sweep.endZ,
      sweep.radius,
    ].every(Number.isFinite) && sweep.radius >= 0
  );
}

function validShape(shape: HitShape): boolean {
  if (
    !shape.id ||
    !Number.isFinite(shape.minimumY) ||
    !Number.isFinite(shape.maximumY) ||
    shape.minimumY > shape.maximumY
  ) {
    return false;
  }
  const collider = shape.collider;
  if (collider.kind === "circle") {
    return (
      Number.isFinite(collider.x) &&
      Number.isFinite(collider.z) &&
      Number.isFinite(collider.radius) &&
      collider.radius >= 0
    );
  }
  if (collider.kind === "box") {
    return (
      Number.isFinite(collider.x) &&
      Number.isFinite(collider.z) &&
      Number.isFinite(collider.halfWidth) &&
      Number.isFinite(collider.halfDepth) &&
      collider.halfWidth >= 0 &&
      collider.halfDepth >= 0
    );
  }
  return (
    Number.isFinite(collider.startX) &&
    Number.isFinite(collider.startZ) &&
    Number.isFinite(collider.endX) &&
    Number.isFinite(collider.endZ) &&
    Number.isFinite(collider.radius) &&
    collider.radius >= 0
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function degreesToRadians(value: number): number {
  return (value / 180) * Math.PI;
}
