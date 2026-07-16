import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPFIRE_AUDIO_OUTER_RADIUS,
  createCampfireFeedbackCursor,
  resolveCampfireFeedbackFrame,
} from "../../src/game/render/campfireFeedbackFrame";
import { createInitialState } from "../../src/game/sim/state";

test("a second campfire owns its visual beat while loop audio follows the nearest lit fire", () => {
  const state = createInitialState("campfire-frame-routing");
  state.player.position = { x: 2, y: 0, z: 0 };
  state.camp.structures = [
    {
      id: "fire.primary-cold",
      kind: "campfire",
      position: { x: -2, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 1,
      fire: {
        lit: false,
        fuelSeconds: 0,
        rainExposure: 0,
        sheltered: false,
      },
    },
    {
      id: "fire.secondary-lit",
      kind: "campfire",
      position: { x: 2, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 2,
      fire: {
        lit: true,
        fuelSeconds: 420,
        rainExposure: 0,
        sheltered: false,
      },
    },
  ];
  state.camp.fire = {
    built: true,
    lit: false,
    fuelSeconds: 0,
    rainExposure: 0,
    sheltered: false,
  };

  const hydrated = resolveCampfireFeedbackFrame(
    state,
    createCampfireFeedbackCursor(),
    false,
  );
  assert.equal(hydrated.audibleStructureId, "fire.secondary-lit");
  assert.equal(
    hydrated.feedbackByStructureId.get("fire.primary-cold")?.stage,
    "cold",
  );
  assert.equal(
    hydrated.feedbackByStructureId.get("fire.secondary-lit")?.stage,
    "steady",
  );

  state.eventLog.push({
    id: state.nextEventId,
    tick: state.clock.tick,
    elapsedSeconds: state.clock.elapsedSeconds,
    type: "fuel-added",
    message: "第二处营火添入木柴。",
    cause: { source: "command", code: "add-fuel" },
    details: {
      structureId: "fire.secondary-lit",
      fuelAddedSeconds: 300,
    },
  });
  state.nextEventId += 1;
  const routed = resolveCampfireFeedbackFrame(
    state,
    hydrated.cursor,
    false,
  );
  assert.equal(
    routed.feedbackByStructureId.get("fire.primary-cold")?.transients.length,
    0,
  );
  assert.deepEqual(
    routed.feedbackByStructureId
      .get("fire.secondary-lit")
      ?.transients.map((transient) => transient.kind),
    ["fuel-added"],
  );

  const deduplicated = resolveCampfireFeedbackFrame(
    state,
    routed.cursor,
    false,
  );
  assert.equal(
    deduplicated.feedbackByStructureId.get("fire.secondary-lit")?.transients
      .length,
    0,
  );
});

test("campfire loop gain attenuates with distance and stops outside the audible radius", () => {
  const state = createInitialState("campfire-frame-distance");
  state.camp.structures = [
    {
      id: "fire.distance",
      kind: "campfire",
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 1,
      fire: {
        lit: true,
        fuelSeconds: 420,
        rainExposure: 0,
        sheltered: false,
      },
    },
  ];
  state.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 420,
    rainExposure: 0,
    sheltered: false,
  };

  state.player.position = { x: 0, y: 0, z: 0 };
  const near = resolveCampfireFeedbackFrame(
    state,
    createCampfireFeedbackCursor(),
    false,
  );
  const nearGain = near.feedbackByStructureId.get("fire.distance")!.audio
    .loopGain;
  assert.equal(near.audibleStructureId, "fire.distance");
  assert.ok(nearGain > 0);

  state.player.position = {
    x: CAMPFIRE_AUDIO_OUTER_RADIUS - 1,
    y: 0,
    z: 0,
  };
  const edge = resolveCampfireFeedbackFrame(state, near.cursor, false);
  const edgeGain = edge.feedbackByStructureId.get("fire.distance")!.audio
    .loopGain;
  assert.equal(edge.audibleStructureId, "fire.distance");
  assert.ok(edgeGain > 0 && edgeGain < nearGain);

  state.player.position = {
    x: CAMPFIRE_AUDIO_OUTER_RADIUS + 1,
    y: 0,
    z: 0,
  };
  const far = resolveCampfireFeedbackFrame(state, edge.cursor, false);
  assert.equal(far.audibleStructureId, null);
  assert.equal(
    far.feedbackByStructureId.get("fire.distance")!.audio.loopGain,
    0,
  );
});

test("a distant extinguish event keeps its visual beat but mutes audio and advances its cursor", () => {
  const state = createInitialState("campfire-frame-far-transient");
  state.player.position = { x: 10_000, y: 0, z: 10_000 };
  state.camp.structures = [
    {
      id: "fire.far",
      kind: "campfire",
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 1,
      fire: {
        lit: true,
        fuelSeconds: 20,
        rainExposure: 0,
        sheltered: false,
      },
    },
  ];
  state.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 20,
    rainExposure: 0,
    sheltered: false,
  };
  const hydrated = resolveCampfireFeedbackFrame(
    state,
    createCampfireFeedbackCursor(),
    false,
  );

  state.camp.structures[0].fire = {
    lit: false,
    fuelSeconds: 0,
    rainExposure: 0,
    sheltered: false,
  };
  state.eventLog.push({
    id: state.nextEventId,
    tick: state.clock.tick,
    elapsedSeconds: state.clock.elapsedSeconds,
    type: "fire-extinguished",
    message: "远处营火熄灭。",
    cause: { source: "system", code: "fire:fuel-empty" },
    details: { structureId: "fire.far" },
  });
  state.nextEventId += 1;

  const far = resolveCampfireFeedbackFrame(state, hydrated.cursor, false);
  assert.equal(far.audibleStructureId, null);
  assert.deepEqual(
    far.feedbackByStructureId
      .get("fire.far")
      ?.transients.map(({ kind, audioGain }) => ({ kind, audioGain })),
    [{ kind: "fire-extinguished", audioGain: 0 }],
  );
  assert.equal(
    far.cursor.byStructureId.get("fire.far"),
    state.eventLog.at(-1)?.id,
  );
});
