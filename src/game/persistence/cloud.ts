import { gunzipSync, gzipSync } from "three/examples/jsm/libs/fflate.module.js";

import {
  TOY_CLOUD_MAX_ITEM_BYTES,
  TOY_CLOUD_MAX_KEYS,
  isValidToyCloudKey,
  type ToyBridgeClient,
} from "../platform/toyBridge";
import { checksum } from "./checksum";

export interface CloudKV {
  getItems(keys: readonly string[]): Promise<Readonly<Record<string, string>> | null>;
  setItems(items: Readonly<Record<string, string>>): Promise<boolean | void>;
  removeItems?(keys: readonly string[]): Promise<boolean | void>;
}

const CLOUD_CHUNK_PROTOCOL = "canopy-cloud-chunks";
const CLOUD_CHUNK_VERSION = 1;
const CLOUD_MAPPED_KEY_PREFIX = "canopy_k_";
const CLOUD_CHUNK_KEY_PREFIX = "canopy_c_";
export const TOY_CLOUD_MAX_DECODED_BYTES = 8 * 1024 * 1024;
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const CHECKSUM_PATTERN = /^fnv1a32:[0-9a-f]{8}$/;

type CloudChunkEncoding = "gzip-base64" | "utf8-base64";

interface CloudChunkManifest {
  protocol: typeof CLOUD_CHUNK_PROTOCOL;
  version: typeof CLOUD_CHUNK_VERSION;
  encoding: CloudChunkEncoding;
  chunks: number;
  bytes: number;
  checksum: string;
}

type ManifestParseResult =
  | { kind: "legacy" }
  | { kind: "invalid" }
  | { kind: "manifest"; value: CloudChunkManifest };

export interface ToyBridgeCloudKVOptions {
  /** Test/debug escape hatch. Production prefers gzip and falls back safely. */
  compression?: "auto" | "identity";
  /** Hard ceiling applied before and during decompression of untrusted cloud data. */
  maxDecodedBytes?: number;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function physicalValueBudget(key: string): number {
  return Math.max(0, TOY_CLOUD_MAX_ITEM_BYTES - byteLength(key));
}

function physicalItemFits(key: string, value: string): boolean {
  return byteLength(value) <= physicalValueBudget(key);
}

function isLogicalKey(key: string): boolean {
  return key.length > 0;
}

function logicalKeyFingerprint(logicalKey: string): string {
  const bytes = new TextEncoder().encode(logicalKey);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const byte of bytes) {
    first ^= byte;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= byte;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, "0")}${second
    .toString(16)
    .padStart(8, "0")}`;
}

function manifestKey(logicalKey: string): string {
  return isValidToyCloudKey(logicalKey)
    ? logicalKey
    : `${CLOUD_MAPPED_KEY_PREFIX}${logicalKeyFingerprint(logicalKey)}`;
}

function chunkPrefix(logicalKey: string): string {
  return `${CLOUD_CHUNK_KEY_PREFIX}${logicalKeyFingerprint(logicalKey)}_`;
}

function chunkKey(logicalKey: string, index: number): string {
  return `${chunkPrefix(logicalKey)}${index.toString(36).padStart(3, "0")}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const value = (first << 16) | (second << 8) | third;
    result += BASE64_ALPHABET[(value >>> 18) & 63];
    result += BASE64_ALPHABET[(value >>> 12) & 63];
    result += index + 1 < bytes.length ? BASE64_ALPHABET[(value >>> 6) & 63] : "=";
    result += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : "=";
  }
  return result;
}

function base64ToBytes(value: string): Uint8Array | null {
  if (value.length % 4 !== 0 || !BASE64_PATTERN.test(value)) return null;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let offset = 0;

  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index]);
    const second = BASE64_ALPHABET.indexOf(value[index + 1]);
    const third = value[index + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]);
    const fourth = value[index + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) return null;
    const packed = (first << 18) | (second << 12) | (third << 6) | fourth;
    if (offset < bytes.length) bytes[offset++] = (packed >>> 16) & 255;
    if (offset < bytes.length) bytes[offset++] = (packed >>> 8) & 255;
    if (offset < bytes.length) bytes[offset++] = packed & 255;
  }
  return bytes;
}

