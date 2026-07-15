import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  SaveCoordinator,
  SaveRepository,
  ToyBridgeCloudKV,
  autosaveReasonForEvents,
  saveStatusLabel,
  type CloudKV,
  type SaveStatus,
} from "../../src/game/persistence";
import { ToyBridgeClient } from "../../src/game/platform";

type Payload = { marker: string };

function createRepository(kv: MemoryKV, cloud?: CloudKV) {
  return new SaveRepository<Payload>({
    key: "coordinator.save",
    schema: 1,
    content: "test@1",
    device: "test-device",
    kv,
    cloud,
    payloadValidator: (value): value is Payload =>
      Boolean(value && typeof value === "object" && typeof (value as Payload).marker === "string"),
  });
}

test("manual save becomes locally durable before Toy cloud sync resolves", async () => {
  let releaseCloud!: (value: boolean) => void;
  const cloud: CloudKV = {
    async getItems() { return {}; },
    async setItems() {
      return await new Promise<boolean>((resolve) => { releaseCloud = resolve; });
    },
  };
  const kv = new MemoryKV();
  const repository = createRepository(kv, cloud);
  const statuses: SaveStatus[] = [];
  const coordinator = new SaveCoordinator(repository, {
    onStatus: (status) => statuses.push(status),
    now: () => 1234,
  });

  const saved = await coordinator.save(
    { marker: "manual" },
    { seed: 1, simTick: 4 },
    "manual",
  );

  assert.ok(kv.getItem(repository.key), "local primary exists while cloud is still pending");
  assert.equal(saved.phase, "saved-local");
  assert.equal(coordinator.getStatus().phase, "saved-local");
  assert.deepEqual(statuses.map((status) => status.phase), ["saving", "saved-local"]);
  releaseCloud(true);

  await coordinator.whenCloudIdle();
  assert.equal(coordinator.getStatus().phase, "saved-cloud");
  assert.equal(coordinator.getStatus().savedAt, 1234);
});

test("cloud failure preserves local success and exposes a retryable state", async () => {
  const kv = new MemoryKV();
  const repository = createRepository(kv, {
    async getItems() { return {}; },
    async setItems() { return false; },
  });
  const coordinator = new SaveCoordinator(repository);

  const result = await coordinator.save(
    { marker: "safe-locally" },
    { seed: 1, simTick: 8 },
    "task",
  );
  assert.equal(result.phase, "saved-local");
  assert.ok(kv.getItem(repository.key));
  await coordinator.whenCloudIdle();
  assert.equal(coordinator.getStatus().phase, "cloud-failed");

  const loaded = await repository.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.envelope.payload.marker, "safe-locally");
});

test("a never-settling Toy host write cannot block or roll back local durability", async () => {
  const kv = new MemoryKV();
  const toy = new ToyBridgeClient({
    timeoutMs: 10,
    bridge: {
      getCloudStorage: () => ({}),
      setCloudStorage: () => new Promise(() => undefined),
    },
  });
  const repository = createRepository(
    kv,
    new ToyBridgeCloudKV(toy, { compression: "identity" }),
  );
  const coordinator = new SaveCoordinator(repository);

  const result = await coordinator.save(
    { marker: "durable-before-host" },
    { seed: 2, simTick: 9 },
    "manual",
  );
  assert.equal(result.phase, "saved-local");
  assert.ok(kv.getItem(repository.key));
  await coordinator.whenCloudIdle();
  assert.equal(coordinator.getStatus().phase, "cloud-failed");

  const loaded = await repository.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.envelope.payload.marker, "durable-before-host");
});

test("checkpoint promotion resolves after verified local durability without waiting for cloud", async () => {
  let releaseCloud!: (value: boolean) => void;
  const cloud: CloudKV = {
    async getItems() { return {}; },
    async setItems() {
      return await new Promise<boolean>((resolve) => { releaseCloud = resolve; });
    },
  };
  const kv = new MemoryKV();
  const repository = createRepository(kv, cloud);
  const coordinator = new SaveCoordinator(repository);

  const promoted = await Promise.race([
    coordinator.replaceFromCheckpoint(
      { marker: "recovered" },
      { seed: 7, simTick: 10 },
    ),
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 30)),
  ]);
  assert.notEqual(promoted, "timeout");
  if (promoted === "timeout") return;
  assert.equal(promoted.phase, "saved-local");
  const local = await repository.load({ allowCloudFallback: false });
  assert.equal(local.ok, true);
  if (local.ok) assert.equal(local.envelope.payload.marker, "recovered");

  await Promise.resolve();
  releaseCloud(true);
  await coordinator.whenCloudIdle();
});

