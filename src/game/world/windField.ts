import { hashSeed, nextRandom } from "../sim/rng";
import type { Seed } from "../sim/types";

export const WIND_FIELD_VERSION = 1 as const;
export const WIND_FIELD_FIXED_HZ = 30;
/** One authored weather front lasts ninety real-time seconds. */
export const WIND_FRONT_INTERVAL_TICKS = 90 * WIND_FIELD_FIXED_HZ;
/** A deterministic gust pulse repeats often enough to avoid a sampling soft-lock. */
export const WIND_GUST_INTERVAL_TICKS = 72 * WIND_FIELD_FIXED_HZ;

export interface WindFieldState {
  version: typeof WIND_FIELD_VERSION;
  /** Radians clockwise in world X/Z space, normalized to [0, 2π). */
  directionRadians: number;
  /** Slowly varying baseline strength in the inclusive range 0..1. */
  speed: number;
  /** Instantaneous strength, including the deterministic gust envelope. */
  gust: number;
  targetDirectionRadians: number;
  targetSpeed: number;
  /** Tick at which the next deterministic front becomes the active target. */
  nextFrontTick: number;
  lastAdvancedTick: number;
}

export interface WindFieldAdvanceInput {
  worldSeed: Seed;
  tick: number;
}

const TAU = Math.PI * 2;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeTick(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : Math.max(0, Math.floor(Number.isFinite(fallback) ? fallback : 0));
}

function wrapRadians(value: number): number {
  const wrapped = value % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

function deterministicRoll(
  worldSeed: Seed,
  domain: string,
  ordinal: number,
): number {
  const [roll] = nextRandom(hashSeed(`${worldSeed}:wind:${domain}:${ordinal}`));
  return roll;
}

function frontTarget(worldSeed: Seed, frontIndex: number): {
  directionRadians: number;
  speed: number;
} {
  const directionRadians =
    deterministicRoll(worldSeed, "direction", frontIndex) * TAU;
  const speedRoll = deterministicRoll(worldSeed, "speed", frontIndex);
  return {
    directionRadians,
    // Most fronts are readable breezes; low and strong fronts still occur.
    speed: clamp(0.1 + Math.pow(speedRoll, 0.82) * 0.64),
  };
}

function smoothstep(value: number): number {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function interpolateDirection(
  fromRadians: number,
  toRadians: number,
  amount: number,
): number {
  const shortestDelta =
    ((toRadians - fromRadians + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return wrapRadians(fromRadians + shortestDelta * amount);
}

function gustStrength(
  worldSeed: Seed,
  tick: number,
  baselineSpeed: number,
): number {
  const offset = Math.floor(
    deterministicRoll(worldSeed, "gust-phase", 0) * WIND_GUST_INTERVAL_TICKS,
  );
  const phase =
    ((tick + offset) % WIND_GUST_INTERVAL_TICKS) / WIND_GUST_INTERVAL_TICKS;
  // A broad, smooth pulse gives C-17 at least one ten-second readable window
  // per cycle without spawning a task-only weather event near the player.
  const distanceFromPeak = Math.abs(phase - 0.5);
  // The flat crown is ~13 seconds wide, enough for a ten-second C-17 sample
  // even during the weakest baseline front.
  const pulse = smoothstep(clamp((0.24 - distanceFromPeak) / 0.15));
  const ripplePhase =
    deterministicRoll(worldSeed, "gust-ripple", 0) * TAU +
    (tick / WIND_FIELD_FIXED_HZ) * 0.41;
  const ripple = (Math.sin(ripplePhase) + 1) * 0.015;
  const peakBoost = 0.76 - baselineSpeed * 0.25;
  return clamp(baselineSpeed + pulse * peakBoost + ripple);
}

/**
 * Projects the authoritative field from seed + absolute fixed tick. Because
 * no wall-clock integration is involved, one N-tick advance and any partition
 * of that advance produce exactly the same canonical result.
 */
function projectWindField(worldSeed: Seed, tick: number): WindFieldState {
  const canonicalTick = safeTick(tick);
  const frontIndex = Math.floor(canonicalTick / WIND_FRONT_INTERVAL_TICKS);
  const frontStartTick = frontIndex * WIND_FRONT_INTERVAL_TICKS;
  const previousTarget = frontTarget(worldSeed, frontIndex - 1);
  const target = frontTarget(worldSeed, frontIndex);
  const progress = smoothstep(
    (canonicalTick - frontStartTick) / WIND_FRONT_INTERVAL_TICKS,
  );
  const directionRadians = interpolateDirection(
    previousTarget.directionRadians,
    target.directionRadians,
    progress,
  );
  const speed = clamp(
    previousTarget.speed + (target.speed - previousTarget.speed) * progress,
  );

  return {
    version: WIND_FIELD_VERSION,
    directionRadians,
    speed,
    gust: gustStrength(worldSeed, canonicalTick, speed),
    targetDirectionRadians: target.directionRadians,
    targetSpeed: target.speed,
    nextFrontTick: (frontIndex + 1) * WIND_FRONT_INTERVAL_TICKS,
    lastAdvancedTick: canonicalTick,
  };
}

export function createWindFieldState(
  worldSeed: Seed,
  lastAdvancedTick = 0,
): WindFieldState {
  return projectWindField(worldSeed, safeTick(lastAdvancedTick));
}

/**
 * Saved numerical projections are treated as a cache, not independent truth.
 * A valid version contributes only its monotonic tick; all field values are
 * reconstructed from the same seed/tick authority and therefore stay bounded.
 */
export function normalizeWindFieldState(
  value: Partial<WindFieldState> | null | undefined,
  worldSeed: Seed,
  fallbackTick = 0,
): WindFieldState {
  const tick =
    value?.version === WIND_FIELD_VERSION
      ? safeTick(value.lastAdvancedTick, fallbackTick)
      : safeTick(fallbackTick);
  return projectWindField(worldSeed, tick);
}

export function advanceWindField(
  source: WindFieldState,
  input: WindFieldAdvanceInput,
): WindFieldState {
  const normalized = normalizeWindFieldState(
    source,
    input.worldSeed,
    input.tick,
  );
  return projectWindField(
    input.worldSeed,
    Math.max(normalized.lastAdvancedTick, safeTick(input.tick)),
  );
}

/** Shared strength used by leaves, rain, audio and C-17 sampling. */
export function windFieldStrength(
  state: Pick<WindFieldState, "speed" | "gust">,
): number {
  const speed = Number.isFinite(state.speed) ? state.speed : 0;
  const gust = Number.isFinite(state.gust) ? state.gust : 0;
  return clamp(Math.max(speed, gust));
}
