import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_CHECKPOINT_SLOTS,
  CheckpointTimeline,
  MANUAL_CHECKPOINT_SLOTS,
  MemoryKV,
  type CheckpointMetadataDraft,
  type KVStore,
} from "../../src/game/persistence";

type Payload = { marker: string };

function createTimeline(kv: KVStore = new MemoryKV()) {
  return new CheckpointTimeline<Payload>({
    key: "timeline.test",
    schema: 1,
    content: "canopy@test",
    device: "test-device",
    kv,
    localDurability: "persistent",
    payloadValidator: (value): value is Payload =>
      Boolean(value && typeof value === "object" && typeof (value as Payload).marker === "string"),
  });
}

function metadata(
  reason: CheckpointMetadataDraft["reason"],
  sequence: number,
): CheckpointMetadataDraft {
  return {
    reason,
    createdAt: 10_000 + sequence,
    gameDay: 1 + Math.floor(sequence / 12),
    minuteOfDay: sequence % 1440,
    elapsedSeconds: sequence * 3,
    objectiveLabel: `目标 ${sequence}`,
    position: { x: sequence, z: -sequence },
    biomeLabel: "常绿雨林",
    health: 80,
    majorStatuses: [],
    storm: false,
    combat: false,
    danger: false,
    safety: "safe",
  };
}

test("25 automatic checkpoints rotate through ten slots without touching three manual slots", () => {
  const timeline = createTimeline();
  for (const [index, slotId] of MANUAL_CHECKPOINT_SLOTS.entries()) {
    const result = timeline.saveManual(
      slotId,
      { marker: `manual-${index}` },
      { seed: 1, simTick: index },
      metadata("manual", index + 1),
      1,
    );
    assert.equal(result.ok, true);
  }
  for (let index = 0; index < 25; index += 1) {
    const result = timeline.saveAuto(
      { marker: `auto-${index}` },
      { seed: 1, simTick: 100 + index },
      metadata("periodic", 20 + index),
      1,
    );
    assert.equal(result.ok, true);
  }

  const list = timeline.list();
  assert.equal(list.entries.filter((entry) => entry.kind === "manual").length, 3);
  assert.equal(list.entries.filter((entry) => entry.kind === "auto").length, 10);
  for (const [index, slotId] of MANUAL_CHECKPOINT_SLOTS.entries()) {
    const loaded = timeline.load(slotId);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.envelope.payload.marker, `manual-${index}`);
  }
  const automaticMarkers = AUTO_CHECKPOINT_SLOTS.map((slotId) => timeline.load(slotId))
    .flatMap((loaded) => loaded.ok ? [loaded.envelope.payload.marker] : [])
    .sort((left, right) => Number(left.split("-")[1]) - Number(right.split("-")[1]));
  assert.deepEqual(automaticMarkers, Array.from({ length: 10 }, (_, index) => `auto-${15 + index}`));
});

test("preimport is a dedicated slot and never consumes automatic rotation", () => {
  const timeline = createTimeline();
  assert.equal(timeline.saveAuto(
    { marker: "auto-before" },
    { seed: 2, simTick: 1 },
    metadata("rest-before", 1),
    2,
  ).ok, true);
  assert.equal(timeline.savePreImport(
    { marker: "before-import" },
    { seed: 2, simTick: 2 },
    metadata("preimport", 2),
    2,
  ).ok, true);
  assert.equal(timeline.saveAuto(
    { marker: "auto-after" },
    { seed: 2, simTick: 3 },
    metadata("task", 3),
    2,
  ).ok, true);

  const rollback = timeline.load("preimport");
  assert.equal(rollback.ok, true);
  if (rollback.ok) assert.equal(rollback.envelope.payload.marker, "before-import");
  assert.equal(timeline.load("auto-1").ok, true);
  assert.equal(timeline.load("auto-2").ok, true);
});