function streamSource(bytes: Uint8Array): Blob {
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Blob([copy]);
}

async function nativeGzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof globalThis.CompressionStream !== "function") return null;
  try {
    const stream = streamSource(bytes)
      .stream()
      .pipeThrough(new globalThis.CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function nativeGunzip(
  bytes: Uint8Array,
  expectedBytes: number,
  maxDecodedBytes: number,
): Promise<Uint8Array | null> {
  try {
    const stream = streamSource(bytes)
      .stream()
      .pipeThrough(new globalThis.DecompressionStream("gzip"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      total += chunk.byteLength;
      if (total > expectedBytes || total > maxDecodedBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk);
    }
    if (total !== expectedBytes) return null;
    const decoded = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      decoded.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decoded;
  } catch {
    return null;
  }
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  const native = await nativeGzip(bytes);
  if (native) return native;
  try {
    return gzipSync(bytes, { level: 6 });
  } catch {
    return null;
  }
}

async function gunzip(
  bytes: Uint8Array,
  expectedBytes: number,
  maxDecodedBytes: number,
): Promise<Uint8Array | null> {
  if (typeof globalThis.DecompressionStream === "function") {
    return nativeGunzip(bytes, expectedBytes, maxDecodedBytes);
  }
  try {
    return gunzipSync(bytes, { out: new Uint8Array(expectedBytes) });
  } catch {
    return null;
  }
}

function parseManifest(raw: string, maxDecodedBytes: number): ManifestParseResult {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return raw.includes(`"protocol":"${CLOUD_CHUNK_PROTOCOL}"`)
      ? { kind: "invalid" }
      : { kind: "legacy" };
  }

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate) ||
    !("protocol" in candidate)
  ) {
    return { kind: "legacy" };
  }
  const record = candidate as Record<string, unknown>;
  if (record.protocol !== CLOUD_CHUNK_PROTOCOL) return { kind: "legacy" };
  if (
    record.version !== CLOUD_CHUNK_VERSION ||
    (record.encoding !== "gzip-base64" && record.encoding !== "utf8-base64") ||
    !Number.isInteger(record.chunks) ||
    (record.chunks as number) < 0 ||
    (record.chunks as number) >= TOY_CLOUD_MAX_KEYS ||
    !Number.isInteger(record.bytes) ||
    (record.bytes as number) < 0 ||
    (record.bytes as number) > maxDecodedBytes ||
    typeof record.checksum !== "string" ||
    !CHECKSUM_PATTERN.test(record.checksum)
  ) {
    return { kind: "invalid" };
  }

  return {
    kind: "manifest",
    value: {
      protocol: CLOUD_CHUNK_PROTOCOL,
      version: CLOUD_CHUNK_VERSION,
      encoding: record.encoding,
      chunks: record.chunks as number,
      bytes: record.bytes as number,
      checksum: record.checksum,
    },
  };
}

async function encodeCloudValue(
  logicalKey: string,
  value: string,
  compression: "auto" | "identity",
  maxDecodedBytes: number,
): Promise<{ manifest: string; chunks: string[] } | null> {
  const source = new TextEncoder().encode(value);
  if (source.byteLength > maxDecodedBytes) return null;
  let encoding: CloudChunkEncoding = "utf8-base64";
  let encodedBytes: Uint8Array = source;

  if (compression === "auto") {
    const compressed = await gzip(source);
    if (compressed) {
      encoding = "gzip-base64";
      encodedBytes = compressed;
    }
  }

  const base64 = bytesToBase64(encodedBytes);
  const chunks: string[] = [];
  let offset = 0;
  while (offset < base64.length) {
    // One manifest plus at most 127 chunks must fit Toy's 128-key ceiling.
    if (chunks.length >= TOY_CLOUD_MAX_KEYS - 1) return null;
    const physicalKey = chunkKey(logicalKey, chunks.length);
    const budget = physicalValueBudget(physicalKey);
    if (budget <= 0) return null;
    chunks.push(base64.slice(offset, offset + budget));
    offset += budget;
  }
  const manifest: CloudChunkManifest = {
    protocol: CLOUD_CHUNK_PROTOCOL,
    version: CLOUD_CHUNK_VERSION,
    encoding,
    chunks: chunks.length,
    bytes: source.byteLength,
    checksum: checksum(value),
  };
  return { manifest: JSON.stringify(manifest), chunks };
}

