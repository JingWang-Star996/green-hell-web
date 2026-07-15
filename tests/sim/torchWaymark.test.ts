import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ECOLOGY_FRAME_DETERRENTS,
} from "../../src/game/ecology";
import {
  REST_SIMULATION_SECONDS,
  TORCH_MAX_BURN_SECONDS,
  activeFireDeterrents,
  addTorchInventoryUnit,
  applyCommand,
  createInitialState,
  projectActiveWildlife,
  resolveAffordance,
  stepSimulation,
  type GameState,
  type PlacedStructureState,
  type StructurePlacement,
} from "../../src/game/sim";
import {
  RIVER_SURFACE_HALF_WIDTH,
  riverDistance,
  terrainHeight,
  terrainSlopeAcross,
} from "../../src/game/world/terrain";

function stableWeather(state: GameState, rainIntensity = 0): void {
  state.weather.rainIntensity = rainIntensity;
  state.weather.targetRainIntensity = rainIntensity;
  state.weather.secondsUntilChange = REST_SIMULATION_SECONDS + 10_000;
}

function stockWaymarkMaterials(
  state: GameState,
  torchFuelSeconds: number,
): void {
  state.inventory.stick = 4;
  state.inventory.stone = 3;
  state.inventory.vine = 1;
  assert.equal(
    addTorchInventoryUnit(state, {
      remainingBurnSeconds: torchFuelSeconds,
    }),
    true,
  );
}

function validWaymarkPlacement(state: GameState): StructurePlacement {
  for (let radius = 1.5; radius <= 5.5; radius += 0.5) {
    for (let step = 0; step < 24; step += 1) {
      const angle = (step / 24) * Math.PI * 2;
      const x = state.player.position.x + Math.cos(angle) * radius;
      const z = state.player.position.z + Math.sin(angle) * radius;
      if (riverDistance(x, z) <= 0.65 + RIVER_SURFACE_HALF_WIDTH) continue;
      if (terrainSlopeAcross(x, z, 0.65) > 0.68) continue;
      return {
        position: { x, y: terrainHeight(x, z), z },
        yaw: angle,
      };
    }
  }
  throw new Error("test seed has no valid waymark placement within six metres");
}

function waymark(
  state: GameState,
  id: string,
  overrides: Partial<PlacedStructureState> = {},
): PlacedStructureState {
  return {
    id,
    kind: "torch-waymark",
    position: {
      x: state.player.position.x + 1,
      y: 0,
      z: state.player.position.z,
    },
    yaw: 0,
    builtAtTick: state.clock.tick,
    torchFuelQueueSeconds: [],
    lit: false,
    everLit: false,
    lastAdvancedTick: state.clock.tick,
    ...overrides,
  };
}

function installWaymark(
  state: GameState,
  overrides: Partial<PlacedStructureState> = {},
): PlacedStructureState {
  const structure = waymark(state, "structure.torch-waymark.test", overrides);
  state.camp.structures ??= [];
  state.camp.structures.push(structure);
  return structure;
}

function restoredWaymark(state: GameState): PlacedStructureState {
  return state.camp.structures!.find(
    (structure) => structure.kind === "torch-waymark",
  )!;
}

