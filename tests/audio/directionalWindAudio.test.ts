import assert from "node:assert/strict";
import test from "node:test";
import {
  AudioEngine,
  resolveDirectionalWindAudio,
  type DirectionalWindSoundscape,
} from "../../src/game/audio/AudioEngine";
import { projectWindPresentation } from "../../src/game/render/windPresentation";

function soundscape(
  flowDirectionX: number,
  flowDirectionZ: number,
): DirectionalWindSoundscape {
  return {
    flowDirectionX,
    flowDirectionZ,
    windBedGain: 0.4,
    rustleGain: 0.65,
    gustAccentGain: 0.25,
    directionalBlend: 1,
  };
}

test("four world directions map consistently around a yaw-zero listener", () => {
  const east = resolveDirectionalWindAudio(soundscape(1, 0), 0);
  const west = resolveDirectionalWindAudio(soundscape(-1, 0), 0);
  const northBehind = resolveDirectionalWindAudio(soundscape(0, 1), 0);
  const southAhead = resolveDirectionalWindAudio(soundscape(0, -1), 0);

  assert.equal(east.stereoPan, 1);
  assert.equal(west.stereoPan, -1);
  assert.equal(northBehind.stereoPan, 0);
  assert.equal(southAhead.stereoPan, 0);
  assert.ok(southAhead.lowPassHertz > northBehind.lowPassHertz);
  assert.equal(east.gain, west.gain);
  assert.ok(east.gain > 0 && east.gain <= 0.16);
});

test("listener yaw rotates stereo pan without changing the wind bed gain", () => {
  const eastFacingSouth = resolveDirectionalWindAudio(soundscape(1, 0), 0);
  const eastFacingEast = resolveDirectionalWindAudio(
    soundscape(1, 0),
    -Math.PI / 2,
  );
  const eastFacingNorth = resolveDirectionalWindAudio(
    soundscape(1, 0),
    Math.PI,
  );

  assert.equal(eastFacingSouth.stereoPan, 1);
  assert.ok(Math.abs(eastFacingEast.stereoPan) < 1e-12);
  assert.equal(eastFacingNorth.stereoPan, -1);
  assert.equal(eastFacingSouth.gain, eastFacingEast.gain);
  assert.equal(eastFacingEast.gain, eastFacingNorth.gain);
});

test("static wind is silent and centered", () => {
  const calm = projectWindPresentation({
    directionRadians: 1.2,
    speed: 0,
    gust: 0,
  }).soundscape;
  assert.deepEqual(resolveDirectionalWindAudio(calm, 0.7), {
    gain: 0,
    lowPassHertz: 600,
    stereoPan: 0,
  });
});

test("NaN and invalid vectors fail closed with bounded neutral targets", () => {
  const invalidCases: Array<
    [DirectionalWindSoundscape | null, number]
  > = [
    [null, 0],
    [soundscape(Number.NaN, 0), 0],
    [soundscape(1, Number.POSITIVE_INFINITY), 0],
    [{ ...soundscape(1, 0), rustleGain: Number.NaN }, 0],
    [soundscape(1, 0), Number.NaN],
    [soundscape(0, 0), 0],
  ];
  for (const [input, yaw] of invalidCases) {
    const result = resolveDirectionalWindAudio(input, yaw);
    assert.deepEqual(result, {
      gain: 0,
      lowPassHertz: 600,
      stereoPan: 0,
    });
    assert.ok(result.stereoPan >= -1 && result.stereoPan <= 1);
    assert.ok(result.lowPassHertz >= 450 && result.lowPassHertz <= 4_200);
  }
});

test("wind updates do not alter campfire feedback ownership", () => {
  const engine = new AudioEngine();
  engine.applyCampfireFeedback({
    loopGain: 0.08,
    crackleRatePerSecond: 1,
    lowPassHertz: 1_400,
  });
  const campfireBefore = engine.getCampfireDebugState();
  const input = soundscape(1, 0);
  engine.setWindEnvironment(input, 0);

  assert.deepEqual(
    engine.getWindDebugState(),
    resolveDirectionalWindAudio(input, 0),
  );
  assert.deepEqual(engine.getCampfireDebugState(), campfireBefore);
});
