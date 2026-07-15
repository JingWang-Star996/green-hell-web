import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  SaveCoordinator,
  SaveRepository,
  ToyBridgeCloudKV,
} from "../../src/game/persistence";
import {
  TOY_CLOUD_MAX_KEY_BYTES,
  TOY_CLOUD_MAX_ITEM_BYTES,
  TOY_CLOUD_MAX_KEYS,
  ToyBridgeClient,
  type RawToyBridge,
} from "../../src/game/platform";

const encoder = new TextEncoder();
const legalPhysicalKey = /^[A-Za-z0-9_-]+$/;

function assertPhysicalKeys(keys: readonly string[]): void {
  assert.ok(keys.length <= TOY_CLOUD_MAX_KEYS);
  for (const key of keys) {
    assert.match(key, legalPhysicalKey);
    assert.ok(encoder.encode(key).byteLength <= TOY_CLOUD_MAX_KEY_BYTES);
  }
}

interface FakeToyCloud {
  storage: Record<string, string>;
  setCalls: Record<string, string>[];
  getCalls: string[][];
  removeCalls: string[][];
  bridge: RawToyBridge;
}

function fakeToyCloud(
  initial: Readonly<Record<string, string>> = {},
  options: { supportsRemove?: boolean } = {},
): FakeToyCloud {
  const storage = { ...initial };
  const setCalls: Record<string, string>[] = [];
  const getCalls: string[][] = [];
  const removeCalls: string[][] = [];
  assertPhysicalKeys(Object.keys(storage));

  const bridge: RawToyBridge = {
    getCloudStorage(keys = []) {
      assertPhysicalKeys(keys);
      getCalls.push([...keys]);
      if (keys.length === 0) return { ...storage };
      const selected: Record<string, string> = {};
      for (const key of keys) {
        if (key in storage) selected[key] = storage[key];
      }
      return selected;
    },
    setCloudStorage(items) {
      const keys = Object.keys(items);
      assertPhysicalKeys(keys);
      for (const [key, value] of Object.entries(items)) {
        assert.ok(
          encoder.encode(key).byteLength + encoder.encode(value).byteLength <=
            TOY_CLOUD_MAX_ITEM_BYTES,
          "every physical cloud key/value pair must stay within Toy's 1024-byte cap",
        );
      }
      setCalls.push({ ...items });
      Object.assign(storage, items);
    },
  };
  if (options.supportsRemove !== false) {
    bridge.removeCloudStorage = (keys) => {
      assertPhysicalKeys(keys);
      removeCalls.push([...keys]);
      for (const key of keys) delete storage[key];
    };
  }

  return { storage, setCalls, getCalls, removeCalls, bridge };
}

function adapter(
  fake: FakeToyCloud,
  compression: "auto" | "identity" = "identity",
): ToyBridgeCloudKV {
  return new ToyBridgeCloudKV(new ToyBridgeClient({ bridge: fake.bridge }), {
    compression,
  });
}

function manifest(fake: FakeToyCloud, physicalKey: string): Record<string, unknown> {
  return JSON.parse(fake.storage[physicalKey]) as Record<string, unknown>;
}

test("Chinese saves round-trip across multiple strict 1024-byte chunks", async () => {
  const fake = fakeToyCloud();
  const cloud = adapter(fake);
  const value = `营地：暴雨中的热带雨林；${"观察、采集、制作、求生。".repeat(700)}`;

  assert.equal(await cloud.setItems({ green_hell_save_v2: value }), true);
  assert.equal(fake.setCalls.length, 1, "all chunks publish in one atomic SDK batch");
  const writtenKeys = Object.keys(fake.setCalls[0]);
  assertPhysicalKeys(writtenKeys);
  const descriptor = manifest(fake, "green_hell_save_v2");
  assert.equal(descriptor.protocol, "canopy-cloud-chunks");
  assert.equal(descriptor.version, 1);
  assert.equal(descriptor.encoding, "utf8-base64");
  assert.ok(Number(descriptor.chunks) > 1);
  assert.match(String(descriptor.checksum), /^fnv1a32:[0-9a-f]{8}$/);

  assert.deepEqual(await cloud.getItems(["green_hell_save_v2"]), {
    green_hell_save_v2: value,
  });
});

test("production codec prefers gzip and has a non-native compatible fallback", async () => {
  const compressionDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "CompressionStream",
  );
  const decompressionDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "DecompressionStream",
  );
  try {
    Object.defineProperty(globalThis, "CompressionStream", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(globalThis, "DecompressionStream", {
      configurable: true,
      value: undefined,
    });

    const fake = fakeToyCloud();
    const cloud = adapter(fake, "auto");
    const value = "动态雨林生态循环".repeat(1_000);
    assert.equal(await cloud.setItems({ save: value }), true);
    assert.equal(manifest(fake, "save").encoding, "gzip-base64");
    assert.deepEqual(await cloud.getItems(["save"]), { save: value });
  } finally {
    if (compressionDescriptor) {
      Object.defineProperty(globalThis, "CompressionStream", compressionDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "CompressionStream");
    }
    if (decompressionDescriptor) {
      Object.defineProperty(globalThis, "DecompressionStream", decompressionDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "DecompressionStream");
    }
  }
});

