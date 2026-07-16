import type { EcologyRenderProjection } from "../ecology";
import {
  authoredWorldColliders,
  isPointBlocked,
  type WorldCollider,
} from "../world/interactionGeometry";
import {
  buildPhysicalHitSweep,
  hitProfileFor,
  resolveBoundPhysicalHit,
  type BoundHitResult,
  type HitShape,
  type HitSweep,
  type PhysicalActionId,
} from "../world/hitGeometry";
import {
  buildPredatorContactSweep,
  predatorContactPlayerShape,
  resolvePredatorContact,
  type PredatorContactPose,
} from "../world/predatorContact";
import {
  buildWaterReachSweep,
  resolveWaterReach,
  waterReachTargetShape,
  type WaterReachPose,
} from "../world/riverWaterAccess";
import { terrainHeight } from "../world/terrain";
import { resolveAffordance, resolveWildlifeAffordance } from "./affordances";
import { isMineableRockEntity, rockInteractionGeometry } from "./rockHarvest";
import {
  STRUCTURE_KINDS,
  structureWorldColliders,
} from "./structureGeometry";
import {
  isTreeEntity,
  treeFallenGeometry,
  treeInteractionAnchor,
  treeHarvestPhase,
} from "./treeHarvest";
import type { GameState, WorldEntity } from "./types";
import { getCampStructureTransforms } from "./selectors";

export type PhysicalHitValidationResult =
  | Readonly<{
      ok: true;
      actionId: PhysicalActionId;
      targetId: string;
      hit: Extract<BoundHitResult, { ok: true }>;
    }>
  | Readonly<{
      ok: false;
      reason:
        | "stale-pose"
        | "invalid-pose"
        | "target-unavailable"
        | "action-mismatch"
        | Extract<BoundHitResult, { ok: false }>["reason"];
      targetId: string;
      blockerId?: string;
    }>;

export type ActiveHitBlockerOptions = Readonly<{
  /** Harvest anchors generated inside a large source mesh stay usable. */
  ignoreBlockersContainingTarget?: boolean;
  /** Broad-phase padding around the analytic sweep. */
  boundsPadding?: number;
}>;

export function validateEntityPhysicalHit(
  state: GameState,
  entity: WorldEntity,
  actionId: PhysicalActionId,
  poseRevision: number,
): PhysicalHitValidationResult {
  const preflight = validatePoseRevision(state, entity.id, poseRevision);
  if (preflight) return preflight;
  const affordance = resolveAffordance(state, entity);
  if (affordance.state === "depleted" || affordance.state === "ambient") {
    return { ok: false, reason: "target-unavailable", targetId: entity.id };
  }
  if (affordance.actionId !== actionId) {
    return { ok: false, reason: "action-mismatch", targetId: entity.id };
  }
  const target = entityHitShape(entity);
  if (!target) {
    return { ok: false, reason: "target-unavailable", targetId: entity.id };
  }
  return validateGeometry(state, target, actionId);
}

export function validateWildlifePhysicalHit(
  state: GameState,
  wildlife: EcologyRenderProjection,
  actionId: PhysicalActionId,
  poseRevision: number,
): PhysicalHitValidationResult {
  const targetId = `wildlife:${wildlife.individualId}`;
  const preflight = validatePoseRevision(state, targetId, poseRevision);
  if (preflight) return preflight;
  const affordance = resolveWildlifeAffordance(state, wildlife);
  if (
    affordance.state === "depleted" ||
    affordance.state === "ambient" ||
    wildlife.health <= 0 ||
    !wildlife.visible
  ) {
    return { ok: false, reason: "target-unavailable", targetId };
  }
  if (actionId !== "attack" || affordance.actionId !== actionId) {
    return { ok: false, reason: "action-mismatch", targetId };
  }
  return validateGeometry(state, wildlifeHitShape(wildlife), actionId);
}

/**
 * Authoritative predator contact endpoint. It shares the same deterministic
 * first-entry query and active-world blocker truth as player physical hits.
 */
export function validateWildlifeContactHit(
  state: GameState,
  wildlife: EcologyRenderProjection,
): BoundHitResult {
  const pose = wildlifeContactPose(state, wildlife);
  const sweep = buildPredatorContactSweep(pose);
  const target = predatorContactPlayerShape(pose);
  return resolvePredatorContact(
    pose,
    activeWorldHitBlockers(state, sweep, target, {
      ignoreBlockersContainingTarget: false,
      boundsPadding: 0.12,
    }),
  );
}

/** Shared active-world reach truth for authored and ephemeral water targets. */
export function validateWaterReachHit(
  state: GameState,
  pose: WaterReachPose,
): BoundHitResult {
  const sweep = buildWaterReachSweep(pose);
  const target = waterReachTargetShape(pose);
  return resolveWaterReach(
    pose,
    activeWorldHitBlockers(state, sweep, target, {
      ignoreBlockersContainingTarget: false,
      boundsPadding: 0.12,
    }),
  );
}

