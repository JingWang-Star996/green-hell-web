import {
  WIND_FIELD_FIXED_HZ,
  createWindFieldState,
  windFieldStrength,
} from "../world/windField";

export const CANOPY_JUNCTION_VERSION = 1 as const;
export const CANOPY_JUNCTION_ID = "landmark.canopy-junction-c17";
export const CANOPY_JUNCTION_OBSTRUCTION_TREE_ID =
  "resource.tree.canopy-c17-obstruction";
export const CANOPY_JUNCTION_TENSION_VINE_IDS = [
  "resource.vine.canopy-c17-tension-west",
  "resource.vine.canopy-c17-tension-east",
] as const;
export const CANOPY_JUNCTION_POSITION = { x: 118, y: 0, z: 92 } as const;

export const CANOPY_JUNCTION_PHASES = [
  "obstructed",
  "exposed",
  "connector-open",
  "link-restored",
  "sampling",
  "sample-ready",
  "reported",
] as const;

export type CanopyJunctionPhase = (typeof CANOPY_JUNCTION_PHASES)[number];

export const CANOPY_SAMPLE_MIN_STRENGTH = 0.72;
export const CANOPY_SAMPLE_STABLE_TICKS = 10 * WIND_FIELD_FIXED_HZ;
/** Shared precheck/settlement threshold for opening an unsheltered C-17 box. */
export const CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD = 0.65;
/** Real structure geometry, never a scripted placement point, is checked here. */
export const CANOPY_FORWARD_OUTPOST_RADIUS = 32;

export interface CanopyWindSample {
  directionRadians: number;
  strength: number;
  signalQuality: number;
  capturedAtTick: number;
  stableTicks: number;
}

/**
 * Sparse authored-landmark state. Ordinary trees/vines retain their own world
 * deltas; the IDs here are evidence that one of the two legal clearing routes
 * exposed the same persistent junction.
 */
export interface CanopyJunctionState {
  version: typeof CANOPY_JUNCTION_VERSION;
  phase: CanopyJunctionPhase;
  clearedObstructionIds: string[];
  phaseEnteredTick: number;
  samplingStartedTick: number | null;
  consecutiveReadableTicks: number;
  lastAdvancedTick: number;
  sample: CanopyWindSample | null;
  reportedAtTick: number | null;
}

export interface CanopySamplingAdvanceInput {
  worldSeed: number | string;
  tick: number;
}

const PHASE_INDEX = new Map(
  CANOPY_JUNCTION_PHASES.map((phase, index) => [phase, index]),
);
const KNOWN_OBSTRUCTION_IDS = new Set<string>([
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  ...CANOPY_JUNCTION_TENSION_VINE_IDS,
]);
const TAU = Math.PI * 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeTick(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : Math.max(0, Math.floor(Number.isFinite(fallback) ? fallback : 0));
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isPhase(value: unknown): value is CanopyJunctionPhase {
  return (
    typeof value === "string" &&
    PHASE_INDEX.has(value as CanopyJunctionPhase)
  );
}

function phaseAtLeast(
  phase: CanopyJunctionPhase,
  threshold: CanopyJunctionPhase,
): boolean {
  return PHASE_INDEX.get(phase)! >= PHASE_INDEX.get(threshold)!;
}

function normalizeClearedObstructionIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          KNOWN_OBSTRUCTION_IDS.has(candidate),
      ),
    ),
  ].sort();
}

export function canopyJunctionObstructionCleared(
  clearedObstructionIds: readonly string[],
): boolean {
  const cleared = new Set(clearedObstructionIds);
  return (
    cleared.has(CANOPY_JUNCTION_OBSTRUCTION_TREE_ID) ||
    CANOPY_JUNCTION_TENSION_VINE_IDS.every((id) => cleared.has(id))
  );
}