async function decodeCloudValue(
  manifest: CloudChunkManifest,
  encoded: string,
  maxDecodedBytes: number,
): Promise<string | null> {
  const packed = base64ToBytes(encoded);
  if (!packed) return null;
  if (manifest.bytes > maxDecodedBytes) return null;
  if (manifest.encoding === "gzip-base64") {
    if (packed.byteLength < 4) return null;
    const tail = packed.byteLength - 4;
    const gzipBytes =
      (packed[tail] ?? 0) |
      ((packed[tail + 1] ?? 0) << 8) |
      ((packed[tail + 2] ?? 0) << 16) |
      ((packed[tail + 3] ?? 0) << 24);
    if ((gzipBytes >>> 0) !== manifest.bytes) return null;
  }
  const decoded = manifest.encoding === "gzip-base64"
    ? await gunzip(packed, manifest.bytes, maxDecodedBytes)
    : packed;
  if (!decoded || decoded.byteLength !== manifest.bytes) return null;

  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    return checksum(value) === manifest.checksum ? value : null;
  } catch {
    return null;
  }
}

/**
 * Adapts Toy's small per-key cloud store to logical string values. Values are
 * compressed and split behind a versioned manifest while callers keep using
 * the original logical key.
 */
export class ToyBridgeCloudKV implements CloudKV {
  private readonly compression: "auto" | "identity";
  private readonly maxDecodedBytes: number;

  constructor(
    private readonly client: ToyBridgeClient,
    options: ToyBridgeCloudKVOptions = {},
  ) {
    this.compression = options.compression ?? "auto";
    this.maxDecodedBytes =
      Number.isSafeInteger(options.maxDecodedBytes) &&
      (options.maxDecodedBytes ?? 0) > 0
        ? options.maxDecodedBytes!
        : TOY_CLOUD_MAX_DECODED_BYTES;
  }

  async getItems(
    keys: readonly string[],
  ): Promise<Readonly<Record<string, string>> | null> {
    const logicalKeys = [...new Set(keys)];
    if (
      logicalKeys.length > TOY_CLOUD_MAX_KEYS ||
      logicalKeys.some((key) => typeof key !== "string" || !isLogicalKey(key))
    ) {
      return null;
    }

    const physicalManifestKeys = logicalKeys.map(manifestKey);
    if (new Set(physicalManifestKeys).size !== physicalManifestKeys.length) return null;
    const manifestResult = await this.client.getCloudStorage(physicalManifestKeys);
    if (!manifestResult.ok) return null;

    const output: Record<string, string> = {};
    const manifests = new Map<string, CloudChunkManifest>();
    for (const key of logicalKeys) {
      const raw = manifestResult.value[manifestKey(key)];
      if (typeof raw !== "string" || raw.length === 0) continue;
      const parsed = parseManifest(raw, this.maxDecodedBytes);
      if (parsed.kind === "invalid") continue;
      if (parsed.kind === "legacy") {
        output[key] = raw;
        continue;
      }
      manifests.set(key, parsed.value);
    }

    for (const [key, manifest] of manifests) {
      const physicalChunkKeys = Array.from(
        { length: manifest.chunks },
        (_, index) => chunkKey(key, index),
      );
      if (
        physicalChunkKeys.length > TOY_CLOUD_MAX_KEYS ||
        new Set(physicalChunkKeys).size !== physicalChunkKeys.length
      ) {
        continue;
      }
      if (physicalChunkKeys.length === 0) {
        const value = await decodeCloudValue(
          manifest,
          "",
          this.maxDecodedBytes,
        );
        if (value !== null) output[key] = value;
        continue;
      }

      const chunkResult = await this.client.getCloudStorage(physicalChunkKeys);
      if (!chunkResult.ok) return null;
      let encoded = "";
      let valid = true;
      for (let index = 0; index < manifest.chunks; index += 1) {
        const physicalKey = chunkKey(key, index);
        const chunk = chunkResult.value[physicalKey];
        if (
          typeof chunk !== "string" ||
          chunk.length === 0 ||
          !physicalItemFits(physicalKey, chunk)
        ) {
          valid = false;
          break;
        }
        encoded += chunk;
      }
      if (!valid) continue;
      const value = await decodeCloudValue(
        manifest,
        encoded,
        this.maxDecodedBytes,
      );
      if (value !== null) output[key] = value;
    }
    return output;
  }

