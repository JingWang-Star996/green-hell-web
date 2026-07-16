import assert from "node:assert/strict";
import test from "node:test";

import {
  TREE_REGROWTH_STUMP_HOURS,
  TREE_REGROWTH_TOTAL_HOURS,
  advanceTreeRegrowthState,
  createTreeRegrowthState,
  generateTreeRegrowthSchedule,
  normalizeTreeRegrowthState,
  treeRegrowthDurabilityRatio,
  treeRegrowthEffectiveGrowthStage,
  treeRegrowthStageAtTick,
  type TreeRegrowthState,
} from "../../src/game/sim/treeRegrowth";
import { gameHoursToTicks } from "../../src/game/sim/time";

test("at least twenty seeds produce stable bounded seven-to-ten-day schedules", () => {
  for (let index = 0; index < 32; index += 1) {
    const seed = `tree-regrowth-seed-${index}`;
    const first = generateTreeRegrowthSchedule(seed, "tree.central-01", 0, 123);
    const second = generateTreeRegrowthSchedule(seed, "tree.central-01", 0, 123);
    assert.ok(first, seed);
    assert.deepEqual(first, second, seed);
    if (!first) continue;

    assert.ok(
      first.saplingAtTick - first.stumpStartedAtTick >=
        gameHoursToTicks(TREE_REGROWTH_STUMP_HOURS.minimum),
      seed,
    );
    const total = first.matureAtTick - first.stumpStartedAtTick;
    assert.ok(total >= gameHoursToTicks(TREE_REGROWTH_TOTAL_HOURS.minimum), seed);
    assert.ok(total <= gameHoursToTicks(TREE_REGROWTH_TOTAL_HOURS.maximum), seed);
  }
});

test("each exact boundary enters the next legal stage", () => {
  const state = createTreeRegrowthState("stage-boundaries", "tree.1", 0, 50);
  assert.ok(state);
  if (!state) return;
  const { schedule } = state;

  assert.equal(treeRegrowthStageAtTick(schedule, schedule.saplingAtTick - 1), "stump");
  assert.equal(treeRegrowthStageAtTick(schedule, schedule.saplingAtTick), "sapling");
  assert.equal(treeRegrowthStageAtTick(schedule, schedule.youngAtTick - 1), "sapling");
  assert.equal(treeRegrowthStageAtTick(schedule, schedule.youngAtTick), "young");
  assert.equal(treeRegrowthStageAtTick(schedule, schedule.matureAtTick - 1), "young");
  assert.equal(treeRegrowthStageAtTick(schedule, schedule.matureAtTick), "mature");
});

test("partitioned advancement and one long rest resolve to the same mature state", () => {
  const initial = createTreeRegrowthState("long-rest", "tree.2", 4, 0);
  assert.ok(initial);
  if (!initial) return;
  const finalTick = initial.schedule.matureAtTick + gameHoursToTicks(24);

  const afterSapling = advanceTreeRegrowthState(initial, initial.schedule.saplingAtTick);
  assert.ok(afterSapling);
  const afterYoung = afterSapling
    ? advanceTreeRegrowthState(afterSapling, initial.schedule.youngAtTick)
    : null;
  assert.ok(afterYoung);
  const partitioned = afterYoung
    ? advanceTreeRegrowthState(afterYoung, finalTick)
    : null;
  const direct = advanceTreeRegrowthState(initial, finalTick);

  assert.deepEqual(direct, partitioned);
  assert.equal(direct?.stage, "mature");
  assert.equal(direct?.stageStartedAtTick, initial.schedule.matureAtTick);
  assert.equal(direct?.lastAdvancedTick, finalTick);
});

test("JSON round-trips normalize without mutating the serialized source", () => {
  const initial = createTreeRegrowthState("json-roundtrip", "tree.3", 1, 77);
  assert.ok(initial);
  if (!initial) return;
  const young = advanceTreeRegrowthState(initial, initial.schedule.youngAtTick);
  assert.ok(young);
  if (!young) return;

  const serialized = JSON.stringify(young);
  const parsed: unknown = JSON.parse(serialized);
  const normalized = normalizeTreeRegrowthState(parsed, young.lastAdvancedTick);

  assert.deepEqual(normalized, young);
  assert.equal(JSON.stringify(parsed), serialized);
  assert.equal(initial.stage, "stump", "advancement is side-effect free");
});

