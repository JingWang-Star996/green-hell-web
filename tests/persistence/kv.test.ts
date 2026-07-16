import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  createDefaultKVSelection,
  detectBrowserKV,
} from "../../src/game/persistence";

test("browser storage is persistent only after a reversible write probe", () => {
  const storage = new MemoryKV({ __canopy_local_storage_probe_v1__: "keep" });
  const selection = createDefaultKVSelection({ localStorage: storage });

  assert.equal(selection.kv, storage);
  assert.equal(selection.durability, "persistent");
  assert.equal(storage.getItem("__canopy_local_storage_probe_v1__"), "keep");
});

test("write-denied browser storage falls back to explicitly ephemeral memory", () => {
  const denied = {
    getItem() { return null; },
    setItem() { throw new Error("denied"); },
    removeItem() { throw new Error("denied"); },
  };

  assert.equal(detectBrowserKV({ localStorage: denied }), null);
  const selection = createDefaultKVSelection({ localStorage: denied });
  assert.equal(selection.durability, "ephemeral");
  assert.ok(selection.kv instanceof MemoryKV);
});
