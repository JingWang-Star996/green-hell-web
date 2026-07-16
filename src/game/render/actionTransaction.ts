import type { ActionPhase, InteractionTarget } from "./types";
import {
  hitPoseWithinWindupTolerance,
  hitProfileFor,
  isPhysicalActionId,
  shortestAngleDelta,
} from "../world/hitGeometry";

export type ActionInterruptReason = NonNullable<ActionPhase["interruptReason"]>;

export type ActionTiming = {
  windupMs: number;
  hitWindowMs: number;
  recoveryMs: number;
  interruptedMs: number;
};

export type ActionTransaction = {
  phase: ActionPhase["phase"];
  targetId: string;
  actionId: string;
  animationKey: string;
  targetLabel: string;
  verb: string;
  elapsedMs: number;
  timing: ActionTiming;
  boundTarget: InteractionTarget;
  startPose: ActionStartPose;
  interruptReason?: ActionInterruptReason;
};

export type ActionStartPose = Readonly<{
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}>;

export type ActionTransactionStep = {
  transaction: ActionTransaction | null;
  shouldCommit: boolean;
  commitTarget: InteractionTarget | null;
};

const TOOL_TIMING: ActionTiming = {
  windupMs: 170,
  hitWindowMs: 70,
  recoveryMs: 180,
  interruptedMs: 520,
};

const WEAPON_TIMING: ActionTiming = {
  windupMs: 160,
  hitWindowMs: 70,
  recoveryMs: 210,
  interruptedMs: 520,
};

const PICKUP_TIMING: ActionTiming = {
  windupMs: 80,
  hitWindowMs: 40,
  recoveryMs: 120,
  interruptedMs: 420,
};

const HAND_TIMING: ActionTiming = {
  windupMs: 110,
  hitWindowMs: 50,
  recoveryMs: 140,
  interruptedMs: 460,
};

const DEFAULT_TIMING: ActionTiming = {
  windupMs: 90,
  hitWindowMs: 40,
  recoveryMs: 120,
  interruptedMs: 420,
};

export function actionTimingFor(animationKey: string): ActionTiming {
  if (animationKey.startsWith("weapon.")) return WEAPON_TIMING;
  if (animationKey.startsWith("tool.")) return TOOL_TIMING;
  if (animationKey === "hand.pickup") return PICKUP_TIMING;
  if (animationKey.startsWith("hand.")) return HAND_TIMING;
  return DEFAULT_TIMING;
}

export function isExecutableActionTarget(
  target: InteractionTarget | null,
): target is InteractionTarget {
  if (!target) return false;
  return (
    target.affordance.state === "ready" ||
    (target.affordance.state === "danger" &&
      target.affordance.actionId === "attack")
  );
}

export function beginActionTransaction(
  target: InteractionTarget,
  startPose: ActionStartPose = { x: 0, z: 0, yaw: 0, pitch: 0 },
): ActionTransaction | null {
  if (!isExecutableActionTarget(target)) return null;
  return {
    phase: "windup",
    targetId: target.id,
    actionId: target.affordance.actionId,
    animationKey: target.affordance.animationKey,
    targetLabel: target.label,
    verb: target.affordance.verb,
    elapsedMs: 0,
    timing: actionTimingFor(target.affordance.animationKey),
    boundTarget: target,
    startPose: { ...startPose },
  };
}

/** Physical windups remain bound through focus jitter; hand interactions keep focus. */
export function actionTargetStillValid(
  transaction: ActionTransaction,
  currentTarget: InteractionTarget | null,
  currentPose: ActionStartPose = transaction.startPose,
): boolean {
  if (isPhysicalActionId(transaction.actionId)) {
    return hitPoseWithinWindupTolerance(
      transaction.startPose,
      currentPose,
      hitProfileFor(transaction.actionId),
    );
  }
  return Boolean(
    currentTarget &&
      isExecutableActionTarget(currentTarget) &&
      currentTarget.id === transaction.targetId &&
      currentTarget.affordance.actionId === transaction.actionId &&
      currentTarget.affordance.animationKey === transaction.animationKey &&
      currentTarget.distance <= currentTarget.affordance.range,
  );
}