  async setItems(items: Readonly<Record<string, string>>): Promise<boolean> {
    const entries = Object.entries(items);
    if (
      entries.length === 0 ||
      entries.length > TOY_CLOUD_MAX_KEYS ||
      entries.some(([key, value]) => !isLogicalKey(key) || typeof value !== "string")
    ) {
      return false;
    }

    const writes: Record<string, string> = {};
    for (const [logicalKey, value] of entries) {
      const encoded = await encodeCloudValue(
        logicalKey,
        value,
        this.compression,
        this.maxDecodedBytes,
      );
      if (!encoded) return false;
      const physicalManifestKey = manifestKey(logicalKey);
      if (physicalManifestKey in writes) return false;
      writes[physicalManifestKey] = encoded.manifest;
      for (let index = 0; index < encoded.chunks.length; index += 1) {
        const physicalChunkKey = chunkKey(logicalKey, index);
        if (physicalChunkKey in writes) return false;
        writes[physicalChunkKey] = encoded.chunks[index];
      }
    }
    const writeEntries = Object.entries(writes);
    if (
      writeEntries.length > TOY_CLOUD_MAX_KEYS ||
      writeEntries.some(
        ([key, value]) => !isValidToyCloudKey(key) || !physicalItemFits(key, value),
      )
    ) {
      return false;
    }

    const inventoryResult = await this.client.getCloudStorage([]);
    if (!inventoryResult.ok) return false;
    const projectedKeys = new Set(Object.keys(inventoryResult.value));
    for (const key of Object.keys(writes)) projectedKeys.add(key);
    if (projectedKeys.size > TOY_CLOUD_MAX_KEYS) return false;

    // One SDK call publishes every new manifest and chunk as a single batch.
    const writeResult = await this.client.setCloudStorage(writes);
    if (!writeResult.ok) return false;

    const staleKeys: string[] = [];
    for (const [logicalKey] of entries) {
      const prefix = chunkPrefix(logicalKey);
      for (const existingKey of Object.keys(inventoryResult.value)) {
        if (existingKey.startsWith(prefix) && !(existingKey in writes)) {
          staleKeys.push(existingKey);
        }
      }
    }
    return await this.removePhysicalItems(staleKeys);
  }

  async removeItems(keys: readonly string[]): Promise<boolean> {
    const logicalKeys = [...new Set(keys)];
    if (
      logicalKeys.length > TOY_CLOUD_MAX_KEYS ||
      logicalKeys.some((key) => typeof key !== "string" || !isLogicalKey(key))
    ) {
      return false;
    }
    if (logicalKeys.length === 0) return true;

    const inventoryResult = await this.client.getCloudStorage([]);
    if (!inventoryResult.ok) return false;
    const physicalKeys = new Set<string>();
    for (const logicalKey of logicalKeys) {
      const physicalManifestKey = manifestKey(logicalKey);
      if (physicalManifestKey in inventoryResult.value) {
        physicalKeys.add(physicalManifestKey);
      }
      const prefix = chunkPrefix(logicalKey);
      for (const existingKey of Object.keys(inventoryResult.value)) {
        if (existingKey.startsWith(prefix)) physicalKeys.add(existingKey);
      }
    }
    return await this.removePhysicalItems([...physicalKeys]);
  }

  private async removePhysicalItems(keys: readonly string[]): Promise<boolean> {
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length === 0) return true;
    if (uniqueKeys.length > TOY_CLOUD_MAX_KEYS) return false;

    const removal = await this.client.removeCloudStorage(uniqueKeys);
    if (removal.ok) return true;
    if (removal.reason !== "unsupported") return false;

    // Older Toy hosts have no delete primitive. Empty values are safe semantic
    // tombstones; adapters ignore them and never mistake them for a save.
    const tombstones: Record<string, string> = {};
    for (const key of uniqueKeys) tombstones[key] = "";
    const fallback = await this.client.setCloudStorage(tombstones);
    return fallback.ok;
  }
}
