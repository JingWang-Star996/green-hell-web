import assert from "node:assert/strict";
import test from "node:test";
import {
  checkpointReasonForSaveReason,
  createCheckpointMetadata,
} from "../../src/game/GameClient";
import { createInitialState } from "../../src/game/sim";

test("checkpoint condition metadata uses the simulation's 0..100 wound scale", () => {
  const state = createInitialState(1201);
  state.weather.storm = false;
  state.player.conditions.wound.open = true;
  state.player.conditions.wound.treated = false;
  state.player.conditions.wound.severity = 20;
  state.player.conditions.wound.infection = 4;

  const moderate = createCheckpointMetadata(state, "rest-before", 1);
  assert.deepEqual(moderate.majorStatuses, [
    { label: "开放伤口", severity: "warning" },
  ]);

  state.player.conditions.wound.severity = 70;
  state.player.conditions.wound.infection = 55;
  const severe = createCheckpointMetadata(state, "rest-before", 2);
  assert.deepEqual(severe.majorStatuses, [
    { label: "开放伤口", severity: "critical" },
    { label: "感染 55%", severity: "critical" },
  ]);
  assert.equal(severe.safety, "caution");
});

test("routine saves update the active slot without evicting recovery history", () => {
  assert.equal(checkpointReasonForSaveReason("periodic"), null);
  assert.equal(checkpointReasonForSaveReason("hidden"), null);
  assert.equal(checkpointReasonForSaveReason("page-exit"), null);
  assert.equal(checkpointReasonForSaveReason("new-game"), "new-game");
  assert.equal(checkpointReasonForSaveReason("rest-before"), "rest-before");
  assert.equal(checkpointReasonForSaveReason("rest-after"), "rest-after");
  assert.equal(checkpointReasonForSaveReason("task"), "task");
  assert.equal(checkpointReasonForSaveReason("milestone"), "milestone");
});
