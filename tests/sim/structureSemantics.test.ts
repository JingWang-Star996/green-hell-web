import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRE_COMFORT_RADIUS,
  REST_SIMULATION_SECONDS,
  applyCommand,
  createInitialState,
  isNearCampStructure,
  isShelteredByCampStructures,
  stepSimulation,
} from "../../src/game/sim/index";
import type {
  GameState,
  PlacedStructureKind,
  PlacedStructureState,
} from "../../src/game/sim/index";

function placed(
  kind: PlacedStructureKind,
  x: number,
  z: number,
  yaw = 0,
): PlacedStructureState {
  return {
    id: `structure.${kind}.test`,
    kind,
    position: { x, y: 0, z },
    yaw,
    builtAtTick: 0,
  };
}

function makeSurvivalSafe(state: GameState): void {
  state.player.conditions.wound = {
    open: false,
    treated: true,
    severity: 0,
    infection: 0,
  };
  state.player.conditions.parasites = 0;
  state.player.conditions.wetness = 20;
  state.player.nutrition = {
    carbohydrates: 100,
    protein: 100,
    fat: 100,
    hydration: 100,
  };
  state.player.vitals = {
    health: 100,
    stamina: 100,
    energy: 80,
    sanity: 50,
  };
}

test("fuel and rest actions follow their placed structures instead of camp center", () => {
  const fireState = createInitialState("placed-fire-action");
  makeSurvivalSafe(fireState);
  fireState.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 100,
    rainExposure: 0,
    sheltered: false,
  };
  fireState.camp.structures = [placed("campfire", 6, 0)];
  fireState.inventory.stick = 2;
  fireState.inventory["dirty-water"] = 1;
  fireState.player.position = { ...fireState.camp.position };

  const tooFarFromFire = applyCommand(fireState, { type: "add-fuel" });
  assert.equal(tooFarFromFire.inventory.stick, 2);
  assert.equal(tooFarFromFire.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(
    tooFarFromFire.eventLog.at(-1)?.details?.requiredStructure,
    "campfire",
  );
  const tooFarToBoil = applyCommand(fireState, { type: "boil-water" });
  assert.equal(tooFarToBoil.inventory["dirty-water"], 1);
  assert.equal(tooFarToBoil.inventory["clean-water"], 0);
  assert.equal(tooFarToBoil.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(
    tooFarToBoil.eventLog.at(-1)?.details?.requiredStructure,
    "campfire",
  );

  fireState.player.position = { x: 4, y: 0, z: 0 };
  const fuelled = applyCommand(fireState, { type: "add-fuel" });
  assert.equal(fuelled.inventory.stick, 1);
  assert.equal(fuelled.eventLog.at(-1)?.type, "fuel-added");
  const boiled = applyCommand(fireState, { type: "boil-water" });
  assert.equal(boiled.inventory["dirty-water"], 0);
  assert.equal(boiled.inventory["clean-water"], 1);
  assert.equal(boiled.eventLog.at(-1)?.type, "water-purified");

  const bedState = createInitialState("placed-bed-action");
  makeSurvivalSafe(bedState);
  bedState.camp.bedBuilt = true;
  bedState.camp.structures = [placed("bed", 6, 0, Math.PI / 2)];
  bedState.player.position = { ...bedState.camp.position };
  const tooFarFromBed = applyCommand(bedState, { type: "rest" });
  assert.equal(tooFarFromBed.clock.tick, 0);
  assert.equal(tooFarFromBed.eventLog.at(-1)?.type, "command-rejected");

  bedState.player.position = { x: 4.2, y: 0, z: 0 };
  assert.equal(isNearCampStructure(bedState, "bed"), true);
  const rested = applyCommand(bedState, { type: "rest" });
  assert.equal(rested.clock.elapsedSeconds, REST_SIMULATION_SECONDS);
  assert.equal(rested.eventLog.at(-1)?.type, "rest-completed");
});

test("rain cover and night fire comfort use local placed-structure radii", () => {
  const rainBase = createInitialState("placed-rain-cover");
  makeSurvivalSafe(rainBase);
  rainBase.weather.rainIntensity = 1;
  rainBase.weather.targetRainIntensity = 1;
  rainBase.weather.secondsUntilChange = 10_000;
  rainBase.camp.shelterBuilt = true;
  rainBase.camp.structures = [placed("shelter", 6, 0)];

  const farFromShelter = structuredClone(rainBase);
  farFromShelter.player.position = { x: 0, y: 0, z: 0 };
  const exposed = stepSimulation(farFromShelter, {}, 1);
  const underShelter = structuredClone(rainBase);
  underShelter.player.position = { x: 6, y: 0, z: 0 };
  assert.equal(isShelteredByCampStructures(underShelter), true);
  const dry = stepSimulation(underShelter, {}, 1);
  assert.ok(exposed.player.conditions.wetness > rainBase.player.conditions.wetness);
  assert.ok(dry.player.conditions.wetness < rainBase.player.conditions.wetness);

  const exposedBed = createInitialState("placed-bed-is-not-a-roof");
  makeSurvivalSafe(exposedBed);
  exposedBed.weather.rainIntensity = 1;
  exposedBed.weather.targetRainIntensity = 1;
  exposedBed.weather.secondsUntilChange = 10_000;
  exposedBed.camp.bedBuilt = true;
  exposedBed.camp.structures = [placed("bed", -6, 0)];
  exposedBed.player.position = { x: -6, y: 0, z: 0 };
  assert.equal(isShelteredByCampStructures(exposedBed), false);
  const rainedOnBed = stepSimulation(exposedBed, {}, 1);
  assert.ok(
    rainedOnBed.player.conditions.wetness > exposedBed.player.conditions.wetness,
    "a bed alone must not create an invisible rain-cover radius",
  );

  const fireBase = createInitialState("placed-fire-comfort");
  makeSurvivalSafe(fireBase);
  fireBase.clock.gameMinutesElapsed = 8 * 60;
  fireBase.clock.minuteOfDay = 22 * 60;
  fireBase.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 10_000,
    rainExposure: 0,
    sheltered: true,
  };
  fireBase.camp.structures = [placed("campfire", 6, 0)];

  const farFromFire = structuredClone(fireBase);
  farFromFire.player.position = { x: 0, y: 0, z: 0 };
  assert.equal(
    isNearCampStructure(farFromFire, "campfire", FIRE_COMFORT_RADIUS),
    false,
  );
  const lonely = stepSimulation(farFromFire, {}, 1);
  const besideFire = structuredClone(fireBase);
  besideFire.player.position = { x: 4, y: 0, z: 0 };
  const comforted = stepSimulation(besideFire, {}, 1);
  assert.ok(lonely.player.vitals.sanity < fireBase.player.vitals.sanity);
  assert.ok(comforted.player.vitals.sanity > fireBase.player.vitals.sanity);
});

