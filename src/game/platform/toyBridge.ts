export const DEFAULT_TOY_BRIDGE_TIMEOUT_MS = 1_500;

export interface RawToyBridge {
  getCloudStorage?: (keys?: string[]) => unknown;
  setCloudStorage?: (items: Record<string, string>) => unknown;
  reportAction?: (request: { userEventId: string }) => unknown;
}

export type ToyBridgeOperation =
  | "getCloudStorage"
  | "setCloudStorage"
  | "reportAction";

export type ToyBridgeFailureReason =
  | "unavailable"
  | "unsupported"
  | "invalid-input"
  | "invalid-response"
  | "timeout"
  | "error";

export type ToyBridgeResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      value: T;
      reason: ToyBridgeFailureReason;
      error?: unknown;
    };

type ToyBridgeInvocation<T> =
  | { ok: true; value: unknown }
  | Extract<ToyBridgeResult<T>, { ok: false }>;

export interface ToyBridgeClientOptions {
  /** Explicit bridge override. Pass null to force the unavailable fallback. */
  bridge?: unknown;
  /** Object on which the SDK exposes `toy`; defaults to globalThis. */
  globalObject?: unknown;
  timeoutMs?: number;
  onFailure?: (
    operation: ToyBridgeOperation,
    result: Extract<ToyBridgeResult<unknown>, { ok: false }>,
  ) => void;
}

class ToyBridgeTimeoutError extends Error {
  constructor(operation: ToyBridgeOperation, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = "ToyBridgeTimeoutError";
  }
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isObject(value) || Array.isArray(value)) return false;
  try {
    return Object.keys(value).every((key) => typeof value[key] === "string");
  } catch {
    return false;
  }
}

function cloneStringRecord(value: Readonly<Record<string, string>>): Record<string, string> {
  const clone: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) clone[key] = item;
  return clone;
}

function normalizedTimeout(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TOY_BRIDGE_TIMEOUT_MS;
  }
  return Math.max(1, Math.floor(value));
}

async function withTimeout<T>(
  operation: ToyBridgeOperation,
  timeoutMs: number,
  task: () => T | PromiseLike<T>,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new ToyBridgeTimeoutError(operation, timeoutMs));
    }, timeoutMs);

    Promise.resolve()
      .then(task)
      .then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

/**
 * Safely detects the injected Toy SDK without assuming a browser or touching React.
 * Accessors supplied by hostile or partially initialized hosts are contained.
 */
export function detectToyBridge(globalObject: unknown = globalThis): RawToyBridge | null {
  try {
    if (!isObject(globalObject)) return null;
    const candidate = Reflect.get(globalObject, "toy");
    return isObject(candidate) ? (candidate as RawToyBridge) : null;
  } catch {
    return null;
  }
}

export class ToyBridgeClient {
  readonly timeoutMs: number;
  private bridge: RawToyBridge | null;
  private readonly globalObject: unknown;
  private readonly canRedetect: boolean;
  private readonly onFailure?: ToyBridgeClientOptions["onFailure"];

  constructor(options: ToyBridgeClientOptions = {}) {
    this.timeoutMs = normalizedTimeout(options.timeoutMs);
    this.onFailure = options.onFailure;
    this.globalObject = options.globalObject ?? globalThis;

    if (Object.prototype.hasOwnProperty.call(options, "bridge")) {
      this.canRedetect = false;
      this.bridge = isObject(options.bridge) ? (options.bridge as RawToyBridge) : null;
    } else {
      this.canRedetect = true;
      this.bridge = detectToyBridge(this.globalObject);
    }
  }

  get available(): boolean {
    return this.resolveBridge() !== null;
  }

  async getCloudStorage(
    keys: readonly string[] = [],
    fallback: Readonly<Record<string, string>> = {},
  ): Promise<ToyBridgeResult<Record<string, string>>> {
    const safeFallback = isStringRecord(fallback) ? cloneStringRecord(fallback) : {};
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
      return this.fail("getCloudStorage", safeFallback, "invalid-input");
    }

    const uniqueKeys = [...new Set(keys)];
    const result = await this.invoke(
      "getCloudStorage",
      [uniqueKeys],
      safeFallback,
    );
    if (!result.ok) return result;
    if (!isStringRecord(result.value)) {
      return this.fail("getCloudStorage", safeFallback, "invalid-response");
    }
    return { ok: true, value: cloneStringRecord(result.value) };
  }

  async setCloudStorage(
    items: Readonly<Record<string, string>>,
  ): Promise<ToyBridgeResult<boolean>> {
    if (!isStringRecord(items)) {
      return this.fail("setCloudStorage", false, "invalid-input");
    }
    const result = await this.invoke(
      "setCloudStorage",
      [cloneStringRecord(items)],
      false,
    );
    return result.ok ? { ok: true, value: true } : result;
  }

  async reportAction(
    event: string | { userEventId: string },
  ): Promise<ToyBridgeResult<boolean>> {
    const userEventId = typeof event === "string" ? event : event?.userEventId;
    if (typeof userEventId !== "string" || userEventId.trim().length === 0) {
      return this.fail("reportAction", false, "invalid-input");
    }
    const result = await this.invoke(
      "reportAction",
      [{ userEventId: userEventId.trim() }],
      false,
    );
    return result.ok ? { ok: true, value: true } : result;
  }

  private async invoke<T>(
    operation: ToyBridgeOperation,
    args: unknown[],
    fallback: T,
  ): Promise<ToyBridgeInvocation<T>> {
    const bridge = this.resolveBridge();
    if (!bridge) return this.fail(operation, fallback, "unavailable");

    let method: unknown;
    try {
      method = Reflect.get(bridge, operation);
    } catch (error) {
      return this.fail(operation, fallback, "error", error);
    }
    if (typeof method !== "function") {
      return this.fail(operation, fallback, "unsupported");
    }

    try {
      const value = await withTimeout(operation, this.timeoutMs, () =>
        Reflect.apply(method as (...parameters: unknown[]) => unknown, bridge, args),
      );
      return { ok: true, value };
    } catch (error) {
      return this.fail(
        operation,
        fallback,
        error instanceof ToyBridgeTimeoutError ? "timeout" : "error",
        error,
      );
    }
  }

  private resolveBridge(): RawToyBridge | null {
    if (!this.bridge && this.canRedetect) this.bridge = detectToyBridge(this.globalObject);
    return this.bridge;
  }

  private fail<T>(
    operation: ToyBridgeOperation,
    value: T,
    reason: ToyBridgeFailureReason,
    error?: unknown,
  ): Extract<ToyBridgeResult<T>, { ok: false }> {
    const result: Extract<ToyBridgeResult<T>, { ok: false }> = {
      ok: false,
      value,
      reason,
      ...(error === undefined ? {} : { error }),
    };
    try {
      this.onFailure?.(
        operation,
        result as Extract<ToyBridgeResult<unknown>, { ok: false }>,
      );
    } catch {
      // Diagnostics must never make the host bridge unsafe.
    }
    return result;
  }
}

export function createToyBridgeClient(
  options: ToyBridgeClientOptions = {},
): ToyBridgeClient {
  return new ToyBridgeClient(options);
}
