import type { TreeHarvestState } from "../sim/types";

export type InteractionAnchor = {
  x: number;
  z: number;
  height: number;
};

export type CircleCollider = {
  kind: "circle";
  x: number;
  z: number;
  radius: number;
};

export type BoxCollider = {
  kind: "box";
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
};

export type CapsuleCollider = {
  kind: "capsule";
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  radius: number;
};

export type WorldCollider = CircleCollider | BoxCollider | CapsuleCollider;

export interface RenderTreeColliderSource {
  x: number;
  z: number;
  available: boolean;
  treeHarvest?: TreeHarvestState;
}

/** Shared authored/legacy tree collider for movement, LOS and placement. */
export function renderTreeCollider(
  tree: RenderTreeColliderSource,
): WorldCollider {
  const harvest = tree.treeHarvest;
  const unfinished = Boolean(
    harvest &&
      (harvest.branches > 0 || harvest.trunkSegments > 0 || harvest.looseLog),
  );
  if (harvest && unfinished) {
    const angle = (harvest.fallDirection / 1024) * Math.PI * 2;
    const directionX = Math.cos(angle);
    const directionZ = Math.sin(angle);
    return {
      kind: "capsule",
      startX: tree.x + directionX * 0.3,
      startZ: tree.z + directionZ * 0.3,
      endX: tree.x + directionX * 3.2,
      endZ: tree.z + directionZ * 3.2,
      radius: 0.32,
    };
  }
  return {
    kind: "circle",
    x: tree.x,
    z: tree.z,
    radius: tree.available ? 0.5 : 0.24,
  };
}

export const WEATHER_STATION_LAYOUT = {
  centerX: 33,
  centerZ: 27,
  width: 4.6,
  depth: 3.6,
  height: 2.6,
  console: { x: 33.85, z: 25.02, height: 1.18 },
  battery: { x: 32, z: 25.02, height: 1.02 },
} as const;

export const SURVEY_ROCK_SHELTER_LAYOUT = {
  centerX: -35,
  centerZ: 31,
  yaw: -0.9,
  roof: { width: 4.6, depth: 3.8, thickness: 0.42, height: 2.35 },
  entrance: { width: 2.8, height: 2.05, frontZ: -1.9, clearDepth: 1.4 },
  approachLocal: { x: 0, z: -2.1 },
  cacheLocal: { x: 0.65, z: 0.55, height: 0.62 },
  cover: { halfWidth: 1.95, minimumZ: -1.35, maximumZ: 1.55 },
  walls: [
    { fromX: -2.05, fromZ: -1.25, toX: -2.05, toZ: 1.65, radius: 0.42 },
    { fromX: 2.05, fromZ: -1.25, toX: 2.05, toZ: 1.65, radius: 0.42 },
    { fromX: -2.05, fromZ: 1.65, toX: 2.05, toZ: 1.65, radius: 0.42 },
  ],
} as const;

/** Visible opening wreckage around the starting radio; the river is ~20m south. */
export const AUTHORED_WRECKAGE_COLLIDER: CircleCollider = {
  kind: "circle",
  x: 0,
  z: 3,
  radius: 3.7,
};

export function surveyShelterLocalToWorld(
  point: Readonly<{ x: number; z: number }>,
): { x: number; z: number } {
  const cosine = Math.cos(SURVEY_ROCK_SHELTER_LAYOUT.yaw);
  const sine = Math.sin(SURVEY_ROCK_SHELTER_LAYOUT.yaw);
  return {
    x:
      SURVEY_ROCK_SHELTER_LAYOUT.centerX +
      point.x * cosine +
      point.z * sine,
    z:
      SURVEY_ROCK_SHELTER_LAYOUT.centerZ -
      point.x * sine +
      point.z * cosine,
  };
}

export function surveyShelterWorldToLocal(
  point: Readonly<{ x: number; z: number }>,
): { x: number; z: number } {
  const offsetX = point.x - SURVEY_ROCK_SHELTER_LAYOUT.centerX;
  const offsetZ = point.z - SURVEY_ROCK_SHELTER_LAYOUT.centerZ;
  const cosine = Math.cos(SURVEY_ROCK_SHELTER_LAYOUT.yaw);
  const sine = Math.sin(SURVEY_ROCK_SHELTER_LAYOUT.yaw);
  return {
    x: offsetX * cosine - offsetZ * sine,
    z: offsetX * sine + offsetZ * cosine,
  };
}

export function surveyRockShelterCacheAnchor(): InteractionAnchor {
  const world = surveyShelterLocalToWorld(
    SURVEY_ROCK_SHELTER_LAYOUT.cacheLocal,
  );
  return { ...world, height: SURVEY_ROCK_SHELTER_LAYOUT.cacheLocal.height };
}

export function surveyRockShelterApproachPoint(): { x: number; z: number } {
  return surveyShelterLocalToWorld(
    SURVEY_ROCK_SHELTER_LAYOUT.approachLocal,
  );
}

