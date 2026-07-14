import { FOOD_SPOILAGE, ITEMS, TOOL_DURABILITY } from "./content";
import {
  DURABLE_TOOL_IDS,
  PERISHABLE_ITEM_IDS,
  type DurableToolId,
  type DurableToolState,
  type GameState,
  type ItemId,
  type ItemLifecycleState,
  type PerishableBatchState,
  type PerishableItemId,
} from "./types";

export const LIFECYCLE_TICKS_PER_SECOND = 30;

export interface PerishableInventoryStatus {
  itemId: PerishableItemId;
  quantity: number;
  nextExpiryTick: number | null;
  secondsUntilNextSpoilage: number | null;
  shelfLifeSeconds: number;
}

export interface DurableToolInventoryStatus {
  itemId: DurableToolId;
  quantity: number;
  durabilities: number[];
  maxDurability: number;
  activeDurability: number;
}

export interface SpoiledFoodResult {
  itemId: PerishableItemId;
  quantity: number;
}

export interface ToolWearResult {
  itemId: DurableToolId;
  cost: number;
  durability: number;
  maxDurability: number;
  broken: boolean;
}

export function isPerishableItem(itemId: ItemId): itemId is PerishableItemId {
  return (PERISHABLE_ITEM_IDS as readonly string[]).includes(itemId);
}

export function isDurableTool(itemId: ItemId): itemId is DurableToolId {
  return (DURABLE_TOOL_IDS as readonly string[]).includes(itemId);
}

