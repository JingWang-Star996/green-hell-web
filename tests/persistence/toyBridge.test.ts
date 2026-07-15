import assert from "node:assert/strict";
import test from "node:test";

import {
  TOY_CLOUD_MAX_ITEM_BYTES,
  ToyBridgeClient,
  detectToyBridge,
  type RawToyBridge,
} from "../../src/game/platform";

const encoder = new TextEncoder();

test("detectToyBridge contains missing and throwing host access", () => {
  assert.equal(detectToyBridge({}), null);
  assert.equal(detectToyBridge(null), null);

  const throwingHost = Object.defineProperty({}, "toy", {
    get() {
      throw new Error("host not ready");
    },
  });
  assert.equal(detectToyBridge(throwingHost), null);

  const bridge: RawToyBridge = {};
  assert.equal(detectToyBridge({ toy: bridge }), bridge);
});

test("unavailable bridge returns caller fallback and never rejects", async () => {
  const failures: string[] = [];
  const client = new ToyBridgeClient({
    bridge: null,
    onFailure(operation, result) {
      failures.push(`${operation}:${result.reason}`);
    },
  });

  assert.equal(client.available, false);
  const read = await client.getCloudStorage(["save"], { save: "local" });
  assert.deepEqual(read, {
    ok: false,
    value: { save: "local" },
    reason: "unavailable",
  });
  assert.equal((await client.setCloudStorage({ save: "value" })).ok, false);
  assert.equal((await client.removeCloudStorage(["save"])).ok, false);
  assert.equal((await client.reportAction("start_run")).ok, false);
  assert.deepEqual(failures, [
    "getCloudStorage:unavailable",
    "setCloudStorage:unavailable",
    "removeCloudStorage:unavailable",
    "reportAction:unavailable",
  ]);
});

test("bridge methods preserve receiver, normalize input, and report success", async () => {
  const calls: unknown[] = [];
  const bridge: RawToyBridge = {
    async getCloudStorage(keys) {
      assert.equal(this, bridge);
      calls.push(keys);
      return { save: "cloud" };
    },
    async setCloudStorage(items) {
      assert.equal(this, bridge);
      calls.push(items);
    },
    async removeCloudStorage(keys) {
      assert.equal(this, bridge);
      calls.push(keys);
    },
    async reportAction(request) {
      assert.equal(this, bridge);
      calls.push(request);
    },
  };
  const client = new ToyBridgeClient({ bridge });

  assert.deepEqual(await client.getCloudStorage(["save", "save"]), {
    ok: true,
    value: { save: "cloud" },
  });
  assert.deepEqual(await client.setCloudStorage({ save: "local" }), {
    ok: true,
    value: true,
  });
  assert.deepEqual(await client.removeCloudStorage(["save", "save"]), {
    ok: true,
    value: true,
  });
  assert.deepEqual(await client.reportAction("  start_run  "), {
    ok: true,
    value: true,
  });
  assert.deepEqual(calls, [
    ["save"],
    { save: "local" },
    ["save"],
    { userEventId: "start_run" },
  ]);
});

test("invalid inputs and invalid cloud response fail closed", async () => {
  const client = new ToyBridgeClient({
    bridge: {
      getCloudStorage: () => ["not", "a", "record"],
      setCloudStorage: () => undefined,
      reportAction: () => undefined,
    },
  });

  const invalidRead = await client.getCloudStorage(["save"], { save: "fallback" });
  assert.equal(invalidRead.ok, false);
  if (!invalidRead.ok) {
    assert.equal(invalidRead.reason, "invalid-response");
    assert.deepEqual(invalidRead.value, { save: "fallback" });
  }

  const invalidEvent = await client.reportAction("   ");
  assert.equal(invalidEvent.ok, false);
  if (!invalidEvent.ok) assert.equal(invalidEvent.reason, "invalid-input");

  const invalidKeyRead = await client.getCloudStorage(["save.backup"]);
  assert.equal(invalidKeyRead.ok, false);
  if (!invalidKeyRead.ok) assert.equal(invalidKeyRead.reason, "invalid-input");

  const oversizedValue = await client.setCloudStorage({ save: "界".repeat(342) });
  assert.equal(oversizedValue.ok, false);
  if (!oversizedValue.ok) assert.equal(oversizedValue.reason, "invalid-input");

  const tooManyKeys = Object.fromEntries(
    Array.from({ length: 129 }, (_, index) => [`save_${index}`, "x"]),
  );
  const oversizedBatch = await client.setCloudStorage(tooManyKeys);
  assert.equal(oversizedBatch.ok, false);
  if (!oversizedBatch.ok) assert.equal(oversizedBatch.reason, "invalid-input");

  const unsupportedRemove = await client.removeCloudStorage(["save"]);
  assert.equal(unsupportedRemove.ok, false);
  if (!unsupportedRemove.ok) assert.equal(unsupportedRemove.reason, "unsupported");
});

test("cloud key and value share Toy's 1024-byte physical item budget", async () => {
  const writes: Record<string, string>[] = [];
  const client = new ToyBridgeClient({
    bridge: {
      setCloudStorage(items: Record<string, string>) {
        writes.push({ ...items });
      },
    },
  });
  const key = "save";
  const valueBudget = TOY_CLOUD_MAX_ITEM_BYTES - encoder.encode(key).byteLength;

  assert.equal(
    (await client.setCloudStorage({ [key]: "x".repeat(valueBudget) })).ok,
    true,
  );
  const oversized = await client.setCloudStorage({
    [key]: "x".repeat(valueBudget + 1),
  });
  assert.equal(oversized.ok, false);
  if (!oversized.ok) assert.equal(oversized.reason, "invalid-input");
  assert.equal(writes.length, 1);
});

