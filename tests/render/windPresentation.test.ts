import assert from "node:assert/strict";
import test from "node:test";
import {
  projectWindPresentation,
  stableWindObjectPhase,
  type WindPerceptionChannel,
} from "../../src/game/render/windPresentation";
import { createWindFieldState } from "../../src/game/world/windField";

test("one field projects the same world direction into leaves, rain and audio", () => {
  const presentation = projectWindPresentation({
    directionRadians: Math.PI / 2,
    speed: 0.31,
    gust: 0.6,
  });

  assert.equal(presentation.valid, true);
  assert.equal(presentation.strength, 0.6);
  assert.equal(presentation.strengthBand, "strong");
  assert.equal(presentation.directionSector, "east");
  assert.ok(Math.abs(presentation.worldDirection.x - 1) < 1e-12);
  assert.ok(Math.abs(presentation.worldDirection.z) < 1e-12);
  assert.equal(
    presentation.rainLines.directionX,
    presentation.worldDirection.x,
  );
  assert.equal(
    presentation.canopy.directionZ,
    presentation.worldDirection.z,
  );
  assert.equal(
    presentation.soundscape.flowDirectionX,
    presentation.worldDirection.x,
  );
});

test("stable ids change phase but never change directional truth", () => {
  const wind = createWindFieldState("phase-contract", 4_321);
  const leafA = projectWindPresentation(wind, {
    stableObjectId: "banana-leaf:a",
  });
  const leafARepeat = projectWindPresentation(wind, {
    stableObjectId: "banana-leaf:a",
  });
  const leafB = projectWindPresentation(wind, {
    stableObjectId: "banana-leaf:b",
  });

  assert.deepEqual(leafA, leafARepeat);
  assert.notEqual(leafA.canopy.phaseRadians, leafB.canopy.phaseRadians);
  assert.deepEqual(leafA.worldDirection, leafB.worldDirection);
  assert.deepEqual(leafA.rainLines, leafB.rainLines);
  assert.deepEqual(leafA.soundscape, leafB.soundscape);
  assert.equal(
    stableWindObjectPhase("banana-leaf:a"),
    stableWindObjectPhase("banana-leaf:a"),
  );
});

test("low-power keeps redundant wind channels with a 16-particle cap", () => {
  const wind = createWindFieldState("low-power", 9_876);
  const full = projectWindPresentation(wind, { quality: "full" });
  const lowPower = projectWindPresentation(wind, { quality: "low-power" });

  assert.equal(full.budget.fallingLeafParticleLimit, 48);
  assert.equal(full.budget.minimumIndicatorLeafCount, 8);
  assert.equal(lowPower.budget.fallingLeafParticleLimit, 16);
  assert.equal(lowPower.budget.minimumIndicatorLeafCount, 4);
  const environmental = new Set<WindPerceptionChannel>([
    "indicator-leaves",
    "rain-lines",
    "directional-audio",
  ]);
  assert.ok(
    lowPower.availableChannels.filter((channel) => environmental.has(channel))
      .length >= 2,
  );
  assert.ok(lowPower.availableChannels.includes("text-sector"));
});

test("reduced motion lowers movement while preserving static readable cues", () => {
  const wind = {
    directionRadians: Math.PI,
    speed: 0.55,
    gust: 0.82,
  };
  const full = projectWindPresentation(wind, {
    stableObjectId: "indicator:1",
  });
  const reduced = projectWindPresentation(wind, {
    stableObjectId: "indicator:1",
    reducedMotion: true,
  });

  assert.equal(reduced.motionMode, "reduced");
  assert.ok(
    reduced.canopy.swayAmplitudeRadians <=
      full.canopy.swayAmplitudeRadians * 0.2,
  );
  assert.ok(
    reduced.canopy.swayFrequencyHertz <=
      full.canopy.swayFrequencyHertz * 0.31,
  );
  assert.equal(
    reduced.leafUnderside.flipAmount,
    full.leafUnderside.flipAmount,
  );
  assert.deepEqual(reduced.rainLines, full.rainLines);
  assert.equal(reduced.directionSector, full.directionSector);
  assert.ok(reduced.availableChannels.includes("indicator-leaves"));
  assert.ok(reduced.availableChannels.includes("rain-lines"));
  assert.ok(reduced.availableChannels.includes("text-sector"));
});

test("NaN fails closed and finite outliers remain bounded", () => {
  for (const invalid of [
    { directionRadians: Number.NaN, speed: 0.5, gust: 0.6 },
    { directionRadians: 1, speed: Number.NaN, gust: 0.6 },
    { directionRadians: 1, speed: 0.5, gust: Number.POSITIVE_INFINITY },
  ]) {
    const result = projectWindPresentation(invalid, { quality: "low-power" });
    assert.equal(result.valid, false);
    assert.equal(result.directionSector, "unknown");
    assert.deepEqual(result.worldDirection, { x: 0, z: 0 });
    assert.equal(result.budget.fallingLeafParticleLimit, 16);
  }

  const bounded = projectWindPresentation({
    directionRadians: -Math.PI / 2,
    speed: -4,
    gust: 3,
  });
  assert.equal(bounded.valid, true);
  assert.equal(bounded.strength, 1);
  assert.equal(bounded.strengthBand, "gust");
  assert.ok(Math.abs(bounded.worldDirection.x + 1) < 1e-12);
  assert.ok(Math.abs(bounded.worldDirection.z) < 1e-12);
  const normalizedValues = [
    bounded.strength,
    bounded.rainLines.tiltNormalized,
    bounded.leafUnderside.flipAmount,
    bounded.soundscape.windBedGain,
    bounded.soundscape.rustleGain,
    bounded.soundscape.gustAccentGain,
    bounded.soundscape.directionalBlend,
  ];
  assert.ok(normalizedValues.every((value) => value >= 0 && value <= 1));
  assert.ok(
    bounded.rainLines.tiltRadians >= 0 &&
      bounded.rainLines.tiltRadians <= Math.PI / 6,
  );
});