function normalizeSample(value: unknown): CanopyWindSample | null {
  if (!isRecord(value)) return null;
  const directionRadians = value.directionRadians;
  const strength = value.strength;
  const signalQuality = value.signalQuality;
  const stableTicks = value.stableTicks;
  const capturedAtTick = value.capturedAtTick;
  if (
    typeof directionRadians !== "number" ||
    !Number.isFinite(directionRadians) ||
    typeof strength !== "number" ||
    !Number.isFinite(strength) ||
    typeof signalQuality !== "number" ||
    !Number.isFinite(signalQuality) ||
    typeof stableTicks !== "number" ||
    !Number.isSafeInteger(stableTicks) ||
    stableTicks < CANOPY_SAMPLE_STABLE_TICKS ||
    typeof capturedAtTick !== "number" ||
    !Number.isSafeInteger(capturedAtTick) ||
    capturedAtTick < 0
  ) {
    return null;
  }
  return {
    directionRadians: ((directionRadians % TAU) + TAU) % TAU,
    strength: clamp(strength),
    signalQuality: clamp(signalQuality),
    capturedAtTick,
    stableTicks: Math.min(stableTicks, CANOPY_SAMPLE_STABLE_TICKS),
  };
}

export function createCanopyJunctionState(
  lastAdvancedTick = 0,
): CanopyJunctionState {
  const tick = safeTick(lastAdvancedTick);
  return {
    version: CANOPY_JUNCTION_VERSION,
    phase: "obstructed",
    clearedObstructionIds: [],
    phaseEnteredTick: tick,
    samplingStartedTick: null,
    consecutiveReadableTicks: 0,
    lastAdvancedTick: tick,
    sample: null,
    reportedAtTick: null,
  };
}

export function normalizeCanopyJunctionState(
  value: Partial<CanopyJunctionState> | null | undefined,
  fallbackTick = 0,
): CanopyJunctionState {
  if (!value || value.version !== CANOPY_JUNCTION_VERSION) {
    return createCanopyJunctionState(fallbackTick);
  }

  const lastAdvancedTick = safeTick(value.lastAdvancedTick, fallbackTick);
  const clearedObstructionIds = normalizeClearedObstructionIds(
    value.clearedObstructionIds,
  );
  let phase = isPhase(value.phase) ? value.phase : "obstructed";
  let sample = normalizeSample(value.sample);
  let reportedAtTick =
    value.reportedAtTick === null
      ? null
      : safeTick(value.reportedAtTick, lastAdvancedTick);

  // Inconsistent imported evidence fails closed to the last truthful phase.
  if (
    phaseAtLeast(phase, "exposed") &&
    !canopyJunctionObstructionCleared(clearedObstructionIds)
  ) {
    phase = "obstructed";
    sample = null;
    reportedAtTick = null;
  } else if (phaseAtLeast(phase, "sample-ready") && !sample) {
    phase = "sampling";
    reportedAtTick = null;
  } else if (phase === "reported" && reportedAtTick === null) {
    phase = "sample-ready";
  }

  const phaseEnteredTick = Math.min(
    lastAdvancedTick,
    safeTick(value.phaseEnteredTick, lastAdvancedTick),
  );
  const samplingStartedTick = phaseAtLeast(phase, "sampling")
    ? Math.min(
        lastAdvancedTick,
        value.samplingStartedTick === null
          ? phaseEnteredTick
          : safeTick(value.samplingStartedTick, phaseEnteredTick),
      )
    : null;
  const consecutiveReadableTicks =
    phase === "sampling" &&
    typeof value.consecutiveReadableTicks === "number" &&
    Number.isSafeInteger(value.consecutiveReadableTicks)
      ? Math.max(
          0,
          Math.min(
            CANOPY_SAMPLE_STABLE_TICKS - 1,
            value.consecutiveReadableTicks,
          ),
        )
      : 0;

  return {
    version: CANOPY_JUNCTION_VERSION,
    phase,
    clearedObstructionIds,
    phaseEnteredTick,
    samplingStartedTick,
    consecutiveReadableTicks,
    lastAdvancedTick,
    sample,
    reportedAtTick: phase === "reported" ? reportedAtTick : null,
  };
}

