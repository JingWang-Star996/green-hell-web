import assert from "node:assert/strict";
import test from "node:test";

import { RESOURCE_REGENERATION } from "../../src/game/sim/content";
import {
  DEFAULT_STRUCTURE_PLACEMENTS,
  FIXED_HZ,
  GAME_DAY_SIMULATION_SECONDS,
  MAXIMUM_FIRE_FUEL_SECONDS,
  REST_GAME_HOURS,
  REST_SIMULATION_SECONDS,
  applyCommand,
  createInitialState,
  gameHoursToSimulationSeconds,
  migrateGameState,
  stepSimulation,
} from "../../src/game/sim/index";
import type { GameState } from "../../src/game/sim/index";
import { createGameViewModel } from "../../src/game/ui/viewModel";

function prepareSafeRest(state: GameState): GameState {
  state.camp.bedBuilt = true;
  state.camp.shelterBuilt = true;
  state.player.position = {
    ...DEFAULT_STRUCTURE_PLACEMENTS.bed.position,
  };
  state.player.conditions.wound.open = false;
  state.player.conditions.wound.treated = true;
  state.player.conditions.wound.severity = 0;
  state.player.conditions.wound.infection = 0;
  state.player.nutrition = {
    carbohydrates: 100,
    protein: 100,
    fat: 100,
    hydration: 100,
  };
  state.player.vitals.health = 100;
  return state;
}

test("the authored clock has an explicit 48-minute day and rest resolves every survival system for eight game hours", () => {
  assert.equal(GAME_DAY_SIMULATION_SECONDS, 48 * 60);
  assert.equal(REST_GAME_HOURS, 8);
  assert.equal(
    REST_SIMULATION_SECONDS,
    gameHoursToSimulationSeconds(REST_GAME_HOURS),
  );

  const state = prepareSafeRest(createInitialState("complete-rest"));
  state.player.vitals.energy = 20;
  state.player.conditions.wetness = 60;
  state.weather.secondsUntilChange = 1;
  state.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 30,
    rainExposure: 0,
    sheltered: true,
  };
  state.inventory.grubs = 1;
  state.itemLifecycle = {
    balanceVersion: 2,
    perishables: {
      grubs: [
        {
          quantity: 1,
          expiresAtTick: state.clock.tick + FIXED_HZ * 10,
        },
      ],
    },
    tools: {},
  };
  const remoteNode = state.world.entities["resource.stick.trail-01"];
  remoteNode.position = { x: 100, y: 0, z: -100 };
  remoteNode.quantity = 0;
  remoteNode.depleted = true;
  remoteNode.regeneration = {
    capacity: 12,
    nextTick: 1,
    cycle: 0,
    nextAmount: 1,
  };
  const weatherRngBefore = state.rng.weather;

  const rested = applyCommand(state, { type: "rest" });

  assert.equal(rested.clock.tick, REST_SIMULATION_SECONDS * FIXED_HZ);
  assert.equal(rested.clock.elapsedSeconds, REST_SIMULATION_SECONDS);
  assert.equal(rested.clock.day, 1);
  assert.ok(Math.abs(rested.clock.minuteOfDay - 22 * 60) < 1e-6);
  assert.ok(rested.player.nutrition.hydration < 100, "sleep pays metabolism");
  assert.ok(rested.player.vitals.energy > 20, "sleep restores energy after metabolism");
  assert.ok(rested.player.conditions.wetness < 60, "sheltered sleep dries the player");
  assert.equal(rested.camp.fire.lit, false, "fuel burns for the full sleep duration");
  assert.equal(rested.inventory.grubs, 0, "food expires during sleep");
  assert.notEqual(rested.rng.weather, weatherRngBefore, "weather fronts advance during sleep");
  assert.ok(remoteNode.quantity === 0, "the source state remains immutable");
  assert.ok(
    rested.world.entities[remoteNode.id].quantity > 0,
    "due remote resources materialize while sleeping",
  );
  assert.ok(rested.eventLog.some((event) => event.type === "food-spoiled"));
  assert.ok(rested.eventLog.some((event) => event.type === "fire-extinguished"));
  assert.equal(rested.eventLog.at(-1)?.type, "rest-completed");
  assert.equal(rested.eventLog.at(-1)?.details?.endMinute, 22 * 60);
  assert.equal(createGameViewModel(rested).watch.time, "22:00");
});

