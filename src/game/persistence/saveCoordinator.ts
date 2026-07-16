import type { SaveCheckpoint, SaveRepository } from "./saveRepository";
import type { KVStorageDurability } from "./kv";

export type SaveReason =
  | "manual"
  | "new-game"
  | "rest-before"
  | "rest-after"
  | "task"
  | "milestone"
  | "periodic"
  | "hidden"
  | "page-exit"
  | "import"
  | "checkpoint";

export type SavePhase =
  | "idle"
  | "saving"
  | "saved-local"
  | "saved-cloud"
  | "cloud-failed"
  | "failed";

export interface SaveStatus {
  phase: SavePhase;
  reason: SaveReason | null;
  revision?: number;
  savedAt?: number;
  localDurability?: KVStorageDurability;
}

export const INITIAL_SAVE_STATUS: SaveStatus = {
  phase: "idle",
  reason: null,
};

export interface SaveCoordinatorOptions {
  onStatus?: (status: SaveStatus) => void;
  now?: () => number;
}

/**
 * Orchestrates local-first saves without allowing an older async completion to
 * replace the status of a newer checkpoint. SaveRepository performs the local
 * write before scheduling its ordered cloud queue; this class makes that
 * contract visible to the UI.
 */
export class SaveCoordinator<T> {
  private readonly repository: SaveRepository<T>;
  private readonly onStatus?: (status: SaveStatus) => void;
  private readonly now: () => number;
  private requestId = 0;
  private status: SaveStatus = INITIAL_SAVE_STATUS;
  private readonly highestTickBySeed = new Map<string, number>();
  /**
   * Presentation settlement is deliberately separate from repository I/O.
   * Keep it observable so tests, shutdown flows and explicit retry UI can wait
   * for both the cloud queue and the status publication instead of racing the
   * fire-and-forget continuation by one or more microtasks.
   */
  private cloudCompletionTail: Promise<void> = Promise.resolve();

  constructor(repository: SaveRepository<T>, options: SaveCoordinatorOptions = {}) {
    this.repository = repository;
    this.onStatus = options.onStatus;
    this.now = options.now ?? Date.now;
  }

  getStatus(): SaveStatus {
    return this.status;
  }

  async save(payload: T, checkpoint: SaveCheckpoint, reason: SaveReason): Promise<SaveStatus> {
    const seedKey = String(checkpoint.seed);
    const highestTick = this.highestTickBySeed.get(seedKey) ?? -1;
    if (checkpoint.simTick < highestTick) return this.status;
    this.highestTickBySeed.set(seedKey, checkpoint.simTick);

    const requestId = ++this.requestId;
    this.publish({ phase: "saving", reason });
    const result = await this.repository.save(payload, checkpoint);
    if (requestId !== this.requestId) return this.status;
    if (!result.ok) {
      return this.publish({ phase: "failed", reason });
    }

    const localStatus = this.publish({
      phase: "saved-local",
      reason,
      revision: result.envelope.revision,
      savedAt: this.now(),
      localDurability: result.localDurability,
    });
    if (!result.cloudScheduled) return localStatus;

    // A player-facing local save must resolve as soon as the verified local
    // write is durable. Toy cloud storage is an independent, best-effort
    // follow-up: waiting for the host here used to leave manual saves and
    // portable exports stuck behind an unavailable/slow SDK.
    this.trackCheckpointCloudCompletion(requestId, localStatus);
    return localStatus;
  }

  /** Replaces the current run through the repository's rollback-safe import path. */
  async replaceFromImport(payload: T, checkpoint: SaveCheckpoint): Promise<SaveStatus> {
    this.highestTickBySeed.clear();
    const requestId = ++this.requestId;
    const reason: SaveReason = "import";
    this.publish({ phase: "saving", reason });
    const result = await this.repository.replaceFromImport(payload, checkpoint);
    if (requestId !== this.requestId) return this.status;
    if (!result.ok) return this.publish({ phase: "failed", reason });

    this.highestTickBySeed.set(String(checkpoint.seed), checkpoint.simTick);
    const localStatus = this.publish({
      phase: "saved-local",
      reason,
      revision: result.envelope.revision,
      savedAt: this.now(),
      localDurability: result.localDurability,
    });
    if (!result.cloudScheduled) return localStatus;
    this.trackCheckpointCloudCompletion(requestId, localStatus);
    return localStatus;
  }

