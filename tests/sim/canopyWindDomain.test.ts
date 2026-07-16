import assert from "node:assert/strict";
import test from "node:test";

import {
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  CANOPY_SAMPLE_MIN_STRENGTH,
  CANOPY_SAMPLE_STABLE_TICKS,
  advanceCanopyJunctionSampling,
  canopyJunctionObstructionCleared,
  createCanopyJunctionState,
  normalizeCanopyJunctionState,
  recordCanopyObstructionCleared,
  transitionCanopyJunctionPhase,
} from "../../src/game/sim/canopyJunction";
import {
  CAMPAIGN_FACTS,
  CANOPY_WIND_TASK,
  EMERGENCY_CANOPY_RESPONSE,
  campaignTaskSatisfied,
  canopyRadioMessageForPhase,
  canopyReportReady,
  preparedCanopyExpeditionFacts,
  radioResponseDue,
} from "../../src/game/sim/campaignContent";
import {
  recordObjectiveFact,
  type ObjectiveFactRecord,
} from "../../src/game/sim/objectiveFacts";
import { TASK_SEQUENCE } from "../../src/game/sim/content";
import {
  WIND_GUST_INTERVAL_TICKS,
  advanceWindField,
  createWindFieldState,
  normalizeWindFieldState,
  windFieldStrength,
} from "../../src/game/world/windField";

function repairedJunction(tick = 0) {
  let junction = createCanopyJunctionState(tick);
  junction = recordCanopyObstructionCleared(
    junction,
    CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
    tick,
  );
  junction = transitionCanopyJunctionPhase(junction, "connector-open", tick);
  junction = transitionCanopyJunctionPhase(junction, "link-restored", tick);
  return junction;
}

function firstStableGustEndTick(seed: number): number {
  let consecutive = 0;
  for (let tick = 1; tick <= WIND_GUST_INTERVAL_TICKS * 2; tick += 1) {
    const strength = windFieldStrength(createWindFieldState(seed, tick));
    consecutive = strength >= CANOPY_SAMPLE_MIN_STRENGTH
      ? consecutive + 1
      : 0;
    if (consecutive >= CANOPY_SAMPLE_STABLE_TICKS) return tick;
  }
  throw new Error("deterministic wind failed to provide a stable gust window");
}

test("wind authority is deterministic, bounded, and independent of advance partitioning", () => {
  const seed = 42;
  const targetTick = 9_123;
  const direct = createWindFieldState(seed, targetTick);
  const partitioned = advanceWindField(
    advanceWindField(createWindFieldState(seed, 0), {
      worldSeed: seed,
      tick: 2_345,
    }),
    { worldSeed: seed, tick: targetTick },
  );
  assert.deepEqual(partitioned, direct);
  assert.ok(direct.directionRadians >= 0 && direct.directionRadians < Math.PI * 2);
  assert.ok(direct.speed >= 0 && direct.speed <= 1);
  assert.ok(direct.gust >= 0 && direct.gust <= 1);
  assert.ok(direct.nextFrontTick > direct.lastAdvancedTick);

  const normalized = normalizeWindFieldState(
    {
      ...direct,
      directionRadians: Number.NaN,
      speed: 99,
      gust: -99,
    },
    seed,
    0,
  );
  assert.deepEqual(normalized, direct);
});

test("C-17 clearing routes and transitions fail closed until real obstruction evidence exists", () => {
  const untouched = createCanopyJunctionState(0);
  assert.equal(canopyJunctionObstructionCleared([]), false);
  assert.equal(
    transitionCanopyJunctionPhase(untouched, "connector-open", 1).phase,
    "obstructed",
  );

  const cleared = recordCanopyObstructionCleared(
    untouched,
    CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
    10,
  );
  assert.equal(cleared.phase, "exposed");
  assert.equal(canopyJunctionObstructionCleared(cleared.clearedObstructionIds), true);
  assert.equal(
    transitionCanopyJunctionPhase(cleared, "link-restored", 11).phase,
    "exposed",
  );

  const inconsistent = normalizeCanopyJunctionState(
    {
      ...repairedJunction(20),
      clearedObstructionIds: [],
      phase: "sample-ready",
      sample: {
        directionRadians: 1,
        strength: 0.8,
        signalQuality: 0.9,
        capturedAtTick: 20,
        stableTicks: CANOPY_SAMPLE_STABLE_TICKS,
      },
    },
    20,
  );
  assert.equal(inconsistent.phase, "obstructed");
  assert.equal(inconsistent.sample, null);
});

