import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPFIRE_IGNITION_BLOCKING_RAIN_INTENSITY,
  CAMPFIRE_RAIN_EXPOSED_GUIDANCE,
  applyCommand,
  canCraft,
  canCraftAtPlacement,
  createInitialState,
  resolveCampfireIgnition,
  resolveCurrentCampfireIgnition,
} from "../../src/game/sim/index";
import type {
  GameState,
  PlacedStructureKind,
  PlacedStructureState,
} from "../../src/game/sim/index";
import { createGameViewModel } from "../../src/game/ui/viewModel";

const FIRE_POSITION = { x: 0, y: 0, z: 0 };
const FIRE_PLACEMENT = { position: FIRE_POSITION, yaw: 0 };

function placed(
  id: string,
  kind: PlacedStructureKind,
  x = 0,
  z = 0,
): PlacedStructureState {
  return {
    id,
    kind,
    position: { x, y: 0, z },
    yaw: 0,
    builtAtTick: 0,
  };
}

function safeState(seed: string): GameState {
  const state = createInitialState(seed);
  state.player.position = { ...state.camp.position };
  state.player.vitals = {
    health: 100,
    stamina: 100,
    energy: 100,
    sanity: 100,
  };
  state.player.nutrition = {
    carbohydrates: 100,
    protein: 100,
    fat: 100,
    hydration: 100,
  };
  state.player.conditions.wound = {
    open: false,
    treated: true,
    severity: 0,
    infection: 0,
  };
  state.inventory.stick = 4;
  state.inventory["dry-leaf"] = 2;
  state.weather.rainIntensity = 1;
  state.weather.targetRainIntensity = 1;
  state.weather.secondsUntilChange = 10_000;
  state.weather.storm = true;
  return state;
}

test("the pure ignition predicate has one fail-closed rain threshold", () => {
  assert.equal(
    resolveCampfireIgnition({
      rainIntensity: CAMPFIRE_IGNITION_BLOCKING_RAIN_INTENSITY - 0.001,
      sheltered: false,
    }).canIgnite,
    true,
  );
  assert.equal(
    resolveCampfireIgnition({
      rainIntensity: CAMPFIRE_IGNITION_BLOCKING_RAIN_INTENSITY,
      sheltered: false,
    }).blocker,
    "rain-exposed",
  );
  assert.equal(
    resolveCampfireIgnition({ rainIntensity: 1, sheltered: true }).canIgnite,
    true,
  );
  assert.equal(
    resolveCampfireIgnition({
      rainIntensity: Number.NaN,
      sheltered: false,
    }).blocker,
    "rain-exposed",
  );
});

test("an exposed campfire cannot be crafted in heavy rain and produces no success feedback", () => {
  const state = safeState("storm-exposed-new-fire");
  const inventoryBefore = { ...state.inventory };
  const eventCountBefore = state.eventLog.length;

  assert.equal(canCraft(state, "campfire").reason, "rain-exposed");
  assert.equal(
    canCraftAtPlacement(state, "campfire", FIRE_PLACEMENT).reason,
    "rain-exposed",
  );
  const recipe = createGameViewModel(state).recipes.find(
    (entry) => entry.id === "campfire",
  );
  assert.equal(recipe?.available, false);
  assert.equal(recipe?.reason, CAMPFIRE_RAIN_EXPOSED_GUIDANCE);

  const result = applyCommand(state, {
    type: "craft",
    recipeId: "campfire",
    placement: FIRE_PLACEMENT,
  });
  const events = result.eventLog.slice(eventCountBefore);
  assert.deepEqual(result.inventory, inventoryBefore);
  assert.equal(result.clock.tick, state.clock.tick);
  assert.equal(result.camp.fire.built, false);
  assert.deepEqual(result.camp.structures, []);
  assert.ok(events.some((event) => event.type === "craft-failed"));
  assert.ok(
    events.some((event) => event.message === CAMPFIRE_RAIN_EXPOSED_GUIDANCE),
  );
  assert.ok(
    events.every(
      (event) =>
        event.type !== "fire-lit" && event.type !== "craft-succeeded",
    ),
  );
});

