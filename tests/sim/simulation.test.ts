import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STRUCTURE_PLACEMENTS,
  FIXED_DT_SECONDS,
  gameHoursToSimulationSeconds,
  REST_SIMULATION_SECONDS,
  ITEM_IDS,
  applyCommand,
  authoredSnakeIndividualId,
  createInitialState,
  getDiscoveredRecipeIds,
  nextRandom,
  selectGameView,
  stepSimulation,
} from "../../src/game/sim/index";
import type { GameState, Inventory, ItemId } from "../../src/game/sim/index";
import { RESOURCE_REGENERATION } from "../../src/game/sim/content";

function maximumRegenerationSeconds(
  definition: NonNullable<(typeof RESOURCE_REGENERATION)[ItemId]>,
): number {
  return gameHoursToSimulationSeconds(definition.maximumIntervalGameHours);
}

const SAFE_OVERNIGHT_FIRE_SECONDS = REST_SIMULATION_SECONDS * 1.16;
const TEST_CAMPFIRE_PLACEMENT = {
  position: { x: 0, y: 0, z: -2.8 },
  yaw: 0,
};
const TEST_SHELTER_PLACEMENT = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
};
const TEST_BED_PLACEMENT = {
  position: { x: 0, y: 0, z: 0 },
  yaw: 0,
};

function stockInventory(
  state: GameState,
  items: Partial<Record<ItemId, number>>,
): GameState {
  for (const [itemId, amount] of Object.entries(items) as [ItemId, number][]) {
    state.inventory[itemId] = amount;
  }
  return state;
}

function assertLegalInventory(inventory: Inventory): void {
  for (const itemId of ITEM_IDS) {
    assert.ok(Number.isInteger(inventory[itemId]), `${itemId} must be an integer`);
    assert.ok(inventory[itemId] >= 0, `${itemId} must not be negative`);
  }
}

function assertInUnitRange(value: number, label: string): void {
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  assert.ok(value >= 0 && value <= 100, `${label} must be in [0, 100]`);
}

test("same seed and input stream produce byte-for-byte equivalent state", () => {
  let left = createInitialState("jungle-run-42");
  let right = createInitialState("jungle-run-42");

  for (let index = 0; index < 500; index += 1) {
    const input = {
      movement: {
        x: Math.sin(index * 0.17),
        z: Math.cos(index * 0.13),
        sprint: index % 5 === 0,
      },
    };
    left = stepSimulation(left, input, 0.4);
    right = stepSimulation(right, input, 0.4);
  }

  assert.deepEqual(left, right);
  assert.notDeepEqual(
    createInitialState("jungle-run-42").rng,
    createInitialState("another-run").rng,
  );
});

test("fixed-step batching matches individual 30 Hz calls", () => {
  let individual = createInitialState(91);
  for (let tick = 0; tick < 900; tick += 1) {
    individual = stepSimulation(
      individual,
      { movement: { x: 0.35, z: -0.7, sprint: tick < 90 } },
      FIXED_DT_SECONDS,
    );
  }

  const batched = stepSimulation(
    createInitialState(91),
    { movement: { x: 0.35, z: -0.7, sprint: true } },
    3,
  );
  const batchedRemainder = stepSimulation(
    batched,
    { movement: { x: 0.35, z: -0.7, sprint: false } },
    27,
  );

  assert.equal(individual.clock.tick, batchedRemainder.clock.tick);
  assert.equal(individual.clock.elapsedSeconds, batchedRemainder.clock.elapsedSeconds);
  assert.deepEqual(individual.weather, batchedRemainder.weather);
  assert.deepEqual(individual.rng, batchedRemainder.rng);
});