function validatePoseRevision(
  state: GameState,
  targetId: string,
  poseRevision: number,
): Extract<PhysicalHitValidationResult, { ok: false }> | null {
  const currentRevision = Math.max(0, Math.floor(state.player.poseRevision ?? 0));
  if (!Number.isSafeInteger(poseRevision) || poseRevision !== currentRevision) {
    return { ok: false, reason: "stale-pose", targetId };
  }
  if (
    !Number.isFinite(state.player.position.x) ||
    !Number.isFinite(state.player.position.z) ||
    !Number.isFinite(state.player.lookYaw) ||
    !Number.isFinite(state.player.lookPitch)
  ) {
    return { ok: false, reason: "invalid-pose", targetId };
  }
  return null;
}

function validateGeometry(
  state: GameState,
  target: HitShape,
  actionId: PhysicalActionId,
): PhysicalHitValidationResult {
  const sweep = buildPhysicalHitSweep(
    {
      x: state.player.position.x,
      z: state.player.position.z,
      groundY: terrainHeight(state.player.position.x, state.player.position.z),
      yaw: state.player.lookYaw!,
      pitch: state.player.lookPitch!,
    },
    hitProfileFor(actionId),
  );
  const hit = resolveBoundPhysicalHit(
    sweep,
    target,
    activeWorldHitBlockers(state, sweep, target),
  );
  if (!hit.ok) {
    return {
      ok: false,
      reason: hit.reason,
      targetId: target.id,
      ...(hit.blocker ? { blockerId: hit.blocker.id } : {}),
    };
  }
  return { ok: true, actionId, targetId: target.id, hit };
}

export function entityHitShape(entity: WorldEntity): HitShape | null {
  const ground = terrainHeight(entity.position.x, entity.position.z);
  if (isTreeEntity(entity)) {
    const anchor = treeInteractionAnchor(entity);
    const phase = treeHarvestPhase(entity);
    const scale = finiteScale(entity.semantic?.scale);
    const radius = phase === "standing"
      ? (entity.semantic?.size === "large" ? 0.48 : 0.36) * scale
      : 0.46;
    return {
      id: entity.id,
      collider: { kind: "circle", x: anchor.x, z: anchor.z, radius },
      minimumY: ground,
      maximumY:
        phase === "standing"
          ? ground + Math.max(3.2, 5.2 * scale)
          : ground + Math.max(1.02, anchor.height + 0.42),
    };
  }
  if (isMineableRockEntity(entity)) {
    const geometry = rockInteractionGeometry(entity);
    return {
      id: entity.id,
      collider: {
        kind: "circle",
        x: geometry.anchor.x,
        z: geometry.anchor.z,
        radius: geometry.colliderRadius,
      },
      minimumY: ground,
      maximumY: ground + Math.max(0.82, geometry.bodyScale.y * 2),
    };
  }
  if (entity.semantic?.category === "harvestable-plant") {
    const scale = finiteScale(entity.semantic.scale);
    return {
      id: entity.id,
      collider: {
        kind: "circle",
        x: entity.position.x,
        z: entity.position.z,
        radius: Math.max(0.24, Math.min(0.58, 0.34 * scale)),
      },
      minimumY: ground,
      maximumY: ground + Math.max(0.9, 1.25 * scale),
    };
  }
  return null;
}

export function wildlifeHitShape(wildlife: EcologyRenderProjection): HitShape {
  const ground = terrainHeight(wildlife.position.x, wildlife.position.z);
  const viper = wildlife.speciesId === "coiled-viper";
  const radius = viper
    ? 0.38
    : wildlife.role === "large-herbivore"
      ? 0.82
      : wildlife.role === "small-prey"
        ? 0.28
        : 0.56;
  const height = viper
    ? 0.38
    : wildlife.role === "large-herbivore"
      ? 1.7
      : wildlife.role === "small-prey"
        ? 0.65
        : 1.15;
  return {
    id: `wildlife:${wildlife.individualId}`,
    collider: {
      kind: "circle",
      x: wildlife.position.x,
      z: wildlife.position.z,
      radius: radius * finiteScale(wildlife.scale),
    },
    minimumY: ground,
    maximumY: ground + Math.max(0.88, height * finiteScale(wildlife.scale)),
  };
}

