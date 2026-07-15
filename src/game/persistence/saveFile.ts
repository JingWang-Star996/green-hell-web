import { checksum } from "./checksum";
import {
  createSaveEnvelope,
  parseSaveEnvelope,
  serializeSaveEnvelope,
  type EnvelopeFailureReason,
  type SaveEnvelope,
} from "./saveEnvelope";

export const SAVE_FILE_FORMAT = "canopy-save-file";
export const SAVE_FILE_VERSION = 1;
export const SAVE_FILE_PRODUCT = "canopy-first-night";
export const MAX_SAVE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SAVE_FILE_DEPTH = 64;
export const MAX_SAVE_FILE_NODES = 200_000;

export interface SaveFileProfile {
  retainedRecipeIds: string[];
}

interface SaveFileEnvelopeV1 {
  format: typeof SAVE_FILE_FORMAT;
  fileVersion: typeof SAVE_FILE_VERSION;
  product: typeof SAVE_FILE_PRODUCT;
  exportedAt: string;
  envelope: unknown;
  profile: SaveFileProfile;
  checksum: string;
}

export interface ParseSaveFileOptions<T> {
  schema: number;
  content: string | readonly string[];
  payloadValidator: (payload: unknown) => payload is T;
  checkpointValidator?: (envelope: SaveEnvelope<T>) => boolean;
}

export type SaveFileFailureReason =
  | "file-too-large"
  | "invalid-json"
  | "too-complex"
  | "invalid-file-shape"
  | "unsupported-file-version"
  | "file-checksum-mismatch"
  | "envelope-invalid"
  | "checkpoint-mismatch";

export type SaveFileParseResult<T> =
  | {
      ok: true;
      exportedAt: string;
      envelope: SaveEnvelope<T>;
      profile: SaveFileProfile;
    }
  | {
      ok: false;
      reason: SaveFileFailureReason;
      envelopeReason?: EnvelopeFailureReason;
      error?: unknown;
    };

const FILE_KEYS = [
  "format",
  "fileVersion",
  "product",
  "exportedAt",
  "envelope",
  "profile",
  "checksum",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function validProfile(value: unknown): value is SaveFileProfile {
  if (!isRecord(value) || !hasExactKeys(value, ["retainedRecipeIds"])) return false;
  const recipes = value.retainedRecipeIds;
  return (
    Array.isArray(recipes) &&
    recipes.length <= 256 &&
    recipes.every(
      (recipe) =>
        typeof recipe === "string" && recipe.length > 0 && recipe.length <= 128,
    )
  );
}

function withoutFileChecksum(
  file: SaveFileEnvelopeV1,
): Omit<SaveFileEnvelopeV1, "checksum"> {
  return {
    format: file.format,
    fileVersion: file.fileVersion,
    product: file.product,
    exportedAt: file.exportedAt,
    envelope: file.envelope,
    profile: file.profile,
  };
}

function validComplexity(value: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_SAVE_FILE_NODES || current.depth > MAX_SAVE_FILE_DEPTH) {
      return false;
    }
    if (!current.value || typeof current.value !== "object") continue;
    const values = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of values) {
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return true;
}

function validExportedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 64 &&
    Number.isFinite(Date.parse(value))
  );
}

/** Creates a portable, checksummed file without exposing the stable device id. */
export function createSaveFileText<T>(
  envelope: SaveEnvelope<T>,
  profile: SaveFileProfile,
  exportedAt = new Date().toISOString(),
): string {
  if (!validProfile(profile)) throw new TypeError("Invalid save file profile");
  if (!validExportedAt(exportedAt)) throw new TypeError("Invalid export timestamp");

  const portableEnvelope = createSaveEnvelope({
    schema: envelope.schema,
    content: envelope.content,
    ...(envelope.runEpoch === undefined ? {} : { runEpoch: envelope.runEpoch }),
    revision: envelope.revision,
    device: "portable-export",
    seed: envelope.seed,
    simTick: envelope.simTick,
    payload: envelope.payload,
  });
  const storedEnvelope = JSON.parse(serializeSaveEnvelope(portableEnvelope)) as unknown;
  const file: SaveFileEnvelopeV1 = {
    format: SAVE_FILE_FORMAT,
    fileVersion: SAVE_FILE_VERSION,
    product: SAVE_FILE_PRODUCT,
    exportedAt,
    envelope: storedEnvelope,
    profile: {
      retainedRecipeIds: [...new Set(profile.retainedRecipeIds)].sort(),
    },
    checksum: "",
  };
  file.checksum = checksum(withoutFileChecksum(file));
  const raw = JSON.stringify(file, null, 2);
  if (new TextEncoder().encode(raw).byteLength > MAX_SAVE_FILE_BYTES) {
    throw new RangeError("Save file exceeds the portable file limit");
  }
  return raw;
}

