import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPFIRE_FEEDBACK_LIMITS,
  resolveCampfireFeedback,
  resolveEffectiveReducedMotion,
} from "../../src/game/render/campfireFeedback";
import type {
  CampfireFeedbackEvent,
  CampfireFeedbackInput,
  CampfireFeedbackTargets,
} from "../../src/game/render/campfireFeedback";
import type { GameEventType } from "../../src/game/sim";

function event(
  id: number,
  type: GameEventType,
  details?: Record<string, string | number | boolean>,
): CampfireFeedbackEvent {
  return {
    id,
    type,
    details,
    cause: {
      source: type === "fire-extinguished" ? "system" : "command",
      code: type,
    },
  };
}

function feedback(
  overrides: Partial<CampfireFeedbackInput> = {},
): CampfireFeedbackTargets {
  return resolveCampfireFeedback({
    built: true,
    lit: true,
    fuelSeconds: 500,
    fuelCapacitySeconds: 1_000,
    reducedMotion: false,
    authoritativeEvents: [],
    lastProcessedEventId: 0,
    ...overrides,
  });
}

test("authoritative fire state resolves every visual stage and a clamped ratio", () => {
  assert.equal(feedback({ built: false }).stage, "unbuilt");
  assert.equal(
    feedback({ lit: false, fuelSeconds: 0 }).stage,
    "cold",
  );
  assert.equal(
    feedback({ lit: false, fuelSeconds: 200 }).stage,
    "embers",
  );
  assert.equal(feedback({ fuelSeconds: 100 }).stage, "low");
  assert.equal(feedback({ fuelSeconds: 500 }).stage, "steady");
  assert.equal(feedback({ fuelSeconds: 1_000 }).stage, "full");
  assert.equal(feedback({ fuelSeconds: 2_000 }).fuelRatio, 1);
  assert.equal(feedback({ fuelSeconds: -20 }).fuelRatio, 0);
});

test("static flame, light, ember, char, and audio targets stay finite and bounded", () => {
  const cases = [
    feedback({ built: false }),
    feedback({ lit: false, fuelSeconds: 0 }),
    feedback({ lit: false, fuelSeconds: 200 }),
    feedback({ fuelSeconds: 100 }),
    feedback({ fuelSeconds: 500 }),
    feedback({ fuelSeconds: 1_000 }),
    feedback({ fuelSeconds: Number.NaN }),
    feedback({ fuelSeconds: 100, fuelCapacitySeconds: 0 }),
    feedback({ fuelSeconds: 100, fuelCapacitySeconds: Number.NaN }),
  ];
  for (const result of cases) {
    assert.ok(Number.isFinite(result.fuelRatio));
    assert.ok(result.fuelRatio >= 0 && result.fuelRatio <= 1);
    assert.ok(result.flame.heightScale >= 0);
    assert.ok(
      result.flame.heightScale <= CAMPFIRE_FEEDBACK_LIMITS.flameScale,
    );
    assert.ok(result.flame.widthScale >= 0);
    assert.ok(
      result.flame.widthScale <= CAMPFIRE_FEEDBACK_LIMITS.flameScale,
    );
    assert.ok(result.flame.opacity >= 0 && result.flame.opacity <= 1);
    assert.ok(result.light.intensity >= 0);
    assert.ok(
      result.light.intensity <= CAMPFIRE_FEEDBACK_LIMITS.lightIntensity,
    );
    assert.ok(result.light.range >= 0);
    assert.ok(result.light.range <= CAMPFIRE_FEEDBACK_LIMITS.lightRange);
    assert.ok(result.embers.glow >= 0 && result.embers.glow <= 1);
    assert.ok(result.embers.opacity >= 0 && result.embers.opacity <= 1);
    assert.ok(result.embers.sparkRatePerSecond >= 0);
    assert.ok(
      result.embers.sparkRatePerSecond <=
        CAMPFIRE_FEEDBACK_LIMITS.emberSparkRate,
    );
    assert.ok(result.logChar.amount >= 0 && result.logChar.amount <= 1);
    assert.ok(result.logChar.emberTint >= 0 && result.logChar.emberTint <= 1);
    assert.ok(result.audio.loopGain >= 0);
    assert.ok(result.audio.loopGain <= CAMPFIRE_FEEDBACK_LIMITS.audioGain);
    assert.ok(result.audio.crackleRatePerSecond >= 0);
    assert.ok(
      result.audio.crackleRatePerSecond <=
        CAMPFIRE_FEEDBACK_LIMITS.crackleRate,
    );
    assert.ok(Number.isFinite(result.audio.lowPassHertz));
  }
  assert.equal(
    feedback({ fuelSeconds: Number.NaN }).stage,
    "cold",
    "invalid fuel cannot leave a flame active",
  );
  assert.equal(
    feedback({ fuelSeconds: 100, fuelCapacitySeconds: 0 }).stage,
    "cold",
    "zero capacity fails closed",
  );
});