test("a full campfire never wastes a stick, while retained fuel can be relit with tinder only", () => {
  const full = createInitialState("full-fire-protection");
  full.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: MAXIMUM_FIRE_FUEL_SECONDS,
    rainExposure: 0,
    sheltered: true,
  };
  full.player.position = { ...DEFAULT_STRUCTURE_PLACEMENTS.campfire.position };
  full.inventory.stick = 1;
  const fullRecipe = createGameViewModel(full).recipes.find(
    (recipe) => recipe.id === "add-fuel",
  );
  assert.equal(fullRecipe?.available, false);
  assert.equal(fullRecipe?.reason, "燃料已满；无需浪费木棍");
  const rejected = applyCommand(full, { type: "add-fuel" });
  assert.equal(rejected.inventory.stick, 1);
  assert.equal(rejected.camp.fire.fuelSeconds, MAXIMUM_FIRE_FUEL_SECONDS);
  assert.equal(rejected.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(
    rejected.eventLog.at(-1)?.details?.fuelCapacitySeconds,
    MAXIMUM_FIRE_FUEL_SECONDS,
  );

  const unlit = createInitialState("relight-retained-fuel");
  unlit.camp.fire = {
    built: true,
    lit: false,
    fuelSeconds: MAXIMUM_FIRE_FUEL_SECONDS,
    rainExposure: 0,
    sheltered: true,
  };
  unlit.player.position = { ...DEFAULT_STRUCTURE_PLACEMENTS.campfire.position };
  unlit.inventory.stick = 0;
  unlit.inventory["dry-leaf"] = 1;
  const retainedEmberRecipe = createGameViewModel(unlit).recipes.find(
    (recipe) => recipe.id === "add-fuel",
  );
  assert.equal(retainedEmberRecipe?.available, true);
  assert.deepEqual(retainedEmberRecipe?.ingredients, ["干叶 ×1"]);
  const relit = applyCommand(unlit, { type: "add-fuel" });
  assert.equal(relit.camp.fire.lit, true);
  assert.equal(relit.inventory.stick, 0);
  assert.equal(relit.inventory["dry-leaf"], 0);
  assert.equal(relit.camp.fire.fuelSeconds, MAXIMUM_FIRE_FUEL_SECONDS);
  const fuelEvent = relit.eventLog.findLast((event) => event.type === "fuel-added");
  assert.equal(fuelEvent?.details?.stickConsumed, false);
  assert.equal(fuelEvent?.details?.fuelAddedSeconds, 0);
});

test("clock migration preserves a legacy calendar and an eight-hour rest crosses midnight without rewinding", () => {
  const legacy = prepareSafeRest(createInitialState("legacy-calendar"));
  delete legacy.clock.gameMinutesElapsed;
  legacy.clock.tick = 600 * FIXED_HZ;
  legacy.clock.elapsedSeconds = 600;
  legacy.clock.day = 3;
  legacy.clock.minuteOfDay = 23 * 60 + 30;

  const migrated = migrateGameState(legacy);
  assert.equal(migrated.clock.day, 3);
  assert.equal(migrated.clock.minuteOfDay, 23 * 60 + 30);
  assert.equal(legacy.clock.gameMinutesElapsed, undefined);

  const rested = applyCommand(migrated, { type: "rest" });
  assert.equal(rested.clock.day, 4);
  assert.ok(Math.abs(rested.clock.minuteOfDay - (7 * 60 + 30)) < 1e-6);
  assert.equal(
    rested.clock.elapsedSeconds,
    legacy.clock.elapsedSeconds + REST_SIMULATION_SECONDS,
  );
});

test("resource windows and batches vary by seed/node but survive save-load and replay exactly", () => {
  const definition = RESOURCE_REGENERATION.stick!;
  const schedules = new Set<string>();
  let replaySource: GameState | null = null;

  for (const seed of ["growth-a", "growth-b", "growth-c", "growth-d"]) {
    for (const entityId of [
      "resource.stick.camp-01",
      "resource.stick.trail-01",
    ]) {
      let state = createInitialState(seed);
      state.player.position = { ...state.world.entities[entityId].position };
      state = applyCommand(state, { type: "pick-up", entityId });
      const regeneration = state.world.entities[entityId].regeneration;
      assert.ok(regeneration?.nextTick);
      assert.ok(regeneration.nextAmount);
      const delaySeconds =
        (regeneration.nextTick - state.clock.tick) / FIXED_HZ;
      assert.ok(
        delaySeconds >=
          gameHoursToSimulationSeconds(definition.minimumIntervalGameHours),
      );
      assert.ok(
        delaySeconds <=
          gameHoursToSimulationSeconds(definition.maximumIntervalGameHours),
      );
      assert.ok(regeneration.nextAmount >= definition.minimumAmount);
      assert.ok(regeneration.nextAmount <= definition.maximumAmount);
      schedules.add(`${Math.round(delaySeconds * FIXED_HZ)}:${regeneration.nextAmount}`);
      replaySource ??= state;
    }
  }
  assert.ok(schedules.size > 1, "nodes must not respawn as a synchronized wave");
  assert.ok(replaySource);

  const restored = migrateGameState(
    JSON.parse(JSON.stringify(replaySource)) as GameState,
  );
  replaySource.player.position = { x: -100, y: 0, z: -100 };
  restored.player.position = { ...replaySource.player.position };
  const advanceSeconds =
    gameHoursToSimulationSeconds(definition.maximumIntervalGameHours) + 1;
  const replayed = stepSimulation(replaySource, {}, advanceSeconds);
  const loadedReplay = stepSimulation(restored, {}, advanceSeconds);
  const entityId = "resource.stick.camp-01";

  assert.deepEqual(
    loadedReplay.world.entities[entityId],
    replayed.world.entities[entityId],
    "serialized regeneration state must produce the same deadline, batch, and next cycle",
  );
});
