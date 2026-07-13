import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  SaveRepository,
  createSaveEnvelope,
  parseSaveEnvelope,
  serializeSaveEnvelope,
  type CloudKV,
  type KVStore,
} from "../../src/game/persistence";

interface TestPayload {
  scene: string;
  inventory: { stick: number };
}

function isTestPayload(value: unknown): value is TestPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TestPayload>;
  return (
    typeof candidate.scene === "string" &&
    typeof candidate.inventory === "object" &&
    candidate.inventory !== null &&
    typeof candidate.inventory.stick === "number"
  );
}

function repository(
  kv: KVStore,
  options: { cloud?: CloudKV; schema?: number; content?: string } = {},
): SaveRepository<TestPayload> {
  return new SaveRepository<TestPayload>({
    key: "test.save",
    schema: options.schema ?? 2,
    content: options.content ?? "vertical-slice@1",
    device: "test-device",
    kv,
    cloud: options.cloud,
    payloadValidator: isTestPayload,
  });
}

const firstPayload: TestPayload = { scene: "river", inventory: { stick: 2 } };
const secondPayload: TestPayload = { scene: "camp", inventory: { stick: 4 } };

test("save envelope is versioned, checksummed, and round-trips generic payload", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);

  const first = await saves.save(firstPayload, { seed: "seed-a", simTick: 12 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.envelope.schema, 2);
  assert.equal(first.envelope.content, "vertical-slice@1");
  assert.equal(first.envelope.revision, 1);
  assert.equal(first.envelope.device, "test-device");
  assert.equal(first.envelope.seed, "seed-a");
  assert.equal(first.envelope.simTick, 12);
  assert.match(first.envelope.checksum, /^fnv1a32:[0-9a-f]{8}$/);

  const loaded = await saves.load();
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.source, "local");
  assert.equal(loaded.recovered, false);
  assert.deepEqual(loaded.envelope.payload, firstPayload);
});

test("each save increments revision and preserves the previous valid primary as backup", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);

  const first = await saves.save(firstPayload, { seed: 41, simTick: 1 });
  const second = await saves.save(secondPayload, { seed: 41, simTick: 2 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.envelope.revision, 2);

  const backupRaw = kv.getItem(saves.backupKey);
  assert.ok(backupRaw);
  const backup = parseSaveEnvelope<TestPayload>(backupRaw, {
    schema: 2,
    content: "vertical-slice@1",
    payloadValidator: isTestPayload,
  });
  assert.equal(backup.ok, true);
  if (backup.ok) {
    assert.equal(backup.envelope.revision, 1);
    assert.deepEqual(backup.envelope.payload, firstPayload);
  }
});

test("tampered primary is quarantined and the valid backup is restored", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  await saves.save(firstPayload, { seed: 9, simTick: 10 });
  await saves.save(secondPayload, { seed: 9, simTick: 20 });

  const primaryRaw = kv.getItem(saves.key);
  assert.ok(primaryRaw);
  const tampered = JSON.parse(primaryRaw) as { payload: TestPayload };
  tampered.payload.inventory.stick = 999;
  const corruptRaw = JSON.stringify(tampered);
  kv.setItem(saves.key, corruptRaw);

  const reloaded = repository(kv);
  const result = await reloaded.load();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "backup");
  assert.equal(result.recovered, true);
  assert.deepEqual(result.envelope.payload, firstPayload);
  assert.equal(kv.getItem(reloaded.corruptKey), corruptRaw);
  assert.equal(kv.getItem(reloaded.key), kv.getItem(reloaded.backupKey));
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "envelope-invalid" && issue.reason === "checksum-mismatch",
    ),
  );
});

test("schema/content mismatch is rejected rather than silently loaded", async () => {
  const kv = new MemoryKV();
  const oldRepository = repository(kv, { schema: 1, content: "old-content" });
  await oldRepository.save(firstPayload, { seed: 1, simTick: 0 });

  const currentRepository = repository(kv);
  const result = await currentRepository.load({ allowCloudFallback: false });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "envelope-invalid" && issue.reason === "schema-mismatch",
    ),
  );
});

test("cloud is used only as a fallback when no valid local save exists", async () => {
  const envelope = createSaveEnvelope<TestPayload>({
    schema: 2,
    content: "vertical-slice@1",
    revision: 7,
    device: "other-device",
    seed: "cloud-seed",
    simTick: 88,
    payload: secondPayload,
  });
  const raw = serializeSaveEnvelope(envelope);
  let reads = 0;
  const cloud: CloudKV = {
    async getItems() {
      reads += 1;
      return { "test.save": raw };
    },
    async setItems() {
      return true;
    },
  };
  const kv = new MemoryKV();
  const saves = repository(kv, { cloud });

  const result = await saves.load();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.source, "cloud");
  assert.equal(result.recovered, true);
  assert.equal(result.envelope.revision, 7);
  assert.deepEqual(result.envelope.payload, secondPayload);
  assert.equal(kv.getItem(saves.key), raw);
  assert.equal(reads, 1);

  const secondLoad = await saves.load();
  assert.equal(secondLoad.ok, true);
  assert.equal(reads, 1, "valid local save must not wait for cloud");
});