export function* activeWorldHitBlockers(
  state: GameState,
  sweep: HitSweep,
  target: HitShape,
  options: ActiveHitBlockerOptions = {},
): Iterable<HitShape> {
  const ignoreContainingTarget =
    options.ignoreBlockersContainingTarget ?? true;
  const targetCenter = ignoreContainingTarget ? hitShapeCenter(target) : null;
  const padding = Math.max(0, options.boundsPadding ?? 7);
  const minimumX = Math.min(sweep.startX, sweep.endX) - sweep.radius - padding;
  const maximumX = Math.max(sweep.startX, sweep.endX) + sweep.radius + padding;
  const minimumZ = Math.min(sweep.startZ, sweep.endZ) - sweep.radius - padding;
  const maximumZ = Math.max(sweep.startZ, sweep.endZ) + sweep.radius + padding;

  const authored = authoredWorldColliders();
  for (let index = 0; index < authored.length; index += 1) {
    const collider = authored[index];
    if (!colliderNearBounds(collider, minimumX, maximumX, minimumZ, maximumZ)) {
      continue;
    }
    if (
      targetCenter &&
      isPointBlocked(collider, targetCenter.x, targetCenter.z, 0.02)
    ) continue;
    yield {
      id: `authored:${index}`,
      collider,
      minimumY: -20,
      maximumY: index === 0 ? 3 : 4.5,
    };
  }

  for (const kind of STRUCTURE_KINDS) {
    for (const structure of getCampStructureTransforms(state, kind)) {
      const ground = terrainHeight(structure.x, structure.z);
      for (const [index, collider] of structureWorldColliders(structure).entries()) {
        if (!colliderNearBounds(collider, minimumX, maximumX, minimumZ, maximumZ)) {
          continue;
        }
        if (
          targetCenter &&
          isPointBlocked(collider, targetCenter.x, targetCenter.z, 0.02)
        ) {
          continue;
        }
        yield {
          id: `${structure.id}:part:${index}`,
          collider,
          minimumY: ground,
          maximumY: ground + structureBlockerHeight(kind),
        };
      }
    }
  }

  for (const entity of Object.values(state.world.entities)) {
    if (entity.id === target.id) continue;
    let collider: WorldCollider | null = null;
    let maximumHeight = 0;
    if (isTreeEntity(entity)) {
      const phase = treeHarvestPhase(entity);
      const fallen = phase === "standing" ? null : treeFallenGeometry(entity);
      collider = fallen
        ? {
            kind: "capsule",
            startX: fallen.start.x,
            startZ: fallen.start.z,
            endX: fallen.end.x,
            endZ: fallen.end.z,
            radius: fallen.radius,
          }
        : {
            kind: "circle",
            x: entity.position.x,
            z: entity.position.z,
            radius: phase === "standing" ? 0.5 * finiteScale(entity.semantic?.scale) : 0.24,
          };
      maximumHeight = phase === "standing" ? 8 : 1.2;
    } else if (isMineableRockEntity(entity) && !entity.depleted) {
      const geometry = rockInteractionGeometry(entity);
      collider = {
        kind: "circle",
        x: geometry.anchor.x,
        z: geometry.anchor.z,
        radius: geometry.colliderRadius,
      };
      maximumHeight = Math.max(0.42, geometry.bodyScale.y * 2);
    }
    if (
      !collider ||
      !colliderNearBounds(collider, minimumX, maximumX, minimumZ, maximumZ)
    ) {
      continue;
    }
    if (
      targetCenter &&
      isPointBlocked(collider, targetCenter.x, targetCenter.z, 0.02)
    ) continue;
    const ground = terrainHeight(entity.position.x, entity.position.z);
    yield {
      id: entity.id,
      collider,
      minimumY: ground,
      maximumY: ground + maximumHeight,
    };
  }
}

function wildlifeContactPose(
  state: GameState,
  wildlife: EcologyRenderProjection,
): PredatorContactPose {
  return {
    predatorX: wildlife.position.x,
    predatorZ: wildlife.position.z,
    predatorGroundY: terrainHeight(wildlife.position.x, wildlife.position.z),
    playerX: state.player.position.x,
    playerZ: state.player.position.z,
    playerGroundY: terrainHeight(
      state.player.position.x,
      state.player.position.z,
    ),
    speciesId: wildlife.speciesId,
    scale: wildlife.scale,
  };
}

function hitShapeCenter(shape: HitShape): { x: number; z: number } {
  if (shape.collider.kind === "circle" || shape.collider.kind === "box") {
    return { x: shape.collider.x, z: shape.collider.z };
  }
  return {
    x: (shape.collider.startX + shape.collider.endX) / 2,
    z: (shape.collider.startZ + shape.collider.endZ) / 2,
  };
}

function colliderNearBounds(
  collider: WorldCollider,
  minimumX: number,
  maximumX: number,
  minimumZ: number,
  maximumZ: number,
): boolean {
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

function structureBlockerHeight(kind: (typeof STRUCTURE_KINDS)[number]): number {
  if (kind === "campfire") return 0.55;
  if (kind === "bed") return 0.75;
  if (kind === "radio-beacon") return 3.1;
  if (kind === "smoking-rack") return 1.75;
  if (kind === "rain-collector") return 1.35;
  return 2.65;
}

function finiteScale(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0.35, Math.min(2, value!)) : 1;
}
