import {
  generateChunkDescriptor,
  worldToChunkCoordinate,
  type BiomeId,
} from "../world/generation";
import type { GameState, PlacedStructureState } from "./types";
import {
  SHELTER_COVERAGE_RADIUS,
  isWithinStructureRadius,
  resolveStructureTransform,
  structureTransformFromSource,
} from "./structureGeometry";

export const RAIN_COLLECTOR_CAPACITY = 4;
export const RAIN_COLLECTOR_DRY_THRESHOLD = 0.04;
export const RAIN_COLLECTOR_FULL_RAIN_SECONDS_PER_UNIT = 180;

export const RAIN_COLLECTOR_BIOME_MULTIPLIERS: Readonly<
  Record<BiomeId, number>
> = {
  "evergreen-rainforest": 0.88,
  "river-wetland": 1.08,
  "palm-grove": 1,
  swamp: 1.02,
  "rocky-highland": 1.12,
};

export type RainCollectorSiteBand = "high" | "low";

export interface RainCollectorEnvironment {
  biome: BiomeId;
  canopy: number;
  exposure: number;
  biomeMultiplier: number;
  siteMultiplier: number;
  rainIntensity: number;
  ratePerSecond: number;
  active: boolean;
  blocker: "drought" | "capacity-full" | "overhead-cover" | null;
  siteBand: RainCollectorSiteBand;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function rainCollectorEnvironment(input: {
  biome: BiomeId;
  canopy: number;
  rainIntensity: number;
  storedUnits?: number;
  capacity?: number;
  overheadCover?: boolean;
}): RainCollectorEnvironment {
  const canopy = clamp01(input.canopy);
  const rainIntensity = clamp01(input.rainIntensity);
  // Even a dense crown has gaps, but exposed clearings remain markedly better.
  const exposure = 0.42 + (1 - canopy) * 0.58;
  const biomeMultiplier = RAIN_COLLECTOR_BIOME_MULTIPLIERS[input.biome];
  const siteMultiplier = exposure * biomeMultiplier;
  const capacity = Math.max(0, input.capacity ?? RAIN_COLLECTOR_CAPACITY);
  const storedUnits = Math.max(0, input.storedUnits ?? 0);
  const blocker =
    storedUnits >= capacity - 1e-9
      ? ("capacity-full" as const)
      : input.overheadCover === true
        ? ("overhead-cover" as const)
        : rainIntensity <= RAIN_COLLECTOR_DRY_THRESHOLD
          ? ("drought" as const)
          : null;
  const ratePerSecond = blocker
    ? 0
    : (Math.pow(rainIntensity, 1.15) * siteMultiplier) /
      RAIN_COLLECTOR_FULL_RAIN_SECONDS_PER_UNIT;
  return {
    biome: input.biome,
    canopy,
    exposure,
    biomeMultiplier,
    siteMultiplier,
    rainIntensity,
    ratePerSecond,
    active: ratePerSecond > 0,
    blocker,
    siteBand: siteMultiplier >= 0.65 ? "high" : "low",
  };
}

/** A collector needs open sky; a built leaf shelter is a hard roof, not canopy. */
export function rainCollectorHasOverheadCoverAtPoint(
  state: GameState,
  point: Pick<PlacedStructureState["position"], "x" | "z">,
): boolean {
  const explicit = (state.camp.structures ?? [])
    .filter((candidate) => candidate.kind === "shelter")
    .map(structureTransformFromSource)
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
  if (
    explicit.some((shelter) =>
      isWithinStructureRadius(point, shelter, SHELTER_COVERAGE_RADIUS),
    )
  ) return true;
  if (explicit.length > 0 || !state.camp.shelterBuilt) return false;
  const legacy = resolveStructureTransform("shelter", undefined, true);
  return Boolean(
    legacy && isWithinStructureRadius(point, legacy, SHELTER_COVERAGE_RADIUS),
  );
}

export function rainCollectorEnvironmentForStructure(
  state: GameState,
  structure: PlacedStructureState,
): RainCollectorEnvironment {
  const descriptor = generateChunkDescriptor(
    String(state.seed),
    worldToChunkCoordinate(structure.position.x, structure.position.z),
  );
  return rainCollectorEnvironment({
    biome: descriptor.biome,
    canopy: descriptor.canopy,
    rainIntensity: state.weather.rainIntensity,
    storedUnits: structure.storedUnits,
    capacity: structure.capacity,
    overheadCover: rainCollectorHasOverheadCoverAtPoint(
      state,
      structure.position,
    ),
  });
}

export function rainCollectorSiteEnvironment(
  worldSeed: string,
  position: Pick<PlacedStructureState["position"], "x" | "z">,
  overheadCover = false,
): RainCollectorEnvironment {
  const descriptor = generateChunkDescriptor(
    worldSeed,
    worldToChunkCoordinate(position.x, position.z),
  );
  return rainCollectorEnvironment({
    biome: descriptor.biome,
    canopy: descriptor.canopy,
    // Full rain exposes site efficiency without conflating it with current weather.
    rainIntensity: 1,
    overheadCover,
  });
}
