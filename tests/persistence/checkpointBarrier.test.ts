import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  SaveRepository,
  runVerifiedCheckpointBarrier,
  runVerifiedCheckpointTransaction,
  type CheckpointMetadataDraft,
  type CheckpointWriteResult,
} from "../../src/game/persistence";

type RestPayload = { marker: string; elapsed: number };

function isRestPayload(value: unknown): value is RestPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as RestPayload).marker === "string" &&
      typeof (value as RestPayload).elapsed === "number",
  );
}

function repository(kv = new MemoryKV()) {
  return new SaveRepository<RestPayload>({
    key: "rest.barrier",
    schema: 1,
    content: "rest@test",
    device: "test-device",
    kv,
    payloadValidator: isRestPayload,
  });
}

function metadata(reason: CheckpointMetadataDraft["reason"]): CheckpointMetadataDraft {
  return {
    reason,
    createdAt: 20_000,
    gameDay: 2,
    minuteOfDay: 1_020,
    elapsedSeconds: 600,
    objectiveLabel: "活过今晚",
    position: { x: 12, z: -8 },
    biomeLabel: "河岸雨林",
    health: 62,
    majorStatuses: [{ label: "能量偏低", severity: "warning" }],
    storm: false,
    combat: false,
    danger: false,
    safety: "caution",
  };
}

test("the command callback is unreachable when a verified checkpoint cannot be written", async () => {
  const order: string[] = [];
  let committed = false;
  const failed: CheckpointWriteResult = {
    ok: false,
    reason: "storage-error",
    issues: [],
  };
  const result = await runVerifiedCheckpointBarrier(
    () => {
      order.push("checkpoint-failed");
      return failed;
    },
    () => {
      committed = true;
      order.push("rest-advanced");
    },
    async () => {
      order.push("ui-painted-and-input-locked");
    },
  );

  assert.equal(result.ok, false);
  assert.equal(committed, false);
  assert.deepEqual(order, ["ui-painted-and-input-locked", "checkpoint-failed"]);
});

test("a crash after pre-rest verification leaves a boot-loadable pre-rest checkpoint", async () => {
  const kv = new MemoryKV();
  const beforeRest: RestPayload = { marker: "before-rest", elapsed: 600 };
  const firstProcess = repository(kv);
  const result = await runVerifiedCheckpointBarrier(
    () => firstProcess.saveAutoCheckpoint(
      beforeRest,
      { seed: "rainforest", simTick: 90 },
      metadata("rest-before"),
    ),
    () => {
      throw new Error("simulated process crash before rest settlement");
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.phase, "commit");

  const restartedProcess = repository(kv);
  const timeline = restartedProcess.listCheckpoints();
  assert.equal(timeline.entries.length, 1);
  assert.equal(timeline.entries[0]?.reason, "rest-before");
  const loaded = restartedProcess.loadCheckpoint(timeline.entries[0]!.slotId);
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.deepEqual(loaded.envelope.payload, beforeRest);
    assert.equal(loaded.entry.validation, "verified");
  }
});

