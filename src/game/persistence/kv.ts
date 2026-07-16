export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type KVStorageDurability = "persistent" | "ephemeral";

export interface KVStoreSelection {
  kv: KVStore;
  durability: KVStorageDurability;
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/** Safely discovers localStorage; privacy/security exceptions are treated as unavailable. */
export function detectBrowserKV(globalObject: unknown = globalThis): KVStore | null {
  try {
    if (!isObject(globalObject)) return null;
    const candidate = Reflect.get(globalObject, "localStorage");
    if (!isObject(candidate)) return null;
    if (
      typeof Reflect.get(candidate, "getItem") !== "function" ||
      typeof Reflect.get(candidate, "setItem") !== "function" ||
      typeof Reflect.get(candidate, "removeItem") !== "function"
    ) {
      return null;
    }
    const store = candidate as unknown as KVStore;
    // Merely exposing localStorage is not enough: private/embedded browser
    // modes may provide the API while every write throws. Probe one reversible
    // value so the UI can honestly distinguish durable from session-only data.
    const probeKey = "__canopy_local_storage_probe_v1__";
    const previous = store.getItem(probeKey);
    try {
      store.setItem(probeKey, "ok");
      if (store.getItem(probeKey) !== "ok") return null;
    } finally {
      if (previous === null) store.removeItem(probeKey);
      else store.setItem(probeKey, previous);
    }
    return store;
  } catch {
    return null;
  }
}

/** Deterministic, injectable storage for Node tests and non-browser hosts. */
export class MemoryKV implements KVStore {
  private readonly values = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.values);
  }
}

export function createDefaultKV(globalObject: unknown = globalThis): KVStore {
  return createDefaultKVSelection(globalObject).kv;
}

/**
 * Returns both the storage implementation and whether it can survive a page
 * reload. The previous silent MemoryKV fallback made a session-only save look
 * locally durable to the player.
 */
export function createDefaultKVSelection(
  globalObject: unknown = globalThis,
): KVStoreSelection {
  const browser = detectBrowserKV(globalObject);
  return browser
    ? { kv: browser, durability: "persistent" }
    : { kv: new MemoryKV(), durability: "ephemeral" };
}