test("crafting is atomic and does not mutate the supplied state", () => {
  const state = stockInventory(createInitialState(7), { stone: 1 });
  const beforeInventory = { ...state.inventory };
  const failed = applyCommand(state, { type: "craft", recipeId: "stone-blade" });

  assert.deepEqual(state.inventory, beforeInventory);
  assert.deepEqual(failed.inventory, beforeInventory);
  assert.equal(failed.eventLog.at(-1)?.type, "craft-failed");

  state.inventory.stone = 2;
  const crafted = applyCommand(state, {
    type: "craft",
    recipeId: "stone-blade",
  });
  assert.equal(crafted.inventory.stone, 0);
  assert.equal(crafted.inventory["stone-blade"], 1);
  assert.equal(state.inventory.stone, 2, "source state must remain unchanged");
});

test("resource pickup decrements a stable entity and marks it depleted at zero", () => {
  const entityId = "resource.stone.camp-01";
  const original = createInitialState(3);
  const position = original.world.entities[entityId].position;
  const sourceQuantity = original.world.entities[entityId].quantity;
  let state = applyCommand(original, { type: "move-player", position });
  state = applyCommand(state, { type: "pick-up", entityId, amount: 4 });

  assert.equal(state.inventory.stone, 1, "the simulation, not the UI, caps a bare-hand harvest");
  assert.equal(state.clock.elapsedSeconds, 8);
  for (let index = 1; index < sourceQuantity; index += 1) {
    state = applyCommand(state, { type: "pick-up", entityId, amount: 4 });
  }
  assert.equal(state.inventory.stone, sourceQuantity);
  assert.equal(state.world.entities[entityId].quantity, 0);
  assert.equal(state.world.entities[entityId].depleted, true);
  assert.equal(original.world.entities[entityId].quantity, sourceQuantity);
  assert.equal(original.world.entities[entityId].depleted, false);

  const viewEntity = selectGameView(state).worldEntities.find(
    (entity) => entity.id === entityId,
  );
  assert.equal(viewEntity?.available, false);
});

test("an axe increases harvesting throughput without bypassing finite resource nodes", () => {
  const entityId = "resource.stick.camp-01";
  const bare = createInitialState("bare-harvest");
  bare.player.position = { ...bare.world.entities[entityId].position };
  const bareResult = applyCommand(bare, { type: "pick-up", entityId, amount: 9 });

  const equipped = createInitialState("axe-harvest");
  equipped.player.position = { ...equipped.world.entities[entityId].position };
  equipped.inventory.axe = 1;
  const holdingAxe = applyCommand(equipped, { type: "equip-item", itemId: "axe" });
  const axeResult = applyCommand(holdingAxe, { type: "pick-up", entityId, amount: 9 });

  assert.equal(bareResult.inventory.stick, 1);
  assert.equal(axeResult.inventory.stick, 3);
  assert.equal(axeResult.world.entities[entityId].quantity, 7);
  assert.equal(axeResult.eventLog.at(-1)?.details?.harvestLimit, 3);
});

test("renewable resources lazily regenerate only after time passes away from the player", () => {
  const entityId = "resource.stick.trail-01";
  const definition = RESOURCE_REGENERATION.stick;
  assert.ok(definition);

  let state = createInitialState("renewable-distance");
  const initialQuantity = state.world.entities[entityId].quantity;
  state = applyCommand(state, {
    type: "move-player",
    position: state.world.entities[entityId].position,
  });
  state = applyCommand(state, { type: "pick-up", entityId });

  const harvested = state.world.entities[entityId];
  assert.equal(harvested.quantity, initialQuantity - 1);
  assert.equal(harvested.regeneration?.capacity, initialQuantity);
  assert.ok(
    (harvested.regeneration?.nextTick ?? 0) > state.clock.tick,
    "harvesting should schedule a deterministic future deadline",
  );

  state = stepSimulation(state, {}, maximumRegenerationSeconds(definition) + 2);
  assert.equal(
    state.world.entities[entityId].quantity,
    initialQuantity - 1,
    "a due node must not pop back while the player remains beside it",
  );

  state = applyCommand(state, {
    type: "move-player",
    position: { x: 18, y: 0, z: 80 },
  });
  state = stepSimulation(state, {}, gameHoursToSimulationSeconds(0.5));
  assert.equal(state.world.entities[entityId].quantity, initialQuantity);
  assert.equal(state.world.entities[entityId].regeneration?.nextTick, null);

  const viewEntity = selectGameView(state).worldEntities.find(
    (entity) => entity.id === entityId,
  );
  assert.equal(viewEntity?.renewable, true);
  assert.equal(viewEntity?.capacity, initialQuantity);
  assert.equal(viewEntity?.nextRegenerationTick, null);
});

