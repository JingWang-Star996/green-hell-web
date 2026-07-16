import assert from "node:assert/strict";
import test from "node:test";
import {
  RIVER_HYDROLOGY_MAX_LEVEL_METERS,
  RIVER_HYDROLOGY_MIN_LEVEL_METERS,
  advanceRiverHydrology,
  createRiverHydrologyState,
  normalizeRiverHydrologyState,
  riverLevelTrend,
} from "../../src/game/world/riverHydrology";

test("catchment response is deterministic for equal weather intervals", () => {
  const initial = createRiverHydrologyState(0);
  const once = advanceRiverHydrology(initial, {
    tick: 900,
    rainIntensity: 0.86,
    stormActive: true,
  });
  let stepped = initial;
  for (let tick = 30; tick <= 900; tick += 30) {
    stepped = advanceRiverHydrology(stepped, {
      tick,
      rainIntensity: 0.86,
      stormActive: true,
    });
  }

  assert.ok(Math.abs(once.runoff - stepped.runoff) < 1e-12);
  assert.ok(Math.abs(once.levelMeters - stepped.levelMeters) < 1e-12);
  assert.equal(once.lastAdvancedTick, 900);
});

test("heavy rain raises delayed runoff and reports a rising river", () => {
  const wet = advanceRiverHydrology(createRiverHydrologyState(0), {
    tick: 1_800,
    rainIntensity: 1,
    stormActive: true,
  });

  assert.ok(wet.runoff > 0.7);
  assert.ok(wet.levelMeters > 0.2);
  assert.equal(riverLevelTrend(wet), "rising");
});

test("rain stopping drains more slowly and eventually lowers the river", () => {
  const peak = advanceRiverHydrology(createRiverHydrologyState(0), {
    tick: 4_500,
    rainIntensity: 1,
    stormActive: true,
  });
  const earlyDrain = advanceRiverHydrology(peak, {
    tick: 4_800,
    rainIntensity: 0,
    stormActive: false,
  });
  const lateDrain = advanceRiverHydrology(earlyDrain, {
    tick: 13_800,
    rainIntensity: 0,
    stormActive: false,
  });

  assert.ok(earlyDrain.levelMeters > 0.15, "river should retain runoff after rain stops");
  assert.ok(lateDrain.levelMeters < earlyDrain.levelMeters);
  assert.equal(riverLevelTrend(lateDrain), "falling");
});

test("malformed saved hydrology is bounded and cannot rewind its tick", () => {
  const normalized = normalizeRiverHydrologyState({
    version: 1,
    levelMeters: 99,
    runoff: -8,
    trendMetersPerGameHour: Number.NaN,
    lastAdvancedTick: 120,
  });
  const noRewind = advanceRiverHydrology(normalized, {
    tick: 60,
    rainIntensity: 1,
    stormActive: true,
  });

  assert.equal(normalized.levelMeters, RIVER_HYDROLOGY_MAX_LEVEL_METERS);
  assert.equal(normalized.runoff, 0);
  assert.equal(noRewind.lastAdvancedTick, 120);
  assert.ok(noRewind.levelMeters >= RIVER_HYDROLOGY_MIN_LEVEL_METERS);
  assert.ok(noRewind.levelMeters <= RIVER_HYDROLOGY_MAX_LEVEL_METERS);
});
