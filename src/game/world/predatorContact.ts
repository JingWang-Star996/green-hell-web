import {
  resolveBoundPhysicalHit,
  type BoundHitResult,
  type HitShape,
  type HitSweep,
} from "./hitGeometry";
import type { WorldCollider } from "./interactionGeometry";

export const PREDATOR_CONTACT_RANGE = 1.65;
export const PREDATOR_CONTACT_RESET_RANGE = 4.5;
export const PREDATOR_CONTACT_TARGET_ID = "player:contact-body";

export type PredatorContactPose = Readonly<{
  predatorX: number;
  predatorZ: number;
  predatorGroundY: number;
  playerX: number;
  playerZ: number;
  playerGroundY: number;
  speciesId: string;
  scale?: number;
}>;

/**
 * The contact volume is analytic and has no dependency on the animated mesh.
 * Renderer anticipation and simulation commit both reproduce this exact sweep.
 */
export function buildPredatorContactSweep(
  pose: PredatorContactPose,
): HitSweep {
  const scale = finiteScale(pose.scale);
  const viper = pose.speciesId === "coiled-viper";
  return {
    startX: pose.predatorX,
    startY:
      pose.predatorGroundY + (viper ? 0.22 : 0.5) * scale,
    startZ: pose.predatorZ,
    endX: pose.playerX,
    endY: pose.playerGroundY + (viper ? 0.46 : 0.72),
    endZ: pose.playerZ,
    radius: (viper ? 0.2 : 0.3) * scale,
  };
}

export function predatorContactPlayerShape(
  pose: Pick<PredatorContactPose, "playerX" | "playerZ" | "playerGroundY">,
): HitShape {
  return {
    id: PREDATOR_CONTACT_TARGET_ID,
    collider: {
      kind: "circle",
      x: pose.playerX,
      z: pose.playerZ,
      radius: 0.34,
    },
    minimumY: pose.playerGroundY,
    maximumY: pose.playerGroundY + 1.82,
  };
}

/** Shared first-entry query used for preview cancellation and commit truth. */
export function resolvePredatorContact(
  pose: PredatorContactPose,
  blockers: Iterable<HitShape>,
): BoundHitResult {
  return resolveBoundPhysicalHit(
    buildPredatorContactSweep(pose),
    predatorContactPlayerShape(pose),
    blockers,
  );
}

/** Cheap broad phase that keeps the bounded first-entry query local. */
export function colliderNearContactSweep(
  collider: WorldCollider,
  sweep: HitSweep,
  padding = 0.12,
): boolean {
  const minimumX = Math.min(sweep.startX, sweep.endX) - sweep.radius - padding;
  const maximumX = Math.max(sweep.startX, sweep.endX) + sweep.radius + padding;
  const minimumZ = Math.min(sweep.startZ, sweep.endZ) - sweep.radius - padding;
  const maximumZ = Math.max(sweep.startZ, sweep.endZ) + sweep.radius + padding;
  if (collider.kind === "circle") {
    return (
      collider.x + collider.radius >= minimumX &&
      collider.x - collider.radius <= maximumX &&
      collider.z + collider.radius >= minimumZ &&
      collider.z - collider.radius <= maximumZ
    );
  }
  if (collider.kind === "box") {
    return (
      collider.x + collider.halfWidth >= minimumX &&
      collider.x - collider.halfWidth <= maximumX &&
      collider.z + collider.halfDepth >= minimumZ &&
      collider.z - collider.halfDepth <= maximumZ
    );
  }
  return (
    Math.max(collider.startX, collider.endX) + collider.radius >= minimumX &&
    Math.min(collider.startX, collider.endX) - collider.radius <= maximumX &&
    Math.max(collider.startZ, collider.endZ) + collider.radius >= minimumZ &&
    Math.min(collider.startZ, collider.endZ) - collider.radius <= maximumZ
  );
}

export function predatorContactBlockerShape(
  id: string,
  collider: WorldCollider,
  minimumY = -20,
  maximumY = 20,
): HitShape {
  return { id, collider, minimumY, maximumY };
}

function finiteScale(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0.35, Math.min(2, value!)) : 1;
}