test("resource regeneration deadlines and catch-up are deterministic", () => {
  const entityId = "resource.grubs.log-01";
  const makeHarvestedState = () => {
    let state = createInitialState("regeneration-determinism");
    state = applyCommand(state, {
      type: "move-player",
      position: state.world.entities[entityId].position,
    });
    return applyCommand(state, { type: "pick-up", entityId });
  };
  let left = makeHarvestedState();
  let right = makeHarvestedState();
  assert.deepEqual(
    left.world.entities[entityId].regeneration,
    right.world.entities[entityId].regeneration,
  );

  for (const state of [left, right]) {
    state.player.position = { x: 8, y: 0, z: 60 };
  }
  const definition = RESOURCE_REGENERATION.grubs;
  assert.ok(definition);
  const interval = maximumRegenerationSeconds(definition);
  left = stepSimulation(left, {}, interval * 3 + 1);
  right = stepSimulation(right, {}, interval * 3 + 1);

  assert.deepEqual(left.world.entities[entityId], right.world.entities[entityId]);
  assert.equal(
    left.world.entities[entityId].quantity,
    createInitialState(1).world.entities[entityId].quantity,
  );
});

test("legacy resource nodes gain safe lifecycle defaults without instant refill", () => {
  const entityId = "resource.vine.trail-01";
  let state = createInitialState("legacy-resource-save");
  const entity = state.world.entities[entityId];
  const originalCapacity = entity.quantity;
  entity.quantity = 0;
  entity.depleted = true;
  delete entity.regeneration;
  state.player.position = { x: 21, y: 0, z: 80 };

  state = stepSimulation(state, {}, FIXED_DT_SECONDS);
  const migrated = state.world.entities[entityId];
  assert.equal(migrated.quantity, 0, "legacy depletion must not refill immediately");
  assert.equal(migrated.regeneration?.capacity, originalCapacity);
  assert.ok((migrated.regeneration?.nextTick ?? 0) > state.clock.tick);

  state = stepSimulation(
    state,
    {},
    maximumRegenerationSeconds(RESOURCE_REGENERATION.vine!) + 1,
  );
  assert.ok(
    state.world.entities[entityId].quantity >=
      RESOURCE_REGENERATION.vine!.minimumAmount,
  );
  assert.ok(
    state.world.entities[entityId].quantity <=
      RESOURCE_REGENERATION.vine!.maximumAmount,
  );
  assert.equal(state.world.entities[entityId].depleted, false);
});

test("the objective battery never regenerates, including malformed legacy lifecycle data", () => {
  const entityId = "resource.battery.weather-station";
  let state = createInitialState("finite-battery");
  const battery = state.world.entities[entityId];
  battery.quantity = 0;
  battery.depleted = true;
  battery.regeneration = { capacity: 1, nextTick: state.clock.tick };
  state.player.position = { x: -50, y: 0, z: -50 };

  state = stepSimulation(state, {}, 600);
  assert.equal(state.world.entities[entityId].quantity, 0);
  assert.equal(state.world.entities[entityId].depleted, true);
  assert.equal(state.world.entities[entityId].regeneration, undefined);
});

