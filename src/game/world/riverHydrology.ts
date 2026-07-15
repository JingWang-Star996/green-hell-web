export const RIVER_HYDROLOGY_VERSION = 1 as const;
export const RIVER_HYDROLOGY_FIXED_HZ = 30;
export const RIVER_HYDROLOGY_MIN_LEVEL_METERS = -0.08;
export const RIVER_HYDROLOGY_MAX_LEVEL_METERS = 0.62;
/** Orange line on the authored gauge; readings report their signed clearance. */
export const RIVER_GAUGE_SAFE_LEVEL_METERS = 0.36;

export interface RiverHydrologyState {
  version: typeof RIVER_HYDROLOGY_VERSION;
  /** Relative offset shared by river rendering, interaction and gauge readout. */
  levelMeters: number;
  /** Delayed catchment response in the inclusive range 0..1. */
  runoff: number;
  trendMetersPerGameHour: number;
  lastAdvancedTick: number;
}

export interface RiverHydrologyInput {
  tick: number;
  rainIntensity: number;
  stormActive: boolean;
  fixedHz?: number;
  gameHoursPerSimulationSecond?: number;
}

const DEFAULT_GAME_HOURS_PER_SIMULATION_SECOND = 24 / (48 * 60);

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function approachExponential(
  current: number,
  target: number,
  elapsedSeconds: number,
  timeConstantSeconds: number,
): number {
  if (elapsedSeconds <= 0) return current;
  const blend = 1 - Math.exp(-elapsedSeconds / Math.max(0.001, timeConstantSeconds));
  return current + (target - current) * blend;
}

function advanceCoupledLevel(
  initialLevel: number,
  initialRunoff: number,
  runoffTarget: number,
  elapsedSeconds: number,
  runoffTimeConstant: number,
  levelTimeConstant: number,
): number {
  const runoffRate = 1 / runoffTimeConstant;
  const levelRate = 1 / levelTimeConstant;
  const equilibriumLevel = -0.06 + runoffTarget * 0.68;
  const runoffOffsetLevel = (initialRunoff - runoffTarget) * 0.68;
  const runoffDecay = Math.exp(-runoffRate * elapsedSeconds);
  const levelDecay = Math.exp(-levelRate * elapsedSeconds);
  const coupled = Math.abs(levelRate - runoffRate) < 1e-9
    ? levelRate * runoffOffsetLevel * elapsedSeconds * levelDecay
    : levelRate * runoffOffsetLevel *
      (runoffDecay - levelDecay) / (levelRate - runoffRate);
  return equilibriumLevel +
    (initialLevel - equilibriumLevel) * levelDecay +
    coupled;
}

export function createRiverHydrologyState(
  lastAdvancedTick = 0,
): RiverHydrologyState {
  return {
    version: RIVER_HYDROLOGY_VERSION,
    levelMeters: 0,
    runoff: 0.08,
    trendMetersPerGameHour: 0,
    lastAdvancedTick: Math.max(0, Math.floor(finiteOr(lastAdvancedTick, 0))),
  };
}

export function normalizeRiverHydrologyState(
  value: Partial<RiverHydrologyState> | null | undefined,
  fallbackTick = 0,
): RiverHydrologyState {
  const fallback = createRiverHydrologyState(fallbackTick);
  if (!value || value.version !== RIVER_HYDROLOGY_VERSION) return fallback;
  return {
    version: RIVER_HYDROLOGY_VERSION,
    levelMeters: clamp(
      finiteOr(value.levelMeters, fallback.levelMeters),
      RIVER_HYDROLOGY_MIN_LEVEL_METERS,
      RIVER_HYDROLOGY_MAX_LEVEL_METERS,
    ),
    runoff: clamp(finiteOr(value.runoff, fallback.runoff), 0, 1),
    trendMetersPerGameHour: clamp(
      finiteOr(value.trendMetersPerGameHour, 0),
      -2,
      2,
    ),
    lastAdvancedTick: Math.max(
      0,
      Math.floor(finiteOr(value.lastAdvancedTick, fallback.lastAdvancedTick)),
    ),
  };
}

/**
 * Closed-form catchment update. Calling once for N ticks is equivalent to
 * calling repeatedly with the same weather, which keeps save/load replay
 * deterministic without using wall-clock time.
 */
export function advanceRiverHydrology(
  source: RiverHydrologyState,
  input: RiverHydrologyInput,
): RiverHydrologyState {
  const state = normalizeRiverHydrologyState(source, input.tick);
  const targetTick = Math.max(
    state.lastAdvancedTick,
    Math.floor(finiteOr(input.tick, state.lastAdvancedTick)),
  );
  const elapsedTicks = targetTick - state.lastAdvancedTick;
  if (elapsedTicks === 0) return state;

  const fixedHz = clamp(finiteOr(input.fixedHz, RIVER_HYDROLOGY_FIXED_HZ), 1, 240);
  const elapsedSeconds = elapsedTicks / fixedHz;
  const rain = clamp(finiteOr(input.rainIntensity, 0), 0, 1);
  const runoffTarget = clamp(rain * 0.88 + (input.stormActive ? 0.18 : 0), 0, 1);
  const runoffTimeConstant = runoffTarget > state.runoff ? 22 : 58;
  const runoff = clamp(
    approachExponential(
      state.runoff,
      runoffTarget,
      elapsedSeconds,
      runoffTimeConstant,
    ),
    0,
    1,
  );

  const equilibriumLevel = -0.06 + runoffTarget * 0.68;
  const levelTimeConstant = equilibriumLevel > state.levelMeters ? 30 : 78;
  const levelMeters = clamp(
    advanceCoupledLevel(
      state.levelMeters,
      state.runoff,
      runoffTarget,
      elapsedSeconds,
      runoffTimeConstant,
      levelTimeConstant,
    ),
    RIVER_HYDROLOGY_MIN_LEVEL_METERS,
    RIVER_HYDROLOGY_MAX_LEVEL_METERS,
  );
  const gameHoursPerSimulationSecond = clamp(
    finiteOr(
      input.gameHoursPerSimulationSecond,
      DEFAULT_GAME_HOURS_PER_SIMULATION_SECOND,
    ),
    1 / 10_000,
    1,
  );
  const elapsedGameHours = elapsedSeconds * gameHoursPerSimulationSecond;
  const trendMetersPerGameHour = clamp(
    elapsedGameHours > 0
      ? (levelMeters - state.levelMeters) / elapsedGameHours
      : 0,
    -2,
    2,
  );

  return {
    version: RIVER_HYDROLOGY_VERSION,
    levelMeters,
    runoff,
    trendMetersPerGameHour,
    lastAdvancedTick: targetTick,
  };
}

export type RiverLevelTrend = "rising" | "stable" | "falling";

export function riverLevelTrend(
  state: Pick<RiverHydrologyState, "trendMetersPerGameHour">,
  stableThreshold = 0.025,
): RiverLevelTrend {
  const threshold = Math.max(0, finiteOr(stableThreshold, 0.025));
  if (state.trendMetersPerGameHour > threshold) return "rising";
  if (state.trendMetersPerGameHour < -threshold) return "falling";
  return "stable";
}
