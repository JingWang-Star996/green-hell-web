import { checksum } from "./checksum";
import type { KVStorageDurability, KVStore } from "./kv";
import {
  createSaveEnvelope,
  parseSaveEnvelope,
  serializeSaveEnvelope,
  type SaveEnvelope,
  type SaveSeed,
} from "./saveEnvelope";

export const CHECKPOINT_RECORD_FORMAT = "canopy-checkpoint-record";
export const CHECKPOINT_MANIFEST_FORMAT = "canopy-checkpoint-manifest";
export const CHECKPOINT_TIMELINE_VERSION = 1;
export const CHECKPOINT_CLOUD_BUNDLE_FORMAT = "canopy-checkpoint-cloud-bundle";
export const CHECKPOINT_CLOUD_BUNDLE_VERSION = 1;
/** Bounds untrusted decompressed cloud input before JSON traversal. */
export const CHECKPOINT_CLOUD_BUNDLE_MAX_CHARACTERS = 8 * 1024 * 1024;
export const MANUAL_CHECKPOINT_SLOTS = [
  "manual-1",
  "manual-2",
  "manual-3",
] as const;
export const AUTO_CHECKPOINT_SLOTS = [
  "auto-1",
  "auto-2",
  "auto-3",
  "auto-4",
  "auto-5",
  "auto-6",
  "auto-7",
  "auto-8",
  "auto-9",
  "auto-10",
] as const;
export const PREIMPORT_CHECKPOINT_SLOT = "preimport" as const;

export type ManualCheckpointSlotId = (typeof MANUAL_CHECKPOINT_SLOTS)[number];
export type AutoCheckpointSlotId = (typeof AUTO_CHECKPOINT_SLOTS)[number];
export type CheckpointSlotId =
  | ManualCheckpointSlotId
  | AutoCheckpointSlotId
  | typeof PREIMPORT_CHECKPOINT_SLOT;
export type CheckpointKind = "manual" | "auto" | "preimport";
export type CheckpointReason =
  | "manual"
  | "rest-before"
  | "rest-after"
  | "task"
  | "milestone"
  | "periodic"
  | "hidden"
  | "page-exit"
  | "new-game"
  | "preimport";
export type CheckpointSafety = "safe" | "caution" | "unsafe";
export type CheckpointStatusSeverity = "observe" | "warning" | "critical";
export type CheckpointCloudDurability = "synced" | "pending" | "local-only";

export interface CheckpointStatusSummary {
  label: string;
  severity: CheckpointStatusSeverity;
}

export interface CheckpointMetadataDraft {
  reason: CheckpointReason;
  createdAt: number;
  gameDay: number;
  minuteOfDay: number;
  elapsedSeconds: number;
  objectiveLabel: string;
  position: { x: number; z: number };
  biomeLabel: string;
  health: number;
  majorStatuses: CheckpointStatusSummary[];
  storm: boolean;
  combat: boolean;
  danger: boolean;
  safety: CheckpointSafety;
}

export interface CheckpointMetadata extends CheckpointMetadataDraft {
  slotId: CheckpointSlotId;
  kind: CheckpointKind;
  sequence: number;
  localDurability: "persistent" | "session";
  /** `not-synced` is accepted only when reading pre-bundle development saves. */
  cloudDurability: CheckpointCloudDurability | "not-synced";
}

export type CheckpointTimelineEntry = Omit<
  CheckpointMetadata,
  "cloudDurability"
> & {
  cloudDurability: CheckpointCloudDurability;
  recordChecksum: string;
  validation: "verified";
  recoveredFromBackup: boolean;
};

export interface CheckpointTimelineIssue {
  code:
    | "storage-read-failed"
    | "storage-write-failed"
    | "storage-remove-failed"
    | "record-invalid"
    | "manifest-invalid"
    | "write-verification-failed";
  slotId?: CheckpointSlotId;
  key?: string;
  error?: unknown;
}

export interface CheckpointTimelineListResult {
  entries: CheckpointTimelineEntry[];
  recommendedSlotId: CheckpointSlotId | null;
  issues: CheckpointTimelineIssue[];
}

export interface CheckpointTimelineClearResult {
  ok: boolean;
  issues: CheckpointTimelineIssue[];
}

export type CheckpointWriteResult =
  | { ok: true; entry: CheckpointTimelineEntry; issues: CheckpointTimelineIssue[] }
  | {
      ok: false;
      reason: "invalid-checkpoint" | "storage-error";
      issues: CheckpointTimelineIssue[];
      error?: unknown;
    };

export type CheckpointLoadResult<T> =
  | {
      ok: true;
      entry: CheckpointTimelineEntry;
      envelope: SaveEnvelope<T>;
      issues: CheckpointTimelineIssue[];
    }
  | {
      ok: false;
      reason: "not-found" | "unavailable";
      issues: CheckpointTimelineIssue[];
    };

interface StoredCheckpointRecord {
  format: typeof CHECKPOINT_RECORD_FORMAT;
  version: typeof CHECKPOINT_TIMELINE_VERSION;
  metadata: CheckpointMetadata;
  envelope: unknown;
  checksum: string;
}

interface CheckpointManifestEntry {
  slotId: CheckpointSlotId;
  sequence: number;
  recordChecksum: string;
}

interface CheckpointManifest {
  format: typeof CHECKPOINT_MANIFEST_FORMAT;
  version: typeof CHECKPOINT_TIMELINE_VERSION;
  sequence: number;
  autoCursor: number;
  entries: CheckpointManifestEntry[];
  checksum: string;
}

export type CloudCheckpointSlotId =
  | ManualCheckpointSlotId
  | AutoCheckpointSlotId;

interface CheckpointCloudBundleEntry {
  slotId: CloudCheckpointSlotId;
  recordChecksum: string;
  raw: string;
}

interface CheckpointCloudBundle {
  format: typeof CHECKPOINT_CLOUD_BUNDLE_FORMAT;
  version: typeof CHECKPOINT_CLOUD_BUNDLE_VERSION;
  runEpoch: number;
  sequence: number;
  entries: CheckpointCloudBundleEntry[];
  checksum: string;
}