test("a successful rest publishes only after verified before and after recovery points", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  const beforeRest: RestPayload = { marker: "before-rest", elapsed: 600 };
  const afterRest: RestPayload = { marker: "after-rest", elapsed: 1_080 };
  const order: string[] = [];
  let published: RestPayload | null = null;

  const result = await runVerifiedCheckpointTransaction(
    () => {
      order.push("before-write");
      return saves.saveAutoCheckpoint(
        beforeRest,
        { seed: "rainforest", simTick: 90 },
        metadata("rest-before"),
      );
    },
    () => {
      order.push("stage-rest");
      return afterRest;
    },
    (staged) => {
      order.push("after-write");
      return saves.saveAutoCheckpoint(
        staged,
        { seed: "rainforest", simTick: 180 },
        {
          ...metadata("rest-after"),
          createdAt: 21_000,
          elapsedSeconds: staged.elapsed,
        },
      );
    },
    (staged) => {
      order.push("publish-rest");
      published = staged;
      return staged;
    },
    async () => {
      order.push("input-locked");
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(published, afterRest);
  assert.deepEqual(order, [
    "input-locked",
    "before-write",
    "stage-rest",
    "after-write",
    "publish-rest",
  ]);

  const timeline = repository(kv).listCheckpoints();
  assert.deepEqual(timeline.entries.map((entry) => entry.reason), [
    "rest-after",
    "rest-before",
  ]);
  for (const [reason, expected] of [
    ["rest-before", beforeRest],
    ["rest-after", afterRest],
  ] as const) {
    const entry = timeline.entries.find((candidate) => candidate.reason === reason);
    assert.ok(entry);
    const loaded = repository(kv).loadCheckpoint(entry.slotId);
    assert.equal(loaded.ok, true);
    if (loaded.ok) {
      assert.equal(loaded.entry.validation, "verified");
      assert.deepEqual(loaded.envelope.payload, expected);
    }
  }
});

test("a failed post-rest checkpoint never publishes the staged rest", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  const beforeRest: RestPayload = { marker: "before-rest", elapsed: 600 };
  const afterRest: RestPayload = { marker: "after-rest", elapsed: 1_080 };
  let published = beforeRest;
  const failed: CheckpointWriteResult = {
    ok: false,
    reason: "storage-error",
    issues: [],
  };

  const result = await runVerifiedCheckpointTransaction(
    () => saves.saveAutoCheckpoint(
      beforeRest,
      { seed: "rainforest", simTick: 90 },
      metadata("rest-before"),
    ),
    () => afterRest,
    () => failed,
    (staged) => {
      published = staged;
      return staged;
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.phase, "after-checkpoint");
  assert.deepEqual(published, beforeRest);
  const timeline = repository(kv).listCheckpoints();
  assert.equal(timeline.entries.length, 1);
  assert.equal(timeline.entries[0]?.reason, "rest-before");
});

test("a fatal rest publishes death but retains only the verified pre-rest recovery point", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  const beforeRest: RestPayload = { marker: "before-rest", elapsed: 600 };
  const fatalRest: RestPayload = { marker: "fatal-rest", elapsed: 1_080 };
  let published: RestPayload | null = null;

  const result = await runVerifiedCheckpointTransaction(
    () => saves.saveAutoCheckpoint(
      beforeRest,
      { seed: "rainforest", simTick: 90 },
      metadata("rest-before"),
    ),
    () => fatalRest,
    () => null,
    (staged) => {
      published = staged;
      return staged;
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(published, fatalRest);
  const timeline = repository(kv).listCheckpoints();
  assert.deepEqual(timeline.entries.map((entry) => entry.reason), ["rest-before"]);
  const loaded = repository(kv).loadCheckpoint(timeline.entries[0]!.slotId);
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.deepEqual(loaded.envelope.payload, beforeRest);
});

test("a crash while staging rest leaves only the verified pre-rest point", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  const beforeRest: RestPayload = { marker: "before-rest", elapsed: 600 };
  let afterWriteReached = false;
  let publishReached = false;

  const result = await runVerifiedCheckpointTransaction<RestPayload>(
    () => saves.saveAutoCheckpoint(
      beforeRest,
      { seed: "rainforest", simTick: 90 },
      metadata("rest-before"),
    ),
    () => {
      throw new Error("simulated crash during rest settlement");
    },
    () => {
      afterWriteReached = true;
      return null;
    },
    (staged) => {
      publishReached = true;
      return staged;
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.phase, "stage");
  assert.equal(afterWriteReached, false);
  assert.equal(publishReached, false);
  const timeline = repository(kv).listCheckpoints();
  assert.equal(timeline.entries.length, 1);
  assert.equal(timeline.entries[0]?.reason, "rest-before");
});

test("a publish crash after post-rest verification leaves both recovery points loadable", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  const beforeRest: RestPayload = { marker: "before-rest", elapsed: 600 };
  const afterRest: RestPayload = { marker: "after-rest", elapsed: 1_080 };

  const result = await runVerifiedCheckpointTransaction(
    () => saves.saveAutoCheckpoint(
      beforeRest,
      { seed: "rainforest", simTick: 90 },
      metadata("rest-before"),
    ),
    () => afterRest,
    (staged) => saves.saveAutoCheckpoint(
      staged,
      { seed: "rainforest", simTick: 180 },
      { ...metadata("rest-after"), createdAt: 21_000 },
    ),
    () => {
      throw new Error("simulated crash while publishing staged rest");
    },
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.phase, "commit");
  const timeline = repository(kv).listCheckpoints();
  assert.deepEqual(timeline.entries.map((entry) => entry.reason), [
    "rest-after",
    "rest-before",
  ]);
  for (const entry of timeline.entries) {
    const loaded = repository(kv).loadCheckpoint(entry.slotId);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.entry.validation, "verified");
  }
});

test("checkpoint recovery does not replace import rollback and a corrupt choice never mutates primary", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  const original: RestPayload = { marker: "original", elapsed: 100 };
  const imported: RestPayload = { marker: "imported", elapsed: 200 };
  const earlier: RestPayload = { marker: "earlier-checkpoint", elapsed: 70 };
  assert.equal((await saves.save(original, { seed: 3, simTick: 10 })).ok, true);
  assert.equal((await saves.replaceFromImport(imported, { seed: 4, simTick: 20 })).ok, true);
  const rollbackRaw = kv.getItem(saves.preImportKey);
  assert.ok(rollbackRaw);
  const checkpoint = saves.saveManualCheckpoint(
    "manual-1",
    earlier,
    { seed: 3, simTick: 7 },
    metadata("manual"),
  );
  assert.equal(checkpoint.ok, true);

  const restored = await saves.replaceFromCheckpoint(earlier, { seed: 3, simTick: 7 });
  assert.equal(restored.ok, true);
  assert.equal(kv.getItem(saves.preImportKey), rollbackRaw);

  const activeBeforeFailure = kv.getItem(saves.key);
  kv.setItem(saves.checkpointTimeline.getSlotKey("manual-1"), "{corrupt");
  kv.removeItem(saves.checkpointTimeline.getSlotBackupKey("manual-1"));
  const failedLoad = saves.loadCheckpoint("manual-1");
  assert.equal(failedLoad.ok, false);
  assert.equal(kv.getItem(saves.key), activeBeforeFailure);
  const active = await saves.load({ allowCloudFallback: false });
  assert.equal(active.ok, true);
  if (active.ok) assert.equal(active.envelope.payload.marker, "earlier-checkpoint");
});