test("fuel-added feedback is deterministic, deduplicated, and ordered by event id", () => {
  const fuelAdded = event(3, "fuel-added", { fuelAddedSeconds: 300 });
  const ignition = event(4, "fire-lit");
  const first = feedback({
    authoritativeEvents: [ignition, fuelAdded, fuelAdded],
    lastProcessedEventId: 2,
  });
  const repeatedCalculation = feedback({
    authoritativeEvents: [fuelAdded, ignition],
    lastProcessedEventId: 2,
  });
  assert.deepEqual(first.transients, repeatedCalculation.transients);
  assert.deepEqual(
    first.transients.map((descriptor) => descriptor.eventId),
    [3, 4],
  );
  const added = first.transients[0];
  assert.equal(added.kind, "fuel-added");
  assert.equal(added.visualCue, "log-drop-sparks");
  assert.equal(added.logDrop.enabled, true);
  assert.ok(added.sparkCount >= 8 && added.sparkCount <= 12);

  const nextFrame = feedback({
    authoritativeEvents: [ignition, fuelAdded],
    lastProcessedEventId: first.lastProcessedEventId,
  });
  assert.equal(nextFrame.transients.length, 0);
  assert.equal(nextFrame.lastProcessedEventId, 4);
});

test("one cold-relight command coalesces its fuel drop and ignition into one audiovisual beat", () => {
  const fuelAdded = event(12, "fuel-added", { fuelAddedSeconds: 300 });
  const ignition = event(13, "fire-lit");
  fuelAdded.cause.code = "add-fuel";
  ignition.cause.code = "add-fuel";
  const result = feedback({
    authoritativeEvents: [fuelAdded, ignition],
    lastProcessedEventId: 11,
  });

  assert.equal(result.transients.length, 1);
  assert.equal(result.transients[0].eventId, 13);
  assert.equal(result.transients[0].kind, "fire-lit");
  assert.equal(result.transients[0].visualCue, "ignition-bloom");
  assert.equal(result.transients[0].logDrop.enabled, true);
  assert.equal(result.transients[0].audioCue, "fire-ignite");

  const unrelatedFuel = event(20, "fuel-added", { fuelAddedSeconds: 300 });
  const unrelatedIgnition = event(21, "fire-lit");
  unrelatedFuel.cause.code = "add-fuel";
  unrelatedIgnition.cause.code = "craft:campfire";
  assert.equal(
    feedback({
      authoritativeEvents: [unrelatedFuel, unrelatedIgnition],
      lastProcessedEventId: 19,
    }).transients.length,
    2,
  );
});

test("save hydration consumes replayed events without replaying their effects", () => {
  const oldEvents = [
    event(5, "fuel-added", { fuelAddedSeconds: 300 }),
    event(6, "fire-lit"),
  ];
  const hydrated = feedback({
    authoritativeEvents: oldEvents,
    lastProcessedEventId: null,
  });
  assert.equal(hydrated.transients.length, 0);
  assert.equal(hydrated.lastProcessedEventId, 6);

  const live = feedback({
    authoritativeEvents: [
      event(7, "fire-extinguished"),
      ...oldEvents,
    ],
    lastProcessedEventId: hydrated.lastProcessedEventId,
  });
  assert.equal(live.transients.length, 1);
  assert.equal(live.transients[0].kind, "fire-extinguished");
  assert.equal(live.transients[0].visualCue, "smoke-collapse");
  assert.equal(live.transients[0].audioCue, "fire-extinguish");
});