test("a campfire placed under an existing shelter ignites during the same storm", () => {
  const state = safeState("storm-sheltered-new-fire");
  state.camp.shelterBuilt = true;
  state.camp.structures = [
    placed("structure.shelter.ignition-test", "shelter"),
  ];

  assert.equal(canCraft(state, "campfire").ok, true);
  assert.equal(
    canCraftAtPlacement(state, "campfire", FIRE_PLACEMENT).ok,
    true,
  );
  const result = applyCommand(state, {
    type: "craft",
    recipeId: "campfire",
    placement: FIRE_PLACEMENT,
  });

  assert.equal(result.camp.fire.built, true);
  assert.equal(result.camp.fire.lit, true);
  assert.equal(result.camp.fire.sheltered, true);
  assert.equal(result.inventory.stick, 0);
  assert.equal(result.inventory["dry-leaf"], 0);
  assert.deepEqual(
    result.camp.structures?.map((structure) => structure.kind),
    ["shelter", "campfire"],
  );
  assert.ok(result.eventLog.some((event) => event.type === "fire-lit"));
  assert.ok(result.eventLog.some((event) => event.type === "craft-succeeded"));
});

test("craft settlement rechecks a strengthening storm without consuming materials", () => {
  const state = safeState("storm-strengthens-during-build");
  state.weather.rainIntensity =
    CAMPFIRE_IGNITION_BLOCKING_RAIN_INTENSITY - 0.01;
  state.weather.targetRainIntensity = 1;
  state.weather.storm = true;
  const inventoryBefore = { ...state.inventory };
  const eventCountBefore = state.eventLog.length;

  assert.equal(
    canCraftAtPlacement(state, "campfire", FIRE_PLACEMENT).ok,
    true,
  );
  const result = applyCommand(state, {
    type: "craft",
    recipeId: "campfire",
    placement: FIRE_PLACEMENT,
  });
  const events = result.eventLog.slice(eventCountBefore);

  assert.ok(result.clock.tick > state.clock.tick);
  assert.deepEqual(result.inventory, inventoryBefore);
  assert.equal(result.camp.fire.built, false);
  assert.deepEqual(result.camp.structures, []);
  assert.ok(
    events.some(
      (event) =>
        event.type === "craft-failed" &&
        event.details?.reason === "rain-exposed" &&
        event.details?.phase === "settlement",
    ),
  );
  assert.ok(
    events.every(
      (event) =>
        event.type !== "fire-lit" && event.type !== "craft-succeeded",
    ),
  );
});

test("relighting uses the same real shelter check as new-fire ignition", () => {
  const exposed = safeState("storm-relight-consistency");
  exposed.inventory.stick = 0;
  exposed.inventory["dry-leaf"] = 1;
  exposed.camp.fire = {
    built: true,
    lit: false,
    fuelSeconds: 120,
    rainExposure: 0,
    sheltered: true,
  };
  exposed.camp.structures = [
    placed("structure.campfire.relight-test", "campfire"),
  ];
  const ignition = resolveCurrentCampfireIgnition(exposed);
  assert.equal(ignition.blocker, "rain-exposed");
  assert.equal(ignition.sheltered, false, "stale cached cover cannot grant ignition");
  const exposedRecipe = createGameViewModel(exposed).recipes.find(
    (entry) => entry.id === "add-fuel",
  );
  assert.equal(exposedRecipe?.available, false);
  assert.equal(exposedRecipe?.reason, CAMPFIRE_RAIN_EXPOSED_GUIDANCE);

  const rejected = applyCommand(exposed, { type: "add-fuel" });
  assert.equal(rejected.inventory["dry-leaf"], 1);
  assert.equal(rejected.camp.fire.lit, false);
  assert.equal(rejected.clock.tick, exposed.clock.tick);
  assert.ok(
    rejected.eventLog
      .slice(exposed.eventLog.length)
      .every(
        (event) =>
          event.type !== "fuel-added" && event.type !== "fire-lit",
      ),
  );

  const covered = structuredClone(exposed);
  covered.camp.fire.sheltered = false;
  covered.camp.shelterBuilt = true;
  covered.camp.structures?.push(
    placed("structure.shelter.relight-test", "shelter"),
  );
  assert.equal(resolveCurrentCampfireIgnition(covered).canIgnite, true);
  const coveredRecipe = createGameViewModel(covered).recipes.find(
    (entry) => entry.id === "add-fuel",
  );
  assert.equal(coveredRecipe?.available, true);

  const relit = applyCommand(covered, { type: "add-fuel" });
  assert.equal(relit.inventory["dry-leaf"], 0);
  assert.equal(relit.camp.fire.lit, true);
  assert.equal(relit.camp.fire.sheltered, true);
  assert.ok(relit.eventLog.some((event) => event.type === "fuel-added"));
  assert.ok(relit.eventLog.some((event) => event.type === "fire-lit"));
});