test("a corrupt slot is isolated and its verified same-slot backup remains loadable", () => {
  const kv = new MemoryKV();
  const timeline = createTimeline(kv);
  assert.equal(timeline.saveManual(
    "manual-1",
    { marker: "first" },
    { seed: 3, simTick: 1 },
    metadata("manual", 1),
    3,
  ).ok, true);
  assert.equal(timeline.saveManual(
    "manual-1",
    { marker: "second" },
    { seed: 3, simTick: 2 },
    metadata("manual", 2),
    3,
  ).ok, true);
  kv.setItem(timeline.getSlotKey("manual-1"), "{broken");

  const loaded = timeline.load("manual-1");
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.envelope.payload.marker, "first");
    assert.equal(loaded.entry.recoveredFromBackup, true);
  }
  assert.equal(kv.getItem(timeline.getSlotCorruptKey("manual-1")), "{broken");
});

test("manifest reconciliation removes dangling entries and discovers verified orphan slots", () => {
  const kv = new MemoryKV();
  const timeline = createTimeline(kv);
  assert.equal(timeline.saveAuto(
    { marker: "one" },
    { seed: 4, simTick: 1 },
    metadata("task", 1),
    4,
  ).ok, true);
  assert.equal(timeline.saveAuto(
    { marker: "two" },
    { seed: 4, simTick: 2 },
    metadata("task", 2),
    4,
  ).ok, true);

  kv.removeItem(timeline.getSlotKey("auto-1"));
  kv.removeItem(timeline.getSlotBackupKey("auto-1"));
  kv.setItem(timeline.manifestKey, "{bad-manifest");
  const list = timeline.list();
  assert.deepEqual(list.entries.map((entry) => entry.slotId), ["auto-2"]);
  const repaired = JSON.parse(kv.getItem(timeline.manifestKey) ?? "null") as {
    entries: Array<{ slotId: string }>;
  };
  assert.deepEqual(repaired.entries.map((entry) => entry.slotId), ["auto-2"]);
  assert.equal(kv.getItem(timeline.manifestCorruptKey), "{bad-manifest");
});

test("a verified orphan advances the recovered auto cursor instead of being overwritten", () => {
  const kv = new MemoryKV();
  const timeline = createTimeline(kv);
  assert.equal(timeline.saveAuto(
    { marker: "one" },
    { seed: 8, simTick: 1 },
    metadata("task", 1),
    8,
  ).ok, true);
  const manifestBeforeOrphan = kv.getItem(timeline.manifestKey);
  assert.ok(manifestBeforeOrphan);
  assert.equal(timeline.saveAuto(
    { marker: "orphan-two" },
    { seed: 8, simTick: 2 },
    metadata("task", 2),
    8,
  ).ok, true);

  // Simulate a crash after auto-2 was verified but before its manifest was
  // promoted by restoring the prior, still-valid manifest.
  kv.setItem(timeline.manifestKey, manifestBeforeOrphan);
  assert.deepEqual(
    timeline.list().entries.map((entry) => entry.slotId).sort(),
    ["auto-1", "auto-2"],
  );
  assert.equal(timeline.saveAuto(
    { marker: "three" },
    { seed: 8, simTick: 3 },
    metadata("task", 3),
    8,
  ).ok, true);
  const orphan = timeline.load("auto-2");
  assert.equal(orphan.ok, true);
  if (orphan.ok) assert.equal(orphan.envelope.payload.marker, "orphan-two");
  const third = timeline.load("auto-3");
  assert.equal(third.ok, true);
  if (third.ok) assert.equal(third.envelope.payload.marker, "three");
});

test("a manifest commit failure rolls the slot back to its prior verified value", () => {
  class ManifestFailingKV implements KVStore {
    readonly memory = new MemoryKV();
    failManifest = false;
    getItem(key: string) { return this.memory.getItem(key); }
    setItem(key: string, value: string) {
      if (this.failManifest && key === "timeline.test.timeline.manifest") {
        throw new Error("manifest quota");
      }
      this.memory.setItem(key, value);
    }
    removeItem(key: string) { this.memory.removeItem(key); }
  }
  const kv = new ManifestFailingKV();
  const timeline = createTimeline(kv);
  assert.equal(timeline.saveManual(
    "manual-2",
    { marker: "protected" },
    { seed: 5, simTick: 1 },
    metadata("manual", 1),
    5,
  ).ok, true);
  kv.failManifest = true;
  const failed = timeline.saveManual(
    "manual-2",
    { marker: "must-not-win" },
    { seed: 5, simTick: 2 },
    metadata("manual", 2),
    5,
  );
  assert.equal(failed.ok, false);
  const loaded = timeline.load("manual-2");
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.envelope.payload.marker, "protected");
});