test("blocked, full-fuel, and zero-addition events never create transients", () => {
  const result = feedback({
    authoritativeEvents: [
      event(2, "command-rejected", {
        fuelSeconds: 1_000,
        fuelCapacitySeconds: 1_000,
      }),
      event(3, "fuel-added", { fuelAddedSeconds: 0 }),
      event(4, "fuel-added", { fuelAddedSeconds: -1 }),
      event(5, "fuel-added", { fuelAddedSeconds: Number.NaN }),
      event(6, "craft-failed"),
    ],
    lastProcessedEventId: 1,
  });
  assert.equal(result.transients.length, 0);
  assert.equal(result.lastProcessedEventId, 6);
});

test("ignition and extinguish have distinct feedback while reduced motion preserves cues", () => {
  const regular = feedback({
    authoritativeEvents: [event(2, "fire-lit"), event(3, "fire-extinguished")],
    lastProcessedEventId: 1,
  });
  assert.deepEqual(
    regular.transients.map((descriptor) => descriptor.visualCue),
    ["ignition-bloom", "smoke-collapse"],
  );
  const reduced = feedback({
    reducedMotion: true,
    authoritativeEvents: [
      event(2, "fuel-added", { fuelAddedSeconds: 300 }),
      event(3, "fire-lit"),
      event(4, "fire-extinguished"),
    ],
    lastProcessedEventId: 1,
  });
  assert.equal(reduced.transients.length, 3);
  assert.ok(reduced.transients.every((descriptor) => descriptor.motionScale > 0));
  assert.ok(
    reduced.transients.every(
      (descriptor) =>
        descriptor.durationMs > 0 &&
        descriptor.durationMs <=
          CAMPFIRE_FEEDBACK_LIMITS.transientDurationMs,
    ),
  );
  assert.equal(reduced.transients[0].logDrop.enabled, true);
  assert.ok(
    reduced.transients[0].sparkCount >= 8 &&
      reduced.transients[0].sparkCount <= 12,
  );
  assert.equal(reduced.flame.visible, true);
  assert.ok(reduced.flame.flickerAmplitude > 0);
  assert.ok(
    reduced.flame.flickerAmplitude < regular.flame.flickerAmplitude,
  );
});

test("ambiguous duplicate ids and invalid ids fail closed with a bounded queue", () => {
  const manyEvents = Array.from({ length: 8 }, (_, index) =>
    event(index + 2, "fuel-added", { fuelAddedSeconds: 300 }),
  );
  const ambiguousId = 20;
  const result = feedback({
    authoritativeEvents: [
      ...manyEvents.reverse(),
      event(ambiguousId, "fire-lit"),
      event(ambiguousId, "fire-extinguished"),
      event(Number.NaN, "fire-lit"),
      event(Number.MAX_SAFE_INTEGER + 1, "fire-lit"),
    ],
    lastProcessedEventId: 1,
  });
  assert.equal(
    result.transients.length,
    CAMPFIRE_FEEDBACK_LIMITS.maximumTransientDescriptors,
  );
  assert.deepEqual(
    result.transients.map((descriptor) => descriptor.eventId),
    [6, 7, 8, 9],
  );
  assert.equal(result.lastProcessedEventId, ambiguousId);
  assert.ok(
    result.transients.every(
      (descriptor) => descriptor.eventId !== ambiguousId,
    ),
  );
});

test("effective reduced motion honors either the player or operating-system preference", () => {
  assert.equal(resolveEffectiveReducedMotion(false, false), false);
  assert.equal(resolveEffectiveReducedMotion(true, false), true);
  assert.equal(resolveEffectiveReducedMotion(false, true), true);
  assert.equal(resolveEffectiveReducedMotion(true, true), true);
});
