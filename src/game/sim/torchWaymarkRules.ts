import { TORCH_MAX_BURN_SECONDS } from "./lifecycle";
import type { PlacedStructureState } from "./types";

export const TORCH_WAYMARK_MAX_FUEL_SLOTS = 2;
export const TORCH_WAYMARK_INSERT_SECONDS = 3;
export const TORCH_WAYMARK_RELIGHT_SECONDS = 2;
export const TORCH_WAYMARK_TOP_UP_SECONDS = 3;

export type TorchWaymarkUseOperation =
  | "insert-torch-waymark"
  | "relight-torch-waymark"
  | "top-up-torch-waymark"
  | "fuel-slots-full";

export interface NormalizedTorchWaymarkState {
  torchFuelQueueSeconds: number[];
  lit: boolean;
  everLit: boolean;
  lastAdvancedTick: number;
}

export interface TorchWaymarkAdvanceResult {
  torchFuelQueueSeconds: number[];
  lit: boolean;
  consumedSeconds: number;
  extinguished: boolean;
  extinguishReason: "rain-exposed" | "fuel-exhausted" | null;
}

function finiteTick(value: unknown, currentTick: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return currentTick;
  }
  return Math.min(currentTick, Math.floor(value));
}

/**
 * Fuel is an ownership boundary, not a display estimate. A malformed queue is
 * rejected as a whole so migration can never manufacture a usable fraction of
 * a corrupt torch payload. Valid arrays are always copied.
 */
export function normalizeTorchWaymarkFuelQueue(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    value.length > TORCH_WAYMARK_MAX_FUEL_SLOTS ||
    value.some(
      (fuel) =>
        typeof fuel !== "number" ||
        !Number.isFinite(fuel) ||
        fuel <= 0 ||
        fuel > TORCH_MAX_BURN_SECONDS,
    )
  ) {
    return [];
  }
  return value.map((fuel) => fuel as number);
}

export function normalizeTorchWaymarkState(
  structure: Pick<
    PlacedStructureState,
    "torchFuelQueueSeconds" | "lit" | "everLit" | "lastAdvancedTick"
  >,
  currentTick: number,
): NormalizedTorchWaymarkState {
  const safeCurrentTick =
    Number.isFinite(currentTick) && currentTick >= 0
      ? Math.floor(currentTick)
      : 0;
  const torchFuelQueueSeconds = normalizeTorchWaymarkFuelQueue(
    structure.torchFuelQueueSeconds,
  );
  const lit = torchFuelQueueSeconds.length > 0 && structure.lit === true;
  return {
    torchFuelQueueSeconds,
    lit,
    everLit: structure.everLit === true || lit,
    lastAdvancedTick: finiteTick(
      structure.lastAdvancedTick,
      safeCurrentTick,
    ),
  };
}

export function torchWaymarkTotalFuelSeconds(
  structure: Pick<PlacedStructureState, "torchFuelQueueSeconds">,
): number {
  return normalizeTorchWaymarkFuelQueue(structure.torchFuelQueueSeconds).reduce(
    (total, fuel) => total + fuel,
    0,
  );
}

/** State-only operation identity used by both preflight and settlement. */
export function classifyTorchWaymarkUseOperation(
  structure: Pick<PlacedStructureState, "torchFuelQueueSeconds" | "lit">,
): TorchWaymarkUseOperation {
  const queue = normalizeTorchWaymarkFuelQueue(
    structure.torchFuelQueueSeconds,
  );
  if (queue.length === 0) return "insert-torch-waymark";
  if (structure.lit !== true) return "relight-torch-waymark";
  return queue.length < TORCH_WAYMARK_MAX_FUEL_SLOTS
    ? "top-up-torch-waymark"
    : "fuel-slots-full";
}

export function torchWaymarkOperationSeconds(
  operation: TorchWaymarkUseOperation,
): number | null {
  if (operation === "insert-torch-waymark") {
    return TORCH_WAYMARK_INSERT_SECONDS;
  }
  if (operation === "relight-torch-waymark") {
    return TORCH_WAYMARK_RELIGHT_SECONDS;
  }
  if (operation === "top-up-torch-waymark") {
    return TORCH_WAYMARK_TOP_UP_SECONDS;
  }
  return null;
}

/**
 * Advances exact FIFO fuel. The caller supplies the shared campfire ignition
 * verdict so the heavy-rain threshold has one authority across both systems.
 */
export function advanceTorchWaymarkFuel(input: {
  torchFuelQueueSeconds: unknown;
  lit: boolean;
  elapsedSeconds: number;
  rainIntensity: number;
  sheltered: boolean;
  ignitionAllowed: boolean;
}): TorchWaymarkAdvanceResult {
  const queue = normalizeTorchWaymarkFuelQueue(
    input.torchFuelQueueSeconds,
  );
  const lit = input.lit === true && queue.length > 0;
  if (!lit) {
    return {
      torchFuelQueueSeconds: queue,
      lit: false,
      consumedSeconds: 0,
      extinguished: false,
      extinguishReason: null,
    };
  }
  if (input.ignitionAllowed !== true) {
    return {
      torchFuelQueueSeconds: queue,
      lit: false,
      consumedSeconds: 0,
      extinguished: true,
      extinguishReason: "rain-exposed",
    };
  }

  const elapsedSeconds =
    Number.isFinite(input.elapsedSeconds) && input.elapsedSeconds > 0
      ? input.elapsedSeconds
      : 0;
  if (elapsedSeconds <= 0) {
    return {
      torchFuelQueueSeconds: queue,
      lit: true,
      consumedSeconds: 0,
      extinguished: false,
      extinguishReason: null,
    };
  }
  const rainIntensity = Number.isFinite(input.rainIntensity)
    ? Math.max(0, Math.min(1, input.rainIntensity))
    : 1;
  const effectiveRain = input.sheltered
    ? rainIntensity * 0.2
    : rainIntensity;
  let remainingCost = elapsedSeconds * (1 + effectiveRain * 0.65);
  const requestedCost = remainingCost;
  while (remainingCost > 0 && queue.length > 0) {
    if (queue[0] <= remainingCost + Number.EPSILON) {
      remainingCost -= queue[0];
      queue.shift();
      continue;
    }
    queue[0] -= remainingCost;
    remainingCost = 0;
  }
  const consumedSeconds = requestedCost - Math.max(0, remainingCost);
  const stillLit = queue.length > 0;
  return {
    torchFuelQueueSeconds: queue,
    lit: stillLit,
    consumedSeconds,
    extinguished: !stillLit,
    extinguishReason: stillLit ? null : "fuel-exhausted",
  };
}
