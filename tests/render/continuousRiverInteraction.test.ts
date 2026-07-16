import assert from "node:assert/strict";
import test from "node:test";

import { commandForInteraction } from "../../src/game/GameClient";
import {
  actionTargetStillValid,
  advanceActionTransaction,
  beginActionTransaction,
} from "../../src/game/render/actionTransaction";
import type { InteractionTarget } from "../../src/game/render/types";
import { applyCommand, createInitialState } from "../../src/game/sim";
import { createActionReceipt } from "../../src/game/ui/actionReceipt";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import { createRiverWaterTarget } from "../../src/game/world/riverWater";
import { riverCenter } from "../../src/game/world/terrain";

function riverTarget(
  id: string,
  snapshot: ReturnType<typeof createRenderSnapshot>,
): InteractionTarget {
  const affordance = snapshot.riverWaterAffordance;
  assert.ok(affordance);
  return {
    id,
    kind: "water",
    label: "流动溪水",
    distance: 0.5,
    affordance: {
      ...affordance,
      objectId: id,
      preview: { ...affordance.preview },
    },
  };
}

test("render snapshot hides the old single focus ring and maps an ephemeral target", () => {
  const state = createInitialState("continuous-river-render");
  state.inventory["coconut-shell"] = 1;
  const snapshot = createRenderSnapshot(state);
  assert.equal(
    snapshot.entities.some((entity) => entity.id === "landmark.stream"),
    false,
  );
  assert.equal(snapshot.riverWaterAffordance?.actionId, "collect-water");
  const target = createRiverWaterTarget({ x: 48, z: riverCenter(48) });
  assert.ok(target);
  assert.deepEqual(commandForInteraction(state, riverTarget(target.id, snapshot)), {
    type: "collect-water",
    sourceEntityId: target.id,
  });
});

test("switching to a different quantized river address interrupts before hit", () => {
  const state = createInitialState("continuous-river-action-switch");
  state.inventory["coconut-shell"] = 1;
  const snapshot = createRenderSnapshot(state);
  const first = createRiverWaterTarget({ x: 48, z: riverCenter(48) });
  const second = createRiverWaterTarget({ x: 48.5, z: riverCenter(48.5) });
  assert.ok(first);
  assert.ok(second);
  const transaction = beginActionTransaction(riverTarget(first.id, snapshot));
  assert.ok(transaction);
  assert.equal(
    actionTargetStillValid(transaction, riverTarget(first.id, snapshot)),
    true,
  );
  assert.equal(
    actionTargetStillValid(transaction, riverTarget(second.id, snapshot)),
    false,
  );
  const interrupted = advanceActionTransaction(transaction, 16, false);
  assert.equal(interrupted.transaction?.phase, "interrupted");
  assert.equal(interrupted.shouldCommit, false);
});

test("one successful river command produces one authoritative ActionReceipt", () => {
  let state = createInitialState("continuous-river-receipt");
  state.inventory["coconut-shell"] = 1;
  state.player.vitals.health = 100;
  state.player.vitals.energy = 100;
  state.player.nutrition.hydration = 100;
  state.player.nutrition.carbohydrates = 100;
  state.player.nutrition.protein = 100;
  state.player.nutrition.fat = 100;
  const target = createRiverWaterTarget({ x: 72, z: riverCenter(72) });
  assert.ok(target);
  state.player.position = {
    x: target.anchor.x,
    y: 0,
    z: target.anchor.z + 0.5,
  };
  const command = { type: "collect-water", sourceEntityId: target.id } as const;
  const beforeEventId = state.eventLog.at(-1)?.id ?? 0;
  state = applyCommand(state, command);
  assert.equal(
    state.eventLog.filter((event) => event.type === "water-collected").length,
    1,
  );
  const receipt = createActionReceipt({
    transactionId: "river-receipt",
    command,
    beforeEventId,
    events: state.eventLog,
    nowMs: 100,
  });
  assert.ok(receipt);
  assert.equal(receipt.primary.type, "water-collected");
  assert.equal(receipt.status, "completed");
});