export function surveyRockShelterColliders(): CapsuleCollider[] {
  return SURVEY_ROCK_SHELTER_LAYOUT.walls.map((wall) => {
    const start = surveyShelterLocalToWorld({ x: wall.fromX, z: wall.fromZ });
    const end = surveyShelterLocalToWorld({ x: wall.toX, z: wall.toZ });
    return {
      kind: "capsule",
      startX: start.x,
      startZ: start.z,
      endX: end.x,
      endZ: end.z,
      radius: wall.radius,
    };
  });
}

export function isPointShelteredBySurveyRockShelter(
  x: number,
  z: number,
): boolean {
  const local = surveyShelterWorldToLocal({ x, z });
  const cover = SURVEY_ROCK_SHELTER_LAYOUT.cover;
  return (
    Math.abs(local.x) < cover.halfWidth &&
    local.z > cover.minimumZ &&
    local.z < cover.maximumZ
  );
}

export function authoredInteractionAnchor(
  entityId: string,
  fallback: InteractionAnchor,
): InteractionAnchor {
  if (entityId === "landmark.weather-station") return { ...WEATHER_STATION_LAYOUT.console };
  if (entityId === "resource.battery.weather-station") return { ...WEATHER_STATION_LAYOUT.battery };
  if (entityId === "landmark.survey-cache") return surveyRockShelterCacheAnchor();
  if (entityId === "landmark.river-gauge") {
    return { ...fallback, height: 1.2 };
  }
  return fallback;
}

export function isPointBlocked(
  collider: WorldCollider,
  x: number,
  z: number,
  padding = 0.28,
): boolean {
  return colliderPenetrationDepth(collider, x, z, padding) > 0;
}

/**
 * Positive XZ penetration depth for one player-sized point. Keeping the
 * amount, rather than only a boolean, lets a player escape a collider that
 * appeared around them after a world-state transition (for example a felled
 * tree) without permitting movement farther into the obstacle.
 */
export function colliderPenetrationDepth(
  collider: WorldCollider,
  x: number,
  z: number,
  padding = 0.28,
): number {
  const resolvedPadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  if (collider.kind === "circle") {
    return Math.max(
      0,
      collider.radius + resolvedPadding - Math.hypot(x - collider.x, z - collider.z),
    );
  }
  if (collider.kind === "capsule") {
    const segmentX = collider.endX - collider.startX;
    const segmentZ = collider.endZ - collider.startZ;
    const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
    const projection =
      lengthSquared <= 0.000001
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((x - collider.startX) * segmentX +
                (z - collider.startZ) * segmentZ) /
                lengthSquared,
            ),
          );
    const closestX = collider.startX + segmentX * projection;
    const closestZ = collider.startZ + segmentZ * projection;
    return Math.max(
      0,
      collider.radius +
        resolvedPadding -
        Math.hypot(x - closestX, z - closestZ),
    );
  }
  const overlapX =
    collider.halfWidth + resolvedPadding - Math.abs(x - collider.x);
  const overlapZ =
    collider.halfDepth + resolvedPadding - Math.abs(z - collider.z);
  return Math.max(0, Math.min(overlapX, overlapZ));
}

/**
 * Normal movement may never enter an obstacle. If a dynamic collider already
 * contains the player, each pre-existing penetration must stay level or get
 * shallower, at least one must improve, and no new collider may be entered.
 * Comparing collider-by-collider prevents trading one obstacle for another.
 */
export function canMovePointThroughColliders(
  colliders: readonly WorldCollider[],
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
  padding = 0.28,
): boolean {
  const epsilon = 0.0001;
  let currentlyTrapped = false;
  let strictlyImproved = false;
  let nextBlocked = false;
  for (const collider of colliders) {
    const currentDepth = colliderPenetrationDepth(
      collider,
      from.x,
      from.z,
      padding,
    );
    const nextDepth = colliderPenetrationDepth(
      collider,
      to.x,
      to.z,
      padding,
    );
    if (currentDepth > epsilon) currentlyTrapped = true;
    if (nextDepth <= epsilon) {
      if (currentDepth > epsilon) strictlyImproved = true;
      continue;
    }
    nextBlocked = true;
    if (currentDepth <= epsilon || nextDepth > currentDepth + epsilon) {
      return false;
    }
    if (nextDepth < currentDepth - epsilon) strictlyImproved = true;
  }
  return !nextBlocked || (currentlyTrapped && strictlyImproved);
}

export function weatherStationCollider(): BoxCollider {
  return {
    kind: "box",
    x: WEATHER_STATION_LAYOUT.centerX,
    z: WEATHER_STATION_LAYOUT.centerZ,
    halfWidth: WEATHER_STATION_LAYOUT.width / 2,
    halfDepth: WEATHER_STATION_LAYOUT.depth / 2,
  };
}

