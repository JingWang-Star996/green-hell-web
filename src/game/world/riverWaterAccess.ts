import {
  resolveBoundPhysicalHit,
  type BoundHitResult,
  type HitShape,
  type HitSweep,
} from "./hitGeometry";

export const WATER_REACH_ORIGIN_HEIGHT = 1.12;
export const WATER_REACH_RADIUS = 0.12;

export type WaterReachPose = Readonly<{
  playerX: number;
  playerZ: number;
  playerGroundY: number;
  targetId: string;
  targetX: number;
  targetZ: number;
  targetSurfaceY: number;
}>;

/**
 * Analytic hand-to-surface volume. Authored water and ephemeral river targets
 * use the same reach; no renderer ray or building placement envelope is
 * authoritative at command settlement.
 */
export function buildWaterReachSweep(pose: WaterReachPose): HitSweep {
  return {
    startX: pose.playerX,
    startY: pose.playerGroundY + WATER_REACH_ORIGIN_HEIGHT,
    startZ: pose.playerZ,
    endX: pose.targetX,
    endY: pose.targetSurfaceY + 0.04,
    endZ: pose.targetZ,
    radius: WATER_REACH_RADIUS,
  };
}

export function waterReachTargetShape(pose: WaterReachPose): HitShape {
  return {
    id: pose.targetId,
    collider: {
      kind: "circle",
      x: pose.targetX,
      z: pose.targetZ,
      radius: 0.2,
    },
    minimumY: pose.targetSurfaceY - 0.14,
    maximumY: pose.targetSurfaceY + 0.14,
  };
}

/** Shared bounded 2.5D first-entry query for water command settlement. */
export function resolveWaterReach(
  pose: WaterReachPose,
  blockers: Iterable<HitShape>,
): BoundHitResult {
  return resolveBoundPhysicalHit(
    buildWaterReachSweep(pose),
    waterReachTargetShape(pose),
    blockers,
  );
}
