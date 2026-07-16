import assert from "node:assert/strict";
import test from "node:test";

import {
  actionWindupInterruptReason,
  actionTargetStillValid,
  actionTimingFor,
  advanceActionTransaction,
  beginActionTransaction,
  interruptActionTransaction,
  toActionPhase,
} from "../../src/game/render/actionTransaction";
import type { InteractionTarget } from "../../src/game/render/types";
import { interactionModeForAffordance } from "../../src/game/sim/affordances";

function target(
  id = "tree:one",
  options: {
    state?: InteractionTarget["affordance"]["state"];
    actionId?: InteractionTarget["affordance"]["actionId"];
    animationKey?: string;
    distance?: number;
  } = {},
): InteractionTarget {
  const state = options.state ?? "ready";
  const actionId = options.actionId ?? "chop";
  return {
    id,
    kind: "tree",
    label: "棕榈树",
    distance: options.distance ?? 1.5,
    affordance: {
      objectId: id,
      semanticKind: "tree",
      state,
      interactionMode: interactionModeForAffordance({ state, actionId }),
      actionId,
      verb: "砍伐",
      blocker: null,
      requiredItem: "axe",
      range: 3,
      highlightTone: "interactable",
      animationKey: options.animationKey ?? "tool.axe.chop",
      feedbackKey: "test.chop",
      preview: { label: "棕榈树", detail: "测试目标" },
      estimatedSeconds: 3,
    },
  };
}

test("tool actions advance windup to one hit commit and then recovery", () => {
  let transaction = beginActionTransaction(target());
  assert.ok(transaction);

  let step = advanceActionTransaction(
    transaction,
    transaction.timing.windupMs - 1,
    true,
  );
  assert.equal(step.transaction?.phase, "windup");
  assert.equal(step.shouldCommit, false);

  transaction = step.transaction;
  assert.ok(transaction);
  step = advanceActionTransaction(transaction, 1, true);
  assert.equal(step.transaction?.phase, "hit-window");
  assert.equal(step.shouldCommit, true);

  transaction = step.transaction;
  assert.ok(transaction);
  step = advanceActionTransaction(
    transaction,
    transaction.timing.hitWindowMs,
    false,
  );
  assert.equal(step.transaction?.phase, "recovery");
  assert.equal(step.shouldCommit, false, "the hit window commits only on entry");

  transaction = step.transaction;
  assert.ok(transaction);
  step = advanceActionTransaction(
    transaction,
    transaction.timing.recoveryMs,
    false,
  );
  assert.equal(step.transaction, null);
  assert.equal(step.shouldCommit, false);
});

test("physical windup keeps its binding through focus jitter and interrupts pose drift", () => {
  const original = target();
  const startPose = { x: 2, z: 3, yaw: Math.PI - 0.01, pitch: -0.2 };
  const transaction = beginActionTransaction(original, startPose);
  assert.ok(transaction);
  assert.equal(actionTargetStillValid(transaction, original), true);
  assert.equal(
    actionTargetStillValid(transaction, target("tree:other"), {
      ...startPose,
      yaw: -Math.PI + 0.01,
    }),
    true,
    "physical binding must not be cancelled by a competing focus winner",
  );
  assert.equal(
    actionTargetStillValid(transaction, null, { ...startPose, x: 2.05 }),
    true,
  );
  const movedPose = { ...startPose, x: 3 };
  assert.equal(
    actionTargetStillValid(transaction, original, movedPose),
    false,
  );
  assert.equal(
    actionWindupInterruptReason(
      transaction,
      original,
      movedPose,
    ),
    "moved",
  );
  const turnedPose = { ...startPose, yaw: startPose.yaw + Math.PI / 2 };
  assert.equal(
    actionWindupInterruptReason(transaction, original, turnedPose),
    "turned",
  );
  const pitchPose = { ...startPose, pitch: startPose.pitch + Math.PI / 2 };
  assert.equal(
    actionWindupInterruptReason(transaction, original, pitchPose),
    "aim-lost",
  );

  const cancelled = advanceActionTransaction(transaction, 16, false, "moved");
  assert.equal(cancelled.transaction?.phase, "interrupted");
  assert.equal(cancelled.shouldCommit, false);
  assert.equal(toActionPhase(cancelled.transaction)?.interruptReason, "moved");
});

test("pause interrupts windup, but never relabels or rolls back a committed hit", () => {
  const windup = beginActionTransaction(target());
  assert.ok(windup);
  assert.equal(interruptActionTransaction(windup, "paused")?.phase, "interrupted");

  const hit = advanceActionTransaction(windup, windup.timing.windupMs, true);
  assert.equal(hit.shouldCommit, true);
  assert.ok(hit.transaction);
  assert.equal(interruptActionTransaction(hit.transaction, "paused"), null);
});

test("hand pickup transaction is shorter and blocked affordances never begin", () => {
  const pickup = actionTimingFor("hand.pickup");
  const tool = actionTimingFor("tool.axe.chop");
  assert.ok(
    pickup.windupMs + pickup.hitWindowMs + pickup.recoveryMs <
      tool.windupMs + tool.hitWindowMs + tool.recoveryMs,
  );
  assert.equal(
    beginActionTransaction(target("blocked", { state: "blocked" })),
    null,
  );
  assert.equal(
    beginActionTransaction(
      target("danger", {
        state: "danger",
        actionId: "avoid",
        animationKey: "movement.evade",
      }),
    ),
    null,
  );
});
