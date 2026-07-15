import type { CloudKV } from "./cloud";
import { checksum } from "./checksum";
import {
  CheckpointTimeline,
  type CheckpointCloudBundleSnapshot,
  type CheckpointCloudDurability,
  type CheckpointLoadResult,
  type CheckpointMetadataDraft,
  type CheckpointSlotId,
  type CheckpointTimelineEntry,
  type CheckpointTimelineListResult,
  type CheckpointWriteResult,
  type CloudCheckpointSlotId,
  type ManualCheckpointSlotId,
} from "./checkpointTimeline";
import {
  createDefaultKVSelection,
  type KVStorageDurability,
  type KVStore,
} from "./kv";
import {
  createSaveEnvelope,
  parseSaveEnvelope,
  serializeSaveEnvelope,
  type EnvelopeFailureReason,
  type SaveEnvelope,
  type SaveSeed,
} from "./saveEnvelope";

export const DEFAULT_SAVE_KEY = "green_hell_save_v2";

export type SaveSlot =
  | "primary"
  | "backup"
  | "corrupt"
  | "preimport"
  | "cloud"
  | "epoch-floor";

export type RepositoryIssueCode =
  | "storage-read-failed"
  | "storage-write-failed"
  | "storage-remove-failed"
  | "envelope-invalid"
  | "cloud-unavailable"
  | "cloud-read-failed"
  | "cloud-write-failed"
  | "cloud-conflict"
  | "run-epoch-floor-invalid";

export interface RepositoryIssue {
  code: RepositoryIssueCode;
  slot?: SaveSlot;
  reason?: EnvelopeFailureReason;
  error?: unknown;
}

export interface SaveRepositoryOptions<T> {
  key?: string;
  schema: number;
  content: string;
  /** Older content ids that the current payload migrator can still understand. */
  acceptedContent?: readonly string[];
  device: string;
  kv?: KVStore;
  /** Explicit stores are treated as persistent unless a host says otherwise. */
  localDurability?: KVStorageDurability;
  cloud?: CloudKV;
  payloadValidator?: (payload: unknown) => payload is T;
  onCloudIssue?: (issue: RepositoryIssue) => void;
}

export interface SaveCheckpoint {
  seed: SaveSeed;
  simTick: number;
}

export type LoadResult<T> =
  | {
      ok: true;
      envelope: SaveEnvelope<T>;
      source: "local" | "backup" | "cloud";
      recovered: boolean;
      issues: RepositoryIssue[];
    }
  | {
      ok: false;
      reason: "not-found" | "unavailable";
      issues: RepositoryIssue[];
    };

export type SaveResult<T> =
  | {
      ok: true;
      envelope: SaveEnvelope<T>;
      cloudScheduled: boolean;
      localDurability: KVStorageDurability;
      issues: RepositoryIssue[];
    }
  | {
      ok: false;
      reason: "invalid-save" | "storage-error";
      issues: RepositoryIssue[];
      error?: unknown;
    };

export interface ClearResult {
  ok: boolean;
  cloudScheduled: boolean;
  issues: RepositoryIssue[];
}

export type CloudRefreshResult<T> =
  | { status: "disabled" | "unavailable" | "not-found"; issues: RepositoryIssue[] }
  | { status: "up-to-date"; envelope: SaveEnvelope<T>; issues: RepositoryIssue[] }
  | { status: "updated"; envelope: SaveEnvelope<T>; issues: RepositoryIssue[] }
  | { status: "storage-error"; issues: RepositoryIssue[] };

export type LocalSnapshotResult<T> =
  | { ok: true; envelope: SaveEnvelope<T>; raw: string; issues: RepositoryIssue[] }
  | { ok: false; reason: "not-found" | "unavailable"; issues: RepositoryIssue[] };

interface Candidate<T> {
  slot: "primary" | "backup" | "cloud";
  raw: string;
  envelope: SaveEnvelope<T>;
}

const RUN_EPOCH_FLOOR_FORMAT = "canopy-run-epoch-floor";
const RUN_EPOCH_FLOOR_VERSION = 1;

interface RunEpochFloorRecord {
  format: typeof RUN_EPOCH_FLOOR_FORMAT;
  version: typeof RUN_EPOCH_FLOOR_VERSION;
  epoch: number;
  checksum: string;
}

interface RunEpochFloorSnapshot {
  epoch: number;
  raw: string | null;
}

function runEpochFloorPayload(record: RunEpochFloorRecord) {
  return {
    format: record.format,
    version: record.version,
    epoch: record.epoch,
  };
}

function serializeRunEpochFloor(epoch: number): string {
  const record: RunEpochFloorRecord = {
    format: RUN_EPOCH_FLOOR_FORMAT,
    version: RUN_EPOCH_FLOOR_VERSION,
    epoch,
    checksum: "",
  };
  record.checksum = checksum(runEpochFloorPayload(record));
  return JSON.stringify(record);
}

function parseRunEpochFloor(raw: string): number | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<RunEpochFloorRecord>;
  if (
    Object.keys(record).length !== 4 ||
    record.format !== RUN_EPOCH_FLOOR_FORMAT ||
    record.version !== RUN_EPOCH_FLOOR_VERSION ||
    !Number.isSafeInteger(record.epoch) ||
    record.epoch! < 0 ||
    typeof record.checksum !== "string"
  ) {
    return null;
  }
  const normalized = record as RunEpochFloorRecord;
  try {
    return checksum(runEpochFloorPayload(normalized)) === normalized.checksum
      ? normalized.epoch
      : null;
  } catch {
    return null;
  }
}

