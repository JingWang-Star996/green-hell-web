export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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
    return candidate as unknown as KVStore;
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
  return detectBrowserKV(globalObject) ?? new MemoryKV();
}
