import type { CheckpointWriteResult } from "./checkpointTimeline";

export type VerifiedCheckpointBarrierResult<T> =
  | { ok: true; value: T; checkpoint: Extract<CheckpointWriteResult, { ok: true }> }
  | {
      ok: false;
      phase: "checkpoint" | "commit";
      checkpoint?: Extract<CheckpointWriteResult, { ok: false }>;
      error?: unknown;
    };

type SuccessfulCheckpoint = Extract<CheckpointWriteResult, { ok: true }>;
type FailedCheckpoint = Extract<CheckpointWriteResult, { ok: false }>;

export type VerifiedCheckpointTransactionResult<T> =
  | {
      ok: true;
      value: T;
      beforeCheckpoint: SuccessfulCheckpoint;
      /** Null when the staged command did not complete, for example fatal sleep. */
      afterCheckpoint: SuccessfulCheckpoint | null;
    }
  | {
      ok: false;
      phase: "before-checkpoint" | "stage" | "after-checkpoint" | "commit";
      beforeCheckpoint?: SuccessfulCheckpoint;
      afterCheckpoint?: SuccessfulCheckpoint;
      checkpoint?: FailedCheckpoint;
      error?: unknown;
    };

/**
 * A hard ordering boundary for commands that fast-forward simulation time.
 * The command callback is unreachable until the checkpoint reports that its
 * temp record, target slot, and timeline manifest have all been verified.
 */
export async function runVerifiedCheckpointBarrier<T>(
  writeCheckpoint: () => CheckpointWriteResult,
  commitCommand: () => T,
  yieldBeforeWrite: () => Promise<void> = () => Promise.resolve(),
): Promise<VerifiedCheckpointBarrierResult<T>> {
  try {
    await yieldBeforeWrite();
  } catch (error) {
    return { ok: false, phase: "checkpoint", error };
  }

  let checkpoint: CheckpointWriteResult;
  try {
    checkpoint = writeCheckpoint();
  } catch (error) {
    return { ok: false, phase: "checkpoint", error };
  }
  if (!checkpoint.ok) return { ok: false, phase: "checkpoint", checkpoint };

  try {
    return { ok: true, value: commitCommand(), checkpoint };
  } catch (error) {
    return { ok: false, phase: "commit", error };
  }
}

/**
 * Stages a time-skipping command between two verified local checkpoints and
 * publishes the staged state only after the post-command checkpoint verifies.
 * `writeAfterCheckpoint` may return null only when the staged command itself
 * did not complete (for example, the player died during sleep); that terminal
 * result is still committed while the verified pre-command point remains.
 */
export async function runVerifiedCheckpointTransaction<T>(
  writeBeforeCheckpoint: () => CheckpointWriteResult,
  stageCommand: () => T,
  writeAfterCheckpoint: (staged: T) => CheckpointWriteResult | null,
  commitCommand: (staged: T) => T,
  yieldBeforeWrite: () => Promise<void> = () => Promise.resolve(),
): Promise<VerifiedCheckpointTransactionResult<T>> {
  try {
    await yieldBeforeWrite();
  } catch (error) {
    return { ok: false, phase: "before-checkpoint", error };
  }

  let before: CheckpointWriteResult;
  try {
    before = writeBeforeCheckpoint();
  } catch (error) {
    return { ok: false, phase: "before-checkpoint", error };
  }
  if (!before.ok) {
    return {
      ok: false,
      phase: "before-checkpoint",
      checkpoint: before,
    };
  }

  let staged: T;
  try {
    staged = stageCommand();
  } catch (error) {
    return {
      ok: false,
      phase: "stage",
      beforeCheckpoint: before,
      error,
    };
  }

  let after: CheckpointWriteResult | null;
  try {
    after = writeAfterCheckpoint(staged);
  } catch (error) {
    return {
      ok: false,
      phase: "after-checkpoint",
      beforeCheckpoint: before,
      error,
    };
  }
  if (after && !after.ok) {
    return {
      ok: false,
      phase: "after-checkpoint",
      beforeCheckpoint: before,
      checkpoint: after,
    };
  }

  try {
    return {
      ok: true,
      value: commitCommand(staged),
      beforeCheckpoint: before,
      afterCheckpoint: after,
    };
  } catch (error) {
    return {
      ok: false,
      phase: "commit",
      beforeCheckpoint: before,
      ...(after ? { afterCheckpoint: after } : {}),
      error,
    };
  }
}