test("clearAll removes manual, automatic, preimport, backups and manifest artifacts", () => {
  const kv = new MemoryKV();
  const timeline = createTimeline(kv);
  assert.equal(timeline.saveManual(
    "manual-1",
    { marker: "old-manual" },
    { seed: 1, simTick: 1 },
    metadata("manual", 1),
    1,
  ).ok, true);
  assert.equal(timeline.saveAuto(
    { marker: "old-auto" },
    { seed: 1, simTick: 2 },
    metadata("rest-before", 2),
    1,
  ).ok, true);
  assert.equal(timeline.savePreImport(
    { marker: "old-import" },
    { seed: 1, simTick: 3 },
    metadata("preimport", 3),
    1,
  ).ok, true);
  kv.setItem(timeline.getSlotCorruptKey("auto-1"), "quarantined");

  const cleared = timeline.clearAll();
  assert.equal(cleared.ok, true);
  assert.equal(kv.getItem(timeline.manifestKey), null);
  for (const slotId of ["manual-1", "auto-1", "preimport"] as const) {
    assert.equal(kv.getItem(timeline.getSlotKey(slotId)), null);
    assert.equal(kv.getItem(timeline.getSlotBackupKey(slotId)), null);
    assert.equal(kv.getItem(timeline.getSlotTempKey(slotId)), null);
    assert.equal(kv.getItem(timeline.getSlotCorruptKey(slotId)), null);
  }
  assert.deepEqual(timeline.list().entries, []);
});

test("one verified cloud bundle transfers all three manual and ten auto slots but excludes preimport", () => {
  const source = createTimeline();
  for (const [index, slotId] of MANUAL_CHECKPOINT_SLOTS.entries()) {
    assert.equal(source.saveManual(
      slotId,
      { marker: `manual-cloud-${index}` },
      { seed: 11, simTick: 10 + index },
      metadata("manual", 10 + index),
      77,
    ).ok, true);
  }
  for (let index = 0; index < AUTO_CHECKPOINT_SLOTS.length; index += 1) {
    assert.equal(source.saveAuto(
      { marker: `auto-cloud-${index}` },
      { seed: 11, simTick: 100 + index },
      metadata("periodic", 100 + index),
      77,
    ).ok, true);
  }
  assert.equal(source.savePreImport(
    { marker: "must-remain-local" },
    { seed: 11, simTick: 999 },
    metadata("preimport", 999),
    77,
  ).ok, true);

  const bundled = source.createCloudBundle(77);
  assert.equal(bundled.ok, true);
  if (!bundled.ok) return;
  assert.equal(Object.keys(bundled.snapshot.slotChecksums).length, 13);
  assert.equal(bundled.snapshot.raw.includes("must-remain-local"), false);

  const target = createTimeline();
  const imported = target.importCloudBundle(bundled.snapshot.raw, 77);
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.status, "merged");
  assert.equal(imported.adoptedSlotIds.length, 13);
  assert.equal(target.list().entries.length, 13);
  for (const [index, slotId] of MANUAL_CHECKPOINT_SLOTS.entries()) {
    const loaded = target.load(slotId);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.envelope.payload.marker, `manual-cloud-${index}`);
  }
  for (const [index, slotId] of AUTO_CHECKPOINT_SLOTS.entries()) {
    const loaded = target.load(slotId);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.envelope.payload.marker, `auto-cloud-${index}`);
  }
  assert.equal(target.load("preimport").ok, false);
});

