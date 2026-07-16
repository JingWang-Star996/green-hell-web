import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_DT_SECONDS,
  TORCH_MAX_BURN_SECONDS,
  TORCH_BURN_SEGMENT_SECONDS,
  TORCH_BURN_SEGMENTS,
  addTorchInventoryUnit,
  applyCommand,
  burnEquippedTorchFuel,
  createInitialState,
  getDiscoveredRecipeIds,
  getDurableToolInventoryStatus,
  migrateGameState,
  stepSimulation,
  type GameState,
} from "../../src/game/sim";
import { createGameViewModel } from "../../src/game/ui/viewModel";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
} from "../../src/game/world/saveDelta";

function equippedTorch(seed: string): GameState {
  const state = createInitialState(seed);
  assert.equal(
    addTorchInventoryUnit(state, {
      remainingBurnSeconds: TORCH_MAX_BURN_SECONDS,
    }),
    true,
  );
  return applyCommand(state, { type: "equip-item", itemId: "torch" });
}

test("torch recipe is learned from field materials and creates one finite light source", () => {
  let state = createInitialState("torch-recipe");
  state.inventory.stick = 1;
  state.inventory["dry-leaf"] = 3;
  state.inventory.vine = 1;
  assert.ok(getDiscoveredRecipeIds(state).includes("torch"));

  state = applyCommand(state, { type: "craft", recipeId: "torch" });
  assert.equal(state.inventory.torch, 1);
  assert.equal(state.inventory.stick, 0);
  assert.equal(state.inventory["dry-leaf"], 0);
  assert.equal(state.inventory.vine, 0);
  assert.equal(
    getDurableToolInventoryStatus(state, "torch").activeDurability,
    TORCH_BURN_SEGMENTS,
  );
});

test("equipped torch burns in deterministic segments and stowing pauses it", () => {
  let state = equippedTorch("torch-burn-pause");
  state.weather.rainIntensity = 0;
  state.weather.targetRainIntensity = 0;
  state.weather.secondsUntilChange = 10_000;

  state = stepSimulation(
    state,
    {},
    TORCH_BURN_SEGMENT_SECONDS - FIXED_DT_SECONDS,
  );
  assert.equal(
    getDurableToolInventoryStatus(state, "torch").activeDurability,
    TORCH_BURN_SEGMENTS,
  );
  state = stepSimulation(state, {}, FIXED_DT_SECONDS * 2);
  assert.equal(
    getDurableToolInventoryStatus(state, "torch").activeDurability,
    TORCH_BURN_SEGMENTS - 1,
  );

  state = applyCommand(state, { type: "equip-item", itemId: null });
  const remainder = getDurableToolInventoryStatus(
    state,
    "torch",
  ).remainingUseSeconds?.[0];
  state = stepSimulation(state, {}, TORCH_BURN_SEGMENT_SECONDS * 2);
  assert.equal(
    getDurableToolInventoryStatus(state, "torch").activeDurability,
    TORCH_BURN_SEGMENTS - 1,
  );
  assert.equal(
    getDurableToolInventoryStatus(state, "torch").remainingUseSeconds?.[0],
    remainder,
  );
});

test("exposed heavy rain consumes torch fuel faster without removing baseline navigation", () => {
  let dry = equippedTorch("torch-dry-weather");
  dry.weather.rainIntensity = 0;
  dry.weather.targetRainIntensity = 0;
  dry.weather.secondsUntilChange = 10_000;

  let wet = equippedTorch("torch-wet-weather");
  wet.weather.rainIntensity = 1;
  wet.weather.targetRainIntensity = 1;
  wet.weather.secondsUntilChange = 10_000;

  const elapsed = TORCH_BURN_SEGMENT_SECONDS / 1.5;
  dry = stepSimulation(dry, {}, elapsed);
  wet = stepSimulation(wet, {}, elapsed);
  assert.equal(
    getDurableToolInventoryStatus(dry, "torch").activeDurability,
    TORCH_BURN_SEGMENTS,
  );
  assert.equal(
    getDurableToolInventoryStatus(wet, "torch").activeDurability,
    TORCH_BURN_SEGMENTS - 1,
  );
});

test("burning the last segment removes and stows the torch atomically", () => {
  let state = equippedTorch("torch-burnout");
  state.weather.rainIntensity = 0;
  state.weather.targetRainIntensity = 0;
  state.weather.secondsUntilChange = 10_000;
  state = stepSimulation(
    state,
    {},
    TORCH_BURN_SEGMENT_SECONDS * TORCH_BURN_SEGMENTS + FIXED_DT_SECONDS,
  );
  assert.equal(state.inventory.torch, 0);
  assert.equal(state.player.equippedItem, null);
  assert.equal(state.player.torchBurnSeconds, 0);
  assert.ok(
    state.eventLog.some(
      (event) =>
        event.type === "tool-broken" && event.details?.itemId === "torch",
    ),
  );
});

test("legacy saves gain a safe torch key and compact saves retain exact per-unit fuel", () => {
  const legacy = createInitialState("legacy-torch");
  delete (legacy.inventory as Partial<GameState["inventory"]>).torch;
  delete legacy.itemLifecycle?.tools.torch;
  delete legacy.player.torchBurnSeconds;
  const migrated = migrateGameState(legacy);
  assert.equal(
    (legacy.inventory as Partial<GameState["inventory"]>).torch,
    undefined,
  );
  assert.equal(migrated.inventory.torch, 0);
  assert.equal(migrated.player.torchBurnSeconds, 0);
  assert.deepEqual(migrated.itemLifecycle?.tools.torch, []);

  const active = equippedTorch("torch-save-roundtrip");
  const burn = burnEquippedTorchFuel(
    active,
    TORCH_BURN_SEGMENT_SECONDS / 2,
  );
  assert.ok(burn);
  const restored = expandGameStateSavePayload(
    compactGameStateSavePayload(active),
  ) as GameState;
  assert.equal(restored.player.torchBurnSeconds, 0);
  assert.equal(
    getDurableToolInventoryStatus(restored, "torch").remainingUseSeconds?.[0],
    TORCH_MAX_BURN_SECONDS - TORCH_BURN_SEGMENT_SECONDS / 2,
  );
  assert.equal(restored.player.equippedItem, "torch");
});

test("inventory presents torch fuel as authored game time rather than generic durability", () => {
  const state = equippedTorch("torch-view-model");
  const torch = createGameViewModel(state).inventory.find(
    (item) => item.id === "torch",
  );
  assert.equal(torch?.action, "equip");
  assert.match(torch?.statusLabel ?? "", /余燃约 2\.0 游戏小时/);
});