test("the opening wound objective exposes bandaging without revealing the full catalogue", () => {
  let state = createInitialState("knowledge-loop");
  assert.deepEqual(getDiscoveredRecipeIds(state), ["stone-blade", "bandage"]);

  for (const entityId of ["resource.medicinal.camp-01", "resource.vine.camp-01"]) {
    state = applyCommand(state, { type: "move-player", position: state.world.entities[entityId].position });
    state = applyCommand(state, { type: "pick-up", entityId });
  }

  assert.ok(getDiscoveredRecipeIds(state).includes("bandage"));
  assert.ok(state.knowledge?.announcedRecipeIds.includes("bandage"));
  assert.equal(getDiscoveredRecipeIds(state).includes("radio-beacon"), false);
});

test("boiling converts dirty water atomically and dirty water can cause parasites", () => {
  let cleanState = stockInventory(createInitialState(11), {
    "coconut-shell": 1,
    "dirty-water": 1,
  });
  cleanState.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 120,
    rainExposure: 0,
    sheltered: false,
  };
  cleanState.player.position = {
    ...DEFAULT_STRUCTURE_PLACEMENTS.campfire.position,
  };
  cleanState = applyCommand(cleanState, { type: "boil-water" });

  assert.equal(cleanState.inventory["dirty-water"], 0);
  assert.equal(cleanState.inventory["clean-water"], 1);
  assert.equal(cleanState.objectives.flags.waterPurified, false);
  cleanState = applyCommand(cleanState, { type: "drink-water", itemId: "clean-water" });
  assert.equal(cleanState.objectives.flags.waterPurified, true);
  assert.equal(cleanState.eventLog.at(-1)?.type, "water-drunk");
  assert.ok(cleanState.eventLog.some((event) => event.type === "water-purified"));

  let parasiteState: GameState | undefined;
  for (let seed = 0; seed < 100; seed += 1) {
    const candidate = createInitialState(seed);
    const [roll] = nextRandom(candidate.rng.conditions);
    if (roll < 0.56) {
      candidate.inventory["dirty-water"] = 1;
      parasiteState = applyCommand(candidate, {
        type: "drink-water",
        itemId: "dirty-water",
      });
      break;
    }
  }
  assert.ok(parasiteState, "expected a deterministic parasite seed");
  assert.equal(parasiteState.player.conditions.parasites, 1);

  parasiteState.inventory["antiparasitic-herb"] = 1;
  parasiteState = applyCommand(parasiteState, {
    type: "use-item",
    itemId: "antiparasitic-herb",
  });
  assert.equal(parasiteState.player.conditions.parasites, 0);
});

test("bandaging prevents the untreated wound spiral", () => {
  const initial = createInitialState(17);
  const untreated = stepSimulation(initial, {}, 180);

  initial.inventory.bandage = 1;
  const bandaged = stepSimulation(
    applyCommand(initial, { type: "use-item", itemId: "bandage" }),
    {},
    180,
  );

  assert.equal(bandaged.player.conditions.wound.open, false);
  assert.equal(bandaged.player.conditions.wound.treated, true);
  assert.ok(
    bandaged.player.conditions.wound.infection <
      untreated.player.conditions.wound.infection,
  );
  assert.ok(bandaged.player.vitals.health > untreated.player.vitals.health);
  assert.equal(bandaged.objectives.flags.woundTreated, true);
});

