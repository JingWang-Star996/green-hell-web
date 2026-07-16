import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioEngine,
  CampfireAudioEventBuffer,
  campfireTransientPeakGain,
} from "../../src/game/audio/AudioEngine";
import { resolveCampfireFeedback } from "../../src/game/render/campfireFeedback";
import type { GameEvent } from "../../src/game/sim/types";

function transient(eventId: number) {
  const event: GameEvent = {
    id: eventId,
    tick: eventId,
    elapsedSeconds: eventId,
    type: "fuel-added",
    message: "fuel",
    cause: { source: "command", code: "add-fuel" },
    details: { fuelAddedSeconds: 100 },
  };
  return resolveCampfireFeedback({
    built: true,
    lit: true,
    fuelSeconds: 500,
    fuelCapacitySeconds: 900,
    reducedMotion: false,
    authoritativeEvents: [event],
    lastProcessedEventId: eventId - 1,
  }).transients[0];
}

test("suspended audio queues bounded events and only marks ids seen after successful playback", () => {
  const buffer = new CampfireAudioEventBuffer();
  const first = transient(1);
  assert.equal(buffer.submit(first, () => false), "queued");
  assert.deepEqual(buffer.getDebugState(), { pending: 1, seen: 0 });
  assert.equal(buffer.submit(first, () => true), "duplicate");
  assert.equal(buffer.flush(() => false), 0);
  assert.deepEqual(buffer.getDebugState(), { pending: 1, seen: 0 });

  const played: number[] = [];
  assert.equal(
    buffer.flush((candidate) => {
      played.push(candidate.eventId);
      return true;
    }),
    1,
  );
  assert.deepEqual(played, [1]);
  assert.deepEqual(buffer.getDebugState(), { pending: 0, seen: 1 });
  assert.equal(buffer.submit(first, () => true), "duplicate");

  for (let id = 2; id <= 14; id += 1) {
    buffer.submit(transient(id), () => false);
  }
  assert.deepEqual(buffer.getDebugState(), { pending: 8, seen: 1 });
});

test("new-run audio reset drops pending cues and immediately clears stale loop gain", () => {
  const engine = new AudioEngine();
  const feedback = resolveCampfireFeedback({
    built: true,
    lit: true,
    fuelSeconds: 800,
    fuelCapacitySeconds: 900,
    reducedMotion: false,
    authoritativeEvents: [],
    lastProcessedEventId: 0,
  });
  engine.applyCampfireFeedback(feedback.audio);
  engine.presentCampfireTransient(transient(40));
  assert.equal(engine.getCampfireDebugState().pending, 1);
  assert.ok((engine.getCampfireDebugState().loopGain ?? 0) > 0);

  engine.resetCampfireFeedback();
  assert.deepEqual(engine.getCampfireDebugState(), {
    pending: 0,
    seen: 0,
    loopGain: 0,
  });
});

test("campfire transient peak gain reaches true silence and preserves distance attenuation", () => {
  assert.equal(campfireTransientPeakGain(0), 0);
  assert.equal(campfireTransientPeakGain(-1), 0);
  assert.equal(campfireTransientPeakGain(2), 0.12);
  const nearPeak = campfireTransientPeakGain(0.7);
  const edgePeak = campfireTransientPeakGain(0.7 * 0.0025);
  assert.ok(edgePeak > 0);
  assert.ok(edgePeak < nearPeak * 0.01);
});

test("suspended campfire cues expire instead of replaying after the player has moved on", () => {
  let now = 10_000;
  const buffer = new CampfireAudioEventBuffer({
    now: () => now,
    pendingTtlMs: 1_200,
  });
  const cue = transient(70);
  assert.equal(buffer.submit(cue, () => false), "queued");
  now += 1_201;
  const played: number[] = [];
  assert.equal(
    buffer.flush((candidate) => {
      played.push(candidate.eventId);
      return true;
    }),
    0,
  );
  assert.deepEqual(played, []);
  assert.deepEqual(buffer.getDebugState(), { pending: 0, seen: 1 });
  assert.equal(buffer.submit(cue, () => true), "duplicate");
});
