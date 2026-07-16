export const PREDATOR_BLOCKED_RECOVERY_MILLISECONDS = 350;

export type PredatorContactTransaction =
  | Readonly<{ phase: "idle" }>
  | Readonly<{ phase: "windup"; startedAt: number }>
  | Readonly<{ phase: "blocked-recovery"; retryAt: number }>
  | Readonly<{ phase: "triggered" }>;

export type PredatorContactStep = Readonly<{
  transaction: PredatorContactTransaction;
  shouldCommit: boolean;
}>;

export const IDLE_PREDATOR_CONTACT: PredatorContactTransaction = {
  phase: "idle",
};

/**
 * Pure renderer-side anticipation state. Warning policy intentionally lives
 * outside it: a player may hear a predator through cover, but an attack may
 * only advance while the shared physical contact sweep is clear.
 */
export function advancePredatorContactTransaction(
  current: PredatorContactTransaction,
  input: Readonly<{
    now: number;
    withinContactRange: boolean;
    fullyRetreated: boolean;
    contactClear: boolean;
    windupMilliseconds: number;
  }>,
): PredatorContactStep {
  if (input.fullyRetreated) {
    return { transaction: IDLE_PREDATOR_CONTACT, shouldCommit: false };
  }
  if (current.phase === "triggered") {
    return { transaction: current, shouldCommit: false };
  }
  if (!input.withinContactRange) {
    return { transaction: IDLE_PREDATOR_CONTACT, shouldCommit: false };
  }
  if (
    current.phase === "blocked-recovery" &&
    input.now < current.retryAt
  ) {
    return { transaction: current, shouldCommit: false };
  }
  if (!input.contactClear) {
    return {
      transaction: {
        phase: "blocked-recovery",
        retryAt: input.now + PREDATOR_BLOCKED_RECOVERY_MILLISECONDS,
      },
      shouldCommit: false,
    };
  }
  if (current.phase !== "windup") {
    return {
      transaction: { phase: "windup", startedAt: input.now },
      shouldCommit: false,
    };
  }
  if (input.now - current.startedAt < input.windupMilliseconds) {
    return { transaction: current, shouldCommit: false };
  }
  return {
    // The simulation endpoint still owns the commit. Keep windup pending until
    // its synchronous receipt confirms that damage/event truth was written.
    transaction: current,
    shouldCommit: true,
  };
}

export function settlePredatorContactCommit(
  accepted: boolean,
  now: number,
): PredatorContactTransaction {
  return accepted
    ? { phase: "triggered" }
    : {
        phase: "blocked-recovery",
        retryAt: now + PREDATOR_BLOCKED_RECOVERY_MILLISECONDS,
      };
}
