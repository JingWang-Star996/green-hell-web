import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_DT_SECONDS,
  REST_SIMULATION_SECONDS,
  TORCH_BURN_SEGMENT_SECONDS,
  TORCH_FUEL_VERSION,
  TORCH_MAX_BURN_SECONDS,
  addTorchInventoryUnit,
  applyCommand,
  burnEquippedTorchFuel,
  createInitialState,
  getDurableToolInventoryStatus,
  migrateGameState,
  stepSimulation,
  takeNextTorchInventoryUnit,
  type DurableToolState,
  type GameState,
} from "../../src/game/sim";
import { consumeLifecycleInventory } from "../../src/game/sim/lifecycle";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
} from "../../src/game/world/saveDelta";

function torchTool(remainingUseSeconds: number): DurableToolState {
  return {
    durability: Math.max(
      1,
      Math.ceil(remainingUseSeconds / TORCH_BURN_SEGMENT_SECONDS),
    ),
    maxDurability: TORCH_MAX_BURN_SECONDS / TORCH_BURN_SEGMENT_SECONDS,
    remainingUseSeconds,
  };
}

function installTorchUnits(
  state: GameState,
  remainingUseSeconds: readonly number[],
): void {
  state.itemLifecycle ??= { perishables: {}, tools: {} };
  state.itemLifecycle.torchFuelVersion = TORCH_FUEL_VERSION;
  state.itemLifecycle.tools.torch = remainingUseSeconds.map(torchTool);
  state.inventory.torch = remainingUseSeconds.length;
  state.player.torchBurnSeconds = 0;
}

test("taking a torch transfers the exact weakest unit and stows that physical item", () => {
  const state = createInitialState("torch-take-exact");
  installTorchUnits(state, [
    TORCH_BURN_SEGMENT_SECONDS * 3.25,
    TORCH_BURN_SEGMENT_SECONDS * 1.5,
  ]);
  state.player.equippedItem = "torch";

  const taken = takeNextTorchInventoryUnit(state);

  assert.deepEqual(taken, {
    remainingBurnSeconds: TORCH_BURN_SEGMENT_SECONDS * 1.5,
    maxBurnSeconds: TORCH_MAX_BURN_SECONDS,
    wasEquipped: true,
    remainingInventory: 1,
  });
  assert.equal(state.inventory.torch, 1);
  assert.equal(state.player.equippedItem, null);
  assert.equal(state.player.torchBurnSeconds, 0);
  assert.deepEqual(
    getDurableToolInventoryStatus(state, "torch").remainingUseSeconds,
    [TORCH_BURN_SEGMENT_SECONDS * 3.25],
  );
});

test("add/take round-trips exact fuel and rejects invalid or over-capacity units", () => {
  const state = createInitialState("torch-return-exact");
  const exact = TORCH_BURN_SEGMENT_SECONDS * 2.375;

  assert.equal(addTorchInventoryUnit(state, { remainingBurnSeconds: exact }), true);
  const afterAdd = structuredClone(state);
  assert.equal(
    addTorchInventoryUnit(state, {
      remainingBurnSeconds: TORCH_BURN_SEGMENT_SECONDS,
    }),
    false,
    "the current backpack has one physical torch slot",
  );
  assert.deepEqual(state, afterAdd);

  const taken = takeNextTorchInventoryUnit(state);
  assert.equal(taken?.remainingBurnSeconds, exact);
  assert.equal(state.inventory.torch, 0);
  assert.deepEqual(state.itemLifecycle?.tools.torch, []);

  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const before = structuredClone(state);
    assert.equal(
      addTorchInventoryUnit(state, { remainingBurnSeconds: invalid }),
      false,
    );
    assert.deepEqual(state, before);
  }
  assert.equal(
    addTorchInventoryUnit(state, {
      remainingBurnSeconds: TORCH_MAX_BURN_SECONDS + 1,
    }),
    false,
  );
});

test("generic consumption removes torch count, unit state, and equipment together", () => {
  const state = createInitialState("torch-generic-consume");
  assert.equal(
    addTorchInventoryUnit(state, {
      remainingBurnSeconds: TORCH_BURN_SEGMENT_SECONDS * 1.75,
    }),
    true,
  );
  state.player.equippedItem = "torch";

  assert.equal(consumeLifecycleInventory(state, "torch", 1), 1);
  assert.equal(state.inventory.torch, 0);
  assert.deepEqual(state.itemLifecycle?.tools.torch, []);
  assert.equal(state.player.equippedItem, null);
  assert.equal(state.player.torchBurnSeconds, 0);
});

