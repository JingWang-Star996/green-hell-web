import type { WorldEntity } from "./types";

export type RockSize = "small" | "medium" | "large";
export type RockLifecycle = "intact" | "partial" | "exhausted";

export type RockMiningProfile = Readonly<{
  bodyScale: Readonly<{ x: number; y: number; z: number }>;
  anchorHeight: number;
  workSeconds: number;
  staminaCost: number;
  durabilityCost: number;
}>;

export type RockInteractionGeometry = Readonly<{
  bodyScale: Readonly<{ x: number; y: number; z: number }>;
  anchor: Readonly<{ x: number; z: number; height: number }>;
  colliderRadius: number;
  interactRadius: number;
}>;

export type RockGeometrySource = Readonly<{
  x?: number;
  z?: number;
  scale?: number;
  size?: string;
  position?: Readonly<{ x: number; z: number }>;
  transform?: Readonly<{ x: number; z: number; scale?: number }>;
  semantic?: Readonly<{ size?: string; scale?: number }>;
  morphology?: Readonly<{ size?: string }>;
}>;

/**
 * Size is the readable hardness signal: the one current stone pick can mine
 * every rock, while larger outcrops take more time, stamina and tool wear.
 * Scales describe radii for the shared unit dodecahedron geometry.
 */
export const ROCK_MINING_PROFILES: Readonly<Record<RockSize, RockMiningProfile>> = {
  small: {
    bodyScale: { x: 0.43, y: 0.26, z: 0.38 },
    anchorHeight: 0.3,
    workSeconds: 3.5,
    staminaCost: 2,
    durabilityCost: 1,
  },
  medium: {
    bodyScale: { x: 0.72, y: 0.47, z: 0.62 },
    anchorHeight: 0.55,
    workSeconds: 4.5,
    staminaCost: 3,
    durabilityCost: 1,
  },
  large: {
    bodyScale: { x: 1.2, y: 0.78, z: 1 },
    anchorHeight: 0.9,
    workSeconds: 6,
    staminaCost: 4,
    durabilityCost: 2,
  },
};

export function rockSize(source: RockGeometrySource): RockSize {
  const value = source.semantic?.size ?? source.morphology?.size ?? source.size;
  return value === "medium" || value === "large" ? value : "small";
}

/** Keeps legacy 0.55..1.45 rock transforms inside the new readable bands. */
export function controlledRockScale(source: RockGeometrySource): number {
  const raw = source.transform?.scale ?? source.semantic?.scale ?? source.scale ?? 1;
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0.9, Math.min(1.1, raw));
}

export function rockMiningProfile(source: RockGeometrySource): RockMiningProfile {
  return ROCK_MINING_PROFILES[rockSize(source)];
}

/** Pure geometry contract shared by simulation, UI projection and renderer. */
export function rockInteractionGeometry(
  source: RockGeometrySource,
): RockInteractionGeometry {
  const profile = rockMiningProfile(source);
  const scale = controlledRockScale(source);
  const x = source.transform?.x ?? source.position?.x ?? source.x ?? 0;
  const z = source.transform?.z ?? source.position?.z ?? source.z ?? 0;
  const bodyScale = {
    x: profile.bodyScale.x * scale,
    y: profile.bodyScale.y * scale,
    z: profile.bodyScale.z * scale,
  };
  const colliderRadius = Math.max(bodyScale.x, bodyScale.z) * 0.9;
  return {
    bodyScale,
    anchor: { x, z, height: profile.anchorHeight * scale },
    colliderRadius,
    interactRadius: colliderRadius + 2,
  };
}

export function rockLifecycle(
  quantity: number,
  baselineQuantity: number,
): RockLifecycle {
  if (Math.max(0, Math.floor(quantity)) <= 0) return "exhausted";
  return quantity >= Math.max(1, Math.floor(baselineQuantity))
    ? "intact"
    : "partial";
}

export function isMineableRockEntity(entity: WorldEntity): boolean {
  return entity.semantic?.category === "mineable-rock";
}

/**
 * Old runtime saves may still contain tier-two/flint/clay promises. Normalize
 * those derived facts while preserving stable id, position and quantity.
 */
export function normalizeMineableRockRuntime(entity: WorldEntity): void {
  if (!isMineableRockEntity(entity) || !entity.semantic) return;
  entity.itemId = "stone";
  entity.semantic.action = "mine";
  entity.semantic.toolClass = "pick";
  entity.semantic.toolTier = 1;
  entity.semantic.primaryMaterial = "stone";
  entity.semantic.scale = controlledRockScale(entity);
  entity.interactRadius = rockInteractionGeometry(entity).interactRadius;
  entity.depleted = entity.quantity <= 0;
  delete entity.regeneration;
}