test("a shelter protects a fire under its roof but not one four metres away", () => {
  const makeRainyPair = (distance: number): GameState => {
    const state = createInitialState(`fire-shelter-boundary:${distance}`);
    makeSurvivalSafe(state);
    state.camp.fire = {
      built: true,
      lit: true,
      fuelSeconds: 10_000,
      rainExposure: 0,
      sheltered: false,
    };
    state.camp.shelterBuilt = true;
    state.camp.structures = [
      placed("campfire", 0, 0),
      placed("shelter", distance, 0),
    ];
    state.weather.rainIntensity = 1;
    state.weather.targetRainIntensity = 1;
    state.weather.secondsUntilChange = 10_000;
    state.player.position = { x: distance, y: 0, z: 0 };
    return state;
  };

  const underRoof = stepSimulation(makeRainyPair(1.5), {}, 8);
  const fourMetresAway = stepSimulation(makeRainyPair(4), {}, 8);
  assert.equal(underRoof.camp.fire.sheltered, true);
  assert.equal(underRoof.camp.fire.lit, true);
  assert.equal(fourMetresAway.camp.fire.sheltered, false);
  assert.equal(fourMetresAway.camp.fire.lit, false);
  assert.ok(
    fourMetresAway.eventLog.some(
      (event) =>
        event.type === "fire-extinguished" &&
        event.cause.code === "rain-exposure",
    ),
  );
});

test("deterministic movement cannot pass through a placed campfire footprint", () => {
  const open = createInitialState("open-movement");
  makeSurvivalSafe(open);
  const openResult = stepSimulation(
    open,
    { movement: { x: 1, z: 0 } },
    1,
  );

  const blocked = createInitialState("blocked-movement");
  makeSurvivalSafe(blocked);
  blocked.camp.fire.built = true;
  blocked.camp.structures = [placed("campfire", 1, -5)];
  const blockedResult = stepSimulation(
    blocked,
    { movement: { x: 1, z: 0 } },
    1,
  );

  assert.ok(openResult.player.position.x > 2.5);
  assert.ok(blockedResult.player.position.x < 0.2);
});