test("burning one of multiple torches never auto-ignites the reserve", () => {
  const state = createInitialState("torch-no-auto-ignite");
  installTorchUnits(state, [
    TORCH_BURN_SEGMENT_SECONDS / 2,
    TORCH_BURN_SEGMENT_SECONDS * 4,
  ]);
  state.player.equippedItem = "torch";

  const first = burnEquippedTorchFuel(
    state,
    TORCH_BURN_SEGMENT_SECONDS / 2,
  );
  assert.equal(first?.broken, true);
  assert.equal(state.inventory.torch, 1);
  assert.equal(state.player.equippedItem, null);
  assert.deepEqual(
    getDurableToolInventoryStatus(state, "torch").remainingUseSeconds,
    [TORCH_BURN_SEGMENT_SECONDS * 4],
  );

  const beforeStowedBurn = structuredClone(state);
  assert.equal(burnEquippedTorchFuel(state, 10), null);
  assert.deepEqual(state, beforeStowedBurn);

  const equipped = applyCommand(state, { type: "equip-item", itemId: "torch" });
  const second = burnEquippedTorchFuel(equipped, 1.25);
  assert.equal(second?.broken, false);
  assert.equal(
    second?.remainingBurnSeconds,
    TORCH_BURN_SEGMENT_SECONDS * 4 - 1.25,
  );
});

test("simulation burnout leaves reserve fuel untouched and emits one explicit stow", () => {
  let state = createInitialState("torch-simulation-no-auto");
  installTorchUnits(state, [
    FIXED_DT_SECONDS,
    TORCH_BURN_SEGMENT_SECONDS * 2,
  ]);
  state.player.equippedItem = "torch";
  state.weather.rainIntensity = 0;
  state.weather.targetRainIntensity = 0;
  state.weather.secondsUntilChange = 10_000;

  state = stepSimulation(state, {}, FIXED_DT_SECONDS * 2);

  assert.equal(state.inventory.torch, 1);
  assert.equal(state.player.equippedItem, null);
  assert.deepEqual(
    getDurableToolInventoryStatus(state, "torch").remainingUseSeconds,
    [TORCH_BURN_SEGMENT_SECONDS * 2],
  );
  assert.equal(
    state.eventLog.filter(
      (event) =>
        event.type === "item-unequipped" &&
        event.cause.code === "equipment:broken:torch",
    ).length,
    1,
  );
});

test("legacy global burn debt migrates across units without retriggering food balance", () => {
  const legacy = createInitialState("torch-legacy-debt");
  legacy.inventory.torch = 2;
  legacy.inventory.grubs = 1;
  legacy.itemLifecycle!.tools.torch = [
    { durability: 4, maxDurability: 6 },
    { durability: 2, maxDurability: 6 },
  ];
  legacy.itemLifecycle!.perishables.grubs = [
    { quantity: 1, expiresAtTick: legacy.clock.tick + 1 },
  ];
  delete legacy.itemLifecycle!.torchFuelVersion;
  legacy.player.torchBurnSeconds = TORCH_BURN_SEGMENT_SECONDS * 2.5;
  legacy.player.equippedItem = "torch";

  const migrated = migrateGameState(legacy);

  assert.equal(legacy.player.torchBurnSeconds, TORCH_BURN_SEGMENT_SECONDS * 2.5);
  assert.equal(migrated.itemLifecycle?.torchFuelVersion, TORCH_FUEL_VERSION);
  assert.equal(migrated.player.torchBurnSeconds, 0);
  assert.equal(migrated.inventory.torch, 1);
  assert.equal(migrated.player.equippedItem, "torch");
  assert.deepEqual(
    getDurableToolInventoryStatus(migrated, "torch").remainingUseSeconds,
    [TORCH_BURN_SEGMENT_SECONDS * 3.5],
  );
  assert.equal(
    migrated.itemLifecycle?.perishables.grubs?.[0].expiresAtTick,
    legacy.clock.tick + 1,
    "torch format migration must not grant another food freshness window",
  );
});

test("legacy orphan or excessive debt is cleared and cannot poison a future torch", () => {
  const orphan = createInitialState("torch-orphan-debt");
  delete orphan.itemLifecycle!.torchFuelVersion;
  orphan.player.torchBurnSeconds = TORCH_MAX_BURN_SECONDS * 3;
  const migratedOrphan = migrateGameState(orphan);
  assert.equal(migratedOrphan.inventory.torch, 0);
  assert.equal(migratedOrphan.player.torchBurnSeconds, 0);
  assert.equal(
    addTorchInventoryUnit(migratedOrphan, {
      remainingBurnSeconds: TORCH_MAX_BURN_SECONDS,
    }),
    true,
  );
  assert.deepEqual(
    getDurableToolInventoryStatus(
      migratedOrphan,
      "torch",
    ).remainingUseSeconds,
    [TORCH_MAX_BURN_SECONDS],
  );

  const exhausted = createInitialState("torch-excess-debt");
  exhausted.inventory.torch = 2;
  exhausted.itemLifecycle!.tools.torch = [
    { durability: 1, maxDurability: 6 },
    { durability: 1, maxDurability: 6 },
  ];
  delete exhausted.itemLifecycle!.torchFuelVersion;
  exhausted.player.torchBurnSeconds = TORCH_MAX_BURN_SECONDS;
  exhausted.player.equippedItem = "torch";
  const migratedExhausted = migrateGameState(exhausted);
  assert.equal(migratedExhausted.inventory.torch, 0);
  assert.equal(migratedExhausted.player.equippedItem, null);
  assert.equal(migratedExhausted.player.torchBurnSeconds, 0);

  const infiniteDebt = createInitialState("torch-infinite-debt");
  infiniteDebt.inventory.torch = 1;
  infiniteDebt.itemLifecycle!.tools.torch = [
    { durability: 6, maxDurability: 6 },
  ];
  delete infiniteDebt.itemLifecycle!.torchFuelVersion;
  infiniteDebt.player.torchBurnSeconds = Number.POSITIVE_INFINITY;
  const migratedInfinite = migrateGameState(infiniteDebt);
  assert.equal(migratedInfinite.inventory.torch, 0);
  assert.equal(migratedInfinite.player.torchBurnSeconds, 0);
});