test("different cycles vary the deterministic schedule without changing its bounds", () => {
  const schedules = Array.from({ length: 12 }, (_, cycle) =>
    generateTreeRegrowthSchedule("cycle-variation", "tree.4", cycle, 0),
  );
  assert.ok(schedules.every(Boolean));
  assert.ok(
    new Set(schedules.map((schedule) => JSON.stringify(schedule))).size > 1,
    "cycle participates in the deterministic seed",
  );

  const nextCycle = createTreeRegrowthState("cycle-variation", "tree.4", 9, 0);
  assert.equal(nextCycle?.cycle, 9);
});

test("invalid generation inputs and clock ticks fail closed", () => {
  assert.equal(generateTreeRegrowthSchedule(Number.NaN, "tree", 0, 0), null);
  assert.equal(generateTreeRegrowthSchedule(-1, "tree", 0, 0), null);
  assert.equal(generateTreeRegrowthSchedule(" ", "tree", 0, 0), null);
  assert.equal(generateTreeRegrowthSchedule(1, "", 0, 0), null);
  assert.equal(generateTreeRegrowthSchedule(1, " ", 0, 0), null);
  assert.equal(generateTreeRegrowthSchedule(1, "tree", -1, 0), null);
  assert.equal(generateTreeRegrowthSchedule(1, "tree", 0.5, 0), null);
  assert.equal(generateTreeRegrowthSchedule(1, "tree", 0, -1), null);
  assert.equal(
    generateTreeRegrowthSchedule(1, "tree", 0, Number.MAX_SAFE_INTEGER),
    null,
  );

  const state = createTreeRegrowthState("invalid-clock", "tree.5", 0, 100);
  assert.ok(state);
  if (!state) return;
  assert.equal(advanceTreeRegrowthState(state, Number.NaN), null);
  assert.equal(advanceTreeRegrowthState(state, -1), null);
  assert.equal(advanceTreeRegrowthState(state, 99), null);
});

test("malformed, reversed, or internally contradictory persisted states fail closed", () => {
  const state = createTreeRegrowthState("malicious", "tree.6", 0, 0);
  assert.ok(state);
  if (!state) return;

  const malformed: unknown[] = [
    null,
    {},
    { ...state, version: 2 },
    { ...state, cycle: -1 },
    { ...state, lastAdvancedTick: Number.POSITIVE_INFINITY },
    {
      ...state,
      schedule: { ...state.schedule, saplingAtTick: -1 },
    },
    {
      ...state,
      schedule: {
        ...state.schedule,
        youngAtTick: state.schedule.saplingAtTick - 1,
      },
    },
    { ...state, stage: "mature" },
    { ...state, stageStartedAtTick: 1 },
  ];
  for (const value of malformed) {
    assert.equal(normalizeTreeRegrowthState(value, 0), null);
  }

  const sapling = advanceTreeRegrowthState(state, state.schedule.saplingAtTick);
  assert.ok(sapling);
  if (!sapling) return;
  assert.equal(
    normalizeTreeRegrowthState(sapling, sapling.lastAdvancedTick - 1),
    null,
    "clock rewind is rejected",
  );
});

test("stage profiles expose effective growth and bounded durability", () => {
  assert.equal(treeRegrowthEffectiveGrowthStage("stump"), null);
  assert.equal(treeRegrowthEffectiveGrowthStage("sapling"), "sapling");
  assert.equal(treeRegrowthEffectiveGrowthStage("young"), "young");
  assert.equal(treeRegrowthEffectiveGrowthStage("mature"), "mature");

  assert.equal(treeRegrowthDurabilityRatio("stump"), 0);
  assert.ok(treeRegrowthDurabilityRatio("sapling") > 0);
  assert.ok(
    treeRegrowthDurabilityRatio("young") >
      treeRegrowthDurabilityRatio("sapling"),
  );
  assert.equal(treeRegrowthDurabilityRatio("mature"), 1);
});

test("typed but inconsistent state is still treated as untrusted", () => {
  const initial = createTreeRegrowthState("typed-invalid", "tree.7", 0, 0);
  assert.ok(initial);
  if (!initial) return;
  const contradictory = {
    ...initial,
    stage: "young",
  } as TreeRegrowthState;
  assert.equal(advanceTreeRegrowthState(contradictory, 0), null);
});
