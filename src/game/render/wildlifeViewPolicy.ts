import type {
  EcologyRenderProjection,
  EcologyVector3,
} from "../ecology";

export const WILDLIFE_VIEW_LIMITS = {
  low: 10,
  standard: 24,
} as const;

export interface WildlifeViewSelectionOptions {
  maxViews: number;
  observerPosition: Pick<EcologyVector3, "x" | "z">;
  focusedIndividualId?: string | null;
  actionBoundIndividualIds?: readonly string[];
  telegraphIndividualIds?: readonly string[];
  alertIndividualIds?: readonly string[];
}

export interface WildlifeViewSelection<
  Projection extends EcologyRenderProjection = EcologyRenderProjection,
> {
  selected: Projection[];
  protectedCount: number;
  protectedCandidateCount: number;
  protectedDroppedCount: number;
  ambientCount: number;
  overflowCount: number;
  hardViewLimit: number;
}

const enum WildlifeViewPriority {
  FocusedOrActionBound = 0,
  TelegraphOrAlert = 1,
  Corpse = 2,
  Injured = 3,
  Ambient = 4,
}

/**
 * Protected continuity may exceed the ordinary ambience budget, but it must
 * never turn a corrupt or very long save into unbounded Three.js allocations.
 * The emergency lane is deliberately generous for normal play and still has
 * a deterministic hard ceiling.
 */
export function wildlifeEmergencyViewLimit(maxViews: number): number {
  const normal = Math.max(0, Math.floor(maxViews));
  return normal + Math.max(8, Math.ceil(normal * 0.5));
}

function distanceSquared(
  projection: EcologyRenderProjection,
  observer: Pick<EcologyVector3, "x" | "z">,
): number {
  const dx = projection.position.x - observer.x;
  const dz = projection.position.z - observer.z;
  return dx * dx + dz * dz;
}

/**
 * Chooses renderer views without changing simulation presence. Protected views
 * survive the ambient budget; if they alone exceed it, the selection may
 * temporarily overflow rather than dropping combat, interaction, or corpse
 * continuity.
 */
export function selectWildlifeViews<Projection extends EcologyRenderProjection>(
  candidates: readonly Projection[],
  options: WildlifeViewSelectionOptions,
): WildlifeViewSelection<Projection> {
  const focusedOrActionBound = new Set(options.actionBoundIndividualIds ?? []);
  if (options.focusedIndividualId) {
    focusedOrActionBound.add(options.focusedIndividualId);
  }
  const telegraphOrAlert = new Set([
    ...(options.telegraphIndividualIds ?? []),
    ...(options.alertIndividualIds ?? []),
  ]);
  const priorityOf = (
    projection: Projection,
  ): WildlifeViewPriority => {
    if (focusedOrActionBound.has(projection.individualId)) {
      return WildlifeViewPriority.FocusedOrActionBound;
    }
    if (
      telegraphOrAlert.has(projection.individualId) ||
      (projection.role === "predator" && projection.awareness > 0)
    ) {
      return WildlifeViewPriority.TelegraphOrAlert;
    }
    if (projection.health <= 0 || projection.behavior === "dead") {
      return WildlifeViewPriority.Corpse;
    }
    if (
      projection.health > 0 &&
      projection.health < projection.maxHealth
    ) {
      return WildlifeViewPriority.Injured;
    }
    return WildlifeViewPriority.Ambient;
  };
  const ordered = candidates
    .filter((candidate) => candidate.visible)
    .map((projection) => ({
      projection,
      priority: priorityOf(projection),
      distanceSquared: distanceSquared(projection, options.observerPosition),
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        left.distanceSquared - right.distanceSquared ||
        left.projection.individualId.localeCompare(
          right.projection.individualId,
        ),
    );
  const unique = ordered.filter(
    (candidate, index) =>
      ordered.findIndex(
        (other) =>
          other.projection.individualId === candidate.projection.individualId,
      ) === index,
  );
  const protectedViews = unique.filter(
    (candidate) => candidate.priority !== WildlifeViewPriority.Ambient,
  );
  const ambientViews = unique.filter(
    (candidate) => candidate.priority === WildlifeViewPriority.Ambient,
  );
  const maxViews = Math.max(0, Math.floor(options.maxViews));
  const hardViewLimit = wildlifeEmergencyViewLimit(maxViews);
  const selectedProtected = protectedViews.slice(0, hardViewLimit);
  const ambientCount = Math.max(0, maxViews - selectedProtected.length);
  const selectedAmbient = ambientViews.slice(0, ambientCount);
  const selected = [...selectedProtected, ...selectedAmbient].map(
    ({ projection }) => projection,
  );
  return {
    selected,
    protectedCount: selectedProtected.length,
    protectedCandidateCount: protectedViews.length,
    protectedDroppedCount: Math.max(
      0,
      protectedViews.length - selectedProtected.length,
    ),
    ambientCount: selectedAmbient.length,
    overflowCount: Math.max(0, selected.length - maxViews),
    hardViewLimit,
  };
}
