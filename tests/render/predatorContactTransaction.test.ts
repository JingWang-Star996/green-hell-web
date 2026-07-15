import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE_PREDATOR_CONTACT,
  PREDATOR_BLOCKED_RECOVERY_MILLISECONDS,
  advancePredatorContactTransaction,
  settlePredatorContactCommit,
} from "../../src/game/render/predatorContactTransaction";

test("blocked contact clears windup and waits 350ms before retrying", () => {
  const started = advancePredatorContactTransaction(IDLE_PREDATOR_CONTACT, {
    now: 1_000,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: true,
    windupMilliseconds: 900,
  });
  assert.deepEqual(started.transaction, { phase: "windup", startedAt: 1_000 });
  assert.equal(started.shouldCommit, false);

  const blocked = advancePredatorContactTransaction(started.transaction, {
    now: 1_900,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: false,
    windupMilliseconds: 900,
  });
  assert.deepEqual(blocked.transaction, {
    phase: "blocked-recovery",
    retryAt: 1_900 + PREDATOR_BLOCKED_RECOVERY_MILLISECONDS,
  });
  assert.equal(blocked.shouldCommit, false);

  const recovering = advancePredatorContactTransaction(blocked.transaction, {
    now: 2_249,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: true,
    windupMilliseconds: 900,
  });
  assert.deepEqual(recovering, {
    transaction: blocked.transaction,
    shouldCommit: false,
  });

  const retried = advancePredatorContactTransaction(blocked.transaction, {
    now: 2_250,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: true,
    windupMilliseconds: 900,
  });
  assert.deepEqual(retried.transaction, { phase: "windup", startedAt: 2_250 });
});

test("renderer-clear but simulation-rejected contact recovers and can retry", () => {
  const windup = { phase: "windup", startedAt: 100 } as const;
  const pending = advancePredatorContactTransaction(windup, {
    now: 1_000,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: true,
    windupMilliseconds: 900,
  });
  assert.equal(pending.shouldCommit, true);
  assert.equal(pending.transaction, windup, "preview may not lock triggered");

  const refused = settlePredatorContactCommit(false, 1_000);
  assert.deepEqual(refused, {
    phase: "blocked-recovery",
    retryAt: 1_000 + PREDATOR_BLOCKED_RECOVERY_MILLISECONDS,
  });

  const retried = advancePredatorContactTransaction(refused, {
    now: 1_350,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: true,
    windupMilliseconds: 900,
  });
  assert.deepEqual(retried.transaction, { phase: "windup", startedAt: 1_350 });

  const secondPending = advancePredatorContactTransaction(retried.transaction, {
    now: 2_250,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: true,
    windupMilliseconds: 900,
  });
  assert.equal(secondPending.shouldCommit, true);
  const accepted = settlePredatorContactCommit(true, 2_250);
  assert.deepEqual(accepted, { phase: "triggered" });

  const duplicate = advancePredatorContactTransaction(accepted, {
    now: 4_000,
    withinContactRange: true,
    fullyRetreated: false,
    contactClear: true,
    windupMilliseconds: 900,
  });
  assert.equal(duplicate.shouldCommit, false);
  assert.deepEqual(duplicate.transaction, { phase: "triggered" });
  assert.deepEqual(
    advancePredatorContactTransaction(accepted, {
      now: 4_001,
      withinContactRange: false,
      fullyRetreated: true,
      contactClear: false,
      windupMilliseconds: 900,
    }).transaction,
    { phase: "idle" },
  );
});
