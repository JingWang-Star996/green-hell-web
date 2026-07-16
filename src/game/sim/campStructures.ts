import { DEFAULT_STRUCTURE_PLACEMENTS } from "./structureGeometry";
import type {
  FireState,
  GameState,
  PlacedCampfireState,
  PlacedStructureKind,
  PlacedStructureState,
  Vec3,
} from "./types";

const COLD_FIRE: Readonly<PlacedCampfireState> = {
  lit: false,
  fuelSeconds: 0,
  rainExposure: 0,
  sheltered: false,
};

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

export function normalizePlacedCampfireState(
  value: PlacedCampfireState | undefined,
  fallback?: FireState,
): PlacedCampfireState {
  const source = value ?? fallback ?? COLD_FIRE;
  const fuelSeconds = finiteNonNegative(source.fuelSeconds);
  return {
    // Legacy boolean-only tests/saves may briefly say lit at zero fuel. The
    // next fixed fire tick extinguishes that state authoritatively.
    lit: source.lit === true,
    fuelSeconds,
    rainExposure: finiteNonNegative(source.rainExposure),
    sheltered: source.sheltered === true,
  };
}

/** Read path accepts the first-generation facade without mutating the save. */
export function campfireStateForStructure(
  state: GameState,
  structure: PlacedStructureState,
): PlacedCampfireState {
  if (structure.kind !== "campfire") return { ...COLD_FIRE };
  if (structure.fire) return normalizePlacedCampfireState(structure.fire);
  const firstCampfire = (state.camp.structures ?? []).find(
    (candidate) => candidate.kind === "campfire",
  );
  return normalizePlacedCampfireState(
    undefined,
    !firstCampfire || firstCampfire.id === structure.id
      ? state.camp.fire
      : undefined,
  );
}

/** Settlement path materializes runtime on the exact placed structure. */
export function ensureCampfireState(
  state: GameState,
  structure: PlacedStructureState,
): PlacedCampfireState {
  if (structure.kind !== "campfire") {
    throw new Error(`structure ${structure.id} is not a campfire`);
  }
  structure.fire = campfireStateForStructure(state, structure);
  return structure.fire;
}

export function placedStructuresOfKind(
  state: GameState,
  kind: PlacedStructureKind,
): PlacedStructureState[] {
  return (state.camp.structures ?? []).filter(
    (structure) => structure.kind === kind,
  );
}

export function nearestPlacedStructure(
  state: GameState,
  kind: PlacedStructureKind,
  point: Pick<Vec3, "x" | "z"> = state.player.position,
  maximumDistance = Number.POSITIVE_INFINITY,
): PlacedStructureState | null {
  let best: PlacedStructureState | null = null;
  let bestDistance = maximumDistance;
  for (const structure of placedStructuresOfKind(state, kind)) {
    const distance = Math.hypot(
      structure.position.x - point.x,
      structure.position.z - point.z,
    );
    if (
      distance < bestDistance ||
      (distance === bestDistance && best && structure.id.localeCompare(best.id) < 0)
    ) {
      best = structure;
      bestDistance = distance;
    }
  }
  return best;
}

export function nearestLitCampfire(
  state: GameState,
  point: Pick<Vec3, "x" | "z"> = state.player.position,
  maximumDistance = Number.POSITIVE_INFINITY,
): PlacedStructureState | null {
  let best: PlacedStructureState | null = null;
  let bestDistance = maximumDistance;
  for (const structure of placedStructuresOfKind(state, "campfire")) {
    const fire = campfireStateForStructure(state, structure);
    if (!fire.lit || fire.fuelSeconds <= 0) continue;
    const distance = Math.hypot(
      structure.position.x - point.x,
      structure.position.z - point.z,
    );
    if (
      distance < bestDistance ||
      (distance === bestDistance && best && structure.id.localeCompare(best.id) < 0)
    ) {
      best = structure;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Only migration/normalization and simulation settlement should call this.
 * Old fields remain a facade for integrations that have not learned instance IDs.
 */
export function syncLegacyCampFacades(state: GameState): void {
  const campfires = placedStructuresOfKind(state, "campfire");
  const primary = [...campfires].sort(
    (left, right) =>
      left.builtAtTick - right.builtAtTick || left.id.localeCompare(right.id),
  )[0];
  state.camp.fire.built = Boolean(primary);
  if (primary) {
    const fire = campfireStateForStructure(state, primary);
    state.camp.fire.lit = fire.lit;
    state.camp.fire.fuelSeconds = fire.fuelSeconds;
    state.camp.fire.rainExposure = fire.rainExposure;
    state.camp.fire.sheltered = fire.sheltered;
  } else {
    state.camp.fire.lit = false;
    state.camp.fire.fuelSeconds = 0;
    state.camp.fire.rainExposure = 0;
    state.camp.fire.sheltered = false;
  }
  state.camp.shelterBuilt = placedStructuresOfKind(state, "shelter").length > 0;
  state.camp.bedBuilt = placedStructuresOfKind(state, "bed").length > 0;
  state.camp.beaconBuilt = placedStructuresOfKind(state, "radio-beacon").length > 0;
}

/** Materializes a boolean-only legacy structure before an exact-ID mutation. */
export function materializeLegacyStructure(
  state: GameState,
  kind: "campfire" | "shelter" | "bed" | "radio-beacon",
): PlacedStructureState | null {
  const legacyBuilt = {
    campfire: state.camp.fire.built,
    shelter: state.camp.shelterBuilt,
    bed: state.camp.bedBuilt,
    "radio-beacon": state.camp.beaconBuilt,
  } as const;
  state.camp.structures ??= [];
  for (const legacyKind of [
    "campfire",
    "shelter",
    "bed",
    "radio-beacon",
  ] as const) {
    if (
      !legacyBuilt[legacyKind] ||
      placedStructuresOfKind(state, legacyKind).length > 0
    ) {
      continue;
    }
    const placement = DEFAULT_STRUCTURE_PLACEMENTS[legacyKind];
    state.camp.structures.push({
      id: `structure.${legacyKind}.legacy`,
      kind: legacyKind,
      position: { ...placement.position },
      yaw: placement.yaw,
      builtAtTick: 0,
      ...(legacyKind === "campfire"
        ? { fire: normalizePlacedCampfireState(undefined, state.camp.fire) }
        : {}),
    });
  }
  syncLegacyCampFacades(state);
  return placedStructuresOfKind(state, kind)[0] ?? null;
}