export class SaveRepository<T> {
  readonly key: string;
  readonly backupKey: string;
  readonly corruptKey: string;
  readonly preImportKey: string;
  readonly runEpochFloorKey: string;
  readonly checkpointCloudKey: string;
  readonly checkpointTimeline: CheckpointTimeline<T>;

  private readonly schema: number;
  private readonly content: string;
  private readonly acceptedContent: readonly string[];
  private readonly device: string;
  private readonly kv: KVStore;
  private readonly localDurability: KVStorageDurability;
  private readonly cloud?: CloudKV;
  private readonly payloadValidator?: SaveRepositoryOptions<T>["payloadValidator"];
  private readonly onCloudIssue?: SaveRepositoryOptions<T>["onCloudIssue"];
  private cloudTail: Promise<void> = Promise.resolve();
  private localGeneration = 0;
  private lastRevision = 0;
  private lastRunEpoch = 0;
  private minimumRunEpoch = 0;
  private pendingRunEpoch: number | null = null;
  private latestCloudIssue: RepositoryIssue | null = null;
  private latestCheckpointCloudIssue: RepositoryIssue | null = null;
  private readonly checkpointCloudState = new Map<
    CheckpointSlotId,
    { recordChecksum: string; durability: CheckpointCloudDurability }
  >();
  private cloudPending = 0;

  constructor(options: SaveRepositoryOptions<T>) {
    if (!Number.isInteger(options.schema) || options.schema < 0) {
      throw new TypeError("schema must be an unsigned integer");
    }
    if (!options.content) throw new TypeError("content must be non-empty");
    if (!options.device) throw new TypeError("device must be non-empty");

    this.key = options.key || DEFAULT_SAVE_KEY;
    this.backupKey = `${this.key}.backup`;
    this.corruptKey = `${this.key}.corrupt`;
    this.preImportKey = `${this.key}.preimport`;
    this.runEpochFloorKey = `${this.key}.run-epoch-floor.v1`;
    this.checkpointCloudKey = `${this.key}.timeline.bundle.v1`;
    this.schema = options.schema;
    this.content = options.content;
    this.acceptedContent = [...new Set([options.content, ...(options.acceptedContent ?? [])])];
    this.device = options.device;
    if (options.kv) {
      this.kv = options.kv;
      this.localDurability = options.localDurability ?? "persistent";
    } else {
      const selection = createDefaultKVSelection();
      this.kv = selection.kv;
      this.localDurability = selection.durability;
    }
    this.cloud = options.cloud;
    this.payloadValidator = options.payloadValidator;
    this.onCloudIssue = options.onCloudIssue;
    this.primeRunEpochFloor();
    this.checkpointTimeline = new CheckpointTimeline<T>({
      key: this.key,
      schema: this.schema,
      content: this.content,
      acceptedContent: this.acceptedContent,
      device: this.device,
      kv: this.kv,
      localDurability: this.localDurability,
      payloadValidator: this.payloadValidator,
    });
  }

  async load(options: { allowCloudFallback?: boolean } = {}): Promise<LoadResult<T>> {
    const generation = this.localGeneration;
    const issues: RepositoryIssue[] = [];
    const floor = this.readRunEpochFloor(issues);
    if (!floor) return { ok: false, reason: "unavailable", issues };
    const local = this.readLocalCandidates(issues, true, floor.epoch);
    const bestLocal = this.bestCandidate(local);
    if (bestLocal) {
      this.lastRevision = Math.max(this.lastRevision, bestLocal.envelope.revision);
      this.lastRunEpoch = Math.max(this.lastRunEpoch, this.runEpoch(bestLocal.envelope));
      const recovered = bestLocal.slot === "backup";
      if (recovered && !this.safeSet(this.key, bestLocal.raw, issues, "primary")) {
        return { ok: false, reason: "unavailable", issues };
      }
      return {
        ok: true,
        envelope: bestLocal.envelope,
        source: recovered ? "backup" : "local",
        recovered,
        issues,
      };
    }

    if (options.allowCloudFallback !== false && this.cloud) {
      const cloud = await this.readCloudCandidates(issues, floor.epoch);
      if (generation !== this.localGeneration) {
        return { ok: false, reason: "not-found", issues };
      }
      const bestCloud = this.bestCandidate(cloud);
      if (bestCloud) {
        if (!this.safeSet(this.key, bestCloud.raw, issues, "primary")) {
          return { ok: false, reason: "unavailable", issues };
        }
        this.lastRevision = Math.max(this.lastRevision, bestCloud.envelope.revision);
        this.lastRunEpoch = Math.max(this.lastRunEpoch, this.runEpoch(bestCloud.envelope));
        await this.refreshCheckpointTimelineFromCloud(
          bestCloud.envelope,
          issues,
          generation,
        );
        return {
          ok: true,
          envelope: bestCloud.envelope,
          source: "cloud",
          recovered: true,
          issues,
        };
      }
    }

    const unavailable = issues.some((issue) =>
      [
        "storage-read-failed",
        "storage-write-failed",
        "cloud-read-failed",
        "cloud-unavailable",
      ].includes(issue.code),
    );
    return { ok: false, reason: unavailable ? "unavailable" : "not-found", issues };
  }