function normalizedInventoryCount(state: GameState, itemId: ItemId): number {
  const count = state.inventory[itemId];
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

function normalizeBatches(
  batches: readonly PerishableBatchState[] | undefined,
): PerishableBatchState[] {
  return (Array.isArray(batches) ? batches : [])
    .filter(
      (batch) =>
        batch &&
        Number.isFinite(batch.quantity) &&
        batch.quantity > 0 &&
        Number.isFinite(batch.expiresAtTick),
    )
    .map((batch) => ({
      quantity: Math.max(1, Math.floor(batch.quantity)),
      expiresAtTick: Math.max(0, Math.floor(batch.expiresAtTick)),
    }))
    .sort((left, right) => left.expiresAtTick - right.expiresAtTick);
}

function reconcileBatches(
  state: GameState,
  itemId: PerishableItemId,
  batches: PerishableBatchState[],
): PerishableBatchState[] {
  const count = normalizedInventoryCount(state, itemId);
  let tracked = batches.reduce((total, batch) => total + batch.quantity, 0);
  let excess = Math.max(0, tracked - count);
  while (excess > 0 && batches.length > 0) {
    const batch = batches[0];
    const removed = Math.min(excess, batch.quantity);
    batch.quantity -= removed;
    excess -= removed;
    tracked -= removed;
    if (batch.quantity <= 0) batches.shift();
  }
  if (tracked < count) {
    batches.push({
      quantity: count - tracked,
      expiresAtTick:
        state.clock.tick +
        FOOD_SPOILAGE[itemId].shelfLifeSeconds * LIFECYCLE_TICKS_PER_SECOND,
    });
  }
  return batches;
}

function normalizeTools(
  tools: readonly DurableToolState[] | undefined,
  maxDurability: number,
): DurableToolState[] {
  return (Array.isArray(tools) ? tools : [])
    .filter(
      (tool) =>
        tool &&
        Number.isFinite(tool.durability) &&
        tool.durability > 0,
    )
    .map((tool) => ({
      durability: Math.max(
        1,
        Math.min(maxDurability, Math.floor(tool.durability)),
      ),
      maxDurability,
    }))
    .sort((left, right) => left.durability - right.durability);
}

function reconcileTools(
  state: GameState,
  itemId: DurableToolId,
  tools: DurableToolState[],
): DurableToolState[] {
  const count = normalizedInventoryCount(state, itemId);
  const maxDurability = TOOL_DURABILITY[itemId].maxDurability;
  if (tools.length > count) {
    // A generic inventory reduction is treated as discarding the weakest tool.
    tools.splice(0, tools.length - count);
  }
  while (tools.length < count) {
    tools.push({ durability: maxDurability, maxDurability });
  }
  return tools.sort((left, right) => left.durability - right.durability);
}

/** Mutates a working state to the current lifecycle shape without advancing time. */
export function ensureItemLifecycleState(state: GameState): ItemLifecycleState {
  const lifecycle: ItemLifecycleState = {
    perishables: state.itemLifecycle?.perishables ?? {},
    tools: state.itemLifecycle?.tools ?? {},
  };

  for (const itemId of PERISHABLE_ITEM_IDS) {
    lifecycle.perishables[itemId] = reconcileBatches(
      state,
      itemId,
      normalizeBatches(lifecycle.perishables[itemId]),
    );
  }
  for (const itemId of DURABLE_TOOL_IDS) {
    lifecycle.tools[itemId] = reconcileTools(
      state,
      itemId,
      normalizeTools(
        lifecycle.tools[itemId],
        TOOL_DURABILITY[itemId].maxDurability,
      ),
    );
  }
  state.itemLifecycle = lifecycle;
  return lifecycle;
}

/** Adds inventory and its per-unit lifecycle atomically. */
export function addLifecycleInventory(
  state: GameState,
  itemId: ItemId,
  amount: number,
): number {
  const lifecycle = ensureItemLifecycleState(state);
  const accepted = Math.max(
    0,
    Math.min(amount, ITEMS[itemId].stackLimit - state.inventory[itemId]),
  );
  if (accepted <= 0) return 0;
  state.inventory[itemId] += accepted;

  if (isPerishableItem(itemId)) {
    const expiresAtTick =
      state.clock.tick +
      FOOD_SPOILAGE[itemId].shelfLifeSeconds * LIFECYCLE_TICKS_PER_SECOND;
    const batches = lifecycle.perishables[itemId] ?? [];
    const matchingBatch = batches.find(
      (batch) => batch.expiresAtTick === expiresAtTick,
    );
    if (matchingBatch) matchingBatch.quantity += accepted;
    else batches.push({ quantity: accepted, expiresAtTick });
    lifecycle.perishables[itemId] = batches.sort(
      (left, right) => left.expiresAtTick - right.expiresAtTick,
    );
  } else if (isDurableTool(itemId)) {
    const maxDurability = TOOL_DURABILITY[itemId].maxDurability;
    const tools = lifecycle.tools[itemId] ?? [];
    for (let index = 0; index < accepted; index += 1) {
      tools.push({ durability: maxDurability, maxDurability });
    }
    lifecycle.tools[itemId] = tools.sort(
      (left, right) => left.durability - right.durability,
    );
  }
  return accepted;
}

/** Consumes earliest-expiring food first. Other items retain count semantics. */
export function consumeLifecycleInventory(
  state: GameState,
  itemId: ItemId,
  amount: number,
): number {
  const lifecycle = ensureItemLifecycleState(state);
  let remaining = Math.min(
    normalizedInventoryCount(state, itemId),
    Math.max(0, Math.floor(amount)),
  );
  const consumed = remaining;
  state.inventory[itemId] -= consumed;
  if (isPerishableItem(itemId)) {
    const batches = lifecycle.perishables[itemId] ?? [];
    while (remaining > 0 && batches.length > 0) {
      const batch = batches[0];
      const removed = Math.min(remaining, batch.quantity);
      batch.quantity -= removed;
      remaining -= removed;
      if (batch.quantity <= 0) batches.shift();
    }
  }
  return consumed;
}

export function expireSpoiledFood(state: GameState): SpoiledFoodResult[] {
  const lifecycle = ensureItemLifecycleState(state);
  const spoiled: SpoiledFoodResult[] = [];
  for (const itemId of PERISHABLE_ITEM_IDS) {
    const batches = lifecycle.perishables[itemId] ?? [];
    let quantity = 0;
    while (
      batches.length > 0 &&
      batches[0].expiresAtTick <= state.clock.tick
    ) {
      quantity += batches.shift()?.quantity ?? 0;
    }
    if (quantity <= 0) continue;
    const removed = Math.min(quantity, normalizedInventoryCount(state, itemId));
    state.inventory[itemId] -= removed;
    if (removed > 0) spoiled.push({ itemId, quantity: removed });
  }
  return spoiled;
}

export function damageDurableTool(
  state: GameState,
  itemId: DurableToolId,
  cost: number,
): ToolWearResult | null {
  const lifecycle = ensureItemLifecycleState(state);
  const tools = lifecycle.tools[itemId] ?? [];
  if (state.inventory[itemId] <= 0 || tools.length <= 0) return null;
  const tool = tools[0];
  const appliedCost = Math.max(1, Math.floor(cost));
  tool.durability -= appliedCost;
  const broken = tool.durability <= 0;
  const durability = Math.max(0, tool.durability);
  if (broken) {
    tools.shift();
    state.inventory[itemId] = Math.max(0, state.inventory[itemId] - 1);
  } else {
    tools.sort((left, right) => left.durability - right.durability);
  }
  return {
    itemId,
    cost: appliedCost,
    durability,
    maxDurability: tool.maxDurability,
    broken,
  };
}

export function getPerishableInventoryStatus(
  state: GameState,
  itemId: PerishableItemId,
): PerishableInventoryStatus {
  const quantity = normalizedInventoryCount(state, itemId);
  const batches = normalizeBatches(state.itemLifecycle?.perishables?.[itemId]);
  const nextExpiryTick =
    batches[0]?.expiresAtTick ??
    (quantity > 0
      ? state.clock.tick +
        FOOD_SPOILAGE[itemId].shelfLifeSeconds * LIFECYCLE_TICKS_PER_SECOND
      : null);
  return {
    itemId,
    quantity,
    nextExpiryTick,
    secondsUntilNextSpoilage:
      nextExpiryTick === null
        ? null
        : Math.max(
            0,
            (nextExpiryTick - state.clock.tick) / LIFECYCLE_TICKS_PER_SECOND,
          ),
    shelfLifeSeconds: FOOD_SPOILAGE[itemId].shelfLifeSeconds,
  };
}

export function getDurableToolInventoryStatus(
  state: GameState,
  itemId: DurableToolId,
): DurableToolInventoryStatus {
  const quantity = normalizedInventoryCount(state, itemId);
  const maxDurability = TOOL_DURABILITY[itemId].maxDurability;
  const tools = normalizeTools(
    state.itemLifecycle?.tools?.[itemId],
    maxDurability,
  );
  while (tools.length < quantity) {
    tools.push({ durability: maxDurability, maxDurability });
  }
  const durabilities = tools
    .slice(0, quantity)
    .map((tool) => tool.durability)
    .sort((left, right) => left - right);
  return {
    itemId,
    quantity,
    durabilities,
    maxDurability,
    activeDurability: durabilities[0] ?? 0,
  };
}