test("current malformed unit arrays fail closed without minting inventory fuel", () => {
  const malformed = createInitialState("torch-current-malformed");
  malformed.inventory.torch = 4;
  malformed.itemLifecycle!.torchFuelVersion = TORCH_FUEL_VERSION;
  malformed.itemLifecycle!.tools.torch = [
    torchTool(TORCH_BURN_SEGMENT_SECONDS * 1.25),
    { durability: 6, maxDurability: 6 },
    { durability: 6, maxDurability: 6, remainingUseSeconds: Number.NaN },
    torchTool(TORCH_MAX_BURN_SECONDS + 100),
  ];
  malformed.player.equippedItem = "torch";

  const migrated = migrateGameState(malformed);

  assert.equal(migrated.inventory.torch, 2);
  assert.equal(migrated.player.equippedItem, "torch");
  assert.deepEqual(
    getDurableToolInventoryStatus(migrated, "torch").remainingUseSeconds,
    [TORCH_BURN_SEGMENT_SECONDS * 1.25, TORCH_MAX_BURN_SECONDS],
  );
});

test("non-array lifecycle payloads clone and migrate fail-closed", () => {
  const malformed = createInitialState("torch-non-array-lifecycle");
  malformed.inventory.torch = 1;
  malformed.inventory.grubs = 1;
  malformed.player.equippedItem = "torch";
  malformed.itemLifecycle!.torchFuelVersion = TORCH_FUEL_VERSION;
  malformed.itemLifecycle!.tools.torch = {} as DurableToolState[];
  malformed.itemLifecycle!.perishables.grubs = {} as never;

  let migrated!: GameState;
  assert.doesNotThrow(() => {
    migrated = migrateGameState(malformed);
  });
  assert.equal(migrated.inventory.torch, 0);
  assert.equal(migrated.player.equippedItem, null);
  assert.deepEqual(migrated.itemLifecycle?.tools.torch, []);
  assert.ok(Array.isArray(migrated.itemLifecycle?.perishables.grubs));
});

test("rest auto-stows a lit torch once without burning its concrete fuel", () => {
  const state = createInitialState("torch-rest-auto-stow");
  const exactFuel = TORCH_BURN_SEGMENT_SECONDS * 2.375;
  installTorchUnits(state, [exactFuel]);
  state.player.equippedItem = "torch";
  state.camp.bedBuilt = true;
  state.camp.structures!.push({
    id: "structure.bed.rest-test",
    kind: "bed",
    position: { ...state.player.position },
    yaw: 0,
    builtAtTick: state.clock.tick,
  });
  state.weather.rainIntensity = 0;
  state.weather.targetRainIntensity = 0;
  state.weather.secondsUntilChange = REST_SIMULATION_SECONDS + 100;

  const rested = applyCommand(state, { type: "rest" });

  assert.equal(rested.status, "playing");
  assert.equal(rested.player.equippedItem, null);
  assert.deepEqual(
    getDurableToolInventoryStatus(rested, "torch").remainingUseSeconds,
    [exactFuel],
  );
  assert.equal(
    rested.eventLog.filter(
      (event) =>
        event.type === "item-unequipped" &&
        event.cause.code === "rest:auto-stow",
    ).length,
    1,
  );
});

test("compact save round-trip preserves two independent partial torch units", () => {
  const state = createInitialState("torch-two-unit-save");
  const units = [
    TORCH_BURN_SEGMENT_SECONDS * 1.125,
    TORCH_BURN_SEGMENT_SECONDS * 4.625,
  ];
  installTorchUnits(state, units);
  state.player.equippedItem = "torch";

  const restored = migrateGameState(
    expandGameStateSavePayload(
      compactGameStateSavePayload(state),
    ) as GameState,
  );

  assert.equal(restored.player.equippedItem, "torch");
  assert.equal(restored.player.torchBurnSeconds, 0);
  assert.deepEqual(
    getDurableToolInventoryStatus(restored, "torch").remainingUseSeconds,
    units,
  );
});
