import { checksum } from "./checksum";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
} from "../world/saveDelta";

export type SaveSeed = string | number;

export interface SaveEnvelope<T> {
  schema: number;
  content: string;
  /**
   * Monotonic identity for an explicitly replaced run. Legacy envelopes omit
   * this field and are interpreted as epoch zero.
   */
  runEpoch?: number;
  revision: number;
  device: string;
  seed: SaveSeed;
  simTick: number;
  payload: T;
  checksum: string;
}

export interface CreateSaveEnvelopeOptions<T> {
  schema: number;
  content: string;
  runEpoch?: number;
  revision: number;
  device: string;
  seed: SaveSeed;
  simTick: number;
  payload: T;
}

export interface ValidateSaveEnvelopeOptions<T> {
  schema?: number;
  /** Current content id or a compatibility allow-list for migratable saves. */
  content?: string | readonly string[];
  payloadValidator?: (payload: unknown) => payload is T;
}

export type EnvelopeFailureReason =
  | "invalid-json"
  | "invalid-shape"
  | "checksum-mismatch"
  | "schema-mismatch"
  | "content-mismatch"
  | "payload-invalid";

export type EnvelopeValidation<T> =
  | { ok: true; envelope: SaveEnvelope<T> }
  | { ok: false; reason: EnvelopeFailureReason; error?: unknown };

const LEGACY_ENVELOPE_KEYS = [
  "schema",
  "content",
  "revision",
  "device",
  "seed",
  "simTick",
  "payload",
  "checksum",
] as const;

const CURRENT_ENVELOPE_KEYS = [
  "schema",
  "content",
  "runEpoch",
  "revision",
  "device",
  "seed",
  "simTick",
  "payload",
  "checksum",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSeed(value: unknown): value is SaveSeed {
  return (
    (typeof value === "string" && value.length > 0) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function unsignedInteger(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= minimum;
}

function unsignedVersion(value: unknown): value is number {
  return unsignedInteger(value, 0);
}

function withoutChecksum<T>(envelope: SaveEnvelope<T>): Omit<SaveEnvelope<T>, "checksum"> {
  return {
    schema: envelope.schema,
    content: envelope.content,
    ...(Object.prototype.hasOwnProperty.call(envelope, "runEpoch")
      ? { runEpoch: envelope.runEpoch }
      : {}),
    revision: envelope.revision,
    device: envelope.device,
    seed: envelope.seed,
    simTick: envelope.simTick,
    payload: envelope.payload,
  };
}

export function computeEnvelopeChecksum<T>(envelope: SaveEnvelope<T>): string {
  return checksum(withoutChecksum(envelope));
}

export function createSaveEnvelope<T>(
  options: CreateSaveEnvelopeOptions<T>,
): SaveEnvelope<T> {
  if (!unsignedVersion(options.schema)) throw new TypeError("schema must be an unsigned integer");
  if (typeof options.content !== "string" || options.content.length === 0) {
    throw new TypeError("content must be a non-empty string");
  }
  if (options.runEpoch !== undefined && !unsignedVersion(options.runEpoch)) {
    throw new TypeError("runEpoch must be an unsigned integer");
  }
  if (!unsignedInteger(options.revision, 1)) {
    throw new TypeError("revision must be a positive integer");
  }
  if (typeof options.device !== "string" || options.device.length === 0) {
    throw new TypeError("device must be a non-empty string");
  }
  if (!validSeed(options.seed)) throw new TypeError("seed must be a finite number or non-empty string");
  if (!unsignedInteger(options.simTick, 0)) {
    throw new TypeError("simTick must be an unsigned integer");
  }

  const envelope: SaveEnvelope<T> = {
    schema: options.schema,
    content: options.content,
    ...(options.runEpoch === undefined ? {} : { runEpoch: options.runEpoch }),
    revision: options.revision,
    device: options.device,
    seed: options.seed,
    simTick: options.simTick,
    payload: options.payload,
    checksum: "",
  };
  envelope.checksum = computeEnvelopeChecksum(envelope);
  return envelope;
}

export function validateSaveEnvelope<T>(
  value: unknown,
  options: ValidateSaveEnvelopeOptions<T> = {},
): EnvelopeValidation<T> {
  if (!isRecord(value)) return { ok: false, reason: "invalid-shape" };
  const keys = Object.keys(value);
  const expectedKeys = Object.prototype.hasOwnProperty.call(value, "runEpoch")
    ? CURRENT_ENVELOPE_KEYS
    : LEGACY_ENVELOPE_KEYS;
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    return { ok: false, reason: "invalid-shape" };
  }
  if (
    !unsignedVersion(value.schema) ||
    typeof value.content !== "string" ||
    value.content.length === 0 ||
    (Object.prototype.hasOwnProperty.call(value, "runEpoch") &&
      !unsignedVersion(value.runEpoch)) ||
    !unsignedInteger(value.revision, 1) ||
    typeof value.device !== "string" ||
    value.device.length === 0 ||
    !validSeed(value.seed) ||
    !unsignedInteger(value.simTick, 0) ||
    typeof value.checksum !== "string"
  ) {
    return { ok: false, reason: "invalid-shape" };
  }

  const envelope = value as unknown as SaveEnvelope<unknown>;
  try {
    if (computeEnvelopeChecksum(envelope) !== envelope.checksum) {
      return { ok: false, reason: "checksum-mismatch" };
    }
  } catch (error) {
    return { ok: false, reason: "invalid-shape", error };
  }
  if (options.schema !== undefined && envelope.schema !== options.schema) {
    return { ok: false, reason: "schema-mismatch" };
  }
  const acceptedContent =
    typeof options.content === "string" ? [options.content] : options.content;
  if (acceptedContent !== undefined && !acceptedContent.includes(envelope.content)) {
    return { ok: false, reason: "content-mismatch" };
  }
  try {
    if (options.payloadValidator && !options.payloadValidator(envelope.payload)) {
      return { ok: false, reason: "payload-invalid" };
    }
  } catch (error) {
    return { ok: false, reason: "payload-invalid", error };
  }
  return { ok: true, envelope: envelope as SaveEnvelope<T> };
}

export function parseSaveEnvelope<T>(
  raw: string,
  options: ValidateSaveEnvelopeOptions<T> = {},
): EnvelopeValidation<T> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "invalid-json", error };
  }
  const stored = validateSaveEnvelope<unknown>(value, {
    schema: options.schema,
    content: options.content,
  });
  if (!stored.ok) return stored;

  const expandedPayload = expandGameStateSavePayload(stored.envelope.payload);
  if (expandedPayload === stored.envelope.payload) {
    return validateSaveEnvelope(value, options);
  }
  const expanded = {
    ...stored.envelope,
    payload: expandedPayload,
    checksum: "",
  } as SaveEnvelope<unknown>;
  expanded.checksum = computeEnvelopeChecksum(expanded);
  return validateSaveEnvelope<T>(expanded, options);
}

export function serializeSaveEnvelope<T>(envelope: SaveEnvelope<T>): string {
  const validation = validateSaveEnvelope(envelope);
  if (!validation.ok) throw new TypeError(`Cannot serialize envelope: ${validation.reason}`);
  const compactPayload = compactGameStateSavePayload(envelope.payload);
  if (compactPayload === envelope.payload) return JSON.stringify(envelope);

  const stored = {
    ...envelope,
    payload: compactPayload,
    checksum: "",
  } as SaveEnvelope<unknown>;
  stored.checksum = computeEnvelopeChecksum(stored);
  return JSON.stringify(stored);
}