test("a tampered or cross-run cloud bundle never clears or replaces local checkpoints", () => {
  const local = createTimeline();
  assert.equal(local.saveManual(
    "manual-1",
    { marker: "protected-local" },
    { seed: 12, simTick: 50 },
    metadata("manual", 50),
    88,
  ).ok, true);

  const remote = createTimeline();
  assert.equal(remote.saveManual(
    "manual-1",
    { marker: "remote" },
    { seed: 12, simTick: 100 },
    metadata("manual", 100),
    88,
  ).ok, true);
  const bundled = remote.createCloudBundle(88);
  assert.equal(bundled.ok, true);
  if (!bundled.ok) return;
  const tampered = JSON.parse(bundled.snapshot.raw) as { sequence: number };
  tampered.sequence += 1;
  const rejected = local.importCloudBundle(JSON.stringify(tampered), 88);
  assert.equal(rejected.ok, false);
  const afterTamper = local.load("manual-1");
  assert.equal(afterTamper.ok, true);
  if (afterTamper.ok) assert.equal(afterTamper.envelope.payload.marker, "protected-local");

  const ignored = local.importCloudBundle(bundled.snapshot.raw, 89);
  assert.equal(ignored.ok, true);
  if (ignored.ok) assert.equal(ignored.status, "ignored-run");
  const afterWrongRun = local.load("manual-1");
  assert.equal(afterWrongRun.ok, true);
  if (afterWrongRun.ok) assert.equal(afterWrongRun.envelope.payload.marker, "protected-local");
});

test("same-run bundle merge keeps remote-only slots and permits only clearly newer outgoing replacement", () => {
  const outgoingTimeline = createTimeline();
  assert.equal(outgoingTimeline.saveManual(
    "manual-1",
    { marker: "clearly-newer-local" },
    { seed: 13, simTick: 20 },
    metadata("manual", 20),
    99,
  ).ok, true);
  const outgoing = outgoingTimeline.createCloudBundle(99);
  assert.equal(outgoing.ok, true);
  if (!outgoing.ok) return;

  const remoteTimeline = createTimeline();
  assert.equal(remoteTimeline.saveManual(
    "manual-1",
    { marker: "older-remote" },
    { seed: 13, simTick: 10 },
    metadata("manual", 10),
    99,
  ).ok, true);
  assert.equal(remoteTimeline.saveManual(
    "manual-2",
    { marker: "remote-only" },
    { seed: 13, simTick: 15 },
    metadata("manual", 15),
    99,
  ).ok, true);
  const remote = remoteTimeline.createCloudBundle(99);
  assert.equal(remote.ok, true);
  if (!remote.ok) return;

  const merged = outgoingTimeline.combineCloudBundles(outgoing.snapshot.raw, remote.snapshot.raw);
  assert.equal(merged.ok, true);
  if (!merged.ok) return;
  const target = createTimeline();
  assert.equal(target.importCloudBundle(merged.snapshot.raw, 99).ok, true);
  const replaced = target.load("manual-1");
  assert.equal(replaced.ok, true);
  if (replaced.ok) assert.equal(replaced.envelope.payload.marker, "clearly-newer-local");
  const preserved = target.load("manual-2");
  assert.equal(preserved.ok, true);
  if (preserved.ok) assert.equal(preserved.envelope.payload.marker, "remote-only");

  const tieLocal = createTimeline();
  const tieRemote = createTimeline();
  for (const [timeline, marker] of [
    [tieLocal, "ambiguous-local"],
    [tieRemote, "ambiguous-remote"],
  ] as const) {
    assert.equal(timeline.saveManual(
      "manual-3",
      { marker },
      { seed: 13, simTick: 30 },
      metadata("manual", 30),
      99,
    ).ok, true);
  }
  const localTieBundle = tieLocal.createCloudBundle(99);
  const remoteTieBundle = tieRemote.createCloudBundle(99);
  assert.equal(localTieBundle.ok, true);
  assert.equal(remoteTieBundle.ok, true);
  if (!localTieBundle.ok || !remoteTieBundle.ok) return;
  const tied = tieLocal.combineCloudBundles(
    localTieBundle.snapshot.raw,
    remoteTieBundle.snapshot.raw,
  );
  assert.equal(tied.ok, true);
  if (!tied.ok) return;
  const tieTarget = createTimeline();
  assert.equal(tieTarget.importCloudBundle(tied.snapshot.raw, 99).ok, true);
  const tieLoaded = tieTarget.load("manual-3");
  assert.equal(tieLoaded.ok, true);
  if (tieLoaded.ok) assert.equal(tieLoaded.envelope.payload.marker, "ambiguous-remote");
});
