import {
  SHELTER_COVERAGE_RADIUS,
  isWithinStructureRadius,
  resolveStructureTransform,
  structureTransformFromSource,
  type StructureTransform2D,
} from "./structureGeometry";
import type { GameState, Vec3 } from "./types";
import { nearestPlacedStructure } from "./campStructures";

export const CAMPFIRE_IGNITION_BLOCKING_RAIN_INTENSITY = 0.8;
export const CAMPFIRE_RAIN_EXPOSED_GUIDANCE =
  "暴雨会浇灭露天火种；请在已建叶棚的棚顶下点火，或等待雨势减弱。";

export type CampfireIgnitionBlocker = "rain-exposed";

export interface CampfireIgnitionEnvironment {
  rainIntensity: number;
  sheltered: boolean;
}

export interface ResolvedCampfireIgnition {
  canIgnite: boolean;
  blocker: CampfireIgnitionBlocker | null;
  rainIntensity: number;
  sheltered: boolean;
}

/**
 * Shared, pure ignition contract. Invalid rain payloads fail closed because a
 * malformed save must never grant a fire that the authoritative simulation
 * would immediately extinguish.
 */
export function resolveCampfireIgnition(
  input: CampfireIgnitionEnvironment,
): ResolvedCampfireIgnition {
  const rainIntensity = Number.isFinite(input.rainIntensity)
    ? Math.max(0, Math.min(1, input.rainIntensity))
    : 1;
  const sheltered = input.sheltered === true;
  const blocker =
    !sheltered &&
    rainIntensity >= CAMPFIRE_IGNITION_BLOCKING_RAIN_INTENSITY
      ? ("rain-exposed" as const)
      : null;
  return {
    canIgnite: blocker === null,
    blocker,
    rainIntensity,
    sheltered,
  };
}

function shelterTransforms(state: GameState): StructureTransform2D[] {
  const explicit = (state.camp.structures ?? [])
    .filter((structure) => structure.kind === "shelter")
    .map(structureTransformFromSource)
    .filter((structure): structure is StructureTransform2D => structure !== null);
  if (explicit.length > 0) return explicit;
  const fallback = resolveStructureTransform(
    "shelter",
    undefined,
    state.camp.shelterBuilt,
  );
  return fallback ? [fallback] : [];
}

/** Exact candidate/current fire position against every built leaf shelter. */
export function resolveCampfireIgnitionAtPoint(
  state: GameState,
  point: Pick<Vec3, "x" | "z">,
): ResolvedCampfireIgnition {
  const sheltered = shelterTransforms(state).some((shelter) =>
    isWithinStructureRadius(point, shelter, SHELTER_COVERAGE_RADIUS),
  );
  return resolveCampfireIgnition({
    rainIntensity: state.weather.rainIntensity,
    sheltered,
  });
}

/** Existing-fire path used by affordances, UI and authoritative relighting. */
export function resolveCurrentCampfireIgnition(
  state: GameState,
  structureId?: string,
): ResolvedCampfireIgnition {
  const explicit = structureId
    ? state.camp.structures?.find(
        (structure) =>
          structure.kind === "campfire" && structure.id === structureId,
      ) ?? null
    : nearestPlacedStructure(state, "campfire");
  const fire = explicit
    ? structureTransformFromSource(explicit)
    : resolveStructureTransform(
        "campfire",
        undefined,
        state.camp.fire.built,
      );
  return fire
    ? resolveCampfireIgnitionAtPoint(state, fire)
    : resolveCampfireIgnition({
        rainIntensity: state.weather.rainIntensity,
        sheltered: false,
      });
}

/**
 * Recipe-list preflight has no placement yet. Any built shelter represents a
 * legal candidate; the authoritative craft path still checks the exact point.
 */
export function resolvePotentialCampfireIgnition(
  state: GameState,
): ResolvedCampfireIgnition {
  return resolveCampfireIgnition({
    rainIntensity: state.weather.rainIntensity,
    sheltered: shelterTransforms(state).length > 0,
  });
}
