import { hashSeed, nextRandom } from "./rng";
import { gameHoursToTicks } from "./time";

export type TreeRegrowthStage = "stump" | "sapling" | "young" | "mature";

export type EffectiveTreeGrowthStage = "sapling" | "young" | "mature";

export interface TreeRegrowthSchedule {
  stumpStartedAtTick: number;
  saplingAtTick: number;
  youngAtTick: number;
  matureAtTick: number;
}

/**
 * Compact, serializable authority for one ordinary tree's recovery cycle.
 * The integration layer owns eligibility and attaches this state only after a
 * tree has become a fully processed stump.
 */
export interface TreeRegrowthState {
  version: 1;
  cycle: number;
  schedule: TreeRegrowthSchedule;
  stage: TreeRegrowthStage;
  stageStartedAtTick: number;
  lastAdvancedTick: number;
}

export const TREE_REGROWTH_STUMP_HOURS = Object.freeze({
  minimum: 48,
  maximum: 72,
});

export const TREE_REGROWTH_SAPLING_HOURS = Object.freeze({
  minimum: 48,
  maximum: 72,
});

export const TREE_REGROWTH_YOUNG_HOURS = Object.freeze({
  minimum: 72,
  maximum: 96,
});

export const TREE_REGROWTH_TOTAL_HOURS = Object.freeze({
  minimum:
    TREE_REGROWTH_STUMP_HOURS.minimum +
    TREE_REGROWTH_SAPLING_HOURS.minimum +
    TREE_REGROWTH_YOUNG_HOURS.minimum,
  maximum:
    TREE_REGROWTH_STUMP_HOURS.maximum +
    TREE_REGROWTH_SAPLING_HOURS.maximum +
    TREE_REGROWTH_YOUNG_HOURS.maximum,
});

const REGROWTH_VERSION = 1 as const;
const STAGES = new Set<TreeRegrowthStage>([
  "stump",
  "sapling",
  "young",
  "mature",
]);

function isSafeTick(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isValidSeed(seed: string | number): boolean {
  return typeof seed === "string"
    ? seed.trim().length > 0
    : Number.isFinite(seed) && Number.isSafeInteger(seed) && seed >= 0;
}

function isValidCycle(cycle: unknown): cycle is number {
  return Number.isSafeInteger(cycle) && (cycle as number) >= 0;
}

function addTicks(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) && result >= left ? result : null;
}

function wholeHoursFromRoll(
  roll: number,
  range: Readonly<{ minimum: number; maximum: number }>,
): number {
  return (
    range.minimum +
    Math.floor(roll * (range.maximum - range.minimum + 1))
  );
}

function cloneSchedule(schedule: TreeRegrowthSchedule): TreeRegrowthSchedule {
  return {
    stumpStartedAtTick: schedule.stumpStartedAtTick,
    saplingAtTick: schedule.saplingAtTick,
    youngAtTick: schedule.youngAtTick,
    matureAtTick: schedule.matureAtTick,
  };
}

function durationWithin(
  durationTicks: number,
  range: Readonly<{ minimum: number; maximum: number }>,
): boolean {
  return (
    durationTicks >= gameHoursToTicks(range.minimum) &&
    durationTicks <= gameHoursToTicks(range.maximum)
  );
}

function isValidSchedule(value: unknown): value is TreeRegrowthSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<TreeRegrowthSchedule>;
  if (
    !isSafeTick(schedule.stumpStartedAtTick) ||
    !isSafeTick(schedule.saplingAtTick) ||
    !isSafeTick(schedule.youngAtTick) ||
    !isSafeTick(schedule.matureAtTick)
  ) {
    return false;
  }
  const stumpTicks = schedule.saplingAtTick - schedule.stumpStartedAtTick;
  const saplingTicks = schedule.youngAtTick - schedule.saplingAtTick;
  const youngTicks = schedule.matureAtTick - schedule.youngAtTick;
  const totalTicks = schedule.matureAtTick - schedule.stumpStartedAtTick;
  return (
    durationWithin(stumpTicks, TREE_REGROWTH_STUMP_HOURS) &&
    durationWithin(saplingTicks, TREE_REGROWTH_SAPLING_HOURS) &&
    durationWithin(youngTicks, TREE_REGROWTH_YOUNG_HOURS) &&
    durationWithin(totalTicks, TREE_REGROWTH_TOTAL_HOURS)
  );
}

/**
 * Generates a deterministic 7–10 game-day schedule. Each stage duration is a
 * whole number of game hours converted through the authoritative time model.
 */
