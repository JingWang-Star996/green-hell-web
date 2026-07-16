import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_CHECKPOINT_SLOTS,
  MANUAL_CHECKPOINT_SLOTS,
  MemoryKV,
  SaveRepository,
  type CheckpointMetadataDraft,
  type CloudKV,
} from "../../src/game/persistence";

type Payload = { marker: string };

function isPayload(value: unknown): value is Payload {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as Payload).marker === "string",
  );
}

function checkpointMetadata(
  reason: CheckpointMetadataDraft["reason"],
  index: number,
): CheckpointMetadataDraft {
  return {
    reason,
    createdAt: 20_000 + index,
    gameDay: 1,
    minuteOfDay: 400 + index,
    elapsedSeconds: index,
    objectiveLabel: `checkpoint ${index}`,
    position: { x: index, z: -index },
    biomeLabel: "rainforest",
    health: 100,
    majorStatuses: [],
    storm: false,
    combat: false,
    danger: false,
    safety: "safe",
  };
}

class MemoryCloud implements CloudKV {
  readonly items: Record<string, string> = {};
  rejectTimelineWrites = false;

  async getItems(keys: readonly string[]) {
    return Object.fromEntries(
      keys.flatMap((key) => this.items[key] === undefined ? [] : [[key, this.items[key]]]),
    );
  }

  async setItems(items: Readonly<Record<string, string>>) {
    if (
      this.rejectTimelineWrites &&
      Object.keys(items).some((key) => key.endsWith(".timeline.bundle.v1"))
    ) {
      return false;
    }
    Object.assign(this.items, items);
    return true;
  }

  async removeItems(keys: readonly string[]) {
    for (const key of keys) delete this.items[key];
    return true;
  }
}

function repository(kv: MemoryKV, cloud?: CloudKV) {
  return new SaveRepository<Payload>({
    key: "checkpoint.cloud.test",
    schema: 1,
    content: "checkpoint-cloud@test",
    device: "test-device",
    kv,
    cloud,
    payloadValidator: isPayload,
  });
}

test("three manual and ten auto recovery points cross devices with verified synced status", async () => {
  const cloud = new MemoryCloud();
  const firstDevice = repository(new MemoryKV(), cloud);
  assert.equal((await firstDevice.save(
    { marker: "active" },
    { seed: 41, simTick: 1 },
  )).ok, true);
  await firstDevice.whenCloudIdle();

  for (const [index, slotId] of MANUAL_CHECKPOINT_SLOTS.entries()) {
    const result = firstDevice.saveManualCheckpoint(
      slotId,
      { marker: `manual-${index}` },
      { seed: 41, simTick: 10 + index },
      checkpointMetadata("manual", 10 + index),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.entry.cloudDurability, "pending");
  }
  for (let index = 0; index < AUTO_CHECKPOINT_SLOTS.length; index += 1) {
    const result = firstDevice.saveAutoCheckpoint(
      { marker: `auto-${index}` },
      { seed: 41, simTick: 100 + index },
      checkpointMetadata("periodic", 100 + index),
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.entry.cloudDurability, "pending");
  }
  await firstDevice.whenCloudIdle();
  const firstEntries = firstDevice.listCheckpoints().entries;
  assert.equal(firstEntries.length, 13);
  assert.ok(firstEntries.every((entry) => entry.cloudDurability === "synced"));

  const secondDevice = repository(new MemoryKV(), cloud);
  const refreshed = await secondDevice.refreshFromCloud();
  assert.equal(refreshed.status, "updated");
  const secondEntries = secondDevice.listCheckpoints().entries;
  assert.equal(secondEntries.length, 13);
  assert.ok(secondEntries.every((entry) => entry.cloudDurability === "synced"));
  for (const [index, slotId] of MANUAL_CHECKPOINT_SLOTS.entries()) {
    const loaded = secondDevice.loadCheckpoint(slotId);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.envelope.payload.marker, `manual-${index}`);
  }
  for (const [index, slotId] of AUTO_CHECKPOINT_SLOTS.entries()) {
    const loaded = secondDevice.loadCheckpoint(slotId);
    assert.equal(loaded.ok, true);
    if (loaded.ok) assert.equal(loaded.envelope.payload.marker, `auto-${index}`);
  }
});

test("timeline cloud rejection degrades pending to local-only without rolling back the slot", async () => {
  const cloud = new MemoryCloud();
  const saves = repository(new MemoryKV(), cloud);
  assert.equal((await saves.save(
    { marker: "active" },
    { seed: 42, simTick: 1 },
  )).ok, true);
  await saves.whenCloudIdle();
  cloud.rejectTimelineWrites = true;

  const written = saves.saveManualCheckpoint(
    "manual-1",
    { marker: "local-survivor" },
    { seed: 42, simTick: 2 },
    checkpointMetadata("manual", 2),
  );
  assert.equal(written.ok, true);
  if (written.ok) assert.equal(written.entry.cloudDurability, "pending");
  await saves.whenCloudIdle();

  const listed = saves.listCheckpoints().entries.find((entry) => entry.slotId === "manual-1");
  assert.equal(listed?.cloudDurability, "local-only");
  const loaded = saves.loadCheckpoint("manual-1");
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.envelope.payload.marker, "local-survivor");
  assert.equal(saves.getCloudStatus(), "failed");
  assert.equal(saves.getLastCloudIssue()?.code, "cloud-write-failed");
});

test("corrupt remote timeline is isolated and never clears an existing local recovery point", async () => {
  const cloud = new MemoryCloud();
  const source = repository(new MemoryKV(), cloud);
  assert.equal((await source.save(
    { marker: "remote-active" },
    { seed: 43, simTick: 20 },
  )).ok, true);
  await source.whenCloudIdle();
  assert.equal(source.saveManualCheckpoint(
    "manual-1",
    { marker: "remote-checkpoint" },
    { seed: 43, simTick: 30 },
    checkpointMetadata("manual", 30),
  ).ok, true);
  await source.whenCloudIdle();
  const bundle = JSON.parse(cloud.items[source.checkpointCloudKey]) as { sequence: number };
  bundle.sequence += 1;
  cloud.items[source.checkpointCloudKey] = JSON.stringify(bundle);

  const targetKV = new MemoryKV();
  const localOnly = repository(targetKV);
  assert.equal((await localOnly.save(
    { marker: "local-active" },
    { seed: 43, simTick: 1 },
  )).ok, true);
  assert.equal(localOnly.saveManualCheckpoint(
    "manual-1",
    { marker: "protected-local-checkpoint" },
    { seed: 43, simTick: 200 },
    checkpointMetadata("manual", 200),
  ).ok, true);

  const target = repository(targetKV, cloud);
  const refreshed = await target.refreshFromCloud();
  assert.equal(refreshed.status, "updated");
  const protectedCheckpoint = target.loadCheckpoint("manual-1");
  assert.equal(protectedCheckpoint.ok, true);
  if (protectedCheckpoint.ok) {
    assert.equal(
      protectedCheckpoint.envelope.payload.marker,
      "protected-local-checkpoint",
    );
    assert.equal(protectedCheckpoint.entry.cloudDurability, "local-only");
  }
  assert.equal(target.getCloudStatus(), "failed");
  assert.equal(target.getLastCloudIssue()?.code, "cloud-read-failed");
});
