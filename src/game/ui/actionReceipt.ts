import type {
  GameCommand,
  GameEvent,
  GameEventType,
} from "../sim";

export type ActionReceiptTone = "neutral" | "good" | "warning" | "danger";
export type ActionReceiptStatus =
  | "accepted"
  | "rejected"
  | "completed"
  | "interrupted";

export type ActionReceiptEvent = Pick<
  GameEvent,
  "id" | "type" | "message"
> & {
  tone: ActionReceiptTone;
};

export type ActionReceipt = {
  id: string;
  commandType: GameCommand["type"];
  status: ActionReceiptStatus;
  tone: ActionReceiptTone;
  eventRange: {
    fromExclusive: number;
    toInclusive: number;
  };
  primary: ActionReceiptEvent;
  dangerSideEffects: ActionReceiptEvent[];
  createdAtMs: number;
  expiresAtMs: number;
};

export const ACTION_RECEIPT_TTL_MS = {
  normal: 3_400,
  rejected: 4_400,
  danger: 6_200,
} as const;

export const MAX_VISIBLE_ACTION_RECEIPTS = 3;

const DANGER_EVENT_TYPES = new Set<GameEventType>([
  "game-lost",
  "parasite-contracted",
  "snake-bite",
  "food-spoiled",
  "tool-broken",
  "wildlife-attack",
  "structure-process-spoiled",
]);

const WARNING_EVENT_TYPES = new Set<GameEventType>([
  "command-rejected",
  "craft-failed",
  "fire-extinguished",
  "structure-extinguished",
  "weather-changed",
  "tool-damaged",
]);

const GOOD_EVENT_TYPES = new Set<GameEventType>([
  "resource-picked",
  "craft-succeeded",
  "recipe-discovered",
  "landmark-inspected",
  "water-collected",
  "water-purified",
  "wound-treated",
  "parasite-cleared",
  "threat-avoided",
  "rest-completed",
  "fire-lit",
  "fuel-added",
  "item-equipped",
  "item-unequipped",
  "wildlife-defeated",
  "wildlife-loot-collected",
  "structure-loaded",
  "structure-process-completed",
  "structure-output-collected",
  "structure-fuel-added",
  "structure-ignited",
  "task-completed",
  "game-won",
  "sandbox-continued",
]);

const PRIMARY_EVENT_TYPES_BY_COMMAND: Partial<
  Record<GameCommand["type"], readonly GameEventType[]>
> = {
  "pick-up": ["resource-picked"],
  harvest: ["harvest-struck"],
  "physical-action": ["harvest-struck", "wildlife-defeated", "wildlife-hit"],
  "inspect-landmark": ["landmark-inspected"],
  craft: ["craft-succeeded", "fire-lit"],
  "equip-item": ["item-equipped", "item-unequipped"],
  "use-item": ["wound-treated", "parasite-cleared", "item-used"],
  eat: ["item-used"],
  "collect-water": ["water-collected"],
  "collect-rainwater": ["water-collected"],
  "boil-water": ["water-purified"],
  "drink-water": ["water-drunk"],
  "add-fuel": ["fuel-added", "fire-lit"],
  "encounter-hazard": ["threat-avoided", "snake-bite", "wildlife-attack"],
  "attack-wildlife": ["wildlife-defeated", "wildlife-hit"],
  "encounter-wildlife": ["wildlife-attack"],
  "collect-wildlife-loot": ["wildlife-loot-collected"],
  "use-structure": [
    "structure-fuel-added",
    "structure-ignited",
    "structure-output-collected",
    "structure-loaded",
  ],
  rest: ["rest-completed"],
  transmit: ["game-won", "task-completed"],
  "continue-expedition": ["sandbox-continued"],
};

export function actionReceiptTone(event: Pick<GameEvent, "type">): ActionReceiptTone {
  if (DANGER_EVENT_TYPES.has(event.type)) return "danger";
  if (WARNING_EVENT_TYPES.has(event.type)) return "warning";
  if (GOOD_EVENT_TYPES.has(event.type)) return "good";
  return "neutral";
}

function receiptEvent(event: GameEvent): ActionReceiptEvent {
  return {
    id: event.id,
    type: event.type,
    message: event.message,
    tone: actionReceiptTone(event),
  };
}

function findLastEventOfType(
  events: readonly GameEvent[],
  eventType: GameEventType,
): GameEvent | undefined {
  return events.findLast((event) => event.type === eventType);
}

function primaryEventForCommand(
  command: GameCommand,
  events: readonly GameEvent[],
): GameEvent {
  const rejected = events.findLast(
    (event) => event.type === "command-rejected" || event.type === "craft-failed",
  );
  if (rejected) return rejected;

  for (const eventType of PRIMARY_EVENT_TYPES_BY_COMMAND[command.type] ?? []) {
    const event = findLastEventOfType(events, eventType);
    if (event) return event;
  }

  return events.findLast((event) => event.cause.source === "command") ?? events.at(-1)!;
}

function statusForPrimary(
  primary: GameEvent,
  events: readonly GameEvent[],
): ActionReceiptStatus {
  if (events.some((event) => event.type === "game-lost")) {
    return "interrupted";
  }
  if (
    (primary.type === "command-rejected" || primary.type === "craft-failed") &&
    primary.details?.interrupted === true
  ) {
    return "interrupted";
  }
  if (primary.type === "command-rejected" || primary.type === "craft-failed") {
    return "rejected";
  }
  if (primary.type === "harvest-struck" || primary.type === "wildlife-hit") {
    return "accepted";
  }
  return "completed";
}

export function createActionReceipt(input: {
  transactionId: string;
  command: GameCommand;
  beforeEventId: number;
  events: readonly GameEvent[];
  nowMs: number;
}): ActionReceipt | null {
  const newEvents = input.events.filter((event) => event.id > input.beforeEventId);
  if (newEvents.length === 0) return null;

  const primaryEvent = primaryEventForCommand(input.command, newEvents);
  const dangerSideEffects = newEvents
    .filter(
      (event) =>
        event.id !== primaryEvent.id && actionReceiptTone(event) === "danger",
    )
    .map(receiptEvent);
  const status = statusForPrimary(primaryEvent, newEvents);
  const primary = receiptEvent(primaryEvent);
  const tone = dangerSideEffects.length > 0 ? "danger" : primary.tone;
  const ttlMs =
    tone === "danger"
      ? ACTION_RECEIPT_TTL_MS.danger
      : status === "rejected" || status === "interrupted"
        ? ACTION_RECEIPT_TTL_MS.rejected
        : ACTION_RECEIPT_TTL_MS.normal;

  return {
    id: input.transactionId,
    commandType: input.command.type,
    status,
    tone,
    eventRange: {
      fromExclusive: input.beforeEventId,
      toInclusive: newEvents.at(-1)!.id,
    },
    primary,
    dangerSideEffects,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + ttlMs,
  };
}

export function enqueueActionReceipt(
  receipts: readonly ActionReceipt[],
  receipt: ActionReceipt,
): ActionReceipt[] {
  return [receipt, ...receipts.filter((candidate) => candidate.id !== receipt.id)].slice(
    0,
    MAX_VISIBLE_ACTION_RECEIPTS,
  );
}

export function pruneExpiredActionReceipts(
  receipts: readonly ActionReceipt[],
  nowMs: number,
): ActionReceipt[] {
  return receipts.filter((receipt) => receipt.expiresAtMs > nowMs);
}