test("clear invalidates an in-flight cloud load before it can restore stale data", async () => {
  const kv = new MemoryKV();
  let releaseCloud!: () => void;
  const gate = new Promise<void>((resolve) => { releaseCloud = resolve; });
  const raw = serializeSaveEnvelope(createSaveEnvelope({
    schema: 2,
    content: "vertical-slice@1",
    revision: 7,
    device: "old-device",
    seed: 4,
    simTick: 30,
    payload: firstPayload,
  }));
  const cloud: CloudKV = {
    async getItems() {
      await gate;
      return { "test.save": raw };
    },
    async setItems() { return true; },
  };
  const saves = repository(kv, { cloud });
  const loading = saves.load();
  await Promise.resolve();
  await saves.clear();
  releaseCloud();

  const result = await loading;
  assert.equal(result.ok, false);
  assert.equal(kv.getItem(saves.key), null);
});

test("local save resolves while cloud write is still pending", async () => {
  let releaseCloud: ((value: boolean) => void) | undefined;
  let cloudStarted = false;
  const cloud: CloudKV = {
    async getItems() {
      return {};
    },
    async setItems() {
      cloudStarted = true;
      return await new Promise<boolean>((resolve) => {
        releaseCloud = resolve;
      });
    },
  };
  const kv = new MemoryKV();
  const saves = repository(kv, { cloud });

  const result = await saves.save(firstPayload, { seed: 2, simTick: 3 });
  assert.equal(result.ok, true);
  assert.ok(kv.getItem(saves.key), "local primary must be durable before cloud finishes");
  await Promise.resolve();
  assert.equal(cloudStarted, true);

  let idle = false;
  const idlePromise = saves.whenCloudIdle().then(() => {
    idle = true;
  });
  await Promise.resolve();
  assert.equal(idle, false);
  assert.ok(releaseCloud);
  releaseCloud(true);
  await idlePromise;
  assert.equal(idle, true);
});

test("cloud rejection never rolls back a successful local save", async () => {
  const cloud: CloudKV = {
    async getItems() {
      return null;
    },
    async setItems() {
      throw new Error("cloud offline");
    },
  };
  const kv = new MemoryKV();
  const saves = repository(kv, { cloud });
  const result = await saves.save(firstPayload, { seed: 5, simTick: 6 });
  assert.equal(result.ok, true);
  assert.ok(kv.getItem(saves.key));
  await saves.whenCloudIdle();
  assert.equal(saves.getLastCloudIssue()?.code, "cloud-write-failed");

  const loaded = await saves.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.deepEqual(loaded.envelope.payload, firstPayload);
});

test("refreshFromCloud only replaces local state with a newer valid revision", async () => {
  const kv = new MemoryKV();
  const local = repository(kv);
  await local.save(firstPayload, { seed: 3, simTick: 3 });

  const cloudEnvelope = createSaveEnvelope<TestPayload>({
    schema: 2,
    content: "vertical-slice@1",
    revision: 4,
    device: "remote-device",
    seed: 3,
    simTick: 40,
    payload: secondPayload,
  });
  const cloud: CloudKV = {
    async getItems() {
      return { "test.save": serializeSaveEnvelope(cloudEnvelope) };
    },
    async setItems() {
      return true;
    },
  };
  const syncing = repository(kv, { cloud });
  const refresh = await syncing.refreshFromCloud();
  assert.equal(refresh.status, "updated");
  if (refresh.status === "updated") assert.equal(refresh.envelope.revision, 4);

  const loaded = await syncing.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.deepEqual(loaded.envelope.payload, secondPayload);

  const again = await syncing.refreshFromCloud();
  assert.equal(again.status, "up-to-date");
});

test("clear removes primary, backup, and quarantine before scheduling cloud clear", async () => {
  const removed: string[][] = [];
  const cloud: CloudKV = {
    async getItems() {
      return {};
    },
    async setItems() {
      return true;
    },
    async removeItems(keys) {
      removed.push([...keys]);
      return true;
    },
  };
  const kv = new MemoryKV();
  const saves = repository(kv, { cloud });
  await saves.save(firstPayload, { seed: 1, simTick: 1 });
  await saves.save(secondPayload, { seed: 1, simTick: 2 });
  kv.setItem(saves.corruptKey, "broken");
  await saves.whenCloudIdle();

  const result = await saves.clear();
  assert.equal(result.ok, true);
  assert.equal(result.cloudScheduled, true);
  assert.equal(kv.getItem(saves.key), null);
  assert.equal(kv.getItem(saves.backupKey), null);
  assert.equal(kv.getItem(saves.corruptKey), null);
  await saves.whenCloudIdle();
  assert.deepEqual(removed, [[saves.key, saves.backupKey]]);
});

test("local storage failure is surfaced and cloud write is not scheduled", async () => {
  let cloudWrites = 0;
  const cloud: CloudKV = {
    async getItems() {
      return {};
    },
    async setItems() {
      cloudWrites += 1;
      return true;
    },
  };
  const brokenKV: KVStore = {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error("quota exceeded");
    },
    removeItem() {},
  };
  const saves = repository(brokenKV, { cloud });
  const result = await saves.save(firstPayload, { seed: 1, simTick: 1 });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "storage-error");
  await saves.whenCloudIdle();
  assert.equal(cloudWrites, 0);
});