test("C-17 sampling reaches the same saved sample in one advance or several", () => {
  const seed = 42;
  const endTick = firstStableGustEndTick(seed);
  assert.ok(endTick <= WIND_GUST_INTERVAL_TICKS * 2);
  const repaired = repairedJunction(0);
  const direct = advanceCanopyJunctionSampling(repaired, {
    worldSeed: seed,
    tick: endTick,
  });
  const split = advanceCanopyJunctionSampling(
    advanceCanopyJunctionSampling(repaired, {
      worldSeed: seed,
      tick: Math.floor(endTick / 2),
    }),
    { worldSeed: seed, tick: endTick },
  );
  assert.deepEqual(split, direct);
  assert.equal(direct.phase, "sample-ready");
  assert.equal(direct.sample?.capturedAtTick, endTick);
  assert.ok((direct.sample?.strength ?? 0) >= CANOPY_SAMPLE_MIN_STRENGTH);
  assert.equal(direct.sample?.stableTicks, CANOPY_SAMPLE_STABLE_TICKS);
});

test("A2 fact graph is order-independent, requires one preparation, and follows A1", () => {
  assert.equal(TASK_SEQUENCE.at(-1), "canopy-wind");
  assert.equal(TASK_SEQUENCE.at(-2), "river-rising");
  const inventory = {
    axe: 1,
    torch: 1,
    "clean-water": 2,
    "palm-fruit": 2,
  };
  const before = structuredClone(inventory);
  assert.deepEqual(preparedCanopyExpeditionFacts(inventory), [
    CAMPAIGN_FACTS.canopyRepairKitPrepared,
    CAMPAIGN_FACTS.canopyProvisioned,
  ]);
  assert.deepEqual(inventory, before);

  let facts: ObjectiveFactRecord[] = [];
  for (const [index, reference] of [
    CAMPAIGN_FACTS.canopyWindSampleReported,
    CAMPAIGN_FACTS.canopyLiveSampleObserved,
    CAMPAIGN_FACTS.canopyLinkRestored,
    CAMPAIGN_FACTS.canopyContradictionObserved,
    CAMPAIGN_FACTS.canopyRequestHeard,
  ].entries()) {
    facts = recordObjectiveFact(facts, reference, index + 1);
  }
  assert.equal(canopyReportReady(facts), false);
  assert.equal(campaignTaskSatisfied(facts, CANOPY_WIND_TASK), false);
  facts = recordObjectiveFact(
    facts,
    CAMPAIGN_FACTS.canopyForwardOutpostPrepared,
    10,
  );
  assert.equal(canopyReportReady(facts), true);
  assert.equal(campaignTaskSatisfied(facts, CANOPY_WIND_TASK), true);
});

test("A2 delayed response and early-discovery radio variants are deterministic", () => {
  let facts: ObjectiveFactRecord[] = [];
  facts = recordObjectiveFact(facts, CAMPAIGN_FACTS.riverTrendReported, 100);
  assert.equal(
    radioResponseDue(facts, 399, EMERGENCY_CANOPY_RESPONSE),
    false,
  );
  assert.equal(
    radioResponseDue(facts, 400, EMERGENCY_CANOPY_RESPONSE),
    true,
  );
  assert.match(canopyRadioMessageForPhase("obstructed"), /零值|静风/);
  assert.match(canopyRadioMessageForPhase("exposed"), /找到|现场/);
  assert.match(canopyRadioMessageForPhase("sample-ready"), /恢复|样本/);
  assert.match(canopyRadioMessageForPhase("reported"), /收到|失联/);
});
