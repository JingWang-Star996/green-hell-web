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

test("an explicitly accepted legacy content id loads for migration and is rewritten as current", async () => {
  const kv = new MemoryKV();
  const legacy = repository(kv, { content: "vertical-slice@legacy" });
  await legacy.save(firstPayload, { seed: 1, simTick: 12 });

  const current = new SaveRepository<TestPayload>({
    key: "test.save",
    schema: 2,
    content: "vertical-slice@1",
    acceptedContent: ["vertical-slice@legacy"],
    device: "current-device",
    kv,
    payloadValidator: isTestPayload,
  });
  const loaded = await current.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.envelope.content, "vertical-slice@legacy");

  const rewritten = await current.save(loaded.envelope.payload, {
    seed: loaded.envelope.seed,
    simTick: loaded.envelope.simTick,
  });
  assert.equal(rewritten.ok, true);
  if (rewritten.ok) assert.equal(rewritten.envelope.content, "vertical-slice@1");
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
  assert.equal(reads, 2, "cloud fallback also discovers the checkpoint timeline bundle");

  const secondLoad = await saves.load();
  assert.equal(secondLoad.ok, true);
  assert.equal(reads, 2, "valid local save must not wait for cloud");
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

test("clear persists a cross-session run floor before an old cloud delete settles", async () => {
  const kv = new MemoryKV();
  let releaseRemoval!: () => void;
  const removalGate = new Promise<void>((resolve) => {
    releaseRemoval = resolve;
  });
  const oldRaw = serializeSaveEnvelope(createSaveEnvelope({
    schema: 2,
    content: "vertical-slice@1",
    runEpoch: 0,
    revision: 7,
    device: "old-device",
    seed: "old-run",
    simTick: 900,
    payload: firstPayload,
  }));
  const cloudItems: Record<string, string> = { "test.save": oldRaw };
  const cloud: CloudKV = {
    async getItems(keys) {
      return Object.fromEntries(
        keys.flatMap((key) => cloudItems[key] ? [[key, cloudItems[key]]] : []),
      );
    },
    async setItems(items) {
      Object.assign(cloudItems, items);
      return true;
    },
    async removeItems() {
      await removalGate;
      return false;
    },
  };

  const clearingSession = repository(kv, { cloud });
  const cleared = await clearingSession.clear();
  assert.equal(cleared.ok, true);

  const immediateRestart = repository(kv, { cloud });
  const immediateLoad = await immediateRestart.load();
  assert.equal(immediateLoad.ok, false);
  if (!immediateLoad.ok) assert.equal(immediateLoad.reason, "not-found");
  assert.equal(kv.getItem(immediateRestart.key), null);

  releaseRemoval();
  await clearingSession.whenCloudIdle();
  assert.equal(clearingSession.getLastCloudIssue()?.code, "cloud-write-failed");

  const restartAfterFailedDelete = repository(kv, { cloud });
  const laterLoad = await restartAfterFailedDelete.load();
  assert.equal(laterLoad.ok, false);
  assert.equal(kv.getItem(restartAfterFailedDelete.key), null);
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

test("an older local checkpoint never overwrites a fresher Toy cloud revision", async () => {
  const remoteEnvelope = createSaveEnvelope<TestPayload>({
    schema: 2,
    content: "vertical-slice@1",
    revision: 9,
    device: "remote-device",
    seed: 3,
    simTick: 90,
    payload: secondPayload,
  });
  const remoteRaw = serializeSaveEnvelope(remoteEnvelope);
  let cloudWrites = 0;
  const cloud: CloudKV = {
    async getItems() { return { "test.save": remoteRaw }; },
    async setItems() { cloudWrites += 1; return true; },
  };
  const kv = new MemoryKV();
  const saves = repository(kv, { cloud });

  const local = await saves.save(firstPayload, { seed: 3, simTick: 20 });
  assert.equal(local.ok, true, "local durability does not depend on conflict resolution");
  await saves.whenCloudIdle();
  assert.equal(cloudWrites, 0);
  assert.equal(saves.getLastCloudIssue()?.code, "cloud-conflict");

  const refreshed = await saves.refreshFromCloud();
  assert.equal(refreshed.status, "updated");
  if (refreshed.status === "updated") assert.deepEqual(refreshed.envelope.payload, secondPayload);
});

test("simulation progress outranks a higher save revision within the same run epoch", async () => {
  const kv = new MemoryKV();
  kv.setItem(
    "test.save",
    serializeSaveEnvelope(
      createSaveEnvelope<TestPayload>({
        schema: 2,
        content: "vertical-slice@1",
        runEpoch: 7,
        revision: 9,
        device: "local-device",
        seed: 3,
        simTick: 100,
        payload: firstPayload,
      }),
    ),
  );
  const remoteRaw = serializeSaveEnvelope(
    createSaveEnvelope<TestPayload>({
      schema: 2,
      content: "vertical-slice@1",
      runEpoch: 7,
      revision: 2,
      device: "remote-device",
      seed: 3,
      simTick: 10_000,
      payload: secondPayload,
    }),
  );
  let cloudWrites = 0;
  const cloud: CloudKV = {
    async getItems() {
      return { "test.save": remoteRaw };
    },
    async setItems() {
      cloudWrites += 1;
      return true;
    },
  };
  const saves = repository(kv, { cloud });

  const local = await saves.save(firstPayload, { seed: 3, simTick: 101 });
  assert.equal(local.ok, true);
  if (local.ok) assert.equal(local.envelope.revision, 10);
  await saves.whenCloudIdle();
  assert.equal(cloudWrites, 0);
  assert.equal(saves.getLastCloudIssue()?.code, "cloud-conflict");

  const refreshed = await saves.refreshFromCloud();
  assert.equal(refreshed.status, "updated");
  if (refreshed.status === "updated") {
    assert.equal(refreshed.envelope.simTick, 10_000);
    assert.deepEqual(refreshed.envelope.payload, secondPayload);
  }
});

test("equal revision and tick with different payload is treated as a cross-device conflict", async () => {
  const remoteRaw = serializeSaveEnvelope(createSaveEnvelope<TestPayload>({
    schema: 2,
    content: "vertical-slice@1",
    revision: 1,
    device: "remote-device",
    seed: 8,
    simTick: 20,
    payload: secondPayload,
  }));
  let cloudWrites = 0;
  const saves = repository(new MemoryKV(), {
    cloud: {
      async getItems() { return { "test.save": remoteRaw }; },
      async setItems() { cloudWrites += 1; return true; },
    },
  });

  await saves.save(firstPayload, { seed: 8, simTick: 20 });
  await saves.whenCloudIdle();
  assert.equal(cloudWrites, 0);
  assert.equal(saves.getLastCloudIssue()?.code, "cloud-conflict");
  const refresh = await saves.refreshFromCloud();
  assert.equal(refresh.status, "updated", "ambiguous ties prefer the existing cloud checkpoint");
});

test("an explicit new run survives a failed cloud clear and later replaces the old run", async () => {
  const oldCloudEnvelope = createSaveEnvelope<TestPayload>({
    schema: 2,
    content: "vertical-slice@1",
    revision: 9,
    device: "old-device",
    seed: "old-run",
    simTick: 900,
    payload: firstPayload,
  });
  const cloudItems: Record<string, string> = {
    "test.save": serializeSaveEnvelope(oldCloudEnvelope),
  };
  let writesEnabled = false;
  const cloud: CloudKV = {
    async getItems() {
      return { ...cloudItems };
    },
    async setItems(items) {
      if (!writesEnabled) return false;
      Object.assign(cloudItems, items);
      return true;
    },
    async removeItems() {
      return false;
    },
  };
  const kv = new MemoryKV();
  const firstSession = repository(kv, { cloud });

  await firstSession.clear();
  const newRunSave = await firstSession.save(secondPayload, {
    seed: "new-run",
    simTick: 0,
  });
  assert.equal(newRunSave.ok, true);
  if (!newRunSave.ok) return;
  assert.ok((newRunSave.envelope.runEpoch ?? 0) > 0);
  await firstSession.whenCloudIdle();
  assert.equal(firstSession.getLastCloudIssue()?.code, "cloud-write-failed");

  const restarted = repository(kv, { cloud });
  const refreshWhileOldCloudSurvives = await restarted.refreshFromCloud();
  assert.equal(refreshWhileOldCloudSurvives.status, "up-to-date");
  if (refreshWhileOldCloudSurvives.status === "up-to-date") {
    assert.deepEqual(refreshWhileOldCloudSurvives.envelope.payload, secondPayload);
    assert.equal(refreshWhileOldCloudSurvives.envelope.seed, "new-run");
  }

  writesEnabled = true;
  await restarted.save(secondPayload, { seed: "new-run", simTick: 1 });
  await restarted.whenCloudIdle();
  const replacedCloud = parseSaveEnvelope<TestPayload>(cloudItems["test.save"], {
    schema: 2,
    content: "vertical-slice@1",
    payloadValidator: isTestPayload,
  });
  assert.equal(replacedCloud.ok, true);
  if (replacedCloud.ok) {
    assert.equal(replacedCloud.envelope.seed, "new-run");
    assert.deepEqual(replacedCloud.envelope.payload, secondPayload);
    assert.equal(
      replacedCloud.envelope.runEpoch,
      newRunSave.envelope.runEpoch,
      "every checkpoint in one run keeps the same epoch",
    );
  }
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
  assert.equal(saves.saveAutoCheckpoint(
    firstPayload,
    { seed: 1, simTick: 3 },
    {
      reason: "rest-before",
      createdAt: 1,
      gameDay: 1,
      minuteOfDay: 500,
      elapsedSeconds: 10,
      objectiveLabel: "old run",
      position: { x: 0, z: 0 },
      biomeLabel: "forest",
      health: 100,
      majorStatuses: [],
      storm: false,
      combat: false,
      danger: false,
      safety: "safe",
    },
  ).ok, true);
  await saves.whenCloudIdle();

  const result = await saves.clear();
  assert.equal(result.ok, true);
  assert.equal(result.cloudScheduled, true);
  assert.equal(kv.getItem(saves.key), null);
  assert.equal(kv.getItem(saves.backupKey), null);
  assert.equal(kv.getItem(saves.corruptKey), null);
  assert.deepEqual(saves.listCheckpoints().entries, []);
  await saves.whenCloudIdle();
  assert.deepEqual(removed, [[
    saves.key,
    saves.backupKey,
    saves.checkpointCloudKey,
  ]]);
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
