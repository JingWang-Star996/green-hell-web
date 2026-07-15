/**
 * Torch waymarks can be numerous, but only a tiny, fixed pool may cast real
 * light. This module only selects which authoritative waymarks borrow that
 * pool; it deliberately has no Three.js dependency and creates no renderer
 * objects, materials, or lights.
 */

export const TORCH_WAYMARK_ACTIVE_LIGHT_LIMIT = 3;
export const TORCH_WAYMARK_LIGHT_ID_MAX_LENGTH = 160;

export interface TorchWaymarkLightCandidate {
  /** Stable placed-structure identity. Duplicate identities fail closed. */
  id: string;
  x: number;
  z: number;
  lit: boolean;
  totalFuelSeconds: number;
  /** Result of the renderer's current camera-frustum visibility check. */
  inFrustum: boolean;
}

export interface TorchWaymarkLightObserver {
  x: number;
  z: number;
}

function hasValidIdentity(candidate: unknown): candidate is { id: string } {
  if (typeof candidate !== "object" || candidate === null) return false;
  const id = (candidate as { id?: unknown }).id;
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.trim() === id &&
    id.length <= TORCH_WAYMARK_LIGHT_ID_MAX_LENGTH
  );
}

function isEligibleCandidate(
  candidate: unknown,
): candidate is TorchWaymarkLightCandidate {
  if (!hasValidIdentity(candidate)) return false;
  const value = candidate as Partial<TorchWaymarkLightCandidate>;
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.z) &&
    value.lit === true &&
    Number.isFinite(value.totalFuelSeconds) &&
    (value.totalFuelSeconds ?? 0) > 0 &&
    typeof value.inFrustum === "boolean"
  );
}

function stableIdCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function horizontalDistanceSquared(
  candidate: Pick<TorchWaymarkLightCandidate, "x" | "z">,
  observer: TorchWaymarkLightObserver,
): number {
  const dx = candidate.x - observer.x;
  const dz = candidate.z - observer.z;
  return dx * dx + dz * dz;
}

/**
 * Selects at most three candidates for an already-created renderer light pool.
 *
 * Camera-visible candidates win before offscreen candidates. Within either
 * lane, the nearest horizontal distance wins, followed by stable identity so
 * the same authoritative frame produces the same assignment after save/load
 * or input reordering. Returned entries are the original candidate references.
 */
export function selectTorchWaymarkLightAssignments<
  Candidate extends TorchWaymarkLightCandidate,
>(
  candidates: readonly Candidate[] | null | undefined,
  observer: TorchWaymarkLightObserver | null | undefined,
): Candidate[] {
  if (
    !Array.isArray(candidates) ||
    !observer ||
    !Number.isFinite(observer.x) ||
    !Number.isFinite(observer.z)
  ) {
    return [];
  }

  const identityCounts = new Map<string, number>();
  for (const candidate of candidates as readonly unknown[]) {
    if (!isEligibleCandidate(candidate)) continue;
    identityCounts.set(candidate.id, (identityCounts.get(candidate.id) ?? 0) + 1);
  }

  return (candidates as readonly unknown[])
    .filter(
      (candidate): candidate is Candidate =>
        isEligibleCandidate(candidate) && identityCounts.get(candidate.id) === 1,
    )
    .sort((left, right) => {
      if (left.inFrustum !== right.inFrustum) {
        return left.inFrustum ? -1 : 1;
      }
      return (
        horizontalDistanceSquared(left, observer) -
          horizontalDistanceSquared(right, observer) ||
        stableIdCompare(left.id, right.id)
      );
    })
    .slice(0, TORCH_WAYMARK_ACTIVE_LIGHT_LIMIT);
}
