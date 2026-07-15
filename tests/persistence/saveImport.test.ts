import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  SaveRepository,
  createSaveEnvelope,
  serializeSaveEnvelope,
  type CloudKV,
  type KVStore,
} from "../../src/game/persistence";

type Payload = { marker: string };

function repository(kv: KVStore, cloud?: CloudKV) {
  return new SaveRepository<Payload>({
    key: "import.save",
    schema: 1,
    content: "canopy@2",
    acceptedContent: ["canopy@1"],
    device: "current-device",
    kv,
    cloud,
    payloadValidator: (value): value is Payload =>
      Boolean(value && typeof value === "object" && typeof (value as Payload).marker === "string"),
  });
}

test("import retains a local rollback point and re-envelops as a fresh run", async () => {
  const kv = new MemoryKV();
  const saves = repository(kv);
  const original = await saves.save({ marker: "original" }, { seed: 1, simTick: 10 });
  assert.equal(original.ok, true);

  const imported = await saves.replaceFromImport(
    { marker: "imported" },
    { seed: 8, simTick: 3 },
  );
  assert.equal(imported.ok, true);
  if (!original.ok || !imported.ok) return;
  assert.ok((imported.envelope.runEpoch ?? 0) > (original.envelope.runEpoch ?? 0));
  assert.equal(imported.envelope.content, "canopy@2");
  assert.equal(imported.envelope.device, "current-device");

  const active = await saves.load({ allowCloudFallback: false });
  assert.equal(active.ok, true);
  if (active.ok) assert.equal(active.envelope.payload.marker, "imported");
  const rollback = saves.getPreImportSnapshot();
  assert.equal(rollback.ok, true);
  if (rollback.ok) assert.equal(rollback.envelope.payload.marker, "original");
});

test("a newer-looking old cloud checkpoint cannot outrank a confirmed import", async () => {
  const remote = serializeSaveEnvelope(createSaveEnvelope<Payload>({
    schema: 1,
    content: "canopy@2",
    runEpoch: 0,
    revision: 99,
    device: "old-cloud",
    seed: 1,
    simTick: 999,
    payload: { marker: "old-cloud" },
  }));
  const cloudItems: Record<string, string> = { "import.save": remote };
  const cloud: CloudKV = {
    async getItems() { return { ...cloudItems }; },
    async setItems(items) { Object.assign(cloudItems, items); return true; },
  };
  const saves = repository(new MemoryKV(), cloud);
  await saves.save({ marker: "local" }, { seed: 1, simTick: 2 });
  await saves.whenCloudIdle();
  assert.equal(saves.getLastCloudIssue()?.code, "cloud-conflict");

  const imported = await saves.replaceFromImport(
    { marker: "confirmed-import" },
    { seed: 4, simTick: 1 },
  );
  assert.equal(imported.ok, true);
  await saves.whenCloudIdle();
  assert.equal(saves.getCloudStatus(), "synced");

  const restored = repository(new MemoryKV(), cloud);
  const loaded = await restored.load();
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.envelope.payload.marker, "confirmed-import");
});

test("a primary write failure leaves the original active and never touches cloud", async () => {
  class FailingKV implements KVStore {
    readonly memory = new MemoryKV();
    failPrimary = false;
    getItem(key: string) { return this.memory.getItem(key); }
    setItem(key: string, value: string) {
      if (this.failPrimary && key === "import.save") throw new Error("quota");
      this.memory.setItem(key, value);
    }
    removeItem(key: string) { this.memory.removeItem(key); }
  }
  const kv = new FailingKV();
  let cloudWrites = 0;
  const saves = repository(kv, {
    async getItems() { return {}; },
    async setItems() { cloudWrites += 1; return true; },
  });
  await saves.save({ marker: "protected" }, { seed: 1, simTick: 5 });
  await saves.whenCloudIdle();
  cloudWrites = 0;
  const originalRaw = kv.getItem(saves.key);
  kv.failPrimary = true;

  const result = await saves.replaceFromImport(
    { marker: "must-not-win" },
    { seed: 2, simTick: 1 },
  );
  assert.equal(result.ok, false);
  assert.equal(kv.getItem(saves.key), originalRaw);
  await saves.whenCloudIdle();
  assert.equal(cloudWrites, 0);
});

test("a failed first-import readback removes the unverified primary", async () => {
  class CorruptReadbackKV implements KVStore {
    readonly memory = new MemoryKV();
    corruptPrimary = false;

    getItem(key: string) {
      const value = this.memory.getItem(key);
      return this.corruptPrimary && key === "import.save" && value
        ? `${value}corrupt`
        : value;
    }

    setItem(key: string, value: string) {
      this.memory.setItem(key, value);
      if (key === "import.save") this.corruptPrimary = true;
    }

    removeItem(key: string) {
      this.memory.removeItem(key);
      if (key === "import.save") this.corruptPrimary = false;
    }
  }

  const kv = new CorruptReadbackKV();
  let cloudWrites = 0;
  const saves = repository(kv, {
    async getItems() { return {}; },
    async setItems() { cloudWrites += 1; return true; },
  });

  const result = await saves.replaceFromImport(
    { marker: "unverified" },
    { seed: 7, simTick: 1 },
  );
  assert.equal(result.ok, false);
  assert.equal(kv.memory.getItem(saves.key), null);
  await saves.whenCloudIdle();
  assert.equal(cloudWrites, 0);
});