  async save(payload: T, checkpoint: SaveCheckpoint): Promise<SaveResult<T>> {
    this.localGeneration += 1;
    const issues: RepositoryIssue[] = [];
    const floor = this.readRunEpochFloor(issues);
    if (!floor) return { ok: false, reason: "storage-error", issues };
    const local = this.readLocalCandidates(issues, true, floor.epoch);
    if (issues.some((issue) => issue.code === "storage-read-failed")) {
      return { ok: false, reason: "storage-error", issues };
    }
    const bestLocal = this.bestCandidate(local);
    const runEpoch =
      this.pendingRunEpoch ??
      Math.max(floor.epoch, bestLocal ? this.runEpoch(bestLocal.envelope) : 0);
    const revision =
      Math.max(this.lastRevision, ...local.map((item) => item.envelope.revision), 0) + 1;

    let envelope: SaveEnvelope<T>;
    let raw: string;
    try {
      envelope = createSaveEnvelope({
        schema: this.schema,
        content: this.content,
        runEpoch,
        revision,
        device: this.device,
        seed: checkpoint.seed,
        simTick: checkpoint.simTick,
        payload,
      });
      if (this.payloadValidator && !this.payloadValidator(payload)) {
        throw new TypeError("payload validator rejected save");
      }
      raw = serializeSaveEnvelope(envelope);
    } catch (error) {
      return { ok: false, reason: "invalid-save", issues, error };
    }

    if (
      bestLocal &&
      !this.safeSet(this.backupKey, bestLocal.raw, issues, "backup")
    ) {
      return { ok: false, reason: "storage-error", issues };
    }
    if (!this.safeSet(this.key, raw, issues, "primary")) {
      return { ok: false, reason: "storage-error", issues };
    }

    this.lastRevision = envelope.revision;
    this.lastRunEpoch = Math.max(this.lastRunEpoch, runEpoch);
    this.pendingRunEpoch = null;
    if (this.cloud) {
      const items: Record<string, string> = { [this.key]: raw };
      if (bestLocal) items[this.backupKey] = bestLocal.raw;
      this.scheduleCloudWrite(items, envelope);
    }
    return {
      ok: true,
      envelope,
      cloudScheduled: Boolean(this.cloud),
      localDurability: this.localDurability,
      issues,
    };
  }

  /** Returns the freshest verified local checkpoint without consulting Toy cloud. */
  exportLocalSnapshot(): LocalSnapshotResult<T> {
    const issues: RepositoryIssue[] = [];
    const floor = this.readRunEpochFloor(issues);
    if (!floor) return { ok: false, reason: "unavailable", issues };
    const candidates = this.readLocalCandidates(issues, false, floor.epoch);
    const best = this.bestCandidate(candidates);
    if (best) {
      return { ok: true, envelope: best.envelope, raw: best.raw, issues };
    }
    return {
      ok: false,
      reason: issues.some((issue) => issue.code === "storage-read-failed")
        ? "unavailable"
        : "not-found",
      issues,
    };
  }

  /** Returns the rollback checkpoint retained before the most recent import. */
  getPreImportSnapshot(): LocalSnapshotResult<T> {
    const issues: RepositoryIssue[] = [];
    const raw = this.safeGet(this.preImportKey, issues, "preimport");
    if (!raw) {
      return {
        ok: false,
        reason: issues.length > 0 ? "unavailable" : "not-found",
        issues,
      };
    }
    const parsed = this.parse(raw);
    if (!parsed.ok) {
      issues.push({
        code: "envelope-invalid",
        slot: "preimport",
        reason: parsed.reason,
        error: parsed.error,
      });
      return { ok: false, reason: "unavailable", issues };
    }
    return { ok: true, envelope: parsed.envelope, raw, issues };
  }

  hasPreImportSnapshot(): boolean {
    return this.getPreImportSnapshot().ok;
  }

  listCheckpoints(): CheckpointTimelineListResult {
    const listed = this.checkpointTimeline.list();
    return {
      ...listed,
      entries: listed.entries.map((entry) => this.decorateCheckpointEntry(entry)),
    };
  }

  loadCheckpoint(slotId: Parameters<CheckpointTimeline<T>["load"]>[0]): CheckpointLoadResult<T> {
    const loaded = this.checkpointTimeline.load(slotId);
    return loaded.ok
      ? { ...loaded, entry: this.decorateCheckpointEntry(loaded.entry) }
      : loaded;
  }

  saveManualCheckpoint(
    slotId: ManualCheckpointSlotId,
    payload: T,
    checkpoint: SaveCheckpoint,
    metadata: CheckpointMetadataDraft,
  ): CheckpointWriteResult {
    return this.completeCheckpointWrite(this.checkpointTimeline.saveManual(
      slotId,
      payload,
      checkpoint,
      metadata,
      this.checkpointRunEpoch(),
    ));
  }