test("cloud responses with illegal or overlong physical keys are rejected", async () => {
  const illegal = new ToyBridgeClient({
    bridge: { getCloudStorage: () => ({ "save.backup": "value" }) },
  });
  const illegalResult = await illegal.getCloudStorage([]);
  assert.equal(illegalResult.ok, false);
  if (!illegalResult.ok) assert.equal(illegalResult.reason, "invalid-response");

  const overlong = new ToyBridgeClient({
    bridge: { getCloudStorage: () => ({ ["a".repeat(129)]: "value" }) },
  });
  const overlongResult = await overlong.getCloudStorage([]);
  assert.equal(overlongResult.ok, false);
  if (!overlongResult.ok) assert.equal(overlongResult.reason, "invalid-response");
});

test("timeout and rejection are converted to safe results", async () => {
  const timeoutClient = new ToyBridgeClient({
    timeoutMs: 5,
    bridge: {
      reportAction: () => new Promise(() => undefined),
    },
  });
  const startedAt = Date.now();
  const timedOut = await timeoutClient.reportAction("slow_event");
  assert.equal(timedOut.ok, false);
  if (!timedOut.ok) assert.equal(timedOut.reason, "timeout");
  assert.ok(Date.now() - startedAt < 250, "timeout should be bounded");

  const rejectedClient = new ToyBridgeClient({
    bridge: {
      setCloudStorage: async () => {
        throw new Error("cloud offline");
      },
    },
  });
  const rejected = await rejectedClient.setCloudStorage({ save: "value" });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, "error");
});

test("a timed-out old cloud write must truly settle before a newer write starts", async () => {
  let releaseOld!: () => void;
  const calls: string[] = [];
  let stored = "initial";
  const client = new ToyBridgeClient({
    timeoutMs: 30,
    bridge: {
      setCloudStorage(items: Record<string, string>) {
        const value = items.save;
        calls.push(value);
        if (value === "old") {
          return new Promise<void>((resolve) => {
            releaseOld = () => {
              stored = value;
              resolve();
            };
          });
        }
        stored = value;
      },
    },
  });

  const oldResult = await client.setCloudStorage({ save: "old" });
  assert.equal(oldResult.ok, false);
  if (!oldResult.ok) assert.equal(oldResult.reason, "timeout");

  const newer = client.setCloudStorage({ save: "new" });
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, ["old"], "new write is still behind the raw old promise");
  releaseOld();

  assert.deepEqual(await newer, { ok: true, value: true });
  assert.deepEqual(calls, ["old", "new"]);
  assert.equal(stored, "new", "late old completion cannot overwrite the newer save");
});

test("a never-settling cloud write closes the mutation lane fail-closed", async () => {
  const calls: string[] = [];
  const client = new ToyBridgeClient({
    timeoutMs: 10,
    bridge: {
      setCloudStorage(items: Record<string, string>) {
        calls.push(items.save);
        return new Promise(() => undefined);
      },
    },
  });

  const first = await client.setCloudStorage({ save: "stuck" });
  assert.equal(first.ok, false);
  if (!first.ok) assert.equal(first.reason, "timeout");
  const second = await client.setCloudStorage({ save: "must-not-run" });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "timeout");
  assert.deepEqual(calls, ["stuck"]);
});

test("late Toy SDK injection is detected on the next operation", async () => {
  const host: { toy?: RawToyBridge } = {};
  const client = new ToyBridgeClient({ globalObject: host });
  assert.equal(client.available, false);

  const calls: string[] = [];
  host.toy = {
    reportAction(request) {
      calls.push(request.userEventId);
      return true;
    },
  };

  const result = await client.reportAction("late-sdk-ready");
  assert.equal(result.ok, true);
  assert.equal(client.available, true);
  assert.deepEqual(calls, ["late-sdk-ready"]);
});

test("first cloud discovery catches a Toy SDK injected 100ms after startup", async () => {
  // Real hosts may expose a placeholder `toy` object before attaching methods.
  const host: { toy?: RawToyBridge } = { toy: {} };
  const client = new ToyBridgeClient({ globalObject: host });
  assert.equal(client.available, true);
  const injection = setTimeout(() => {
    host.toy = {
      getCloudStorage(keys = []) {
        return keys.length === 0 || keys.includes("save") ? { save: "late-cloud" } : {};
      },
    };
  }, 100);

  try {
    assert.equal(
      await client.waitForCloudStorage({ timeoutMs: 500, pollIntervalMs: 10 }),
      true,
    );
    assert.deepEqual(await client.getCloudStorage(["save"]), {
      ok: true,
      value: { save: "late-cloud" },
    });
  } finally {
    clearTimeout(injection);
  }
});

test("first cloud discovery stops at its bounded wait when no SDK arrives", async () => {
  const client = new ToyBridgeClient({ globalObject: {} });
  const startedAt = Date.now();
  assert.equal(
    await client.waitForCloudStorage({ timeoutMs: 20, pollIntervalMs: 5 }),
    false,
  );
  assert.ok(Date.now() - startedAt < 250, "discovery must not strand the title screen");
});