test("decoded byte ceilings reject oversized cloud values before chunk reads", async () => {
  const fake = fakeToyCloud();
  const permissive = new ToyBridgeCloudKV(
    new ToyBridgeClient({ bridge: fake.bridge }),
    { compression: "auto", maxDecodedBytes: 4_096 },
  );
  assert.equal(await permissive.setItems({ save: "x".repeat(2_048) }), true);

  fake.getCalls.length = 0;
  const bounded = new ToyBridgeCloudKV(
    new ToyBridgeClient({ bridge: fake.bridge }),
    { compression: "auto", maxDecodedBytes: 1_024 },
  );
  assert.deepEqual(await bounded.getItems(["save"]), {});
  assert.equal(
    fake.getCalls.length,
    1,
    "an oversized manifest must be rejected before any chunk payload is fetched",
  );
});

test("a gzip payload whose trailer exceeds its claimed size is rejected before decompression", async () => {
  const fake = fakeToyCloud();
  const writer = new ToyBridgeCloudKV(
    new ToyBridgeClient({ bridge: fake.bridge }),
    { compression: "auto", maxDecodedBytes: 4_096 },
  );
  assert.equal(await writer.setItems({ save: "z".repeat(2_048) }), true);
  const descriptor = manifest(fake, "save");
  descriptor.bytes = 512;
  fake.storage.save = JSON.stringify(descriptor);

  const original = Object.getOwnPropertyDescriptor(globalThis, "DecompressionStream");
  let constructions = 0;
  try {
    Object.defineProperty(globalThis, "DecompressionStream", {
      configurable: true,
      value: class {
        constructor() {
          constructions += 1;
          throw new Error("untrusted gzip should not reach the decompressor");
        }
      },
    });
    const reader = new ToyBridgeCloudKV(
      new ToyBridgeClient({ bridge: fake.bridge }),
      { compression: "auto", maxDecodedBytes: 1_024 },
    );
    assert.deepEqual(await reader.getItems(["save"]), {});
    assert.equal(constructions, 0);
  } finally {
    if (original) {
      Object.defineProperty(globalThis, "DecompressionStream", original);
    } else {
      Reflect.deleteProperty(globalThis, "DecompressionStream");
    }
  }
});

test("writes cannot create logical values above the configured decoded-byte ceiling", async () => {
  const fake = fakeToyCloud();
  const cloud = new ToyBridgeCloudKV(
    new ToyBridgeClient({ bridge: fake.bridge }),
    { compression: "auto", maxDecodedBytes: 128 },
  );
  assert.equal(await cloud.setItems({ save: "雨".repeat(43) }), false);
  assert.equal(fake.setCalls.length, 0);
});

test("missing or corrupted chunks discard only their logical slot", async () => {
  const fake = fakeToyCloud();
  const cloud = adapter(fake);
  const value = "雨林路径".repeat(600);
  assert.equal(await cloud.setItems({ save: value }), true);
  const chunkKeys = Object.keys(fake.storage).filter((key) => key !== "save");
  assert.ok(chunkKeys.length > 1);
  const originalChunk = fake.storage[chunkKeys[0]];

  delete fake.storage[chunkKeys[0]];
  assert.deepEqual(await cloud.getItems(["save"]), {});

  fake.storage[chunkKeys[0]] = originalChunk;
  fake.storage[chunkKeys[0]] = `${originalChunk[0] === "A" ? "B" : "A"}${originalChunk.slice(1)}`;
  assert.deepEqual(await cloud.getItems(["save"]), {});
});

test("a corrupted primary slot does not hide a valid logical backup", async () => {
  const fake = fakeToyCloud();
  const cloud = adapter(fake);
  const primaryKey = "green_hell_save_v2";
  const backupKey = `${primaryKey}.backup`;
  const primary = "primary".repeat(600);
  const backup = "backup".repeat(600);

  assert.equal(
    await cloud.setItems({ [primaryKey]: primary, [backupKey]: backup }),
    true,
  );
  fake.storage[primaryKey] = JSON.stringify({
    protocol: "canopy-cloud-chunks",
    version: 999,
  });

  assert.deepEqual(await cloud.getItems([primaryKey, backupKey]), {
    [backupKey]: backup,
  });
});