/** Static authored collision shared by movement/focus and simulation LOS. */
export function authoredWorldColliders(): WorldCollider[] {
  return [
    { ...AUTHORED_WRECKAGE_COLLIDER },
    weatherStationCollider(),
    ...surveyRockShelterColliders(),
  ];
}

/** Returns true when a 2D world collider interrupts an interaction segment. */
export function isWorldLineOfSightBlocked(
  from: Readonly<{ x: number; z: number }>,
  to: Readonly<{ x: number; z: number }>,
  colliders: readonly WorldCollider[],
  options: Readonly<{ ignoreBlockersContainingTarget?: boolean }> = {},
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 0.0001) return false;

  for (const collider of colliders) {
    // A target embedded in its *own* authored collider (for example a wall
    // console) may remain usable from its approach side. Continuous surfaces
    // such as water request strict mode because an unrelated tree or rock can
    // legitimately contain the endpoint and still block the hand path.
    if (
      options.ignoreBlockersContainingTarget !== false &&
      isPointBlocked(collider, to.x, to.z, 0.02)
    ) {
      continue;
    }
    const hit =
      collider.kind === "circle"
        ? segmentCircleHit(from, dx, dz, lengthSquared, collider)
        : collider.kind === "capsule"
          ? segmentCapsuleHit(from, dx, dz, collider)
          : segmentBoxHit(from, dx, dz, collider);
    if (hit > 0.025 && hit < 0.9) return true;
  }
  return false;
}

function segmentCircleHit(
  from: Readonly<{ x: number; z: number }>,
  dx: number,
  dz: number,
  lengthSquared: number,
  collider: CircleCollider,
): number {
  const offsetX = from.x - collider.x;
  const offsetZ = from.z - collider.z;
  const b = 2 * (offsetX * dx + offsetZ * dz);
  const c =
    offsetX * offsetX + offsetZ * offsetZ - collider.radius * collider.radius;
  const discriminant = b * b - 4 * lengthSquared * c;
  if (discriminant < 0) return Number.POSITIVE_INFINITY;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * lengthSquared);
  if (first >= 0 && first <= 1) return first;
  const second = (-b + root) / (2 * lengthSquared);
  return second >= 0 && second <= 1 ? second : Number.POSITIVE_INFINITY;
}

function segmentBoxHit(
  from: Readonly<{ x: number; z: number }>,
  dx: number,
  dz: number,
  collider: BoxCollider,
): number {
  let minimum = 0;
  let maximum = 1;
  const axes = [
    {
      origin: from.x,
      direction: dx,
      lower: collider.x - collider.halfWidth,
      upper: collider.x + collider.halfWidth,
    },
    {
      origin: from.z,
      direction: dz,
      lower: collider.z - collider.halfDepth,
      upper: collider.z + collider.halfDepth,
    },
  ];
  for (const axis of axes) {
    if (Math.abs(axis.direction) < 0.000001) {
      if (axis.origin < axis.lower || axis.origin > axis.upper) {
        return Number.POSITIVE_INFINITY;
      }
      continue;
    }
    let near = (axis.lower - axis.origin) / axis.direction;
    let far = (axis.upper - axis.origin) / axis.direction;
    if (near > far) [near, far] = [far, near];
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return Number.POSITIVE_INFINITY;
  }
  return minimum;
}

function segmentCapsuleHit(
  from: Readonly<{ x: number; z: number }>,
  dx: number,
  dz: number,
  collider: CapsuleCollider,
): number {
  const sx = collider.endX - collider.startX;
  const sz = collider.endZ - collider.startZ;
  const wx = from.x - collider.startX;
  const wz = from.z - collider.startZ;
  const a = dx * dx + dz * dz;
  const b = dx * sx + dz * sz;
  const c = sx * sx + sz * sz;
  const d = dx * wx + dz * wz;
  const e = sx * wx + sz * wz;
  const denominator = a * c - b * b;
  let rayT = denominator > 0.000001 ? (b * e - c * d) / denominator : 0;
  rayT = Math.max(0, Math.min(1, rayT));
  let trunkT = c > 0.000001 ? (b * rayT + e) / c : 0;
  trunkT = Math.max(0, Math.min(1, trunkT));
  if (a > 0.000001) {
    rayT = Math.max(0, Math.min(1, (b * trunkT - d) / a));
  }
  const rayX = from.x + dx * rayT;
  const rayZ = from.z + dz * rayT;
  const trunkX = collider.startX + sx * trunkT;
  const trunkZ = collider.startZ + sz * trunkT;
  return Math.hypot(rayX - trunkX, rayZ - trunkZ) <= collider.radius
    ? rayT
    : Number.POSITIVE_INFINITY;
}

export function weatherStationApproachPoint(anchor: InteractionAnchor): { x: number; z: number } {
  return {
    x: anchor.x,
    z: WEATHER_STATION_LAYOUT.centerZ - WEATHER_STATION_LAYOUT.depth / 2 - 0.72,
  };
}