  saveAutoCheckpoint(
    payload: T,
    checkpoint: SaveCheckpoint,
    metadata: CheckpointMetadataDraft,
  ): CheckpointWriteResult {
    return this.completeCheckpointWrite(this.checkpointTimeline.saveAuto(
      payload,
      checkpoint,
      metadata,
      this.checkpointRunEpoch(),
    ));
  }

  savePreImportCheckpoint(
    payload: T,
    checkpoint: SaveCheckpoint,
    metadata: CheckpointMetadataDraft,
  ): CheckpointWriteResult {
    return this.checkpointTimeline.savePreImport(
      payload,
      checkpoint,
      metadata,
      this.checkpointRunEpoch(),
    );
  }

  /**
   * Atomically replaces the active run with a validated imported payload.
   * The old active checkpoint is retained locally and the imported payload is
   * re-enveloped as a fresh run so an older Toy cloud checkpoint cannot win.
   */
  async replaceFromImport(
    payload: T,
    checkpoint: SaveCheckpoint,
  ): Promise<SaveResult<T>> {
    return this.replaceActivePayload(payload, checkpoint, true);
  }

  /** Restores a verified local checkpoint without replacing import rollback. */
  async replaceFromCheckpoint(
    payload: T,
    checkpoint: SaveCheckpoint,
  ): Promise<SaveResult<T>> {
    return this.replaceActivePayload(payload, checkpoint, false);
  }

  private async replaceActivePayload(
    payload: T,
    checkpoint: SaveCheckpoint,
    preserveAsPreImport: boolean,
  ): Promise<SaveResult<T>> {
    this.localGeneration += 1;
    const issues: RepositoryIssue[] = [];
    const floor = this.readRunEpochFloor(issues);
    if (!floor) return { ok: false, reason: "storage-error", issues };
    const local = this.readLocalCandidates(issues, true, floor.epoch);
    if (issues.some((issue) => issue.code === "storage-read-failed")) {
      return { ok: false, reason: "storage-error", issues };
    }
    const bestLocal = this.bestCandidate(local);
    const runEpoch = Math.max(
      Date.now(),
      floor.epoch,
      this.lastRunEpoch + 1,
      bestLocal ? this.runEpoch(bestLocal.envelope) + 1 : 1,
    );
    const revision =
      Math.max(this.lastRevision, ...local.map((item) => item.envelope.revision), 0) + 1;

    let envelope: SaveEnvelope<T>;
    let raw: string;
    try {
      if (this.payloadValidator && !this.payloadValidator(payload)) {
        throw new TypeError("payload validator rejected imported save");
      }
      envelope = createSaveEnvelope({
        schema: this.schema,
        content: this.content,
        runEpoch,
        revision,
        device: this.device,
        seed: checkpoint.seed,
        simTick: checkpoint.simTick,
        payload,
      });
      raw = serializeSaveEnvelope(envelope);
    } catch (error) {
      return { ok: false, reason: "invalid-save", issues, error };
    }

    // Every write before primary is additive. A failure therefore leaves the
    // previously active primary untouched.
    if (bestLocal) {
      if (
        preserveAsPreImport &&
        !this.safeSet(this.preImportKey, bestLocal.raw, issues, "preimport")
      ) {
        return { ok: false, reason: "storage-error", issues };
      }
      if (!this.safeSet(this.backupKey, bestLocal.raw, issues, "backup")) {
        return { ok: false, reason: "storage-error", issues };
      }
    }
    if (!this.safeSet(this.key, raw, issues, "primary")) {
      return { ok: false, reason: "storage-error", issues };
    }

    // Verify the exact primary through the same parser used at boot before any
    // React state swap or cloud write is allowed.
    const written = this.safeGet(this.key, issues, "primary");
    const verified = written ? this.parse(written) : null;
    if (!verified?.ok || verified.envelope.checksum !== envelope.checksum) {
      if (bestLocal) this.safeSet(this.key, bestLocal.raw, issues, "primary");
      else this.safeRemove(this.key, issues, "primary");
      return { ok: false, reason: "storage-error", issues };
    }

    this.lastRevision = envelope.revision;
    this.lastRunEpoch = runEpoch;
    this.pendingRunEpoch = null;
    // A restore/import starts a new authoritative branch. Existing timeline
    // slots remain useful locally but are not represented by the new cloud
    // epoch until rewritten, so prior sync claims must be discarded.
    this.checkpointCloudState.clear();
    if (this.cloud) {
      const items: Record<string, string> = { [this.key]: raw };
      if (bestLocal) items[this.backupKey] = bestLocal.raw;
      this.scheduleCloudWrite(items, envelope);
    }
    return {
      ok: true,
      envelope,
      cloudScheduled: Boolean(this.cloud),
      localDurability: this.localDurability,
      issues,
    };
  }