export function generateTreeRegrowthSchedule(
  seed: string | number,
  entityId: string,
  cycle: number,
  stumpStartedAtTick: number,
): TreeRegrowthSchedule | null {
  if (
    !isValidSeed(seed) ||
    typeof entityId !== "string" ||
    entityId.trim().length === 0 ||
    !isValidCycle(cycle) ||
    !isSafeTick(stumpStartedAtTick)
  ) {
    return null;
  }

  let randomState = hashSeed(
    `${String(seed)}:${entityId}:${cycle}:tree-regrowth-v${REGROWTH_VERSION}`,
  );
  const [stumpRoll, afterStump] = nextRandom(randomState);
  randomState = afterStump;
  const [saplingRoll, afterSapling] = nextRandom(randomState);
  randomState = afterSapling;
  const [youngRoll] = nextRandom(randomState);

  const stumpTicks = gameHoursToTicks(
    wholeHoursFromRoll(stumpRoll, TREE_REGROWTH_STUMP_HOURS),
  );
  const saplingTicks = gameHoursToTicks(
    wholeHoursFromRoll(saplingRoll, TREE_REGROWTH_SAPLING_HOURS),
  );
  const youngTicks = gameHoursToTicks(
    wholeHoursFromRoll(youngRoll, TREE_REGROWTH_YOUNG_HOURS),
  );
  const saplingAtTick = addTicks(stumpStartedAtTick, stumpTicks);
  if (saplingAtTick === null) return null;
  const youngAtTick = addTicks(saplingAtTick, saplingTicks);
  if (youngAtTick === null) return null;
  const matureAtTick = addTicks(youngAtTick, youngTicks);
  if (matureAtTick === null) return null;

  const schedule: TreeRegrowthSchedule = {
    stumpStartedAtTick,
    saplingAtTick,
    youngAtTick,
    matureAtTick,
  };
  return isValidSchedule(schedule) ? schedule : null;
}

export function treeRegrowthStageAtTick(
  schedule: Readonly<TreeRegrowthSchedule>,
  clockTick: number,
): TreeRegrowthStage | null {
  if (!isValidSchedule(schedule) || !isSafeTick(clockTick)) return null;
  if (clockTick < schedule.stumpStartedAtTick) return null;
  if (clockTick < schedule.saplingAtTick) return "stump";
  if (clockTick < schedule.youngAtTick) return "sapling";
  if (clockTick < schedule.matureAtTick) return "young";
  return "mature";
}

function stageStartedAtTick(
  schedule: Readonly<TreeRegrowthSchedule>,
  stage: TreeRegrowthStage,
): number {
  if (stage === "sapling") return schedule.saplingAtTick;
  if (stage === "young") return schedule.youngAtTick;
  if (stage === "mature") return schedule.matureAtTick;
  return schedule.stumpStartedAtTick;
}

export function createTreeRegrowthState(
  seed: string | number,
  entityId: string,
  cycle: number,
  stumpStartedAtTick: number,
): TreeRegrowthState | null {
  const schedule = generateTreeRegrowthSchedule(
    seed,
    entityId,
    cycle,
    stumpStartedAtTick,
  );
  if (!schedule) return null;
  return {
    version: REGROWTH_VERSION,
    cycle,
    schedule,
    stage: "stump",
    stageStartedAtTick: stumpStartedAtTick,
    lastAdvancedTick: stumpStartedAtTick,
  };
}

/**
 * Validates an untrusted/JSON state and advances it monotonically to clockTick.
 * Long rests may cross several boundaries, but the result is always one of the
 * four legal stages and retains the exact boundary at which that stage began.
 */
export function normalizeTreeRegrowthState(
  value: unknown,
  clockTick: number,
): TreeRegrowthState | null {
  if (!value || typeof value !== "object" || !isSafeTick(clockTick)) {
    return null;
  }
  const candidate = value as Partial<TreeRegrowthState>;
  if (
    candidate.version !== REGROWTH_VERSION ||
    !isValidCycle(candidate.cycle) ||
    !isValidSchedule(candidate.schedule) ||
    !STAGES.has(candidate.stage as TreeRegrowthStage) ||
    !isSafeTick(candidate.stageStartedAtTick) ||
    !isSafeTick(candidate.lastAdvancedTick) ||
    candidate.lastAdvancedTick < candidate.schedule.stumpStartedAtTick ||
    clockTick < candidate.lastAdvancedTick
  ) {
    return null;
  }

  const savedStage = treeRegrowthStageAtTick(
    candidate.schedule,
    candidate.lastAdvancedTick,
  );
  if (
    savedStage === null ||
    savedStage !== candidate.stage ||
    candidate.stageStartedAtTick !==
      stageStartedAtTick(candidate.schedule, savedStage)
  ) {
    return null;
  }

  const stage = treeRegrowthStageAtTick(candidate.schedule, clockTick);
  if (stage === null) return null;
  return {
    version: REGROWTH_VERSION,
    cycle: candidate.cycle,
    schedule: cloneSchedule(candidate.schedule),
    stage,
    stageStartedAtTick: stageStartedAtTick(candidate.schedule, stage),
    lastAdvancedTick: clockTick,
  };
}

export function advanceTreeRegrowthState(
  state: Readonly<TreeRegrowthState>,
  clockTick: number,
): TreeRegrowthState | null {
  return normalizeTreeRegrowthState(state, clockTick);
}

export function treeRegrowthEffectiveGrowthStage(
  stage: TreeRegrowthStage,
): EffectiveTreeGrowthStage | null {
  if (stage === "stump") return null;
  return stage;
}

/** Effective maximum durability relative to a fully mature tree. */
export function treeRegrowthDurabilityRatio(
  stage: TreeRegrowthStage,
): number {
  if (stage === "stump") return 0;
  if (stage === "sapling") return 0.2;
  if (stage === "young") return 0.55;
  return 1;
}