test("legacy snake contact routes into embodied combat while a spear requires explicit hits", () => {
  const hazardId = "hazard.snake.stream-ridge";
  const snakeId = authoredSnakeIndividualId(hazardId);
  let bitten = createInitialState("snake-bite");
  bitten = applyCommand(bitten, {
    type: "move-player",
    position: bitten.world.entities[hazardId].position,
  });
  bitten = applyCommand(bitten, { type: "encounter-hazard", entityId: hazardId });

  assert.equal(bitten.world.entities[hazardId].depleted, false);
  assert.ok(bitten.player.vitals.health < 84, "the embodied bite has a real health consequence");
  assert.equal(bitten.player.conditions.wound.open, true);
  assert.equal(bitten.eventLog.at(-1)?.type, "snake-bite");

  let armed = createInitialState("snake-spear");
  armed.inventory.spear = 1;
  armed = applyCommand(armed, { type: "equip-item", itemId: "spear" });
  armed = applyCommand(armed, {
    type: "move-player",
    position: armed.world.entities[hazardId].position,
  });
  armed = applyCommand(armed, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  armed = applyCommand(armed, {
    type: "attack-wildlife",
    individualId: snakeId,
  });

  assert.ok(armed.player.vitals.health > bitten.player.vitals.health);
  assert.equal(armed.ecology?.individuals?.[snakeId]?.health, 0);
  assert.ok(armed.eventLog.some((event) => event.type === "wildlife-defeated"));
});

test("heavy rain extinguishes an exposed fire but not a sheltered one", () => {
  const makeFireState = (sheltered: boolean): GameState => {
    const state = createInitialState(23);
    state.camp.fire = {
      built: true,
      lit: true,
      fuelSeconds: 180,
      rainExposure: 0,
      sheltered,
    };
    state.camp.shelterBuilt = sheltered;
    state.camp.structures = [
      {
        id: "structure.campfire.rain-test",
        kind: "campfire",
        position: { x: 0, y: 0, z: 0 },
        yaw: 0,
        builtAtTick: 0,
      },
      ...(sheltered
        ? [
            {
              id: "structure.shelter.rain-test",
              kind: "shelter" as const,
              position: { x: 1.5, y: 0, z: 0 },
              yaw: 0,
              builtAtTick: 0,
            },
          ]
        : []),
    ];
    if (sheltered) {
      state.player.position = { x: 1.5, y: 0, z: 0 };
    }
    state.weather.rainIntensity = 1;
    state.weather.targetRainIntensity = 1;
    state.weather.secondsUntilChange = 999;
    return state;
  };

  const exposed = stepSimulation(makeFireState(false), {}, 10);
  const sheltered = stepSimulation(makeFireState(true), {}, 10);

  assert.equal(exposed.camp.fire.lit, false);
  assert.equal(sheltered.camp.fire.lit, true);
  assert.ok(
    exposed.eventLog.some(
      (event) =>
        event.type === "fire-extinguished" && event.cause.code === "rain-exposure",
    ),
  );
  assert.ok(exposed.player.conditions.wetness > sheltered.player.conditions.wetness);
});

test("a built bed provides a meaningful rest tradeoff", () => {
  const state = createInitialState("rest-tradeoff");
  state.camp.bedBuilt = true;
  state.camp.shelterBuilt = true;
  state.player.position = {
    ...DEFAULT_STRUCTURE_PLACEMENTS.bed.position,
  };
  state.player.vitals.energy = 28;
  state.player.nutrition.hydration = 50;
  state.player.conditions.wetness = 48;

  const rested = applyCommand(state, { type: "rest" });
  assert.ok(rested.player.vitals.energy > state.player.vitals.energy);
  assert.ok(rested.player.nutrition.hydration < state.player.nutrition.hydration);
  assert.ok(rested.player.conditions.wetness < state.player.conditions.wetness);
  assert.equal(
    rested.clock.elapsedSeconds,
    REST_SIMULATION_SECONDS,
    "rest resolves exactly eight authored hours",
  );
  assert.equal(rested.eventLog.at(-1)?.type, "rest-completed");
  rested.camp.fire = { built: true, lit: true, fuelSeconds: 120, rainExposure: 0, sheltered: true };
  const verified = applyCommand(rested, { type: "move-player", position: rested.camp.position });
  assert.equal(verified.objectives.flags.campEstablished, true, "camp requires a completed rest cycle");
});

test("the battery cannot be meta-rushed without the authored investigation chain", () => {
  const batteryId = "resource.battery.weather-station";
  let state = createInitialState("investigation-gate");
  state.objectives.flags.campEstablished = true;
  state.inventory.axe = 1;
  state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  state = applyCommand(state, { type: "move-player", position: state.world.entities[batteryId].position });
  const rushed = applyCommand(state, { type: "pick-up", entityId: batteryId });

  assert.equal(rushed.inventory.battery, 0);
  assert.equal(rushed.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(rushed.eventLog.at(-1)?.details?.missingClue, "landmark.camp-radio");

  state = rushed;
  for (const landmarkId of [
    "landmark.camp-radio",
    "landmark.survey-cache",
    "landmark.weather-station",
  ]) {
    state = applyCommand(state, { type: "move-player", position: state.world.entities[landmarkId].position });
    state = applyCommand(state, { type: "inspect-landmark", entityId: landmarkId });
  }
  state = applyCommand(state, { type: "move-player", position: state.world.entities[batteryId].position });
  state = applyCommand(state, { type: "pick-up", entityId: batteryId });

  assert.equal(state.inventory.battery, 1);
  assert.equal(state.objectives.flags.batteryRecovered, true);
});

test("full objective chain ends in a causal victory event", () => {
  let state = stockInventory(createInitialState("victory-path"), {
    bandage: 1,
    "coconut-shell": 1,
    "dirty-water": 1,
    "stone-blade": 1,
    axe: 1,
    stick: 24,
    vine: 8,
    "broad-leaf": 10,
    "dry-leaf": 4,
  });

  state = applyCommand(state, { type: "use-item", itemId: "bandage" });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "shelter",
    placement: TEST_SHELTER_PLACEMENT,
  });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "campfire",
    placement: TEST_CAMPFIRE_PLACEMENT,
  });
  state = applyCommand(state, {
    type: "move-player",
    position: TEST_CAMPFIRE_PLACEMENT.position,
  });
  while (
    !state.camp.fire.lit ||
    state.camp.fire.fuelSeconds < SAFE_OVERNIGHT_FIRE_SECONDS
  ) {
    state = applyCommand(state, { type: "add-fuel" });
  }
  state = applyCommand(state, { type: "boil-water" });
  state = applyCommand(state, { type: "drink-water", itemId: "clean-water" });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "bed",
    placement: TEST_BED_PLACEMENT,
  });
  state = applyCommand(state, {
    type: "move-player",
    position: TEST_BED_PLACEMENT.position,
  });
  state = applyCommand(state, { type: "rest" });

  for (const landmarkId of [
    "landmark.camp-radio",
    "landmark.survey-cache",
    "landmark.weather-station",
  ]) {
    state = applyCommand(state, {
      type: "move-player",
      position: state.world.entities[landmarkId].position,
    });
    state = applyCommand(state, { type: "inspect-landmark", entityId: landmarkId });
  }

  const batteryId = "resource.battery.weather-station";
  state = applyCommand(state, {
    type: "move-player",
    position: state.world.entities[batteryId].position,
  });
  state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  state = applyCommand(state, { type: "pick-up", entityId: batteryId });
  state = applyCommand(state, {
    type: "move-player",
    position: state.camp.position,
  });
  state = applyCommand(state, { type: "craft", recipeId: "radio-beacon" });
  const beacon = state.camp.structures?.find(
    (structure) => structure.kind === "radio-beacon",
  );
  assert.ok(beacon);
  state = applyCommand(state, {
    type: "move-player",
    position: beacon.position,
  });
  state = applyCommand(state, { type: "transmit", structureId: beacon.id });

  assert.equal(state.status, "playing");
  assert.equal(state.objectives.currentTaskId, "river-rising");
  assert.deepEqual(state.objectives.completedTaskIds, [
    "treat-wound",
    "purify-water",
    "establish-camp",
    "recover-battery",
    "transmit-signal",
  ]);
  assert.equal(state.eventLog.at(-1)?.type, "task-completed");
  assert.equal(state.eventLog.at(-1)?.details?.taskId, "transmit-signal");
});

