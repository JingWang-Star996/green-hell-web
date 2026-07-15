import {
  FOOD_SPOILAGE,
  ITEMS,
  TOOL_DURABILITY,
  TORCH_BURN_SEGMENT_SECONDS,
} from "./content";
import { FIXED_HZ } from "./time";
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

export const LIFECYCLE_TICKS_PER_SECOND = FIXED_HZ;
export const ITEM_LIFECYCLE_BALANCE_VERSION = 2 as const;
export const TORCH_FUEL_VERSION = 1 as const;
export const MIGRATED_FOOD_MINIMUM_FRESHNESS = 0.25;
export const TORCH_MAX_BURN_SECONDS =
  TOOL_DURABILITY.torch.maxDurability * TORCH_BURN_SEGMENT_SECONDS;

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
  /** Exact per-unit fuel in the same weakest-first order; torch only. */
  remainingUseSeconds?: number[];
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

export interface TorchFuelUnit {
  remainingBurnSeconds: number;
  maxBurnSeconds: number;
}

export interface TakenTorchFuelUnit extends TorchFuelUnit {
  wasEquipped: boolean;
  remainingInventory: number;
}

export interface TorchBurnResult extends TorchFuelUnit {
  consumedSeconds: number;
  previousRemainingBurnSeconds: number;
  durability: number;
  previousDurability: number;
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

function torchDurabilityForRemaining(remainingUseSeconds: number): number {
  return Math.max(
    1,
    Math.min(
      TOOL_DURABILITY.torch.maxDurability,
      Math.ceil(remainingUseSeconds / TORCH_BURN_SEGMENT_SECONDS),
    ),
  );
}

function canonicalTorchTool(remainingUseSeconds: number): DurableToolState {
  const remaining = Math.min(
    TORCH_MAX_BURN_SECONDS,
    Math.max(0, remainingUseSeconds),
  );
  return {
    durability: torchDurabilityForRemaining(remaining),
    maxDurability: TOOL_DURABILITY.torch.maxDurability,
    remainingUseSeconds: remaining,
  };
}

/**
 * Purely projects canonical concrete torch units. Legacy inventory counts may
 * materialize missing full units once; current-format counts never mint fuel.
 */
function normalizedTorchTools(
  state: GameState,
  legacyFuelShape: boolean,
): DurableToolState[] {
  const rawTools = Array.isArray(state.itemLifecycle?.tools?.torch)
    ? state.itemLifecycle?.tools?.torch ?? []
    : [];
  const tools = rawTools.flatMap((tool) => {
    if (!tool) return [];
    const exact = tool.remainingUseSeconds;
    if (typeof exact === "number" && Number.isFinite(exact) && exact > 0) {
      return [canonicalTorchTool(exact)];
    }
    if (!legacyFuelShape) return [];
    if (!Number.isFinite(tool.durability) || tool.durability <= 0) return [];
    const legacyDurability = Math.max(
      1,
      Math.min(
        TOOL_DURABILITY.torch.maxDurability,
        Math.floor(tool.durability),
      ),
    );
    return [
      canonicalTorchTool(legacyDurability * TORCH_BURN_SEGMENT_SECONDS),
    ];
  });
  tools.sort(
    (left, right) =>
      (left.remainingUseSeconds ?? 0) - (right.remainingUseSeconds ?? 0),
  );

  if (!legacyFuelShape) return tools;

  const legacyCount = normalizedInventoryCount(state, "torch");
  if (tools.length > legacyCount) {
    // Preserve the existing generic-discard policy for old count reductions.
    tools.splice(0, tools.length - legacyCount);
  }
  while (tools.length < legacyCount) {
    tools.push(canonicalTorchTool(TORCH_MAX_BURN_SECONDS));
  }
  tools.sort(
    (left, right) =>
      (left.remainingUseSeconds ?? 0) - (right.remainingUseSeconds ?? 0),
  );

  const rawBurnDebt = state.player.torchBurnSeconds;
  let burnDebt =
    rawBurnDebt === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : typeof rawBurnDebt === "number" && Number.isFinite(rawBurnDebt)
        ? Math.max(0, rawBurnDebt)
        : 0;
  while (burnDebt > 0 && tools.length > 0) {
    const active = tools[0];
    const remaining = active.remainingUseSeconds ?? 0;
    if (burnDebt >= remaining) {
      burnDebt -= remaining;
      tools.shift();
      continue;
    }
    tools[0] = canonicalTorchTool(remaining - burnDebt);
    burnDebt = 0;
  }
  return tools;
}

/** Mutates a working state to the current lifecycle shape without advancing time. */
export function ensureItemLifecycleState(state: GameState): ItemLifecycleState {
  const needsBalanceMigration = Boolean(
    state.itemLifecycle &&
      state.itemLifecycle.balanceVersion !== ITEM_LIFECYCLE_BALANCE_VERSION,
  );
  const needsTorchFuelMigration =
    state.itemLifecycle?.torchFuelVersion !== TORCH_FUEL_VERSION;
  const lifecycle: ItemLifecycleState = {
    balanceVersion: ITEM_LIFECYCLE_BALANCE_VERSION,
    torchFuelVersion: TORCH_FUEL_VERSION,
    perishables: state.itemLifecycle?.perishables ?? {},
    tools: state.itemLifecycle?.tools ?? {},
  };

  for (const itemId of PERISHABLE_ITEM_IDS) {
    const batches = reconcileBatches(
      state,
      itemId,
      normalizeBatches(lifecycle.perishables[itemId]),
    );
    if (needsBalanceMigration) {
      const minimumExpiry =
        state.clock.tick +
        Math.round(
          FOOD_SPOILAGE[itemId].shelfLifeSeconds *
            LIFECYCLE_TICKS_PER_SECOND *
            MIGRATED_FOOD_MINIMUM_FRESHNESS,
        );
      for (const batch of batches) {
        batch.expiresAtTick = Math.max(batch.expiresAtTick, minimumExpiry);
      }
    }
    lifecycle.perishables[itemId] = batches;
  }
  for (const itemId of DURABLE_TOOL_IDS) {
    if (itemId === "torch") {
      const tools = normalizedTorchTools(state, needsTorchFuelMigration);
      lifecycle.tools.torch = tools;
      // Concrete canonical units own torch quantity. A malformed current save
      // may lose an unbacked count, but can never gain a full fuel unit from it.
      state.inventory.torch = tools.length;
      continue;
    }
    // Durable item IDs can be added while the compatible version-1 save shape
    // remains unchanged. Materialize an absent runtime key before any craft or
    // equip path performs arithmetic on it.
    state.inventory[itemId] = normalizedInventoryCount(state, itemId);
    lifecycle.tools[itemId] = reconcileTools(
      state,
      itemId,
      normalizeTools(
        lifecycle.tools[itemId],
        TOOL_DURABILITY[itemId].maxDurability,
      ),
    );
  }
  // This field survives only as a migration input for old envelopes. Keeping
  // the canonical runtime at zero prevents burn debt from attaching to a later
  // crafted or returned torch.
  state.player.torchBurnSeconds = 0;
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
      tools.push(
        itemId === "torch"
          ? canonicalTorchTool(TORCH_MAX_BURN_SECONDS)
          : { durability: maxDurability, maxDurability },
      );
    }
    lifecycle.tools[itemId] = tools.sort(
      (left, right) =>
        itemId === "torch"
          ? (left.remainingUseSeconds ?? 0) -
            (right.remainingUseSeconds ?? 0)
          : left.durability - right.durability,
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
  if (itemId === "torch") {
    const target = Math.min(
      normalizedInventoryCount(state, itemId),
      Math.max(0, Math.floor(amount)),
    );
    let consumed = 0;
    while (consumed < target && takeNextTorchInventoryUnit(state)) {
      consumed += 1;
    }
    return consumed;
  }
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

/**
 * Atomically transfers the weakest/next-use concrete torch out of inventory.
 * The returned seconds are the unit's exact fuel ownership boundary.
 */
export function takeNextTorchInventoryUnit(
  state: GameState,
): TakenTorchFuelUnit | null {
  const lifecycle = ensureItemLifecycleState(state);
  const tools = lifecycle.tools.torch ?? [];
  const tool = tools[0];
  const remainingBurnSeconds = tool?.remainingUseSeconds;
  if (
    !tool ||
    typeof remainingBurnSeconds !== "number" ||
    !Number.isFinite(remainingBurnSeconds) ||
    remainingBurnSeconds <= 0
  ) {
    return null;
  }

  const wasEquipped = state.player.equippedItem === "torch";
  tools.shift();
  state.inventory.torch = tools.length;
  state.player.torchBurnSeconds = 0;
  if (wasEquipped) state.player.equippedItem = null;
  return {
    remainingBurnSeconds,
    maxBurnSeconds: TORCH_MAX_BURN_SECONDS,
    wasEquipped,
    remainingInventory: tools.length,
  };
}

/** Returns one exact torch unit without rounding or refilling its fuel. */
export function addTorchInventoryUnit(
  state: GameState,
  unit: Readonly<Pick<TorchFuelUnit, "remainingBurnSeconds">>,
): boolean {
  const remaining = unit.remainingBurnSeconds;
  if (
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > TORCH_MAX_BURN_SECONDS
  ) {
    return false;
  }
  const lifecycle = ensureItemLifecycleState(state);
  const tools = lifecycle.tools.torch ?? [];
  if (tools.length >= ITEMS.torch.stackLimit) return false;
  tools.push(canonicalTorchTool(remaining));
  tools.sort(
    (left, right) =>
      (left.remainingUseSeconds ?? 0) - (right.remainingUseSeconds ?? 0),
  );
  lifecycle.tools.torch = tools;
  state.inventory.torch = tools.length;
  return true;
}

/**
 * Burns only the explicitly equipped concrete torch. Exhaustion removes that
 * unit and leaves the player empty-handed even when a reserve exists.
 */
export function burnEquippedTorchFuel(
  state: GameState,
  seconds: number,
): TorchBurnResult | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const lifecycle = ensureItemLifecycleState(state);
  if (state.player.equippedItem !== "torch") return null;
  const tools = lifecycle.tools.torch ?? [];
  const tool = tools[0];
  const previousRemainingBurnSeconds = tool?.remainingUseSeconds;
  if (
    !tool ||
    typeof previousRemainingBurnSeconds !== "number" ||
    previousRemainingBurnSeconds <= 0
  ) {
    state.player.equippedItem = null;
    state.inventory.torch = tools.length;
    return null;
  }

  const previousDurability = torchDurabilityForRemaining(
    previousRemainingBurnSeconds,
  );
  const consumedSeconds = Math.min(seconds, previousRemainingBurnSeconds);
  const nextRemaining = previousRemainingBurnSeconds - consumedSeconds;
  const broken = nextRemaining <= 1e-9;
  let durability = 0;
  if (broken) {
    tools.shift();
    state.player.equippedItem = null;
  } else {
    const next = canonicalTorchTool(nextRemaining);
    tools[0] = next;
    durability = next.durability;
  }
  state.inventory.torch = tools.length;
  state.player.torchBurnSeconds = 0;
  return {
    remainingBurnSeconds: broken ? 0 : nextRemaining,
    maxBurnSeconds: TORCH_MAX_BURN_SECONDS,
    consumedSeconds,
    previousRemainingBurnSeconds,
    durability,
    previousDurability,
    maxDurability: TOOL_DURABILITY.torch.maxDurability,
    broken,
  };
}

/**
 * Removes the earliest-expiring unit while preserving its real deadline for a
 * world processor. This prevents loading/unloading equipment from refreshing
 * food freshness or duplicating an inventory batch.
 */
export function takePerishableInventoryUnit(
  state: GameState,
  itemId: PerishableItemId,
): { itemId: PerishableItemId; expiresAtTick: number } | null {
  const lifecycle = ensureItemLifecycleState(state);
  if (normalizedInventoryCount(state, itemId) <= 0) return null;
  const batches = lifecycle.perishables[itemId] ?? [];
  const batch = batches[0];
  if (!batch) return null;
  const expiresAtTick = batch.expiresAtTick;
  batch.quantity -= 1;
  if (batch.quantity <= 0) batches.shift();
  state.inventory[itemId] = Math.max(0, state.inventory[itemId] - 1);
  return { itemId, expiresAtTick };
}

/**
 * Returns a processed world item to inventory without resetting its age.
 * World processors own the unit while it is outside the backpack, so the
 * original/derived deadline must cross that boundary atomically as well.
 */
export function addPerishableInventoryUnitWithExpiry(
  state: GameState,
  itemId: PerishableItemId,
  expiresAtTick: number,
): boolean {
  const lifecycle = ensureItemLifecycleState(state);
  if (normalizedInventoryCount(state, itemId) >= ITEMS[itemId].stackLimit) {
    return false;
  }
  const normalizedExpiry = Math.max(
    state.clock.tick,
    Math.floor(Number.isFinite(expiresAtTick) ? expiresAtTick : state.clock.tick),
  );
  state.inventory[itemId] += 1;
  const batches = lifecycle.perishables[itemId] ?? [];
  const matchingBatch = batches.find(
    (batch) => batch.expiresAtTick === normalizedExpiry,
  );
  if (matchingBatch) matchingBatch.quantity += 1;
  else batches.push({ quantity: 1, expiresAtTick: normalizedExpiry });
  lifecycle.perishables[itemId] = batches.sort(
    (left, right) => left.expiresAtTick - right.expiresAtTick,
  );
  return true;
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
  if (itemId === "torch") {
    const remaining = tool.remainingUseSeconds;
    if (
      typeof remaining !== "number" ||
      !Number.isFinite(remaining) ||
      remaining <= 0
    ) {
      return null;
    }
    const nextRemaining =
      remaining - appliedCost * TORCH_BURN_SEGMENT_SECONDS;
    const broken = nextRemaining <= 1e-9;
    let durability = 0;
    if (broken) {
      tools.shift();
    } else {
      const next = canonicalTorchTool(nextRemaining);
      tools[0] = next;
      durability = next.durability;
    }
    state.inventory.torch = tools.length;
    return {
      itemId,
      cost: appliedCost,
      durability,
      maxDurability: TOOL_DURABILITY.torch.maxDurability,
      broken,
    };
  }
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
  if (itemId === "torch") {
    const tools = normalizedTorchTools(
      state,
      state.itemLifecycle?.torchFuelVersion !== TORCH_FUEL_VERSION,
    );
    const remainingUseSeconds = tools.map(
      (tool) => tool.remainingUseSeconds ?? 0,
    );
    const durabilities = remainingUseSeconds.map(
      torchDurabilityForRemaining,
    );
    return {
      itemId,
      quantity: tools.length,
      durabilities,
      remainingUseSeconds,
      maxDurability: TOOL_DURABILITY.torch.maxDurability,
      activeDurability: durabilities[0] ?? 0,
    };
  }
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