test("the next successful checkpoint clears a previous cloud retry state", async () => {
  let fail = true;
  const repository = createRepository(new MemoryKV(), {
    async getItems() { return {}; },
    async setItems() { return fail ? false : true; },
  });
  const coordinator = new SaveCoordinator(repository);

  const failed = await coordinator.save({ marker: "first" }, { seed: 1, simTick: 1 }, "task");
  assert.equal(failed.phase, "saved-local");
  await coordinator.whenCloudIdle();
  assert.equal(coordinator.getStatus().phase, "cloud-failed");
  fail = false;
  const retried = await coordinator.save({ marker: "second" }, { seed: 1, simTick: 2 }, "periodic");
  assert.equal(retried.phase, "saved-local");
  await coordinator.whenCloudIdle();
  assert.equal(coordinator.getStatus().phase, "saved-cloud");
  assert.equal(repository.getLastCloudIssue(), null);
});

test("a slower old cloud completion cannot replace a newer save status or payload", async () => {
  let releaseFirst!: () => void;
  let writes = 0;
  const cloud: CloudKV = {
    async getItems() { return {}; },
    async setItems() {
      writes += 1;
      if (writes === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return true;
    },
  };
  const kv = new MemoryKV();
  const repository = createRepository(kv, cloud);
  const coordinator = new SaveCoordinator(repository);

  const oldSave = coordinator.save({ marker: "old" }, { seed: 2, simTick: 10 }, "periodic");
  await Promise.resolve();
  await Promise.resolve();
  const newSave = coordinator.save({ marker: "new" }, { seed: 2, simTick: 11 }, "manual");
  await Promise.resolve();
  await Promise.resolve();
  releaseFirst();

  await Promise.all([oldSave, newSave]);
  await coordinator.whenCloudIdle();
  assert.equal(coordinator.getStatus().phase, "saved-cloud");
  assert.equal(coordinator.getStatus().reason, "manual");
  const loaded = await repository.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.envelope.payload.marker, "new");
    assert.equal(loaded.envelope.simTick, 11);
  }
});

test("a late checkpoint from an older simulation tick is ignored", async () => {
  const repository = createRepository(new MemoryKV());
  const coordinator = new SaveCoordinator(repository);
  const current = await coordinator.save({ marker: "current" }, { seed: 3, simTick: 20 }, "task");
  const stale = await coordinator.save({ marker: "stale" }, { seed: 3, simTick: 19 }, "periodic");

  assert.equal(stale.revision, current.revision);
  const loaded = await repository.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.envelope.payload.marker, "current");
});

test("autosave event classification covers rest, objectives, and key milestones", () => {
  assert.equal(autosaveReasonForEvents([{ type: "rest-completed" }]), "rest-after");
  assert.equal(autosaveReasonForEvents([{ type: "task-completed" }]), "task");
  assert.equal(autosaveReasonForEvents([{ type: "landmark-inspected" }]), "milestone");
  assert.equal(
    autosaveReasonForEvents([
      {
        type: "landmark-inspected",
        details: { entityId: "landmark.river-gauge", createsMilestone: false },
      },
    ]),
    null,
    "repeatable readings must not rotate a checkpoint or schedule cloud work",
  );
  assert.equal(autosaveReasonForEvents([{ type: "wildlife-defeated" }]), "milestone");
  assert.equal(autosaveReasonForEvents([{ type: "wildlife-loot-collected" }]), "milestone");
  assert.equal(
    autosaveReasonForEvents([{ type: "craft-succeeded", details: { recipeId: "shelter" } }]),
    "milestone",
  );
  assert.equal(
    autosaveReasonForEvents([
      { type: "craft-succeeded", details: { recipeId: "rain-collector" } },
    ]),
    "milestone",
  );
  assert.equal(
    autosaveReasonForEvents([
      { type: "craft-succeeded", details: { recipeId: "torch-waymark" } },
    ]),
    "milestone",
  );
  assert.equal(
    autosaveReasonForEvents([
      {
        type: "structure-fuel-added",
        details: { structureId: "waymark.autosave", fuelAddedSeconds: 314 },
      },
    ]),
    "milestone",
  );
  assert.equal(
    autosaveReasonForEvents([
      { type: "structure-ignited", details: { structureId: "waymark.relit" } },
    ]),
    null,
    "relighting without transferring a physical torch must not create a save milestone",
  );
  assert.equal(
    autosaveReasonForEvents([
      {
        type: "structure-output-collected",
        details: { itemId: "clean-water", structureId: "collector.autosave" },
      },
    ]),
    "milestone",
  );
  assert.equal(
    autosaveReasonForEvents([{ type: "resource-picked", details: { itemId: "battery" } }]),
    "milestone",
  );
  assert.equal(autosaveReasonForEvents([{ type: "resource-picked", details: { itemId: "stick" } }]), null);
});

test("ephemeral browser storage is never presented as a durable local save", () => {
  assert.equal(
    saveStatusLabel({
      phase: "saved-local",
      reason: "manual",
      localDurability: "ephemeral",
    }),
    "浏览器本地存储不可用 · 正在同步 Toy 云端",
  );
  assert.equal(
    saveStatusLabel({
      phase: "cloud-failed",
      reason: "manual",
      localDurability: "ephemeral",
    }),
    "未能持久保存 · 请立即导出存档文件",
  );
});