export function actionWindupInterruptReason(
  transaction: ActionTransaction,
  currentTarget: InteractionTarget | null,
  currentPose: ActionStartPose,
): ActionInterruptReason | null {
  if (!isPhysicalActionId(transaction.actionId)) {
    return actionTargetStillValid(transaction, currentTarget, currentPose)
      ? null
      : "target-lost";
  }
  const profile = hitProfileFor(transaction.actionId);
  if (
    Math.hypot(
      currentPose.x - transaction.startPose.x,
      currentPose.z - transaction.startPose.z,
    ) > profile.maximumWindupDrift
  ) {
    return "moved";
  }
  if (
    Math.abs(shortestAngleDelta(transaction.startPose.yaw, currentPose.yaw)) >
    profile.maximumWindupTurnRadians
  ) {
    return "turned";
  }
  if (
    Math.abs(
      shortestAngleDelta(transaction.startPose.pitch, currentPose.pitch),
    ) > profile.maximumWindupPitchRadians
  ) {
    return "aim-lost";
  }
  return null;
}

export function advanceActionTransaction(
  transaction: ActionTransaction,
  deltaMs: number,
  targetValid: boolean,
  invalidReason: ActionInterruptReason = "target-lost",
): ActionTransactionStep {
  const elapsedMs = transaction.elapsedMs + Math.max(0, deltaMs);

  if (transaction.phase === "windup") {
    if (!targetValid) {
      return {
        transaction: interruptedTransaction(transaction, invalidReason),
        shouldCommit: false,
        commitTarget: null,
      };
    }
    if (elapsedMs >= transaction.timing.windupMs) {
      return {
        transaction: {
          ...transaction,
          phase: "hit-window",
          elapsedMs: 0,
        },
        shouldCommit: true,
        commitTarget: transaction.boundTarget,
      };
    }
    return {
      transaction: { ...transaction, elapsedMs },
      shouldCommit: false,
      commitTarget: null,
    };
  }

  if (transaction.phase === "hit-window") {
    if (elapsedMs >= transaction.timing.hitWindowMs) {
      return {
        transaction: {
          ...transaction,
          phase: "recovery",
          elapsedMs: 0,
        },
        shouldCommit: false,
        commitTarget: null,
      };
    }
    return {
      transaction: { ...transaction, elapsedMs },
      shouldCommit: false,
      commitTarget: null,
    };
  }

  if (transaction.phase === "recovery") {
    return {
      transaction:
        elapsedMs >= transaction.timing.recoveryMs
          ? null
          : { ...transaction, elapsedMs },
      shouldCommit: false,
      commitTarget: null,
    };
  }

  return {
    transaction:
      elapsedMs >= transaction.timing.interruptedMs
        ? null
        : { ...transaction, elapsedMs },
    shouldCommit: false,
    commitTarget: null,
  };
}

/** A committed hit is never relabelled as interrupted or rolled back. */
export function interruptActionTransaction(
  transaction: ActionTransaction,
  reason: ActionInterruptReason,
): ActionTransaction | null {
  if (transaction.phase === "windup") {
    return interruptedTransaction(transaction, reason);
  }
  if (transaction.phase === "interrupted") return transaction;
  return null;
}

export function toActionPhase(
  transaction: ActionTransaction | null,
): ActionPhase | null {
  if (!transaction) return null;
  const duration = phaseDuration(transaction);
  return {
    phase: transaction.phase,
    targetId: transaction.targetId,
    targetLabel: transaction.targetLabel,
    verb: transaction.verb,
    progress: clamp01(duration <= 0 ? 1 : transaction.elapsedMs / duration),
    interruptReason: transaction.interruptReason,
  };
}

function interruptedTransaction(
  transaction: ActionTransaction,
  reason: ActionInterruptReason,
): ActionTransaction {
  return {
    ...transaction,
    phase: "interrupted",
    elapsedMs: 0,
    interruptReason: reason,
  };
}

function phaseDuration(transaction: ActionTransaction): number {
  if (transaction.phase === "windup") return transaction.timing.windupMs;
  if (transaction.phase === "hit-window") {
    return transaction.timing.hitWindowMs;
  }
  if (transaction.phase === "recovery") return transaction.timing.recoveryMs;
  return transaction.timing.interruptedMs;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