test("a chunk transport failure still makes the whole cloud read unavailable", async () => {
  const fake = fakeToyCloud();
  const stored = adapter(fake);
  const value = "rainforest-path".repeat(600);
  assert.equal(await stored.setItems({ save: value }), true);

  let reads = 0;
  const bridge: RawToyBridge = {
    getCloudStorage(keys = []) {
      reads += 1;
      if (reads > 1) throw new Error("cloud transport offline");
      return Object.fromEntries(
        keys.filter((key) => key in fake.storage).map((key) => [key, fake.storage[key]]),
      );
    },
  };
  const cloud = new ToyBridgeCloudKV(new ToyBridgeClient({ bridge }), {
    compression: "identity",
  });

  assert.equal(await cloud.getItems(["save"]), null);
});

test("a shorter overwrite removes excess old chunks after publishing the new batch", async () => {
  const fake = fakeToyCloud();
  const cloud = adapter(fake);
  assert.equal(await cloud.setItems({ save: "旧路线".repeat(1_000) }), true);
  const oldChunks = Object.keys(fake.storage).filter((key) => key !== "save");
  assert.ok(oldChunks.length > 2);

  assert.equal(await cloud.setItems({ save: "新营地" }), true);
  assert.equal(fake.setCalls.length, 2);
  assert.ok(fake.removeCalls.at(-1)?.length);
  const newChunkCount = Number(manifest(fake, "save").chunks);
  assert.equal(Object.keys(fake.storage).length, 1 + newChunkCount);
  assert.deepEqual(await cloud.getItems(["save"]), { save: "新营地" });
});

test("logical backup keys map to legal physical keys and true deletion removes all parts", async () => {
  const fake = fakeToyCloud();
  const cloud = adapter(fake);
  const backupKey = "green_hell_save_v2.backup";
  assert.equal(
    await cloud.setItems({
      green_hell_save_v2: "primary",
      [backupKey]: "backup".repeat(500),
    }),
    true,
  );
  assert.ok("green_hell_save_v2" in fake.storage, "legal main key remains legacy-compatible");
  assert.ok(!Object.keys(fake.storage).some((key) => key.includes(".")));
  assert.deepEqual(
    await cloud.getItems(["green_hell_save_v2", backupKey]),
    { green_hell_save_v2: "primary", [backupKey]: "backup".repeat(500) },
  );

  assert.equal(await cloud.removeItems(["green_hell_save_v2", backupKey]), true);
  assert.deepEqual(fake.storage, {});
  assert.ok(fake.removeCalls.flat().length > 2);
});

test("hosts without real deletion use safe empty tombstones", async () => {
  const fake = fakeToyCloud({}, { supportsRemove: false });
  const cloud = adapter(fake);
  assert.equal(await cloud.setItems({ save: "camp".repeat(400) }), true);
  assert.equal(await cloud.removeItems(["save"]), true);
  assert.ok(Object.keys(fake.storage).length > 0);
  assert.ok(Object.values(fake.storage).every((value) => value === ""));
  assert.deepEqual(await cloud.getItems(["save"]), {});
});

test("legacy unchunked values remain readable", async () => {
  const legacy = JSON.stringify({ version: 0, note: "旧版云存档", payload: "x".repeat(2_000) });
  const fake = fakeToyCloud({ save: legacy });
  const cloud = adapter(fake);
  assert.deepEqual(await cloud.getItems(["save"]), { save: legacy });
});

test("more than 128 physical keys fails closed and leaves the local checkpoint intact", async () => {
  const fake = fakeToyCloud();
  const cloud = adapter(fake);
  const hugeMarker = "界".repeat(45_000);
  assert.equal(await cloud.setItems({ save: hugeMarker }), false);
  assert.equal(fake.setCalls.length, 0);

  const local = new MemoryKV();
  const repository = new SaveRepository<{ marker: string }>({
    key: "save",
    schema: 1,
    content: "cloud-chunk-test@1",
    device: "test-device",
    kv: local,
    cloud,
    payloadValidator: (value): value is { marker: string } =>
      Boolean(
        value &&
          typeof value === "object" &&
          typeof (value as { marker?: unknown }).marker === "string",
      ),
  });
  const coordinator = new SaveCoordinator(repository);
  const status = await coordinator.save(
    { marker: hugeMarker },
    { seed: "large-save", simTick: 12 },
    "manual",
  );
  assert.equal(
    status.phase,
    "saved-local",
    "the physical-key ceiling must not delay or invalidate local durability",
  );
  assert.ok(local.getItem(repository.key));
  await coordinator.whenCloudIdle();
  assert.equal(coordinator.getStatus().phase, "cloud-failed");
  const loaded = await repository.load({ allowCloudFallback: false });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.envelope.payload.marker, hugeMarker);
});