test("the authored world economy contains a complete harvest-to-rescue path", () => {
  let state = createInitialState("authored-world-victory");
  const harvest = (entityId: string, amount: number) => {
    state = applyCommand(state, {
      type: "move-player",
      position: state.world.entities[entityId].position,
    });
    const itemId = state.world.entities[entityId].itemId;
    assert.ok(itemId, `${entityId} must yield an item`);
    const startingCount = state.inventory[itemId];
    while (state.inventory[itemId] - startingCount < amount) {
      const before = state.inventory[itemId];
      state = applyCommand(state, { type: "pick-up", entityId, amount: 3 });
      assert.ok(state.inventory[itemId] > before, `${entityId} ran out before the requested harvest`);
    }
  };

  state = applyCommand(state, { type: "move-player", position: state.camp.position });
  state = applyCommand(state, { type: "inspect-landmark", entityId: "landmark.camp-radio" });

  harvest("resource.medicinal.camp-01", 1);
  harvest("resource.vine.camp-01", 2);
  state = applyCommand(state, { type: "craft", recipeId: "bandage" });
  state = applyCommand(state, { type: "use-item", itemId: "bandage" });

  harvest("resource.stone.camp-01", 4);
  state = applyCommand(state, { type: "craft", recipeId: "stone-blade" });
  harvest("resource.stick.camp-01", 1);
  state = applyCommand(state, { type: "craft", recipeId: "axe" });
  state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  harvest("resource.coconut.stream-01", 1);
  state = applyCommand(state, { type: "craft", recipeId: "coconut-shell" });
  state = applyCommand(state, {
    type: "move-player",
    position: state.world.entities["landmark.stream"].position,
  });
  state = applyCommand(state, { type: "collect-water", sourceEntityId: "landmark.stream" });

  harvest("resource.stick.camp-01", 9);
  harvest("resource.stick.trail-01", 11);
  harvest("resource.vine.camp-01", 4);
  harvest("resource.vine.trail-01", 4);
  harvest("resource.dry-leaf.camp-01", 4);
  harvest("resource.leaf.camp-01", 10);
  state = applyCommand(state, { type: "move-player", position: state.camp.position });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "shelter",
    placement: TEST_SHELTER_PLACEMENT,
  });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "campfire",
    placement: TEST_CAMPFIRE_PLACEMENT,
  });
  state = applyCommand(state, {
    type: "move-player",
    position: TEST_CAMPFIRE_PLACEMENT.position,
  });
  while (
    !state.camp.fire.lit ||
    state.camp.fire.fuelSeconds < SAFE_OVERNIGHT_FIRE_SECONDS
  ) {
    state = applyCommand(state, { type: "add-fuel" });
  }
  state = applyCommand(state, { type: "boil-water" });
  state = applyCommand(state, { type: "drink-water", itemId: "clean-water" });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "bed",
    placement: TEST_BED_PLACEMENT,
  });
  state = applyCommand(state, {
    type: "move-player",
    position: TEST_BED_PLACEMENT.position,
  });
  state = applyCommand(state, { type: "rest" });
  state = applyCommand(state, { type: "craft", recipeId: "spear" });
  state = applyCommand(state, { type: "equip-item", itemId: "spear" });

  for (const landmarkId of ["landmark.survey-cache", "landmark.weather-station"]) {
    state = applyCommand(state, { type: "move-player", position: state.world.entities[landmarkId].position });
    state = applyCommand(state, { type: "inspect-landmark", entityId: landmarkId });
  }
  const routeHazard = "hazard.snake.station-trail";
  state = applyCommand(state, { type: "move-player", position: state.world.entities[routeHazard].position });
  const routeSnake = authoredSnakeIndividualId(routeHazard);
  state = applyCommand(state, { type: "attack-wildlife", individualId: routeSnake });
  state = applyCommand(state, { type: "attack-wildlife", individualId: routeSnake });

  state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  harvest("resource.battery.weather-station", 1);
  state = applyCommand(state, { type: "move-player", position: state.camp.position });
  state = applyCommand(state, { type: "craft", recipeId: "radio-beacon" });
  const beacon = state.camp.structures?.find(
    (structure) => structure.kind === "radio-beacon",
  );
  assert.ok(beacon);
  state = applyCommand(state, {
    type: "move-player",
    position: beacon.position,
  });
  state = applyCommand(state, { type: "transmit", structureId: beacon.id });

  assert.equal(state.status, "playing");
  assert.equal(state.objectives.currentTaskId, "river-rising");
  assert.equal(state.eventLog.at(-1)?.type, "task-completed");
  assert.ok(state.clock.elapsedSeconds >= 1_500, `critical path was only ${state.clock.elapsedSeconds}s`);
  assert.ok(state.clock.elapsedSeconds <= 1_950, `critical path exceeded the bounded target: ${state.clock.elapsedSeconds}s`);
});