export interface CheckpointCloudBundleSnapshot {
  raw: string;
  runEpoch: number;
  slotChecksums: Partial<Record<CloudCheckpointSlotId, string>>;
}

export type CheckpointCloudBundleResult =
  | {
      ok: true;
      snapshot: CheckpointCloudBundleSnapshot;
      issues: CheckpointTimelineIssue[];
    }
  | {
      ok: false;
      reason: "invalid-bundle" | "newer-remote-run" | "storage-error";
      issues: CheckpointTimelineIssue[];
    };

export type CheckpointCloudImportResult =
  | {
      ok: true;
      status: "merged" | "ignored-run";
      adoptedSlotIds: CloudCheckpointSlotId[];
      slotChecksums: Partial<Record<CloudCheckpointSlotId, string>>;
      issues: CheckpointTimelineIssue[];
    }
  | {
      ok: false;
      reason: "invalid-bundle" | "storage-error";
      issues: CheckpointTimelineIssue[];
    };

interface ParsedRecord<T> {
  raw: string;
  metadata: CheckpointMetadata;
  envelope: SaveEnvelope<T>;
  recordChecksum: string;
  recoveredFromBackup: boolean;
}

interface ReconciledTimeline<T> {
  manifest: CheckpointManifest;
  records: ParsedRecord<T>[];
}

interface ParsedCloudBundle<T> {
  bundle: CheckpointCloudBundle;
  records: ParsedRecord<T>[];
}

export interface CheckpointTimelineOptions<T> {
  key: string;
  schema: number;
  content: string;
  acceptedContent?: readonly string[];
  device: string;
  kv: KVStore;
  localDurability: KVStorageDurability;
  payloadValidator?: (payload: unknown) => payload is T;
}

