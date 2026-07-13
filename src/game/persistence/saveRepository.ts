import type { CloudKV } from "./cloud";
import { createDefaultKV, type KVStore } from "./kv";
import {
  createSaveEnvelope,
  parseSaveEnvelope,
  serializeSaveEnvelope,
  type EnvelopeFailureReason,
  type SaveEnvelope,
  type SaveSeed,
} from "./saveEnvelope";

export const DEFAULT_SAVE_KEY = "green_hell_save_v2";

export type SaveSlot = "primary" | "backup" | "corrupt" | "cloud";

export type RepositoryIssueCode =
  | "storage-read-failed"
  | "storage-write-failed"
  | "storage-remove-failed"
  | "envelope-invalid"
  | "cloud-unavailable"
  | "cloud-read-failed"
  | "cloud-write-failed";

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
  device: string;
  kv?: KVStore;
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

interface Candidate<T> {
  slot: "primary" | "backup" | "cloud";
  raw: string;
  envelope: SaveEnvelope<T>;
}

export class SaveRepository<T> {
  readonly key: string;
  readonly backupKey: string;
  readonly corruptKey: string;

  private readonly schema: number;
  private readonly content: string;
  private readonly device: string;
  private readonly kv: KVStore;
  private readonly cloud?: CloudKV;
  private readonly payloadValidator?: SaveRepositoryOptions<T>["payloadValidator"];
  private readonly onCloudIssue?: SaveRepositoryOptions<T>["onCloudIssue"];
  private cloudTail: Promise<void> = Promise.resolve();
  private localGeneration = 0;
  private lastRevision = 0;
  private latestCloudIssue: RepositoryIssue | null = null;

  constructor(options: SaveRepositoryOptions<T>) {
    if (!Number.isInteger(options.schema) || options.schema < 0) {
      throw new TypeError("schema must be an unsigned integer");
    }
    if (!options.content) throw new TypeError("content must be non-empty");
    if (!options.device) throw new TypeError("device must be non-empty");

    this.key = options.key || DEFAULT_SAVE_KEY;
    this.backupKey = `${this.key}.backup`;
    this.corruptKey = `${this.key}.corrupt`;
    this.schema = options.schema;
    this.content = options.content;
    this.device = options.device;
    this.kv = options.kv ?? createDefaultKV();
    this.cloud = options.cloud;
    this.payloadValidator = options.payloadValidator;
    this.onCloudIssue = options.onCloudIssue;
  }

  async load(options: { allowCloudFallback?: boolean } = {}): Promise<LoadResult<T>> {
    const generation = this.localGeneration;
    const issues: RepositoryIssue[] = [];
    const local = this.readLocalCandidates(issues, true);
    const bestLocal = this.bestCandidate(local);
    if (bestLocal) {
      this.lastRevision = Math.max(this.lastRevision, bestLocal.envelope.revision);
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
      const cloud = await this.readCloudCandidates(issues);
      if (generation !== this.localGeneration) {
        return { ok: false, reason: "not-found", issues };
      }
      const bestCloud = this.bestCandidate(cloud);
      if (bestCloud) {
        if (!this.safeSet(this.key, bestCloud.raw, issues, "primary")) {
          return { ok: false, reason: "unavailable", issues };
        }
        this.lastRevision = Math.max(this.lastRevision, bestCloud.envelope.revision);
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
    const local = this.readLocalCandidates(issues, true);
    if (issues.some((issue) => issue.code === "storage-read-failed")) {
      return { ok: false, reason: "storage-error", issues };
    }
    const bestLocal = this.bestCandidate(local);
    const revision =
      Math.max(this.lastRevision, ...local.map((item) => item.envelope.revision), 0) + 1;

    let envelope: SaveEnvelope<T>;
    let raw: string;
    try {
      envelope = createSaveEnvelope({
        schema: this.schema,
        content: this.content,
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
    if (this.cloud) {
      const items: Record<string, string> = { [this.key]: raw };
      if (bestLocal) items[this.backupKey] = bestLocal.raw;
      this.scheduleCloudWrite(items);
    }
    return {
      ok: true,
      envelope,
      cloudScheduled: Boolean(this.cloud),
      issues,
    };
  }

  async clear(): Promise<ClearResult> {
    this.localGeneration += 1;
    const issues: RepositoryIssue[] = [];
    let localCleared = true;
    for (const [key, slot] of [
      [this.key, "primary"],
      [this.backupKey, "backup"],
      [this.corruptKey, "corrupt"],
    ] as const) {
      if (!this.safeRemove(key, issues, slot)) localCleared = false;
    }

    if (localCleared) {
      this.lastRevision = 0;
      if (this.cloud) this.scheduleCloudClear([this.key, this.backupKey]);
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

    const cloud = await this.readCloudCandidates(issues);
    if (generation !== this.localGeneration) return { status: "not-found", issues };
    if (cloud === null) return { status: "unavailable", issues };
    const bestCloud = this.bestCandidate(cloud);
    if (!bestCloud) return { status: "not-found", issues };

    const local = this.readLocalCandidates(issues, true);
    const bestLocal = this.bestCandidate(local);
    if (bestLocal && bestLocal.envelope.revision >= bestCloud.envelope.revision) {
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
    return { status: "updated", envelope: bestCloud.envelope, issues };
  }

  /** Wait only when a caller explicitly needs cloud durability (tests, shutdown, status UI). */
  async whenCloudIdle(): Promise<void> {
    await this.cloudTail;
  }

  getLastCloudIssue(): RepositoryIssue | null {
    return this.latestCloudIssue;
  }

  private readLocalCandidates(
    issues: RepositoryIssue[],
    quarantineInvalid: boolean,
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
        candidates.push({ slot, raw, envelope: parsed.envelope });
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
        candidates.push({ slot: "cloud", raw, envelope: parsed.envelope });
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
      content: this.content,
      payloadValidator: this.payloadValidator,
    });
  }

  private bestCandidate(candidates: Candidate<T>[] | null): Candidate<T> | null {
    if (!candidates?.length) return null;
    return [...candidates].sort((left, right) => {
      const revision = right.envelope.revision - left.envelope.revision;
      if (revision !== 0) return revision;
      return left.slot === "primary" ? -1 : right.slot === "primary" ? 1 : 0;
    })[0];
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

  private scheduleCloudWrite(items: Readonly<Record<string, string>>): void {
    this.enqueueCloud(async () => {
      const result = await this.cloud?.setItems(items);
      if (result === false) this.reportCloudIssue({ code: "cloud-write-failed", slot: "cloud" });
    });
  }

  private scheduleCloudClear(keys: readonly string[]): void {
    this.enqueueCloud(async () => {
      const result = this.cloud?.removeItems
        ? await this.cloud.removeItems(keys)
        : await this.cloud?.setItems(Object.fromEntries(keys.map((key) => [key, ""])));
      if (result === false) this.reportCloudIssue({ code: "cloud-write-failed", slot: "cloud" });
    });
  }

  private enqueueCloud(job: () => Promise<void>): void {
    const execution = this.cloudTail.then(job);
    this.cloudTail = execution.catch((error: unknown) => {
      this.reportCloudIssue({ code: "cloud-write-failed", slot: "cloud", error });
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
}

export function createSaveRepository<T>(
  options: SaveRepositoryOptions<T>,
): SaveRepository<T> {
  return new SaveRepository(options);
}