/** Records ordinary-world obstruction evidence and exposes C-17 when legal. */
export function recordCanopyObstructionCleared(
  source: CanopyJunctionState,
  obstructionId: string,
  tick: number,
): CanopyJunctionState {
  const state = normalizeCanopyJunctionState(source, tick);
  if (!KNOWN_OBSTRUCTION_IDS.has(obstructionId)) return state;
  const targetTick = Math.max(state.lastAdvancedTick, safeTick(tick));
  const clearedObstructionIds = [
    ...new Set([...state.clearedObstructionIds, obstructionId]),
  ].sort();
  const exposed =
    state.phase === "obstructed" &&
    canopyJunctionObstructionCleared(clearedObstructionIds);
  return {
    ...state,
    clearedObstructionIds,
    phase: exposed ? "exposed" : state.phase,
    phaseEnteredTick: exposed ? targetTick : state.phaseEnteredTick,
    lastAdvancedTick: targetTick,
  };
}

/**
 * Applies only one adjacent legal phase. It contains no inventory, input or UI
 * command behavior; later simulation commands may call it after their own
 * precheck/action/settlement transaction succeeds.
 */
export function transitionCanopyJunctionPhase(
  source: CanopyJunctionState,
  nextPhase: CanopyJunctionPhase,
  tick: number,
): CanopyJunctionState {
  const state = normalizeCanopyJunctionState(source, tick);
  const currentIndex = PHASE_INDEX.get(state.phase)!;
  const nextIndex = PHASE_INDEX.get(nextPhase);
  if (nextIndex !== currentIndex + 1) return state;
  if (
    nextPhase === "exposed" &&
    !canopyJunctionObstructionCleared(state.clearedObstructionIds)
  ) {
    return state;
  }
  if (nextPhase === "sample-ready" && !state.sample) return state;

  const targetTick = Math.max(state.lastAdvancedTick, safeTick(tick));
  return {
    ...state,
    phase: nextPhase,
    phaseEnteredTick: targetTick,
    samplingStartedTick:
      nextPhase === "sampling" ? targetTick : state.samplingStartedTick,
    consecutiveReadableTicks:
      nextPhase === "sampling" ? 0 : state.consecutiveReadableTicks,
    reportedAtTick: nextPhase === "reported" ? targetTick : null,
    lastAdvancedTick: targetTick,
  };
}

/**
 * Advances the ten-second valid-gust window at fixed ticks. Sampling reads the
 * same seed/tick wind authority as every presentation layer, so save/load and
 * active-bubble partitioning cannot manufacture a different measurement.
 */
export function advanceCanopyJunctionSampling(
  source: CanopyJunctionState,
  input: CanopySamplingAdvanceInput,
): CanopyJunctionState {
  let state = normalizeCanopyJunctionState(source, input.tick);
  if (state.phase === "link-restored") {
    state = transitionCanopyJunctionPhase(state, "sampling", state.lastAdvancedTick);
  }
  if (state.phase !== "sampling") return state;

  const targetTick = Math.max(state.lastAdvancedTick, safeTick(input.tick));
  let consecutiveReadableTicks = state.consecutiveReadableTicks;
  for (let tick = state.lastAdvancedTick + 1; tick <= targetTick; tick += 1) {
    const wind = createWindFieldState(input.worldSeed, tick);
    const strength = windFieldStrength(wind);
    consecutiveReadableTicks =
      strength >= CANOPY_SAMPLE_MIN_STRENGTH
        ? consecutiveReadableTicks + 1
        : 0;
    if (consecutiveReadableTicks < CANOPY_SAMPLE_STABLE_TICKS) continue;

    const sample: CanopyWindSample = {
      directionRadians: wind.directionRadians,
      strength,
      signalQuality: clamp(0.7 + strength * 0.27),
      capturedAtTick: tick,
      stableTicks: CANOPY_SAMPLE_STABLE_TICKS,
    };
    return {
      ...state,
      phase: "sample-ready",
      phaseEnteredTick: tick,
      consecutiveReadableTicks: 0,
      lastAdvancedTick: tick,
      sample,
    };
  }

  return {
    ...state,
    consecutiveReadableTicks,
    lastAdvancedTick: targetTick,
  };
}