  async clear(): Promise<ClearResult> {
    this.localGeneration += 1;
    const issues: RepositoryIssue[] = [];
    const previousFloor = this.readRunEpochFloor(issues);
    if (!previousFloor) {
      return { ok: false, cloudScheduled: false, issues };
    }
    const previousPendingRunEpoch = this.pendingRunEpoch;
    const previousLastRunEpoch = this.lastRunEpoch;
    const previousMinimumRunEpoch = this.minimumRunEpoch;
    // Persist the rejection floor before deleting any local payload. It is the
    // durable clear intent across process restarts; cloud deletion remains a
    // best-effort transport operation and may finish later or fail entirely.
    const nextRunEpoch = Math.max(
      Date.now(),
      previousFloor.epoch + 1,
      this.lastRunEpoch + 1,
    );
    if (!this.persistRunEpochFloor(nextRunEpoch, issues)) {
      this.restoreRunEpochFloor(previousFloor.raw, issues);
      return { ok: false, cloudScheduled: false, issues };
    }
    this.pendingRunEpoch = nextRunEpoch;
    this.lastRunEpoch = nextRunEpoch;
    this.minimumRunEpoch = nextRunEpoch;
    this.checkpointCloudState.clear();
    let localCleared = true;
    const timelineClear = this.checkpointTimeline.clearAll();
    if (!timelineClear.ok) localCleared = false;
    for (const issue of timelineClear.issues) {
      issues.push({
        code: "storage-remove-failed",
        ...(issue.error !== undefined ? { error: issue.error } : {}),
      });
    }
    for (const [key, slot] of [
      [this.key, "primary"],
      [this.backupKey, "backup"],
      [this.corruptKey, "corrupt"],
      [this.preImportKey, "preimport"],
    ] as const) {
      if (!this.safeRemove(key, issues, slot)) localCleared = false;
    }

    if (!localCleared) {
      this.restoreRunEpochFloor(previousFloor.raw, issues);
      this.pendingRunEpoch = previousPendingRunEpoch;
      this.lastRunEpoch = previousLastRunEpoch;
      this.minimumRunEpoch = previousMinimumRunEpoch;
    }

    if (localCleared) {
      this.lastRevision = 0;
      this.latestCheckpointCloudIssue = null;
      if (this.cloud) {
        this.scheduleCloudClear([
          this.key,
          this.backupKey,
          this.checkpointCloudKey,
        ]);
      }
    }
    return {
      ok: localCleared,
      cloudScheduled: localCleared && Boolean(this.cloud),
      issues,
    };
  }

  /** Pulls a newer valid cloud revision; normal load/save remains local-first. */
  async refreshFromCloud(): Promise<CloudRefreshResult<T>> {
    const generation = this.localGeneration;
    const issues: RepositoryIssue[] = [];
    if (!this.cloud) return { status: "disabled", issues };
    const floor = this.readRunEpochFloor(issues);
    if (!floor) return { status: "storage-error", issues };

    const cloud = await this.readCloudCandidates(issues, floor.epoch);
    if (generation !== this.localGeneration) return { status: "not-found", issues };
    if (cloud === null) return { status: "unavailable", issues };
    const local = this.readLocalCandidates(issues, true, floor.epoch);
    const bestLocal = this.bestCandidate(local);
    if (bestLocal) {
      this.lastRevision = Math.max(this.lastRevision, bestLocal.envelope.revision);
      this.lastRunEpoch = Math.max(this.lastRunEpoch, this.runEpoch(bestLocal.envelope));
    }
    const bestCloud = this.bestCandidate(cloud);
    if (!bestCloud) {
      if (!bestLocal) return { status: "not-found", issues };
      await this.refreshCheckpointTimelineFromCloud(
        bestLocal.envelope,
        issues,
        generation,
      );
      return { status: "up-to-date", envelope: bestLocal.envelope, issues };
    }
    const localProgress = bestLocal
      ? this.compareProgress(bestLocal.envelope, bestCloud.envelope)
      : -1;
    if (
      bestLocal &&
      (localProgress > 0 ||
        (localProgress === 0 && bestLocal.envelope.checksum === bestCloud.envelope.checksum))
    ) {
      await this.refreshCheckpointTimelineFromCloud(
        bestLocal.envelope,
        issues,
        generation,
      );
      return { status: "up-to-date", envelope: bestLocal.envelope, issues };
    }
    if (
      bestLocal &&
      !this.safeSet(this.backupKey, bestLocal.raw, issues, "backup")
    ) {
      return { status: "storage-error", issues };
    }
    if (!this.safeSet(this.key, bestCloud.raw, issues, "primary")) {
      return { status: "storage-error", issues };
    }
    this.lastRevision = bestCloud.envelope.revision;
    this.lastRunEpoch = Math.max(this.lastRunEpoch, this.runEpoch(bestCloud.envelope));
    await this.refreshCheckpointTimelineFromCloud(
      bestCloud.envelope,
      issues,
      generation,
    );
    return { status: "updated", envelope: bestCloud.envelope, issues };
  }

  /** Wait only when a caller explicitly needs cloud durability (tests, shutdown, status UI). */
  async whenCloudIdle(): Promise<void> {
    await this.cloudTail;
  }

  getLastCloudIssue(): RepositoryIssue | null {
    return this.latestCheckpointCloudIssue ?? this.latestCloudIssue;
  }

  getCloudStatus(): "disabled" | "pending" | "synced" | "failed" {
    if (!this.cloud) return "disabled";
    if (this.cloudPending > 0) return "pending";
    return this.latestCheckpointCloudIssue || this.latestCloudIssue ? "failed" : "synced";
  }

  getLocalDurability(): KVStorageDurability {
    return this.localDurability;
  }

  private primeRunEpochFloor(): void {
    this.readRunEpochFloor([]);
  }

