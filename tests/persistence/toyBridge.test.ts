import assert from "node:assert/strict";
import test from "node:test";

import {
  ToyBridgeClient,
  detectToyBridge,
  type RawToyBridge,
} from "../../src/game/platform";

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
  assert.equal((await client.reportAction("start_run")).ok, false);
  assert.deepEqual(failures, [
    "getCloudStorage:unavailable",
    "setCloudStorage:unavailable",
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
  assert.deepEqual(await client.reportAction("  start_run  "), {
    ok: true,
    value: true,
  });
  assert.deepEqual(calls, [
    ["save"],
    { save: "local" },
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