const ALL_CHECKPOINT_SLOTS: readonly CheckpointSlotId[] = [
  ...MANUAL_CHECKPOINT_SLOTS,
  ...AUTO_CHECKPOINT_SLOTS,
  PREIMPORT_CHECKPOINT_SLOT,
];
const CLOUD_CHECKPOINT_SLOTS: readonly CloudCheckpointSlotId[] = [
  ...MANUAL_CHECKPOINT_SLOTS,
  ...AUTO_CHECKPOINT_SLOTS,
];
const RECORD_KEYS = ["format", "version", "metadata", "envelope", "checksum"] as const;
const MANIFEST_KEYS = ["format", "version", "sequence", "autoCursor", "entries", "checksum"] as const;
const CLOUD_BUNDLE_KEYS = [
  "format",
  "version",
  "runEpoch",
  "sequence",
  "entries",
  "checksum",
] as const;
const CLOUD_BUNDLE_ENTRY_KEYS = ["slotId", "recordChecksum", "raw"] as const;
const METADATA_KEYS = [
  "slotId",
  "kind",
  "reason",
  "sequence",
  "createdAt",
  "gameDay",
  "minuteOfDay",
  "elapsedSeconds",
  "objectiveLabel",
  "position",
  "biomeLabel",
  "health",
  "majorStatuses",
  "storm",
  "combat",
  "danger",
  "safety",
  "localDurability",
  "cloudDurability",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function safeInteger(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isCheckpointSlotId(value: unknown): value is CheckpointSlotId {
  return typeof value === "string" && ALL_CHECKPOINT_SLOTS.includes(value as CheckpointSlotId);
}

function isCloudCheckpointSlotId(value: unknown): value is CloudCheckpointSlotId {
  return typeof value === "string" &&
    CLOUD_CHECKPOINT_SLOTS.includes(value as CloudCheckpointSlotId);
}

function kindForSlot(slotId: CheckpointSlotId): CheckpointKind {
  if (slotId === PREIMPORT_CHECKPOINT_SLOT) return "preimport";
  return slotId.startsWith("manual-") ? "manual" : "auto";
}

function validStatusSummary(value: unknown): value is CheckpointStatusSummary {
  return isRecord(value) &&
    hasExactKeys(value, ["label", "severity"]) &&
    boundedString(value.label, 80) &&
    ["observe", "warning", "critical"].includes(String(value.severity));
}

function validMetadata(value: unknown): value is CheckpointMetadata {
  if (!isRecord(value) || !hasExactKeys(value, METADATA_KEYS)) return false;
  if (!isCheckpointSlotId(value.slotId) || value.kind !== kindForSlot(value.slotId)) return false;
  if (![
    "manual",
    "rest-before",
    "rest-after",
    "task",
    "milestone",
    "periodic",
    "hidden",
    "page-exit",
    "new-game",
    "preimport",
  ].includes(String(value.reason))) return false;
  if (
    !safeInteger(value.sequence, 1) ||
    !safeInteger(value.createdAt, 1) ||
    !safeInteger(value.gameDay, 1) ||
    !finiteNumber(value.minuteOfDay) ||
    value.minuteOfDay < 0 ||
    value.minuteOfDay >= 1440 ||
    !finiteNumber(value.elapsedSeconds) ||
    value.elapsedSeconds < 0 ||
    !boundedString(value.objectiveLabel, 160) ||
    !boundedString(value.biomeLabel, 80) ||
    !finiteNumber(value.health) ||
    value.health < 0 ||
    value.health > 100 ||
    !Array.isArray(value.majorStatuses) ||
    value.majorStatuses.length > 2 ||
    !value.majorStatuses.every(validStatusSummary) ||
    typeof value.storm !== "boolean" ||
    typeof value.combat !== "boolean" ||
    typeof value.danger !== "boolean" ||
    !["safe", "caution", "unsafe"].includes(String(value.safety)) ||
    !["persistent", "session"].includes(String(value.localDurability)) ||
    !["synced", "pending", "local-only", "not-synced"].includes(
      String(value.cloudDurability),
    )
  ) {
    return false;
  }
  return isRecord(value.position) &&
    hasExactKeys(value.position, ["x", "z"]) &&
    finiteNumber(value.position.x) &&
    finiteNumber(value.position.z);
}

function validDraft(value: CheckpointMetadataDraft): boolean {
  const probe: CheckpointMetadata = {
    ...value,
    slotId: "auto-1",
    kind: "auto",
    sequence: 1,
    localDurability: "persistent",
    cloudDurability: "local-only",
  };
  return validMetadata(probe);
}

function withoutRecordChecksum(record: StoredCheckpointRecord) {
  return {
    format: record.format,
    version: record.version,
    metadata: record.metadata,
    envelope: record.envelope,
  };
}

function withoutManifestChecksum(manifest: CheckpointManifest) {
  return {
    format: manifest.format,
    version: manifest.version,
    sequence: manifest.sequence,
    autoCursor: manifest.autoCursor,
    entries: manifest.entries,
  };
}

function withoutCloudBundleChecksum(bundle: CheckpointCloudBundle) {
  return {
    format: bundle.format,
    version: bundle.version,
    runEpoch: bundle.runEpoch,
    sequence: bundle.sequence,
    entries: bundle.entries,
  };
}

function validManifestEntry(value: unknown): value is CheckpointManifestEntry {
  return isRecord(value) &&
    hasExactKeys(value, ["slotId", "sequence", "recordChecksum"]) &&
    isCheckpointSlotId(value.slotId) &&
    safeInteger(value.sequence, 1) &&
    boundedString(value.recordChecksum, 80);
}

function manifestEntryFor<T>(record: ParsedRecord<T>): CheckpointManifestEntry {
  return {
    slotId: record.metadata.slotId,
    sequence: record.metadata.sequence,
    recordChecksum: record.recordChecksum,
  };
}

function sortManifestEntries(entries: CheckpointManifestEntry[]): CheckpointManifestEntry[] {
  return [...entries].sort(
    (left, right) => ALL_CHECKPOINT_SLOTS.indexOf(left.slotId) - ALL_CHECKPOINT_SLOTS.indexOf(right.slotId),
  );
}

export class CheckpointTimeline<T> {
  readonly manifestKey: string;
  readonly manifestTempKey: string;
  readonly manifestCorruptKey: string;

  private readonly key: string;
  private readonly schema: number;
  private readonly content: string;
  private readonly acceptedContent: readonly string[];
  private readonly device: string;
  private readonly kv: KVStore;
  private readonly localDurability: KVStorageDurability;
  private readonly payloadValidator?: (payload: unknown) => payload is T;

  constructor(options: CheckpointTimelineOptions<T>) {
    this.key = options.key;
    this.schema = options.schema;
    this.content = options.content;
    this.acceptedContent = [...new Set([options.content, ...(options.acceptedContent ?? [])])];
    this.device = options.device;
    this.kv = options.kv;
    this.localDurability = options.localDurability;
    this.payloadValidator = options.payloadValidator;
    this.manifestKey = `${this.key}.timeline.manifest`;
    this.manifestTempKey = `${this.manifestKey}.tmp`;
    this.manifestCorruptKey = `${this.manifestKey}.corrupt`;
  }

  getSlotKey(slotId: CheckpointSlotId): string {
    return `${this.key}.timeline.${slotId}`;
  }

  getSlotBackupKey(slotId: CheckpointSlotId): string {
    return `${this.getSlotKey(slotId)}.backup`;
  }

  getSlotTempKey(slotId: CheckpointSlotId): string {
    return `${this.getSlotKey(slotId)}.tmp`;
  }

  getSlotCorruptKey(slotId: CheckpointSlotId): string {
    return `${this.getSlotKey(slotId)}.corrupt`;
  }

  list(): CheckpointTimelineListResult {
    const issues: CheckpointTimelineIssue[] = [];
    const timeline = this.reconcile(issues);
    const entries = timeline.records
      .map((record) => this.toEntry(record))
      .sort((left, right) => right.sequence - left.sequence || right.createdAt - left.createdAt);
    const recommended = entries.find((entry) => entry.safety === "safe") ??
      entries.find((entry) => entry.safety === "caution") ??
      null;
    return {
      entries,
      recommendedSlotId: recommended?.slotId ?? null,
      issues,
    };
  }

  load(slotId: CheckpointSlotId): CheckpointLoadResult<T> {
    const issues: CheckpointTimelineIssue[] = [];
    if (!isCheckpointSlotId(slotId)) return { ok: false, reason: "not-found", issues };
    const record = this.readSlot(slotId, issues, true);
    if (!record) {
      return {
        ok: false,
        reason: issues.some((issue) => issue.code === "storage-read-failed")
          ? "unavailable"
          : "not-found",
        issues,
      };
    }
    return {
      ok: true,
      entry: this.toEntry(record),
      envelope: record.envelope,
      issues,
    };
  }

  /**
   * Builds one bounded, checksummed logical value for every current-run manual
   * and automatic checkpoint. The pre-import rollback is deliberately local.
   */
  createCloudBundle(runEpoch: number): CheckpointCloudBundleResult {
    const issues: CheckpointTimelineIssue[] = [];
    if (!safeInteger(runEpoch)) {
      return { ok: false, reason: "invalid-bundle", issues };
    }
    const timeline = this.reconcile(issues);
    if (this.hasStorageFailure(issues)) {
      return { ok: false, reason: "storage-error", issues };
    }
    const records = timeline.records.filter((record) =>
      isCloudCheckpointSlotId(record.metadata.slotId) &&
      this.recordRunEpoch(record) === runEpoch,
    );
    const snapshot = this.createCloudBundleSnapshot(
      runEpoch,
      Math.max(
        timeline.manifest.sequence,
        ...records.map((record) => record.metadata.sequence),
        0,
      ),
      records,
    );
    return snapshot
      ? { ok: true, snapshot, issues }
      : { ok: false, reason: "storage-error", issues };
  }

  /**
   * Reconciles an outgoing local bundle with the last cloud value. A cloud
   * record is retained on ties or ambiguous same-progress forks so a client
   * never silently destroys another device's recovery point.
   */
  combineCloudBundles(
    outgoingRaw: string,
    remoteRaw: string | null,
  ): CheckpointCloudBundleResult {
    const issues: CheckpointTimelineIssue[] = [];
    const outgoing = this.parseCloudBundle(outgoingRaw);
    if (!outgoing) return { ok: false, reason: "invalid-bundle", issues };
    if (remoteRaw === null) {
      return {
        ok: true,
        snapshot: this.snapshotFromParsedCloudBundle(outgoing),
        issues,
      };
    }
    const remote = this.parseCloudBundle(remoteRaw);
    if (!remote) return { ok: false, reason: "invalid-bundle", issues };
    if (remote.bundle.runEpoch > outgoing.bundle.runEpoch) {
      return { ok: false, reason: "newer-remote-run", issues };
    }
    if (remote.bundle.runEpoch < outgoing.bundle.runEpoch) {
      return {
        ok: true,
        snapshot: this.snapshotFromParsedCloudBundle(outgoing),
        issues,
      };
    }

    const outgoingBySlot = new Map(
      outgoing.records.map((record) => [record.metadata.slotId, record]),
    );
    const remoteBySlot = new Map(
      remote.records.map((record) => [record.metadata.slotId, record]),
    );
    const merged: ParsedRecord<T>[] = [];
    for (const slotId of CLOUD_CHECKPOINT_SLOTS) {
      const localRecord = outgoingBySlot.get(slotId);
      const remoteRecord = remoteBySlot.get(slotId);
      if (!localRecord && !remoteRecord) continue;
      if (!localRecord) {
        merged.push(remoteRecord!);
        continue;
      }
      if (!remoteRecord) {
        merged.push(localRecord);
        continue;
      }
      // Only a clearly newer outgoing record may replace a cloud record.
      merged.push(
        this.compareRecordProgress(localRecord, remoteRecord) > 0
          ? localRecord
          : remoteRecord,
      );
    }
    const snapshot = this.createCloudBundleSnapshot(
      outgoing.bundle.runEpoch,
      Math.max(outgoing.bundle.sequence, remote.bundle.sequence),
      merged,
    );
    return snapshot
      ? { ok: true, snapshot, issues }
      : { ok: false, reason: "storage-error", issues };
  }

  /**
   * Imports only verified records from the authoritative active run. Corrupt
   * or cross-run cloud input is isolated and never removes a local checkpoint.
   */
  importCloudBundle(
    raw: string,
    expectedRunEpoch: number,
  ): CheckpointCloudImportResult {
    const issues: CheckpointTimelineIssue[] = [];
    if (!safeInteger(expectedRunEpoch)) {
      return { ok: false, reason: "invalid-bundle", issues };
    }
    const parsed = this.parseCloudBundle(raw);
    if (!parsed) return { ok: false, reason: "invalid-bundle", issues };
    const slotChecksums = this.slotChecksumsFor(parsed.records);
    if (parsed.bundle.runEpoch !== expectedRunEpoch) {
      return {
        ok: true,
        status: "ignored-run",
        adoptedSlotIds: [],
        slotChecksums,
        issues,
      };
    }

    const timeline = this.reconcile(issues);
    if (this.hasStorageFailure(issues)) {
      return { ok: false, reason: "storage-error", issues };
    }
    const localBySlot = new Map(
      timeline.records.map((record) => [record.metadata.slotId, record]),
    );
    const adoptedSlotIds: CloudCheckpointSlotId[] = [];
    for (const remoteRecord of parsed.records) {
      const slotId = remoteRecord.metadata.slotId as CloudCheckpointSlotId;
      const localRecord = localBySlot.get(slotId);
      if (localRecord && this.compareRecordProgress(remoteRecord, localRecord) <= 0) {
        continue;
      }
      if (!this.adoptCloudRecord(remoteRecord, issues)) {
        return { ok: false, reason: "storage-error", issues };
      }
      adoptedSlotIds.push(slotId);
      localBySlot.set(slotId, remoteRecord);
    }
    // Rebuild the manifest from verified targets after all per-slot promotions.
    this.reconcile(issues);
    if (this.hasStorageFailure(issues)) {
      return { ok: false, reason: "storage-error", issues };
    }
    return {
      ok: true,
      status: "merged",
      adoptedSlotIds,
      slotChecksums,
      issues,
    };
  }

  /** Erases every fixed timeline artifact so a new expedition cannot see an old run. */
  clearAll(): CheckpointTimelineClearResult {
    const issues: CheckpointTimelineIssue[] = [];
    let ok = true;
    const manifestKeys = [
      this.manifestKey,
      this.manifestTempKey,
      this.manifestCorruptKey,
    ];
    for (const key of manifestKeys) {
      if (!this.safeRemove(key, issues)) ok = false;
    }
    for (const slotId of ALL_CHECKPOINT_SLOTS) {
      for (const key of [
        this.getSlotKey(slotId),
        this.getSlotBackupKey(slotId),
        this.getSlotTempKey(slotId),
        this.getSlotCorruptKey(slotId),
      ]) {
        if (!this.safeRemove(key, issues, slotId)) ok = false;
      }
    }
    return { ok, issues };
  }

  saveManual(
    slotId: ManualCheckpointSlotId,
    payload: T,
    checkpoint: { seed: SaveSeed; simTick: number },
    draft: CheckpointMetadataDraft,
    runEpoch = 0,
  ): CheckpointWriteResult {
    if (!MANUAL_CHECKPOINT_SLOTS.includes(slotId)) {
      return { ok: false, reason: "invalid-checkpoint", issues: [] };
    }
    return this.writeSlot(slotId, payload, checkpoint, draft, runEpoch);
  }

  saveAuto(
    payload: T,
    checkpoint: { seed: SaveSeed; simTick: number },
    draft: CheckpointMetadataDraft,
    runEpoch = 0,
  ): CheckpointWriteResult {
    const issues: CheckpointTimelineIssue[] = [];
    const timeline = this.reconcile(issues);
    const latestMatching = [...timeline.records]
      .filter((record) => record.metadata.kind === "auto")
      .sort((left, right) => right.metadata.sequence - left.metadata.sequence)
      .find((record) =>
        record.envelope.seed === checkpoint.seed &&
        record.envelope.simTick === checkpoint.simTick &&
        record.metadata.reason === draft.reason,
      );
    if (latestMatching) {
      return { ok: true, entry: this.toEntry(latestMatching), issues };
    }
    const slotId = AUTO_CHECKPOINT_SLOTS[timeline.manifest.autoCursor] ?? AUTO_CHECKPOINT_SLOTS[0];
    return this.writeSlot(slotId, payload, checkpoint, draft, runEpoch, timeline, issues);
  }

  savePreImport(
    payload: T,
    checkpoint: { seed: SaveSeed; simTick: number },
    draft: CheckpointMetadataDraft,
    runEpoch = 0,
  ): CheckpointWriteResult {
    return this.writeSlot(PREIMPORT_CHECKPOINT_SLOT, payload, checkpoint, draft, runEpoch);
  }

  private writeSlot(
    slotId: CheckpointSlotId,
    payload: T,
    checkpoint: { seed: SaveSeed; simTick: number },
    draft: CheckpointMetadataDraft,
    runEpoch: number,
    existingTimeline?: ReconciledTimeline<T>,
    existingIssues: CheckpointTimelineIssue[] = [],
  ): CheckpointWriteResult {
    const issues = existingIssues;
    if (!validDraft(draft) || !safeInteger(runEpoch)) {
      return { ok: false, reason: "invalid-checkpoint", issues };
    }
    const kind = kindForSlot(slotId);
    if (
      (kind === "manual" && draft.reason !== "manual") ||
      (kind === "preimport" && draft.reason !== "preimport") ||
      (kind === "auto" && ["manual", "preimport"].includes(draft.reason))
    ) {
      return { ok: false, reason: "invalid-checkpoint", issues };
    }
    if (this.payloadValidator) {
      try {
        if (!this.payloadValidator(payload)) {
          return { ok: false, reason: "invalid-checkpoint", issues };
        }
      } catch (error) {
        return { ok: false, reason: "invalid-checkpoint", issues, error };
      }
    }

    const timeline = existingTimeline ?? this.reconcile(issues);
    const sequence = Math.max(
      timeline.manifest.sequence,
      ...timeline.records.map((record) => record.metadata.sequence),
      0,
    ) + 1;
    const metadata: CheckpointMetadata = {
      ...draft,
      slotId,
      kind: kindForSlot(slotId),
      sequence,
      localDurability: this.localDurability === "persistent" ? "persistent" : "session",
      cloudDurability: "local-only",
    };

    let raw: string;
    let expectedChecksum: string;
    try {
      const envelope = createSaveEnvelope({
        schema: this.schema,
        content: this.content,
        runEpoch,
        revision: sequence,
        device: this.device,
        seed: checkpoint.seed,
        simTick: checkpoint.simTick,
        payload,
      });
      const storedEnvelope = JSON.parse(serializeSaveEnvelope(envelope)) as unknown;
      const record: StoredCheckpointRecord = {
        format: CHECKPOINT_RECORD_FORMAT,
        version: CHECKPOINT_TIMELINE_VERSION,
        metadata,
        envelope: storedEnvelope,
        checksum: "",
      };
      record.checksum = checksum(withoutRecordChecksum(record));
      expectedChecksum = record.checksum;
      raw = JSON.stringify(record);
    } catch (error) {
      return { ok: false, reason: "invalid-checkpoint", issues, error };
    }

    const targetKey = this.getSlotKey(slotId);
    const backupKey = this.getSlotBackupKey(slotId);
    const tempKey = this.getSlotTempKey(slotId);
    const previousTarget = this.safeGet(targetKey, issues, slotId);
    const previousBackup = this.safeGet(backupKey, issues, slotId);
    const previousManifest = this.safeGet(this.manifestKey, issues);

    const rollback = () => {
      this.restore(targetKey, previousTarget, issues, slotId);
      this.restore(backupKey, previousBackup, issues, slotId);
      this.restore(this.manifestKey, previousManifest, issues);
      this.safeRemove(tempKey, issues, slotId);
      this.safeRemove(this.manifestTempKey, issues);
    };

    if (!this.safeSet(tempKey, raw, issues, slotId)) {
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }
    const staged = this.safeGet(tempKey, issues, slotId);
    const stagedRecord = staged ? this.parseRecord(staged) : null;
    if (!stagedRecord || stagedRecord.recordChecksum !== expectedChecksum) {
      issues.push({ code: "write-verification-failed", slotId, key: tempKey });
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }

    if (previousTarget && !this.safeSet(backupKey, previousTarget, issues, slotId)) {
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }
    if (!this.safeSet(targetKey, raw, issues, slotId)) {
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }
    const written = this.safeGet(targetKey, issues, slotId);
    const verified = written ? this.parseRecord(written) : null;
    if (!verified || verified.recordChecksum !== expectedChecksum) {
      issues.push({ code: "write-verification-failed", slotId, key: targetKey });
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }

    const records = timeline.records.filter((record) => record.metadata.slotId !== slotId);
    records.push({
      ...verified,
      raw,
      recoveredFromBackup: false,
    });
    const autoCursor = kindForSlot(slotId) === "auto"
      ? (AUTO_CHECKPOINT_SLOTS.indexOf(slotId as AutoCheckpointSlotId) + 1) % AUTO_CHECKPOINT_SLOTS.length
      : timeline.manifest.autoCursor;
    const manifest = this.createManifest(sequence, autoCursor, records.map(manifestEntryFor));
    const manifestRaw = JSON.stringify(manifest);

    if (!this.safeSet(this.manifestTempKey, manifestRaw, issues)) {
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }
    const stagedManifestRaw = this.safeGet(this.manifestTempKey, issues);
    const stagedManifest = stagedManifestRaw ? this.parseManifest(stagedManifestRaw) : null;
    if (!stagedManifest || stagedManifest.checksum !== manifest.checksum) {
      issues.push({ code: "write-verification-failed", key: this.manifestTempKey });
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }
    if (!this.safeSet(this.manifestKey, manifestRaw, issues)) {
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }
    const writtenManifestRaw = this.safeGet(this.manifestKey, issues);
    const writtenManifest = writtenManifestRaw ? this.parseManifest(writtenManifestRaw) : null;
    if (!writtenManifest || writtenManifest.checksum !== manifest.checksum) {
      issues.push({ code: "write-verification-failed", key: this.manifestKey });
      rollback();
      return { ok: false, reason: "storage-error", issues };
    }

    this.safeRemove(tempKey, issues, slotId);
    this.safeRemove(this.manifestTempKey, issues);
    return {
      ok: true,
      entry: this.toEntry({
        ...verified,
        raw,
        recoveredFromBackup: false,
      }),
      issues,
    };
  }

  private reconcile(issues: CheckpointTimelineIssue[]): ReconciledTimeline<T> {
    const manifestRaw = this.safeGet(this.manifestKey, issues);
    let manifest = manifestRaw ? this.parseManifest(manifestRaw) : null;
    if (manifestRaw && !manifest) {
      issues.push({ code: "manifest-invalid", key: this.manifestKey });
      if (this.safeSet(this.manifestCorruptKey, manifestRaw, issues)) {
        this.safeRemove(this.manifestKey, issues);
      }
    }

    const records = ALL_CHECKPOINT_SLOTS.flatMap((slotId) => {
      const record = this.readSlot(slotId, issues, true);
      return record ? [record] : [];
    });
    const sequence = Math.max(
      manifest?.sequence ?? 0,
      ...records.map((record) => record.metadata.sequence),
      0,
    );
    const newestAuto = [...records]
      .filter((record) => record.metadata.kind === "auto")
      .sort((left, right) => right.metadata.sequence - left.metadata.sequence)[0];
    const recoveredCursor = newestAuto
      ? (AUTO_CHECKPOINT_SLOTS.indexOf(newestAuto.metadata.slotId as AutoCheckpointSlotId) + 1) % AUTO_CHECKPOINT_SLOTS.length
      : 0;
    const observedEntries = sortManifestEntries(records.map(manifestEntryFor));
    const manifestMatchesRecords = Boolean(
      manifest &&
      manifest.entries.length === observedEntries.length &&
      manifest.entries.every((entry, index) => {
        const observed = observedEntries[index];
        return Boolean(
          observed &&
          entry.slotId === observed.slotId &&
          entry.sequence === observed.sequence &&
          entry.recordChecksum === observed.recordChecksum
        );
      }),
    );
    // A target slot can be durably verified immediately before a page/process
    // crash prevents manifest promotion. In that case, derive the next cursor
    // from the newest verified record so reconciliation never overwrites the
    // just-recovered orphan on the next automatic save.
    const autoCursor = manifestMatchesRecords && manifest ? manifest.autoCursor : recoveredCursor;
    const rebuilt = this.createManifest(sequence, autoCursor, observedEntries);
    if (!manifest || manifest.checksum !== rebuilt.checksum) {
      this.writeReconciledManifest(rebuilt, issues);
      manifest = rebuilt;
    }
    return { manifest: manifest ?? rebuilt, records };
  }

  private readSlot(
    slotId: CheckpointSlotId,
    issues: CheckpointTimelineIssue[],
    quarantineInvalid: boolean,
  ): ParsedRecord<T> | null {
    const targetKey = this.getSlotKey(slotId);
    const raw = this.safeGet(targetKey, issues, slotId);
    if (raw) {
      const parsed = this.parseRecord(raw);
      if (parsed && parsed.metadata.slotId === slotId) {
        return { ...parsed, raw, recoveredFromBackup: false };
      }
      issues.push({ code: "record-invalid", slotId, key: targetKey });
      if (quarantineInvalid && this.safeSet(this.getSlotCorruptKey(slotId), raw, issues, slotId)) {
        this.safeRemove(targetKey, issues, slotId);
      }
    }

    const backupKey = this.getSlotBackupKey(slotId);
    const backupRaw = this.safeGet(backupKey, issues, slotId);
    if (!backupRaw) return null;
    const backup = this.parseRecord(backupRaw);
    if (!backup || backup.metadata.slotId !== slotId) {
      issues.push({ code: "record-invalid", slotId, key: backupKey });
      return null;
    }
    if (quarantineInvalid) this.safeSet(targetKey, backupRaw, issues, slotId);
    return { ...backup, raw: backupRaw, recoveredFromBackup: true };
  }

  private parseRecord(raw: string): Omit<ParsedRecord<T>, "raw" | "recoveredFromBackup"> | null {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isRecord(value) || !hasExactKeys(value, RECORD_KEYS)) return null;
    if (
      value.format !== CHECKPOINT_RECORD_FORMAT ||
      value.version !== CHECKPOINT_TIMELINE_VERSION ||
      !validMetadata(value.metadata) ||
      typeof value.checksum !== "string"
    ) {
      return null;
    }
    const record = value as unknown as StoredCheckpointRecord;
    try {
      if (checksum(withoutRecordChecksum(record)) !== record.checksum) return null;
    } catch {
      return null;
    }
    let envelopeRaw: string;
    try {
      envelopeRaw = JSON.stringify(record.envelope);
    } catch {
      return null;
    }
    const envelope = parseSaveEnvelope<T>(envelopeRaw, {
      schema: this.schema,
      content: this.acceptedContent,
      payloadValidator: this.payloadValidator,
    });
    if (!envelope.ok) return null;
    return {
      metadata: record.metadata,
      envelope: envelope.envelope,
      recordChecksum: record.checksum,
    };
  }

  private parseManifest(raw: string): CheckpointManifest | null {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) return null;
    if (
      value.format !== CHECKPOINT_MANIFEST_FORMAT ||
      value.version !== CHECKPOINT_TIMELINE_VERSION ||
      !safeInteger(value.sequence) ||
      !safeInteger(value.autoCursor) ||
      value.autoCursor >= AUTO_CHECKPOINT_SLOTS.length ||
      !Array.isArray(value.entries) ||
      value.entries.length > ALL_CHECKPOINT_SLOTS.length ||
      !value.entries.every(validManifestEntry) ||
      new Set(value.entries.map((entry) => (entry as CheckpointManifestEntry).slotId)).size !== value.entries.length ||
      typeof value.checksum !== "string"
    ) {
      return null;
    }
    const manifest = value as unknown as CheckpointManifest;
    try {
      return checksum(withoutManifestChecksum(manifest)) === manifest.checksum ? manifest : null;
    } catch {
      return null;
    }
  }

  private parseCloudBundle(raw: string): ParsedCloudBundle<T> | null {
    if (
      typeof raw !== "string" ||
      raw.length === 0 ||
      raw.length > CHECKPOINT_CLOUD_BUNDLE_MAX_CHARACTERS
    ) {
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isRecord(value) || !hasExactKeys(value, CLOUD_BUNDLE_KEYS)) return null;
    if (
      value.format !== CHECKPOINT_CLOUD_BUNDLE_FORMAT ||
      value.version !== CHECKPOINT_CLOUD_BUNDLE_VERSION ||
      !safeInteger(value.runEpoch) ||
      !safeInteger(value.sequence) ||
      !Array.isArray(value.entries) ||
      value.entries.length > CLOUD_CHECKPOINT_SLOTS.length ||
      typeof value.checksum !== "string"
    ) {
      return null;
    }
    const entries: CheckpointCloudBundleEntry[] = [];
    const seenSlots = new Set<CloudCheckpointSlotId>();
    const records: ParsedRecord<T>[] = [];
    for (const candidate of value.entries) {
      if (
        !isRecord(candidate) ||
        !hasExactKeys(candidate, CLOUD_BUNDLE_ENTRY_KEYS) ||
        !isCloudCheckpointSlotId(candidate.slotId) ||
        seenSlots.has(candidate.slotId) ||
        !boundedString(candidate.recordChecksum, 80) ||
        typeof candidate.raw !== "string" ||
        candidate.raw.length === 0 ||
        candidate.raw.length > CHECKPOINT_CLOUD_BUNDLE_MAX_CHARACTERS
      ) {
        return null;
      }
      const record = this.parseRecord(candidate.raw);
      if (
        !record ||
        record.metadata.slotId !== candidate.slotId ||
        record.recordChecksum !== candidate.recordChecksum ||
        this.recordRunEpoch(record) !== value.runEpoch
      ) {
        return null;
      }
      seenSlots.add(candidate.slotId);
      entries.push({
        slotId: candidate.slotId,
        recordChecksum: candidate.recordChecksum,
        raw: candidate.raw,
      });
      records.push({
        ...record,
        raw: candidate.raw,
        recoveredFromBackup: false,
      });
    }
    const bundle: CheckpointCloudBundle = {
      format: CHECKPOINT_CLOUD_BUNDLE_FORMAT,
      version: CHECKPOINT_CLOUD_BUNDLE_VERSION,
      runEpoch: value.runEpoch,
      sequence: value.sequence,
      entries,
      checksum: value.checksum,
    };
    try {
      if (checksum(withoutCloudBundleChecksum(bundle)) !== bundle.checksum) return null;
    } catch {
      return null;
    }
    return { bundle, records };
  }

  private createCloudBundleSnapshot(
    runEpoch: number,
    sequence: number,
    records: ParsedRecord<T>[],
  ): CheckpointCloudBundleSnapshot | null {
    const ordered = [...records]
      .filter((record): record is ParsedRecord<T> & { metadata: CheckpointMetadata & { slotId: CloudCheckpointSlotId } } =>
        isCloudCheckpointSlotId(record.metadata.slotId) &&
        this.recordRunEpoch(record) === runEpoch,
      )
      .sort((left, right) =>
        CLOUD_CHECKPOINT_SLOTS.indexOf(left.metadata.slotId) -
        CLOUD_CHECKPOINT_SLOTS.indexOf(right.metadata.slotId),
      );
    const bundle: CheckpointCloudBundle = {
      format: CHECKPOINT_CLOUD_BUNDLE_FORMAT,
      version: CHECKPOINT_CLOUD_BUNDLE_VERSION,
      runEpoch,
      sequence,
      entries: ordered.map((record) => ({
        slotId: record.metadata.slotId,
        recordChecksum: record.recordChecksum,
        raw: record.raw,
      })),
      checksum: "",
    };
    try {
      bundle.checksum = checksum(withoutCloudBundleChecksum(bundle));
      const raw = JSON.stringify(bundle);
      if (raw.length > CHECKPOINT_CLOUD_BUNDLE_MAX_CHARACTERS) return null;
      return {
        raw,
        runEpoch,
        slotChecksums: this.slotChecksumsFor(ordered),
      };
    } catch {
      return null;
    }
  }

  private snapshotFromParsedCloudBundle(
    parsed: ParsedCloudBundle<T>,
  ): CheckpointCloudBundleSnapshot {
    return {
      raw: JSON.stringify(parsed.bundle),
      runEpoch: parsed.bundle.runEpoch,
      slotChecksums: this.slotChecksumsFor(parsed.records),
    };
  }

  private slotChecksumsFor(
    records: ParsedRecord<T>[],
  ): Partial<Record<CloudCheckpointSlotId, string>> {
    const result: Partial<Record<CloudCheckpointSlotId, string>> = {};
    for (const record of records) {
      if (isCloudCheckpointSlotId(record.metadata.slotId)) {
        result[record.metadata.slotId] = record.recordChecksum;
      }
    }
    return result;
  }

  private compareRecordProgress(left: ParsedRecord<T>, right: ParsedRecord<T>): number {
    const runEpoch = this.recordRunEpoch(left) - this.recordRunEpoch(right);
    if (runEpoch !== 0) return runEpoch;
    const simTick = left.envelope.simTick - right.envelope.simTick;
    if (simTick !== 0) return simTick;
    const revision = left.envelope.revision - right.envelope.revision;
    if (revision !== 0) return revision;
    return left.metadata.sequence - right.metadata.sequence;
  }

  private recordRunEpoch(record: Pick<ParsedRecord<T>, "envelope">): number {
    return Number.isInteger(record.envelope.runEpoch) && (record.envelope.runEpoch ?? -1) >= 0
      ? record.envelope.runEpoch!
      : 0;
  }

  private adoptCloudRecord(
    record: ParsedRecord<T>,
    issues: CheckpointTimelineIssue[],
  ): boolean {
    const slotId = record.metadata.slotId;
    if (!isCloudCheckpointSlotId(slotId)) return false;
    const targetKey = this.getSlotKey(slotId);
    const backupKey = this.getSlotBackupKey(slotId);
    const tempKey = this.getSlotTempKey(slotId);
    const issueCount = issues.length;
    const previousTarget = this.safeGet(targetKey, issues, slotId);
    const previousBackup = this.safeGet(backupKey, issues, slotId);
    if (issues.length !== issueCount) return false;
    const rollback = () => {
      this.restore(targetKey, previousTarget, issues, slotId);
      this.restore(backupKey, previousBackup, issues, slotId);
      this.safeRemove(tempKey, issues, slotId);
    };
    if (!this.safeSet(tempKey, record.raw, issues, slotId)) {
      rollback();
      return false;
    }
    const staged = this.safeGet(tempKey, issues, slotId);
    if (!staged || this.parseRecord(staged)?.recordChecksum !== record.recordChecksum) {
      issues.push({ code: "write-verification-failed", slotId, key: tempKey });
      rollback();
      return false;
    }
    if (previousTarget && !this.safeSet(backupKey, previousTarget, issues, slotId)) {
      rollback();
      return false;
    }
    if (!this.safeSet(targetKey, record.raw, issues, slotId)) {
      rollback();
      return false;
    }
    const written = this.safeGet(targetKey, issues, slotId);
    const verified = written ? this.parseRecord(written) : null;
    if (!verified || verified.recordChecksum !== record.recordChecksum) {
      issues.push({ code: "write-verification-failed", slotId, key: targetKey });
      rollback();
      return false;
    }
    this.safeRemove(tempKey, issues, slotId);
    return true;
  }

  private hasStorageFailure(issues: CheckpointTimelineIssue[]): boolean {
    return issues.some((issue) =>
      [
        "storage-read-failed",
        "storage-write-failed",
        "storage-remove-failed",
        "write-verification-failed",
      ].includes(issue.code),
    );
  }

  private createManifest(
    sequence: number,
    autoCursor: number,
    entries: CheckpointManifestEntry[],
  ): CheckpointManifest {
    const manifest: CheckpointManifest = {
      format: CHECKPOINT_MANIFEST_FORMAT,
      version: CHECKPOINT_TIMELINE_VERSION,
      sequence,
      autoCursor,
      entries: sortManifestEntries(entries),
      checksum: "",
    };
    manifest.checksum = checksum(withoutManifestChecksum(manifest));
    return manifest;
  }

  private writeReconciledManifest(
    manifest: CheckpointManifest,
    issues: CheckpointTimelineIssue[],
  ): void {
    const raw = JSON.stringify(manifest);
    if (!this.safeSet(this.manifestTempKey, raw, issues)) return;
    const staged = this.safeGet(this.manifestTempKey, issues);
    if (!staged || this.parseManifest(staged)?.checksum !== manifest.checksum) {
      issues.push({ code: "write-verification-failed", key: this.manifestTempKey });
      return;
    }
    if (!this.safeSet(this.manifestKey, raw, issues)) return;
    const written = this.safeGet(this.manifestKey, issues);
    if (!written || this.parseManifest(written)?.checksum !== manifest.checksum) {
      issues.push({ code: "write-verification-failed", key: this.manifestKey });
      return;
    }
    this.safeRemove(this.manifestTempKey, issues);
  }

  private toEntry(record: ParsedRecord<T>): CheckpointTimelineEntry {
    return {
      ...record.metadata,
      // Sync durability is a repository/runtime fact, never trusted from a
      // serialized local record (including legacy `not-synced` values).
      cloudDurability: "local-only",
      recordChecksum: record.recordChecksum,
      validation: "verified",
      recoveredFromBackup: record.recoveredFromBackup,
    };
  }

  private safeGet(
    key: string,
    issues: CheckpointTimelineIssue[],
    slotId?: CheckpointSlotId,
  ): string | null {
    try {
      return this.kv.getItem(key);
    } catch (error) {
      issues.push({ code: "storage-read-failed", slotId, key, error });
      return null;
    }
  }

  private safeSet(
    key: string,
    value: string,
    issues: CheckpointTimelineIssue[],
    slotId?: CheckpointSlotId,
  ): boolean {
    try {
      this.kv.setItem(key, value);
      return true;
    } catch (error) {
      issues.push({ code: "storage-write-failed", slotId, key, error });
      return false;
    }
  }

  private safeRemove(
    key: string,
    issues: CheckpointTimelineIssue[],
    slotId?: CheckpointSlotId,
  ): boolean {
    try {
      this.kv.removeItem(key);
      return true;
    } catch (error) {
      issues.push({ code: "storage-remove-failed", slotId, key, error });
      return false;
    }
  }

  private restore(
    key: string,
    previous: string | null,
    issues: CheckpointTimelineIssue[],
    slotId?: CheckpointSlotId,
  ): void {
    if (previous === null) this.safeRemove(key, issues, slotId);
    else this.safeSet(key, previous, issues, slotId);
  }
}