  /** Promotes a verified timeline slot while preserving the import rollback slot. */
  async replaceFromCheckpoint(payload: T, checkpoint: SaveCheckpoint): Promise<SaveStatus> {
    this.highestTickBySeed.clear();
    const requestId = ++this.requestId;
    const reason: SaveReason = "checkpoint";
    this.publish({ phase: "saving", reason });
    const result = await this.repository.replaceFromCheckpoint(payload, checkpoint);
    if (requestId !== this.requestId) return this.status;
    if (!result.ok) return this.publish({ phase: "failed", reason });

    this.highestTickBySeed.set(String(checkpoint.seed), checkpoint.simTick);
    const localStatus = this.publish({
      phase: "saved-local",
      reason,
      revision: result.envelope.revision,
      savedAt: this.now(),
      localDurability: result.localDurability,
    });
    if (!result.cloudScheduled) return localStatus;
    this.trackCheckpointCloudCompletion(requestId, localStatus);
    return localStatus;
  }

  /**
   * Waits for repository transport and the matching player-facing status.
   * Local-first save calls never use this path; it is only for callers that
   * explicitly need a settled cloud outcome.
   */
  async whenCloudIdle(): Promise<SaveStatus> {
    for (;;) {
      const completion = this.cloudCompletionTail;
      await this.repository.whenCloudIdle();
      await completion;
      if (
        completion === this.cloudCompletionTail &&
        this.repository.getCloudStatus() !== "pending"
      ) {
        return this.status;
      }
    }
  }

  /** Invalidates status completions from a run that is about to be erased. */
  beginNewRun(): void {
    this.requestId += 1;
    this.highestTickBySeed.clear();
    this.publish(INITIAL_SAVE_STATUS);
  }

  private async publishCheckpointCloudCompletion(
    requestId: number,
    localStatus: SaveStatus,
  ): Promise<void> {
    await this.repository.whenCloudIdle();
    if (requestId !== this.requestId) return;
    this.publish({
      ...localStatus,
      phase: this.repository.getCloudStatus() === "failed"
        ? "cloud-failed"
        : "saved-cloud",
    });
  }

  private trackCheckpointCloudCompletion(
    requestId: number,
    localStatus: SaveStatus,
  ): void {
    const completion = this.publishCheckpointCloudCompletion(
      requestId,
      localStatus,
    );
    this.cloudCompletionTail = Promise.allSettled([
      this.cloudCompletionTail,
      completion,
    ]).then(() => undefined);
  }

  private publish(status: SaveStatus): SaveStatus {
    this.status = status;
    try {
      this.onStatus?.(status);
    } catch {
      // Save durability cannot depend on presentation callbacks.
    }
    return status;
  }
}

type AutosaveEvent = {
  type: string;
  details?: Readonly<Record<string, string | number | boolean>>;
};

/** Returns one checkpoint reason for a batch, ordered by player expectation. */
export function autosaveReasonForEvents(events: readonly AutosaveEvent[]): SaveReason | null {
  if (events.some((event) => event.type === "rest-completed")) return "rest-after";
  if (events.some((event) => event.type === "task-completed")) return "task";
  if (
    events.some(
      (event) =>
        event.type === "game-won" ||
        event.type === "sandbox-continued" ||
        event.type === "campaign-fact-recorded" ||
        event.type === "radio-message-received" ||
        (event.type === "landmark-inspected" &&
          event.details?.createsMilestone !== false) ||
        event.type === "wildlife-defeated" ||
        event.type === "wildlife-loot-collected" ||
        event.type === "structure-fuel-added" ||
        event.type === "structure-dismantled" ||
        (event.type === "structure-output-collected" &&
          event.details?.itemId === "clean-water") ||
        (event.type === "resource-picked" && event.details?.itemId === "battery") ||
        (event.type === "craft-succeeded" &&
          [
            "campfire",
            "shelter",
            "bed",
            "radio-beacon",
            "smoking-rack",
            "rain-collector",
            "torch-waymark",
          ].includes(
            String(event.details?.recipeId ?? ""),
          )),
    )
  ) {
    return "milestone";
  }
  return null;
}

export function saveStatusLabel(status: SaveStatus): string {
  switch (status.phase) {
    case "saving":
      return "保存中…";
    case "saved-local":
      return status.localDurability === "ephemeral"
        ? "浏览器本地存储不可用 · 正在同步 Toy 云端"
        : "已保存到本机 · 正在同步云端";
    case "saved-cloud":
      return "已保存 · Toy 云端已同步";
    case "cloud-failed":
      return status.localDurability === "ephemeral"
        ? "未能持久保存 · 请立即导出存档文件"
        : "本地已保存 · 云同步失败，待重试";
    case "failed":
      return "保存失败 · 请检查浏览器存储权限";
    default:
      return "尚未保存";
  }
}