  private readRunEpochFloor(
    issues: RepositoryIssue[],
  ): RunEpochFloorSnapshot | null {
    const issueCount = issues.length;
    const raw = this.safeGet(this.runEpochFloorKey, issues, "epoch-floor");
    if (issues.length !== issueCount) return null;
    if (raw === null) {
      return { epoch: this.minimumRunEpoch, raw: null };
    }
    const storedEpoch = parseRunEpochFloor(raw);
    if (storedEpoch === null) {
      issues.push({ code: "run-epoch-floor-invalid", slot: "epoch-floor" });
      return null;
    }
    this.minimumRunEpoch = Math.max(this.minimumRunEpoch, storedEpoch);
    this.lastRunEpoch = Math.max(this.lastRunEpoch, this.minimumRunEpoch);
    return { epoch: this.minimumRunEpoch, raw };
  }

  private persistRunEpochFloor(
    epoch: number,
    issues: RepositoryIssue[],
  ): boolean {
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
      issues.push({ code: "run-epoch-floor-invalid", slot: "epoch-floor" });
      return false;
    }
    const raw = serializeRunEpochFloor(epoch);
    if (!this.safeSet(this.runEpochFloorKey, raw, issues, "epoch-floor")) {
      return false;
    }
    const written = this.safeGet(this.runEpochFloorKey, issues, "epoch-floor");
    if (written !== raw || parseRunEpochFloor(written) !== epoch) {
      issues.push({
        code: "storage-write-failed",
        slot: "epoch-floor",
        error: new Error("run epoch floor write verification failed"),
      });
      return false;
    }
    return true;
  }

  private restoreRunEpochFloor(
    previousRaw: string | null,
    issues: RepositoryIssue[],
  ): void {
    if (previousRaw === null) {
      this.safeRemove(this.runEpochFloorKey, issues, "epoch-floor");
    } else {
      this.safeSet(this.runEpochFloorKey, previousRaw, issues, "epoch-floor");
    }
  }

  private readLocalCandidates(
    issues: RepositoryIssue[],
    quarantineInvalid: boolean,
    minimumRunEpoch = 0,
  ): Candidate<T>[] {
    const candidates: Candidate<T>[] = [];
    for (const [key, slot] of [
      [this.key, "primary"],
      [this.backupKey, "backup"],
    ] as const) {
      const raw = this.safeGet(key, issues, slot);
      if (!raw) continue;
      const parsed = this.parse(raw);
      if (parsed.ok) {
        if (this.runEpoch(parsed.envelope) >= minimumRunEpoch) {
          candidates.push({ slot, raw, envelope: parsed.envelope });
        }
      } else {
        issues.push({ code: "envelope-invalid", slot, reason: parsed.reason, error: parsed.error });
        if (quarantineInvalid && slot === "primary") {
          this.safeSet(this.corruptKey, raw, issues, "corrupt");
        }
      }
    }
    return candidates;
  }

  private async readCloudCandidates(
    issues: RepositoryIssue[],
    minimumRunEpoch = 0,
  ): Promise<Candidate<T>[] | null> {
    if (!this.cloud) return [];
    let items: Readonly<Record<string, string>> | null;
    try {
      items = await this.cloud.getItems([this.key, this.backupKey]);
    } catch (error) {
      issues.push({ code: "cloud-read-failed", slot: "cloud", error });
      return null;
    }
    if (items === null) {
      issues.push({ code: "cloud-unavailable", slot: "cloud" });
      return null;
    }

    const candidates: Candidate<T>[] = [];
    for (const key of [this.key, this.backupKey]) {
      const raw = items[key];
      if (!raw) continue;
      const parsed = this.parse(raw);
      if (parsed.ok) {
        if (this.runEpoch(parsed.envelope) >= minimumRunEpoch) {
          candidates.push({ slot: "cloud", raw, envelope: parsed.envelope });
        }
      } else {
        issues.push({
          code: "envelope-invalid",
          slot: "cloud",
          reason: parsed.reason,
          error: parsed.error,
        });
      }
    }
    return candidates;
  }

  private parse(raw: string) {
    return parseSaveEnvelope<T>(raw, {
      schema: this.schema,
      content: this.acceptedContent,
      payloadValidator: this.payloadValidator,
    });
  }

  private bestCandidate(candidates: Candidate<T>[] | null): Candidate<T> | null {
    if (!candidates?.length) return null;
    return [...candidates].sort((left, right) => {
      const freshness = this.compareFreshness(right.envelope, left.envelope);
      if (freshness !== 0) return freshness;
      return left.slot === "primary" ? -1 : right.slot === "primary" ? 1 : 0;
    })[0];
  }

  private compareFreshness(left: SaveEnvelope<T>, right: SaveEnvelope<T>): number {
    const progress = this.compareProgress(left, right);
    if (progress !== 0) return progress;
    return left.checksum.localeCompare(right.checksum);
  }

  private compareProgress(left: SaveEnvelope<T>, right: SaveEnvelope<T>): number {
    const runEpoch = this.runEpoch(left) - this.runEpoch(right);
    if (runEpoch !== 0) return runEpoch;
    const simTick = left.simTick - right.simTick;
    return simTick !== 0 ? simTick : left.revision - right.revision;
  }

  private runEpoch(envelope: SaveEnvelope<T>): number {
    return Number.isInteger(envelope.runEpoch) && (envelope.runEpoch ?? -1) >= 0
      ? envelope.runEpoch!
      : 0;
  }

  private checkpointRunEpoch(): number {
    return Math.max(
      this.pendingRunEpoch ?? 0,
      this.lastRunEpoch,
      this.minimumRunEpoch,
      0,
    );
  }

  private completeCheckpointWrite(result: CheckpointWriteResult): CheckpointWriteResult {
    if (!result.ok) return result;
    if (!this.cloud || result.entry.kind === "preimport") {
      return { ...result, entry: this.decorateCheckpointEntry(result.entry) };
    }
    const bundle = this.checkpointTimeline.createCloudBundle(this.checkpointRunEpoch());
    if (!bundle.ok) {
      this.reportCheckpointCloudIssue({
        code: "cloud-write-failed",
        slot: "cloud",
        error: { reason: bundle.reason, issues: bundle.issues },
      });
      return {
        ...result,
        issues: [...result.issues, ...bundle.issues],
        entry: this.decorateCheckpointEntry(result.entry),
      };
    }
    this.markCheckpointSnapshot(bundle.snapshot, "pending");
    this.scheduleCheckpointCloudWrite(bundle.snapshot);
    return {
      ...result,
      issues: [...result.issues, ...bundle.issues],
      entry: this.decorateCheckpointEntry(result.entry),
    };
  }

  private decorateCheckpointEntry(entry: CheckpointTimelineEntry): CheckpointTimelineEntry {
    const state = this.checkpointCloudState.get(entry.slotId);
    return {
      ...entry,
      cloudDurability: state?.recordChecksum === entry.recordChecksum
        ? state.durability
        : "local-only",
    };
  }

  private markCheckpointSnapshot(
    snapshot: CheckpointCloudBundleSnapshot,
    durability: CheckpointCloudDurability,
  ): void {
    const current = new Map(
      this.checkpointTimeline.list().entries.map((entry) => [entry.slotId, entry]),
    );
    for (const [slotId, recordChecksum] of Object.entries(snapshot.slotChecksums)) {
      const cloudSlotId = slotId as CloudCheckpointSlotId;
      if (
        typeof recordChecksum === "string" &&
        current.get(cloudSlotId)?.recordChecksum === recordChecksum
      ) {
        this.checkpointCloudState.set(cloudSlotId, { recordChecksum, durability });
      }
    }
  }

  private setCheckpointStatusesFromCloud(
    slotChecksums: Partial<Record<CloudCheckpointSlotId, string>>,
  ): void {
    this.checkpointCloudState.clear();
    for (const entry of this.checkpointTimeline.list().entries) {
      if (entry.kind === "preimport") continue;
      const recordChecksum = slotChecksums[entry.slotId as CloudCheckpointSlotId];
      this.checkpointCloudState.set(entry.slotId, {
        recordChecksum: entry.recordChecksum,
        durability: recordChecksum === entry.recordChecksum ? "synced" : "local-only",
      });
    }
  }

  private scheduleCheckpointCloudWrite(snapshot: CheckpointCloudBundleSnapshot): void {
    this.enqueueCloud(async () => {
      try {
        const remoteItems = await this.cloud?.getItems([this.checkpointCloudKey]);
        if (remoteItems === null || remoteItems === undefined) {
          this.markCheckpointSnapshot(snapshot, "local-only");
          this.reportCheckpointCloudIssue({ code: "cloud-write-failed", slot: "cloud" });
          return;
        }
        const remoteRaw = remoteItems[this.checkpointCloudKey] || null;
        const combined = this.checkpointTimeline.combineCloudBundles(
          snapshot.raw,
          remoteRaw,
        );
        if (!combined.ok) {
          this.markCheckpointSnapshot(snapshot, "local-only");
          this.reportCheckpointCloudIssue({
            code: combined.reason === "newer-remote-run"
              ? "cloud-conflict"
              : "cloud-write-failed",
            slot: "cloud",
            error: { reason: combined.reason, issues: combined.issues },
          });
          return;
        }
        const written = await this.cloud?.setItems({
          [this.checkpointCloudKey]: combined.snapshot.raw,
        });
        if (written === false) {
          this.markCheckpointSnapshot(snapshot, "local-only");
          this.reportCheckpointCloudIssue({ code: "cloud-write-failed", slot: "cloud" });
          return;
        }
        this.latestCheckpointCloudIssue = null;
        this.markCheckpointSnapshot(combined.snapshot, "synced");
      } catch (error) {
        this.markCheckpointSnapshot(snapshot, "local-only");
        this.reportCheckpointCloudIssue({
          code: "cloud-write-failed",
          slot: "cloud",
          error,
        });
      }
    });
  }

  private async refreshCheckpointTimelineFromCloud(
    activeEnvelope: SaveEnvelope<T>,
    issues: RepositoryIssue[],
    expectedGeneration: number,
  ): Promise<void> {
    let items: Readonly<Record<string, string>> | null | undefined;
    try {
      items = await this.cloud?.getItems([this.checkpointCloudKey]);
    } catch (error) {
      const issue: RepositoryIssue = { code: "cloud-read-failed", slot: "cloud", error };
      issues.push(issue);
      this.checkpointCloudState.clear();
      this.reportCheckpointCloudIssue(issue);
      return;
    }
    if (expectedGeneration !== this.localGeneration) return;
    if (items === null || items === undefined) {
      const issue: RepositoryIssue = { code: "cloud-unavailable", slot: "cloud" };
      issues.push(issue);
      this.checkpointCloudState.clear();
      this.reportCheckpointCloudIssue(issue);
      return;
    }
    const raw = items[this.checkpointCloudKey];
    if (!raw) {
      this.checkpointCloudState.clear();
      this.latestCheckpointCloudIssue = null;
      return;
    }
    const imported = this.checkpointTimeline.importCloudBundle(
      raw,
      this.runEpoch(activeEnvelope),
    );
    if (!imported.ok) {
      const issue: RepositoryIssue = {
        code: imported.reason === "storage-error"
          ? "storage-write-failed"
          : "cloud-read-failed",
        slot: "cloud",
        error: { reason: imported.reason, issues: imported.issues },
      };
      issues.push(issue);
      this.checkpointCloudState.clear();
      this.reportCheckpointCloudIssue(issue);
      return;
    }
    if (imported.status === "ignored-run") {
      this.checkpointCloudState.clear();
      this.latestCheckpointCloudIssue = null;
      return;
    }
    this.setCheckpointStatusesFromCloud(imported.slotChecksums);
    this.latestCheckpointCloudIssue = null;
  }

  private safeGet(key: string, issues: RepositoryIssue[], slot: SaveSlot): string | null {
    try {
      return this.kv.getItem(key);
    } catch (error) {
      issues.push({ code: "storage-read-failed", slot, error });
      return null;
    }
  }

  private safeSet(
    key: string,
    value: string,
    issues: RepositoryIssue[],
    slot: SaveSlot,
  ): boolean {
    try {
      this.kv.setItem(key, value);
      return true;
    } catch (error) {
      issues.push({ code: "storage-write-failed", slot, error });
      return false;
    }
  }

  private safeRemove(key: string, issues: RepositoryIssue[], slot: SaveSlot): boolean {
    try {
      this.kv.removeItem(key);
      return true;
    } catch (error) {
      issues.push({ code: "storage-remove-failed", slot, error });
      return false;
    }
  }

  private scheduleCloudWrite(
    items: Readonly<Record<string, string>>,
    outgoing: SaveEnvelope<T>,
  ): void {
    this.enqueueCloud(async () => {
      const remoteItems = await this.cloud?.getItems([this.key, this.backupKey]);
      if (remoteItems === null || remoteItems === undefined) {
        this.reportCloudIssue({ code: "cloud-write-failed", slot: "cloud" });
        return;
      }
      const remoteCandidates: Candidate<T>[] = [];
      for (const key of [this.key, this.backupKey]) {
        const raw = remoteItems[key];
        if (!raw) continue;
        const parsed = this.parse(raw);
        if (parsed.ok) remoteCandidates.push({ slot: "cloud", raw, envelope: parsed.envelope });
      }
      const freshestRemote = this.bestCandidate(remoteCandidates);
      if (
        freshestRemote &&
        (this.compareProgress(freshestRemote.envelope, outgoing) > 0 ||
          (this.compareProgress(freshestRemote.envelope, outgoing) === 0 &&
            freshestRemote.envelope.checksum !== outgoing.checksum))
      ) {
        this.reportCloudIssue({ code: "cloud-conflict", slot: "cloud" });
        return;
      }
      const result = await this.cloud?.setItems(items);
      if (result === false) this.reportCloudIssue({ code: "cloud-write-failed", slot: "cloud" });
      else this.latestCloudIssue = null;
    });
  }

  private scheduleCloudClear(keys: readonly string[]): void {
    this.enqueueCloud(async () => {
      const result = this.cloud?.removeItems
        ? await this.cloud.removeItems(keys)
        : await this.cloud?.setItems(Object.fromEntries(keys.map((key) => [key, ""])));
      if (result === false) this.reportCloudIssue({ code: "cloud-write-failed", slot: "cloud" });
      else this.latestCloudIssue = null;
    });
  }

  private enqueueCloud(job: () => Promise<void>): void {
    this.cloudPending += 1;
    const execution = this.cloudTail.then(job);
    this.cloudTail = execution
      .catch((error: unknown) => {
        this.reportCloudIssue({ code: "cloud-write-failed", slot: "cloud", error });
      })
      .finally(() => {
        this.cloudPending = Math.max(0, this.cloudPending - 1);
      });
  }

  private reportCloudIssue(issue: RepositoryIssue): void {
    this.latestCloudIssue = issue;
    try {
      this.onCloudIssue?.(issue);
    } catch {
      // Observability callbacks cannot compromise local persistence.
    }
  }

  private reportCheckpointCloudIssue(issue: RepositoryIssue): void {
    this.latestCheckpointCloudIssue = issue;
    try {
      this.onCloudIssue?.(issue);
    } catch {
      // Observability callbacks cannot compromise local persistence.
    }
  }
}

export function createSaveRepository<T>(
  options: SaveRepositoryOptions<T>,
): SaveRepository<T> {
  return new SaveRepository(options);
}