/**
 * Parses an untrusted save file. Checksums only detect corruption; every shape,
 * bound and gameplay invariant still has to pass validation.
 */
export function parseSaveFileText<T>(
  raw: string,
  options: ParseSaveFileOptions<T>,
): SaveFileParseResult<T> {
  if (new TextEncoder().encode(raw).byteLength > MAX_SAVE_FILE_BYTES) {
    return { ok: false, reason: "file-too-large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: "invalid-json", error };
  }
  if (!validComplexity(parsed)) return { ok: false, reason: "too-complex" };
  if (!isRecord(parsed) || !hasExactKeys(parsed, FILE_KEYS)) {
    return { ok: false, reason: "invalid-file-shape" };
  }
  if (
    parsed.format !== SAVE_FILE_FORMAT ||
    parsed.product !== SAVE_FILE_PRODUCT ||
    parsed.fileVersion !== SAVE_FILE_VERSION
  ) {
    return { ok: false, reason: "unsupported-file-version" };
  }
  if (
    !validExportedAt(parsed.exportedAt) ||
    !validProfile(parsed.profile) ||
    typeof parsed.checksum !== "string"
  ) {
    return { ok: false, reason: "invalid-file-shape" };
  }

  const file = parsed as unknown as SaveFileEnvelopeV1;
  try {
    if (checksum(withoutFileChecksum(file)) !== file.checksum) {
      return { ok: false, reason: "file-checksum-mismatch" };
    }
  } catch (error) {
    return { ok: false, reason: "invalid-file-shape", error };
  }

  let envelopeRaw: string;
  try {
    envelopeRaw = JSON.stringify(file.envelope);
  } catch (error) {
    return { ok: false, reason: "invalid-file-shape", error };
  }
  const envelope = parseSaveEnvelope<T>(envelopeRaw, {
    schema: options.schema,
    content: options.content,
    payloadValidator: options.payloadValidator,
  });
  if (!envelope.ok) {
    return {
      ok: false,
      reason: "envelope-invalid",
      envelopeReason: envelope.reason,
      error: envelope.error,
    };
  }
  try {
    if (options.checkpointValidator && !options.checkpointValidator(envelope.envelope)) {
      return { ok: false, reason: "checkpoint-mismatch" };
    }
  } catch (error) {
    return { ok: false, reason: "checkpoint-mismatch", error };
  }
  return {
    ok: true,
    exportedAt: file.exportedAt,
    envelope: envelope.envelope,
    profile: {
      retainedRecipeIds: [...new Set(file.profile.retainedRecipeIds)],
    },
  };
}

export function saveFileFailureLabel(result: Extract<SaveFileParseResult<unknown>, { ok: false }>): string {
  if (result.reason === "file-too-large") return "存档文件超过 5 MiB 上限";
  if (result.reason === "invalid-json") return "文件不是有效的 JSON 存档";
  if (result.reason === "too-complex") return "存档结构过深或内容数量异常";
  if (result.reason === "unsupported-file-version") return "存档来自不支持的游戏或文件版本";
  if (result.reason === "file-checksum-mismatch") return "文件完整性校验失败，内容可能已损坏";
  if (result.reason === "checkpoint-mismatch") return "存档进度标记与游戏内容不一致";
  if (result.reason === "envelope-invalid") {
    if (result.envelopeReason === "schema-mismatch") return "存档数据结构版本不兼容";
    if (result.envelopeReason === "content-mismatch") return "存档内容版本不兼容";
    if (result.envelopeReason === "checksum-mismatch") return "游戏存档校验失败，内容可能已损坏";
    return "游戏存档内容无效";
  }
  return "无法识别这个存档文件";
}