test("terminal loss is emitted once with an explicit cause", () => {
  const state = createInitialState(29);
  state.player.vitals.health = 0.01;
  state.player.nutrition.hydration = 0;
  const lost = stepSimulation(state, {}, 1);
  const lossEvents = lost.eventLog.filter((event) => event.type === "game-lost");

  assert.equal(lost.status, "lost");
  assert.equal(lost.lossReason, "health");
  assert.equal(lossEvents.length, 1);
  assert.equal(lossEvents[0].cause.code, "terminal:health");
  assert.deepEqual(stepSimulation(lost, {}, 30), lost);
});

test("10,000 ticks preserve all state invariants and renderer projection", () => {
  let state = createInitialState("ten-thousand-ticks");
  state.inventory.bandage = 1;
  state = applyCommand(state, { type: "use-item", itemId: "bandage" });
  state.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 20_000,
    rainExposure: 0,
    sheltered: true,
  };
  state.camp.shelterBuilt = true;
  state.camp.bedBuilt = true;
  for (const key of Object.keys(state.player.nutrition) as Array<
    keyof GameState["player"]["nutrition"]
  >) {
    state.player.nutrition[key] = 100;
  }

  const startingTick = state.clock.tick;
  state = stepSimulation(state, { movement: { x: 0.2, z: 0.1 } }, 10_000 / 30);

  assert.equal(state.clock.tick, startingTick + 10_000);
  for (const [label, value] of Object.entries(state.player.vitals)) {
    assertInUnitRange(value, `vitals.${label}`);
  }
  for (const [label, value] of Object.entries(state.player.nutrition)) {
    assertInUnitRange(value, `nutrition.${label}`);
  }
  assertInUnitRange(state.player.conditions.wetness, "conditions.wetness");
  assertInUnitRange(state.player.conditions.wound.severity, "wound.severity");
  assertInUnitRange(state.player.conditions.wound.infection, "wound.infection");
  assertLegalInventory(state.inventory);
  assert.ok(state.eventLog.length <= 256);
  assert.ok(
    Object.values(state.world.entities).every(
      (entity) =>
        entity.quantity >= 0 &&
        entity.depleted ===
          (entity.quantity === 0 && entity.treeHarvest === undefined),
    ),
  );

  const view = selectGameView(state);
  assert.equal(view.clock.day, state.clock.day);
  assert.equal(view.clock.minuteOfDay, state.clock.minuteOfDay);
  assert.equal(view.weather.rain, state.weather.rainIntensity);
  assert.equal(view.weather.storm, state.weather.storm);
  assert.deepEqual(view.player, state.player.position);
  assert.ok(view.worldEntities.every((entity) => typeof entity.available === "boolean"));
});