function assertClose(actual: number, expected: number, epsilon = 1e-6): void {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("building transfers one half-burned concrete torch after work without duplicating fuel", () => {
  const state = createInitialState("waymark-half-burn-build");
  stableWeather(state);
  const startingFuel = TORCH_MAX_BURN_SECONDS / 2;
  stockWaymarkMaterials(state, startingFuel);
  state.player.equippedItem = "torch";
  const placement = validWaymarkPlacement(state);

  const built = applyCommand(state, {
    type: "craft",
    recipeId: "torch-waymark",
    placement,
  });

  const structure = restoredWaymark(built);
  assert.equal(built.inventory.torch, 0);
  assert.equal(built.player.equippedItem, null);
  assert.equal(built.inventory.stick, 0);
  assert.equal(built.inventory.stone, 0);
  assert.equal(built.inventory.vine, 0);
  assert.equal(structure.lit, true);
  assert.equal(structure.everLit, true);
  assert.equal(structure.torchFuelQueueSeconds?.length, 1);
  assertClose(
    structure.torchFuelQueueSeconds![0],
    startingFuel - 40,
    1e-4,
  );
  assert.equal(
    built.eventLog.filter(
      (event) =>
        event.type === "item-unequipped" &&
        event.cause.code === "craft:torch-waymark:transfer",
    ).length,
    1,
  );
  assert.equal(
    built.eventLog.filter((event) => event.type === "structure-fuel-added")
      .length,
    1,
  );
  assert.equal(
    built.eventLog.filter((event) => event.type === "structure-ignited").length,
    1,
  );
});

test("invalid placement, death, settlement storm and burned-out torch consume no build materials", () => {
  const noPlacement = createInitialState("waymark-no-placement");
  stableWeather(noPlacement);
  stockWaymarkMaterials(noPlacement, TORCH_MAX_BURN_SECONDS);
  const rejectedNoPlacement = applyCommand(noPlacement, {
    type: "craft",
    recipeId: "torch-waymark",
  });
  assert.equal(rejectedNoPlacement.camp.structures!.some((entry) => entry.kind === "torch-waymark"), false);
  assert.deepEqual(rejectedNoPlacement.inventory, noPlacement.inventory);

  const outOfRange = createInitialState("waymark-out-of-range");
  stableWeather(outOfRange);
  stockWaymarkMaterials(outOfRange, TORCH_MAX_BURN_SECONDS);
  const farPlacement = validWaymarkPlacement(outOfRange);
  farPlacement.position.x += 20;
  const rejectedFar = applyCommand(outOfRange, {
    type: "craft",
    recipeId: "torch-waymark",
    placement: farPlacement,
  });
  assert.deepEqual(rejectedFar.inventory, outOfRange.inventory);

  const dying = createInitialState("waymark-build-death");
  stableWeather(dying);
  stockWaymarkMaterials(dying, TORCH_MAX_BURN_SECONDS);
  dying.player.vitals.health = 0.001;
  dying.player.vitals.energy = 0;
  dying.player.nutrition.carbohydrates = 0;
  dying.player.nutrition.protein = 0;
  dying.player.nutrition.fat = 0;
  dying.player.nutrition.hydration = 0;
  const died = applyCommand(dying, {
    type: "craft",
    recipeId: "torch-waymark",
    placement: validWaymarkPlacement(dying),
  });
  assert.equal(died.status, "lost");
  assert.equal(died.inventory.stick, 4);
  assert.equal(died.inventory.stone, 3);
  assert.equal(died.inventory.vine, 1);
  assert.equal(died.inventory.torch, 1);
  assert.equal(died.camp.structures!.some((entry) => entry.kind === "torch-waymark"), false);

  const storm = createInitialState("waymark-build-settlement-storm");
  stockWaymarkMaterials(storm, TORCH_MAX_BURN_SECONDS);
  storm.weather.rainIntensity = 0.79;
  storm.weather.targetRainIntensity = 0.9;
  storm.weather.secondsUntilChange = 10_000;
  const stormRejected = applyCommand(storm, {
    type: "craft",
    recipeId: "torch-waymark",
    placement: validWaymarkPlacement(storm),
  });
  assert.equal(stormRejected.inventory.stick, 4);
  assert.equal(stormRejected.inventory.stone, 3);
  assert.equal(stormRejected.inventory.vine, 1);
  assert.equal(stormRejected.inventory.torch, 1);
  assert.equal(stormRejected.camp.structures!.some((entry) => entry.kind === "torch-waymark"), false);

  const burnedOut = createInitialState("waymark-build-burned-out");
  stableWeather(burnedOut);
  stockWaymarkMaterials(burnedOut, 1);
  burnedOut.player.equippedItem = "torch";
  const emptyRejected = applyCommand(burnedOut, {
    type: "craft",
    recipeId: "torch-waymark",
    placement: validWaymarkPlacement(burnedOut),
  });
  assert.equal(emptyRejected.inventory.stick, 4);
  assert.equal(emptyRejected.inventory.stone, 3);
  assert.equal(emptyRejected.inventory.vine, 1);
  assert.equal(emptyRejected.inventory.torch, 0);
  assert.equal(emptyRejected.camp.structures!.some((entry) => entry.kind === "torch-waymark"), false);
});

test("waymark E interaction implements insert, relight, top-up and full states atomically", () => {
  const empty = createInitialState("waymark-use-insert");
  stableWeather(empty);
  installWaymark(empty);
  assert.equal(addTorchInventoryUnit(empty, { remainingBurnSeconds: 80 }), true);
  const emptyAffordance = resolveAffordance(empty, restoredWaymark(empty));
  assert.equal(emptyAffordance.actionId, "insert-torch-waymark");
  assert.equal(emptyAffordance.preview.fuelSlots, 0);
  const inserted = applyCommand(empty, {
    type: "use-structure",
    structureId: "structure.torch-waymark.test",
  });
  assert.deepEqual(restoredWaymark(inserted).torchFuelQueueSeconds, [80]);
  assert.equal(restoredWaymark(inserted).lit, true);
  assert.equal(inserted.inventory.torch, 0);

  const cold = createInitialState("waymark-use-relight");
  stableWeather(cold);
  installWaymark(cold, {
    torchFuelQueueSeconds: [80],
    lit: false,
    everLit: true,
  });
  const coldAffordance = resolveAffordance(cold, restoredWaymark(cold));
  assert.equal(coldAffordance.actionId, "relight-torch-waymark");
  const relit = applyCommand(cold, {
    type: "use-structure",
    structureId: "structure.torch-waymark.test",
  });
  assert.deepEqual(restoredWaymark(relit).torchFuelQueueSeconds, [80]);
  assert.equal(restoredWaymark(relit).lit, true);

  const lit = createInitialState("waymark-use-top-up");
  stableWeather(lit);
  installWaymark(lit, {
    torchFuelQueueSeconds: [100],
    lit: true,
    everLit: true,
  });
  assert.equal(addTorchInventoryUnit(lit, { remainingBurnSeconds: 200 }), true);
  const topUpAffordance = resolveAffordance(lit, restoredWaymark(lit));
  assert.equal(topUpAffordance.actionId, "top-up-torch-waymark");
  const topped = applyCommand(lit, {
    type: "use-structure",
    structureId: "structure.torch-waymark.test",
  });
  assertClose(restoredWaymark(topped).torchFuelQueueSeconds![0], 97, 1e-5);
  assert.equal(restoredWaymark(topped).torchFuelQueueSeconds![1], 200);
  assert.equal(topped.inventory.torch, 0);

  const full = createInitialState("waymark-use-full");
  stableWeather(full);
  installWaymark(full, {
    torchFuelQueueSeconds: [100, 200],
    lit: true,
    everLit: true,
  });
  assert.equal(addTorchInventoryUnit(full, { remainingBurnSeconds: 50 }), true);
  const fullAffordance = resolveAffordance(full, restoredWaymark(full));
  assert.equal(fullAffordance.blocker, "fuel-slots-full");
  assert.equal(fullAffordance.preview.fuelSlots, 2);
  const blocked = applyCommand(full, {
    type: "use-structure",
    structureId: "structure.torch-waymark.test",
  });
  assert.deepEqual(restoredWaymark(blocked).torchFuelQueueSeconds, [100, 200]);
  assert.equal(blocked.inventory.torch, 1);

  const changing = createInitialState("waymark-use-operation-change");
  stableWeather(changing);
  installWaymark(changing, {
    torchFuelQueueSeconds: [1],
    lit: true,
    everLit: true,
  });
  assert.equal(addTorchInventoryUnit(changing, { remainingBurnSeconds: 60 }), true);
  const interrupted = applyCommand(changing, {
    type: "use-structure",
    structureId: "structure.torch-waymark.test",
  });
  assert.deepEqual(restoredWaymark(interrupted).torchFuelQueueSeconds, []);
  assert.equal(interrupted.inventory.torch, 1);
  assert.equal(
    interrupted.eventLog.at(-1)?.details?.interrupted,
    true,
  );
});

test("storm, shelter, normal rain, FIFO crossing and rest use one deterministic burn law", () => {
  const exposed = createInitialState("waymark-storm-exposed");
  stableWeather(exposed, 0.8);
  installWaymark(exposed, {
    torchFuelQueueSeconds: [100],
    lit: true,
    everLit: true,
  });
  const stormed = stepSimulation(exposed, {}, 1);
  assert.equal(restoredWaymark(stormed).lit, false);
  assert.deepEqual(restoredWaymark(stormed).torchFuelQueueSeconds, [100]);
  assert.equal(
    stormed.eventLog.filter(
      (event) => event.type === "structure-extinguished",
    ).length,
    1,
  );

  const blockedInsert = createInitialState("waymark-storm-blocked-insert");
  stableWeather(blockedInsert, 0.8);
  installWaymark(blockedInsert);
  assert.equal(addTorchInventoryUnit(blockedInsert, { remainingBurnSeconds: 80 }), true);
  const insertRejected = applyCommand(blockedInsert, {
    type: "use-structure",
    structureId: "structure.torch-waymark.test",
  });
  assert.deepEqual(restoredWaymark(insertRejected).torchFuelQueueSeconds, []);
  assert.equal(insertRejected.inventory.torch, 1);

  const sheltered = createInitialState("waymark-storm-sheltered");
  stableWeather(sheltered, 0.8);
  const protectedWaymark = installWaymark(sheltered, {
    torchFuelQueueSeconds: [100],
    lit: true,
    everLit: true,
  });
  sheltered.camp.shelterBuilt = true;
  sheltered.camp.structures!.push({
    id: "structure.shelter.waymark-test",
    kind: "shelter",
    position: { ...protectedWaymark.position },
    yaw: 0,
    builtAtTick: 0,
  });
  const protectedAfter = stepSimulation(sheltered, {}, 10);
  assertClose(
    restoredWaymark(protectedAfter).torchFuelQueueSeconds![0],
    100 - 10 * (1 + 0.8 * 0.2 * 0.65),
    1e-5,
  );
  assert.equal(restoredWaymark(protectedAfter).lit, true);

  const shelteredRelight = createInitialState("waymark-storm-sheltered-relight");
  stableWeather(shelteredRelight, 0.8);
  const coldProtected = installWaymark(shelteredRelight, {
    torchFuelQueueSeconds: [80],
    lit: false,
    everLit: true,
  });
  shelteredRelight.camp.shelterBuilt = true;
  shelteredRelight.camp.structures!.push({
    id: "structure.shelter.relight-test",
    kind: "shelter",
    position: { ...coldProtected.position },
    yaw: 0,
    builtAtTick: 0,
  });
  const relitUnderCover = applyCommand(shelteredRelight, {
    type: "use-structure",
    structureId: "structure.torch-waymark.test",
  });
  assert.equal(restoredWaymark(relitUnderCover).lit, true);
  assert.deepEqual(restoredWaymark(relitUnderCover).torchFuelQueueSeconds, [80]);

  const rainy = createInitialState("waymark-normal-rain");
  stableWeather(rainy, 0.5);
  installWaymark(rainy, {
    torchFuelQueueSeconds: [100],
    lit: true,
    everLit: true,
  });
  const rainyAfter = stepSimulation(rainy, {}, 10);
  assertClose(
    restoredWaymark(rainyAfter).torchFuelQueueSeconds![0],
    100 - 10 * (1 + 0.5 * 0.65),
    1e-5,
  );

  const fifo = createInitialState("waymark-fifo-cross");
  stableWeather(fifo);
  installWaymark(fifo, {
    torchFuelQueueSeconds: [2, 20],
    lit: true,
    everLit: true,
  });
  const crossed = stepSimulation(fifo, {}, 3);
  assert.deepEqual(restoredWaymark(crossed).torchFuelQueueSeconds, [19]);

  const resting = createInitialState("waymark-rest-equivalence");
  stableWeather(resting);
  installWaymark(resting, {
    torchFuelQueueSeconds: [
      TORCH_MAX_BURN_SECONDS,
      TORCH_MAX_BURN_SECONDS,
    ],
    lit: true,
    everLit: true,
  });
  resting.camp.bedBuilt = true;
  resting.camp.structures!.push({
    id: "structure.bed.waymark-rest",
    kind: "bed",
    position: { ...resting.player.position },
    yaw: 0,
    builtAtTick: 0,
  });
  const slept = applyCommand(resting, { type: "rest" });
  const elapsed = stepSimulation(resting, {}, REST_SIMULATION_SECONDS);
  assert.deepEqual(
    restoredWaymark(slept).torchFuelQueueSeconds,
    restoredWaymark(elapsed).torchFuelQueueSeconds,
  );
  assert.equal(restoredWaymark(slept).lit, restoredWaymark(elapsed).lit);
});

test("eighty waymarks advance deterministically while ecology receives at most sixteen active fires", () => {
  const state = createInitialState("waymark-eighty");
  stableWeather(state, 0.3);
  state.camp.structures = [];
  for (let index = 0; index < 80; index += 1) {
    state.camp.structures.push(
      waymark(state, `structure.torch-waymark.${index.toString().padStart(3, "0")}`, {
        position: {
          x: state.player.position.x + (index % 10) * 3,
          y: 0,
          z: state.player.position.z + Math.floor(index / 10) * 3,
        },
        torchFuelQueueSeconds: [100 + index],
        lit: true,
        everLit: true,
      }),
    );
  }
  const reordered = structuredClone(state);
  reordered.camp.structures!.reverse();
  const left = stepSimulation(state, {}, 7);
  const right = stepSimulation(reordered, {}, 7);
  const snapshot = (value: GameState) =>
    value.camp.structures!
      .map((structure) => ({
        id: structure.id,
        fuel: structure.torchFuelQueueSeconds,
        lit: structure.lit,
        tick: structure.lastAdvancedTick,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(snapshot(left), snapshot(right));

  left.camp.fire.built = true;
  left.camp.fire.lit = true;
  left.camp.structures!.push(
    waymark(left, "structure.torch-waymark.unlit", {
      torchFuelQueueSeconds: [100],
      lit: false,
      position: { ...left.player.position },
    }),
    waymark(left, "structure.torch-waymark.far", {
      torchFuelQueueSeconds: [100],
      lit: true,
      position: { x: 500, y: 0, z: 500 },
    }),
  );
  const fires = activeFireDeterrents(left);
  assert.equal(fires.length, MAX_ECOLOGY_FRAME_DETERRENTS);
  assert.equal(fires[0].id, "deterrent.campfire.active");
  assert.equal(fires.some((fire) => fire.id.endsWith(".unlit")), false);
  assert.equal(fires.some((fire) => fire.id.endsWith(".far")), false);
  assert.ok(
    fires.slice(1).every(
      (fire) => fire.radius === 8 && fire.strength === 0.82,
    ),
  );
  assert.deepEqual(projectActiveWildlife(left).frame.deterrents, fires);

  const reversed = structuredClone(left);
  reversed.camp.structures!.reverse();
  assert.deepEqual(
    activeFireDeterrents(reversed).map((fire) => fire.id),
    fires.map((fire) => fire.id),
  );
});
