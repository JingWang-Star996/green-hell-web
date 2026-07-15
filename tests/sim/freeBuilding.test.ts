import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  canCraft,
  cloneGameState,
  createInitialState,
  migrateGameState,
} from "../../src/game/sim/index";
import type {
  GameState,
  PlacedStructureKind,
  PlacedStructureState,
} from "../../src/game/sim/types";

function structure(
  id: string,
  kind: PlacedStructureKind,
  x: number,
  z: number,
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
  state.player.position = { x: 0, y: 0, z: 0 };
  state.player.conditions.wound.open = false;
  state.player.conditions.wound.severity = 0;
  state.player.vitals.health = 100;
  state.player.vitals.energy = 100;
  state.player.nutrition.hydration = 100;
  state.player.nutrition.carbohydrates = 100;
  state.player.nutrition.protein = 100;
  state.player.nutrition.fat = 100;
  state.weather.rainIntensity = 0;
  state.weather.targetRainIntensity = 0;
  return state;
}

test("ordinary structures stay craftable after the first instance while the story beacon remains unique", () => {
  const state = safeState("free-building-recipes");
  for (const item of ["stick", "dry-leaf", "vine", "broad-leaf", "stone"] as const) {
    state.inventory[item] = 99;
  }
  state.inventory.axe = 2;
  state.inventory["stone-blade"] = 2;
  state.inventory.torch = 2;
  state.inventory["coconut-shell"] = 6;
  state.inventory.battery = 2;
  state.camp.structures = [
    structure("fire.one", "campfire", -2, 0),
    structure("shelter.one", "shelter", 2, 0),
    structure("bed.one", "bed", 2, 0),
    structure("rack.one", "smoking-rack", -3, 2),
    structure("collector.one", "rain-collector", 4, 2),
    structure("waymark.one", "torch-waymark", -4, 2),
    structure("beacon.one", "radio-beacon", 0, 4),
  ];
  state.camp.fire.built = true;
  state.camp.shelterBuilt = true;
  state.camp.bedBuilt = true;
  state.camp.beaconBuilt = true;

  for (const recipeId of [
    "campfire",
    "shelter",
    "bed",
    "smoking-rack",
    "rain-collector",
    "torch-waymark",
  ] as const) {
    assert.notEqual(canCraft(state, recipeId).reason, "already-built");
  }
  assert.equal(canCraft(state, "radio-beacon").reason, "already-built");
});

test("campfires, shelters and beds settle more than one placed instance", () => {
  let fires = safeState("free-building-place-fires");
  fires.inventory.stick = 20;
  fires.inventory["dry-leaf"] = 10;
  fires = applyCommand(fires, {
    type: "craft",
    recipeId: "campfire",
    placement: { position: { x: -2, y: 0, z: -2 }, yaw: 0 },
  });
  fires = applyCommand(fires, {
    type: "craft",
    recipeId: "campfire",
    placement: { position: { x: 2, y: 0, z: -2 }, yaw: 0.4 },
  });
  assert.equal(
    fires.camp.structures?.filter(({ kind }) => kind === "campfire").length,
    2,
  );
  assert.ok(
    fires.camp.structures
      ?.filter(({ kind }) => kind === "campfire")
      .every(({ fire }) => fire?.lit),
  );

  let camp = safeState("free-building-place-cover");
  camp.inventory.stick = 40;
  camp.inventory.vine = 30;
  camp.inventory["broad-leaf"] = 40;
  camp.inventory.axe = 1;
  for (const x of [-2, 2]) {
    camp = applyCommand(camp, {
      type: "craft",
      recipeId: "shelter",
      placement: { position: { x, y: 0, z: -2 }, yaw: 0 },
    });
  }
  for (const x of [-2, 2]) {
    camp = applyCommand(camp, {
      type: "craft",
      recipeId: "bed",
      placement: { position: { x, y: 0, z: -2 }, yaw: 0 },
    });
  }
  assert.equal(
    camp.camp.structures?.filter(({ kind }) => kind === "shelter").length,
    2,
  );
  assert.equal(
    camp.camp.structures?.filter(({ kind }) => kind === "bed").length,
    2,
  );
});

