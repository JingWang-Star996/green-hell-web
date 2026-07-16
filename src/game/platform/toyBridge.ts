export const DEFAULT_TOY_BRIDGE_TIMEOUT_MS = 1_500;
/** Toy limits each physical key/value pair to 1 KiB in total. */
export const TOY_CLOUD_MAX_ITEM_BYTES = 1_024;
export const TOY_CLOUD_MAX_KEYS = 128;
export const TOY_CLOUD_MAX_KEY_BYTES = 128;
export const TOY_CLOUD_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface RawToyBridge {
  getCloudStorage?: (keys?: string[]) => unknown;
  setCloudStorage?: (items: Record<string, string>) => unknown;
  removeCloudStorage?: (keys: string[]) => unknown;
  reportAction?: (request: { userEventId: string }) => unknown;
}

export type ToyBridgeOperation =
  | "getCloudStorage"
  | "setCloudStorage"
  | "removeCloudStorage"
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

export interface ToyBridgeWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
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

export function isValidToyCloudKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length > 0 &&
    TOY_CLOUD_KEY_PATTERN.test(key) &&
    new TextEncoder().encode(key).byteLength <= TOY_CLOUD_MAX_KEY_BYTES
  );
}

function validCloudKeys(keys: readonly string[]): boolean {
  return (
    keys.length <= TOY_CLOUD_MAX_KEYS &&
    keys.every(isValidToyCloudKey)
  );
}

function validCloudWrite(items: Readonly<Record<string, string>>): boolean {
  const entries = Object.entries(items);
  return (
    entries.length <= TOY_CLOUD_MAX_KEYS &&
    entries.every(
      ([key, value]) =>
        isValidToyCloudKey(key) &&
        new TextEncoder().encode(key).byteLength +
          new TextEncoder().encode(value).byteLength <=
          TOY_CLOUD_MAX_ITEM_BYTES,
    )
  );
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
  /**
   * Cloud mutations share one settlement lane. A caller-facing timeout does
   * not release this barrier: only the host promise actually settling does.
   */
  private cloudMutationTail: Promise<void> = Promise.resolve();

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

  /**
   * Gives an asynchronously injected Toy SDK one bounded opportunity to join
   * the first title-screen cloud discovery. This waits for the cloud read
   * method, not merely a partially initialized `toy` object.
   */
  async waitForCloudStorage(options: ToyBridgeWaitOptions = {}): Promise<boolean> {
    const timeoutMs = normalizedTimeout(options.timeoutMs ?? this.timeoutMs);
    const pollIntervalMs = Math.min(
      timeoutMs,
      normalizedTimeout(options.pollIntervalMs ?? 25),
    );
    const deadline = Date.now() + timeoutMs;
    while (!this.hasOperation("getCloudStorage")) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.min(pollIntervalMs, remaining));
      });
    }
    return true;
  }

  async getCloudStorage(
    keys: readonly string[] = [],
    fallback: Readonly<Record<string, string>> = {},
  ): Promise<ToyBridgeResult<Record<string, string>>> {
    const safeFallback = isStringRecord(fallback) ? cloneStringRecord(fallback) : {};
    if (!Array.isArray(keys) || !validCloudKeys(keys)) {
      return this.fail("getCloudStorage", safeFallback, "invalid-input");
    }

    const uniqueKeys = [...new Set(keys)];
    const result = await this.invoke(
      "getCloudStorage",
      [uniqueKeys],
      safeFallback,
    );
    if (!result.ok) return result;
    if (
      !isStringRecord(result.value) ||
      !validCloudKeys(Object.keys(result.value))
    ) {
      return this.fail("getCloudStorage", safeFallback, "invalid-response");
    }
    return { ok: true, value: cloneStringRecord(result.value) };
  }

  async setCloudStorage(
    items: Readonly<Record<string, string>>,
  ): Promise<ToyBridgeResult<boolean>> {
    if (!isStringRecord(items) || !validCloudWrite(items)) {
      return this.fail("setCloudStorage", false, "invalid-input");
    }
    const result = await this.invokeCloudMutation(
      "setCloudStorage",
      [cloneStringRecord(items)],
      false,
    );
    return result.ok ? { ok: true, value: true } : result;
  }

  async removeCloudStorage(
    keys: readonly string[],
  ): Promise<ToyBridgeResult<boolean>> {
    if (!Array.isArray(keys) || !validCloudKeys(keys)) {
      return this.fail("removeCloudStorage", false, "invalid-input");
    }
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length === 0) return { ok: true, value: true };
    const result = await this.invokeCloudMutation(
      "removeCloudStorage",
      [uniqueKeys],
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

  /**
   * Serializes host storage mutations without confusing a public timeout with
   * actual host settlement. If a timed-out host call never settles, the lane
   * intentionally remains closed; queued callers time out without invoking
   * the SDK, so a late old write can never overtake a newer one.
   */
  private async invokeCloudMutation<T>(
    operation: "setCloudStorage" | "removeCloudStorage",
    args: unknown[],
    fallback: T,
  ): Promise<ToyBridgeInvocation<T>> {
    return await new Promise<ToyBridgeInvocation<T>>((resolve) => {
      let publicSettled = false;
      let expired = false;
      const complete = (result: ToyBridgeInvocation<T>) => {
        if (publicSettled) return;
        publicSettled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        expired = true;
        const error = new ToyBridgeTimeoutError(operation, this.timeoutMs);
        complete(this.fail(operation, fallback, "timeout", error));
      }, this.timeoutMs);

      const run = async () => {
        // This request exhausted its public budget while waiting behind an
        // older host mutation. It must never be invoked later as a stale write.
        if (expired) return;

        const bridge = this.resolveBridge();
        if (!bridge) {
          complete(this.fail(operation, fallback, "unavailable"));
          return;
        }

        let method: unknown;
        try {
          method = Reflect.get(bridge, operation);
        } catch (error) {
          complete(this.fail(operation, fallback, "error", error));
          return;
        }
        if (typeof method !== "function") {
          complete(this.fail(operation, fallback, "unsupported"));
          return;
        }

        try {
          // Deliberately await the raw host promise even after `complete` has
          // already returned a timeout to the caller. This is the queue barrier.
          const value = await Reflect.apply(
            method as (...parameters: unknown[]) => unknown,
            bridge,
            args,
          );
          complete({ ok: true, value });
        } catch (error) {
          if (!publicSettled) {
            complete(this.fail(operation, fallback, "error", error));
          }
        }
      };

      const predecessor = this.cloudMutationTail;
      this.cloudMutationTail = predecessor
        .then(run, run)
        .then(
          () => undefined,
          () => undefined,
        );
    });
  }

  private hasOperation(operation: ToyBridgeOperation): boolean {
    const bridge = this.resolveBridge();
    if (!bridge) return false;
    try {
      return typeof Reflect.get(bridge, operation) === "function";
    } catch {
      return false;
    }
  }

  private resolveBridge(): RawToyBridge | null {
    if (this.canRedetect) {
      // Some hosts first expose a placeholder object and replace it when the
      // asynchronous SDK finishes loading. Retain a prior working bridge when
      // the global temporarily disappears, but adopt every newer candidate.
      this.bridge = detectToyBridge(this.globalObject) ?? this.bridge;
    }
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