test("fuel settlement is bound to one campfire and both fires advance independently", () => {
  const state = safeState("free-building-fire-runtime");
  const first = structure("fire.first", "campfire", -1, 0);
  first.fire = {
    lit: false,
    fuelSeconds: 120,
    rainExposure: 0,
    sheltered: false,
  };
  const second = structure("fire.second", "campfire", 2, 0);
  second.fire = {
    lit: true,
    fuelSeconds: 400,
    rainExposure: 0,
    sheltered: false,
  };
  state.camp.structures = [first, second];
  state.camp.fire = { built: true, ...first.fire };
  state.inventory["dry-leaf"] = 1;
  state.inventory.stick = 0;

  const next = applyCommand(state, {
    type: "add-fuel",
    structureId: first.id,
  });
  const nextFirst = next.camp.structures?.find(({ id }) => id === first.id);
  const nextSecond = next.camp.structures?.find(({ id }) => id === second.id);
  assert.equal(nextFirst?.fire?.lit, true);
  assert.ok((nextFirst?.fire?.fuelSeconds ?? 0) > 100);
  assert.equal(nextSecond?.fire?.lit, true);
  assert.ok((nextSecond?.fire?.fuelSeconds ?? 0) < 400);
  assert.ok((nextSecond?.fire?.fuelSeconds ?? 0) > 350);
  assert.equal(next.inventory["dry-leaf"], 0);
  assert.equal(
    next.eventLog.findLast((event) => event.type === "fuel-added")?.details
      ?.structureId,
    first.id,
  );
});

test("clone and migration preserve independent campfire runtime without shared references", () => {
  const state = safeState("free-building-save-roundtrip");
  const first = structure("fire.a", "campfire", -3, 0);
  first.fire = { lit: true, fuelSeconds: 111, rainExposure: 2, sheltered: false };
  const second = structure("fire.b", "campfire", 3, 0);
  second.fire = { lit: false, fuelSeconds: 222, rainExposure: 4, sheltered: true };
  state.camp.structures = [first, second];
  state.camp.fire = { built: true, ...first.fire };

  const cloned = cloneGameState(state);
  cloned.camp.structures![0].fire!.fuelSeconds = 999;
  assert.equal(state.camp.structures[0].fire?.fuelSeconds, 111);

  const migrated = migrateGameState(state);
  assert.deepEqual(
    migrated.camp.structures?.map(({ id, fire }) => [id, fire?.fuelSeconds]),
    [
      ["fire.a", 111],
      ["fire.b", 222],
    ],
  );
  assert.equal(migrated.camp.fire.fuelSeconds, 111);
});

test("boil-water without an explicit id selects the nearest usable lit fire", () => {
  const state = safeState("free-building-boil-lit-fire");
  const cold = structure("fire.cold-near", "campfire", 0.5, 0);
  cold.fire = {
    lit: false,
    fuelSeconds: 0,
    rainExposure: 0,
    sheltered: false,
  };
  const lit = structure("fire.lit-farther", "campfire", 2.5, 0);
  lit.fire = {
    lit: true,
    fuelSeconds: 500,
    rainExposure: 0,
    sheltered: false,
  };
  state.camp.structures = [cold, lit];
  state.camp.fire = { built: true, ...cold.fire };
  state.inventory["dirty-water"] = 1;

  const next = applyCommand(state, { type: "boil-water" });
  assert.equal(next.inventory["dirty-water"], 0);
  assert.equal(next.inventory["clean-water"], 1);
  assert.equal(
    next.eventLog.findLast((event) => event.type === "water-purified")
      ?.details?.structureId,
    lit.id,
  );
});

test("add-fuel without an explicit id relights the nearest cold fire instead of targeting a distant lit fire", () => {
  const state = safeState("free-building-refuel-nearest-fire");
  const cold = structure("fire.cold-near", "campfire", 0.5, 0);
  cold.fire = {
    lit: false,
    fuelSeconds: 120,
    rainExposure: 0,
    sheltered: false,
  };
  const lit = structure("fire.lit-far", "campfire", 20, 0);
  lit.fire = {
    lit: true,
    fuelSeconds: 500,
    rainExposure: 0,
    sheltered: false,
  };
  state.camp.structures = [cold, lit];
  state.camp.fire = { built: true, ...cold.fire };
  state.inventory["dry-leaf"] = 1;
  state.inventory.stick = 0;

  const next = applyCommand(state, { type: "add-fuel" });
  assert.equal(
    next.camp.structures?.find(({ id }) => id === cold.id)?.fire?.lit,
    true,
  );
  assert.ok(
    Math.abs(
      (next.camp.structures?.find(({ id }) => id === lit.id)?.fire
        ?.fuelSeconds ?? 0) - 494,
    ) < 1e-6,
  );
  assert.equal(
    next.eventLog.findLast((event) => event.type === "fuel-added")?.details
      ?.structureId,
    cold.id,
  );
});
