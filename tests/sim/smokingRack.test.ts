import assert from "node:assert/strict";
import test from "node:test";

import { FOOD_SPOILAGE } from "../../src/game/sim/content";
import {
  FIXED_HZ,
  MAXIMUM_FIRE_FUEL_SECONDS,
  applyCommand,
  createInitialState,
  getPerishableInventoryStatus,
  migrateGameState,
  resolveAffordance,
  stepSimulation,
} from "../../src/game/sim/index";
import {
  SMOKING_RACK_BIOME_RULES,
  SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
  resolveSmokingRackEnvironment,
} from "../../src/game/sim/smokingRackRules";
import type {
  GameState,
  PlacedStructureKind,
  PlacedStructureState,
  SmokingRackProcessState,
} from "../../src/game/sim/types";
import { createGameViewModel } from "../../src/game/ui/viewModel";
import { generateChunkDescriptor, worldToChunkCoordinate } from "../../src/game/world/generation";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
} from "../../src/game/world/saveDelta";

function placed(
  id: string,
  kind: PlacedStructureKind,
  x: number,
  z: number,
  process?: SmokingRackProcessState,
): PlacedStructureState {
  return {
    id,
    kind,
    position: { x, y: 0, z },
    yaw: 0,
    builtAtTick: 0,
    ...(process ? { process } : {}),
  };
}

function makeSafe(state: GameState): GameState {
  state.player.conditions = {
    wound: { open: false, treated: true, severity: 0, infection: 0 },
    parasites: 0,
    wetness: 0,
  };
  state.player.nutrition = {
    carbohydrates: 100,
    protein: 100,
    fat: 100,
    hydration: 100,
  };
  state.player.vitals = {
    health: 100,
    stamina: 100,
    energy: 100,
    sanity: 100,
  };
  state.weather = {
    rainIntensity: 0,
    targetRainIntensity: 0,
    secondsUntilChange: 10_000,
    storm: false,
  };
  return state;
}

function makeWorkingCamp(seed = "smoking-rack"): GameState {
  const state = makeSafe(createInitialState(seed));
  state.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: MAXIMUM_FIRE_FUEL_SECONDS,
    rainExposure: 0,
    sheltered: false,
  };
  state.camp.structures = [placed("structure.campfire.test", "campfire", 0, 0)];
  state.player.position = { x: 0, y: 0, z: -3 };
  return state;
}

test("smoking rules expose biome rates and explicit fire, distance, and rain blockers", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(SMOKING_RACK_BIOME_RULES).map(([biome, rule]) => [
        biome,
        rule.rateMultiplier,
      ]),
    ),
    {
      "rocky-highland": 1.3,
      "palm-grove": 1.1,
      "evergreen-rainforest": 0.9,
      "river-wetland": 0.7,
      swamp: 0.55,
    },
  );
  assert.equal(
    resolveSmokingRackEnvironment({
      biome: "rocky-highland",
      rainIntensity: 0,
      sheltered: false,
      fireLit: false,
      distanceToFire: 2,
    }).blocker,
    "fire-unlit",
  );
  assert.equal(
    resolveSmokingRackEnvironment({
      biome: "palm-grove",
      rainIntensity: 0,
      sheltered: false,
      fireLit: true,
      distanceToFire: 5,
    }).blocker,
    "fire-too-far",
  );
  assert.equal(
    resolveSmokingRackEnvironment({
      biome: "swamp",
      rainIntensity: 0.3,
      sheltered: false,
      fireLit: true,
      distanceToFire: 2,
    }).blocker,
    "rain-exposed",
  );
  assert.equal(
    resolveSmokingRackEnvironment({
      biome: "swamp",
      rainIntensity: 1,
      sheltered: true,
      fireLit: true,
      distanceToFire: 2,
    }).active,
    true,
  );
});

test("the recipe builds multiple independent racks and rejects overlap without consuming materials", () => {
  let state = makeWorkingCamp("rack-multi-instance");
  state.inventory.stick = 12;
  state.inventory.vine = 9;
  state.inventory["stone-blade"] = 1;
  state = migrateGameState(state);

  state = applyCommand(state, {
    type: "craft",
    recipeId: "smoking-rack",
    placement: { position: { x: -2, y: 0, z: 0 }, yaw: 0 },
  });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "smoking-rack",
    placement: { position: { x: 2, y: 0, z: 0 }, yaw: Math.PI / 2 },
  });
  const racks = state.camp.structures?.filter(
    (structure) => structure.kind === "smoking-rack",
  );
  assert.equal(racks?.length, 2);
  assert.notEqual(racks?.[0].id, racks?.[1].id);
  assert.equal(state.inventory.stick, 4);
  assert.equal(state.inventory.vine, 3);

  const beforeRejectedBuild = structuredClone(state);
  state = applyCommand(state, {
    type: "craft",
    recipeId: "smoking-rack",
    placement: { position: { x: 2.2, y: 0, z: 0 }, yaw: 0 },
  });
  assert.equal(state.eventLog.at(-1)?.type, "craft-failed");
  assert.equal(state.eventLog.at(-1)?.details?.reason, "invalid-placement");
  assert.equal(state.inventory.stick, beforeRejectedBuild.inventory.stick);
  assert.equal(state.inventory.vine, beforeRejectedBuild.inventory.vine);
  assert.equal(
    state.camp.structures?.filter(
      (structure) => structure.kind === "smoking-rack",
    ).length,
    2,
  );
});

test("a rack can be built inside the visible shelter footprint and receives real rain cover", () => {
  let state = makeWorkingCamp("rack-under-shelter");
  state.camp.shelterBuilt = true;
  state.camp.structures?.push(
    placed("structure.shelter.build", "shelter", 2, 0),
  );
  state.inventory.stick = 4;
  state.inventory.vine = 3;
  state.inventory["stone-blade"] = 1;
  state = migrateGameState(state);

  state = applyCommand(state, {
    type: "craft",
    recipeId: "smoking-rack",
    placement: { position: { x: 2, y: 0, z: 0 }, yaw: 0 },
  });
  const rack = state.camp.structures?.find(
    (structure) => structure.kind === "smoking-rack",
  );
  assert.ok(rack);
  assert.ok(
    state.eventLog.some(
      (event) =>
        event.type === "craft-succeeded" &&
        event.details?.recipeId === "smoking-rack",
    ),
  );
  state.inventory["raw-meat"] = 1;
  state = migrateGameState(state);
  state.player.position = { ...rack.position };
  state = applyCommand(state, {
    type: "use-structure",
    structureId: rack.id,
  });
  state.weather.rainIntensity = 1;
  state.weather.targetRainIntensity = 1;
  state.weather.secondsUntilChange = 10_000;
  const before = rack.process?.progressSeconds ?? 0;
  state = stepSimulation(state, {}, 2);
  assert.ok(
    (state.camp.structures?.find((entry) => entry.id === rack.id)?.process
      ?.progressSeconds ?? 0) > before,
  );
});

test("loading a rack transfers the oldest real meat batch and each instance keeps separate focus state", () => {
  let state = makeWorkingCamp("rack-batch-transfer");
  const empty = placed("rack.empty", "smoking-rack", 2, 0);
  const ready = placed("rack.ready", "smoking-rack", -2, 0, {
    kind: "smoking-meat",
    inputExpiresAtTick: 10_000,
    progressSeconds: SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
    outputExpiresAtTick: 20_000,
    status: "ready",
  });
  state.camp.structures?.push(empty, ready);
  state.player.position = { ...empty.position };
  state.inventory["raw-meat"] = 2;
  state.itemLifecycle = {
    balanceVersion: 2,
    perishables: {
      "raw-meat": [
        { quantity: 1, expiresAtTick: 1_000 },
        { quantity: 1, expiresAtTick: 2_000 },
      ],
    },
    tools: {},
  };

  state = applyCommand(state, {
    type: "use-structure",
    structureId: empty.id,
  });
  const loaded = state.camp.structures?.find(
    (structure) => structure.id === empty.id,
  );
  assert.equal(loaded?.process?.inputExpiresAtTick, 1_000);
  assert.equal(state.inventory["raw-meat"], 1);
  assert.equal(
    state.itemLifecycle?.perishables["raw-meat"]?.[0].expiresAtTick,
    2_000,
  );
  assert.equal(resolveAffordance(state, loaded!).actionId, "observe");
  assert.equal(resolveAffordance(state, ready).actionId, "collect-smoking-rack");

  const view = createGameViewModel(state);
  const renderedRacks = view.render.structures.filter(
    (structure) => structure.kind === "smoking-rack",
  );
  assert.equal(renderedRacks.length, 2);
  assert.equal(
    renderedRacks.find((structure) => structure.id === empty.id)?.processStatus,
    "processing",
  );
  assert.equal(
    renderedRacks.find((structure) => structure.id === ready.id)?.processStatus,
    "ready",
  );
});

test("local biome, cover, rain, fire distance, and sleep advance the same authoritative process", () => {
  let state = makeWorkingCamp("rack-environment");
  const rack = placed("rack.environment", "smoking-rack", 2, 0, {
    kind: "smoking-meat",
    inputExpiresAtTick: 100_000,
    progressSeconds: 0,
    status: "processing",
  });
  state.camp.structures?.push(rack);
  const biome = generateChunkDescriptor(
    String(state.seed),
    worldToChunkCoordinate(rack.position.x, rack.position.z),
  ).biome;
  const rate = SMOKING_RACK_BIOME_RULES[biome].rateMultiplier;

  state = stepSimulation(state, {}, 5);
  assert.ok(Math.abs((state.camp.structures?.find((entry) => entry.id === rack.id)?.process?.progressSeconds ?? 0) - rate * 5) < 1e-6);

  const rainy = structuredClone(state);
  rainy.weather.rainIntensity = 1;
  rainy.weather.targetRainIntensity = 1;
  rainy.weather.secondsUntilChange = 10_000;
  const beforeRain = rainy.camp.structures?.find(
    (entry) => entry.id === rack.id,
  )?.process?.progressSeconds;
  const paused = stepSimulation(rainy, {}, 2);
  assert.equal(
    paused.camp.structures?.find((entry) => entry.id === rack.id)?.process
      ?.progressSeconds,
    beforeRain,
  );

  const covered = structuredClone(rainy);
  covered.camp.shelterBuilt = true;
  covered.camp.structures?.push(
    placed("structure.shelter.test", "shelter", 2, 0),
  );
  const resumed = stepSimulation(covered, {}, 2);
  assert.ok(
    (resumed.camp.structures?.find((entry) => entry.id === rack.id)?.process
      ?.progressSeconds ?? 0) > (beforeRain ?? 0),
  );

  let sleeping = makeWorkingCamp("rack-sleep");
  sleeping.camp.shelterBuilt = true;
  sleeping.camp.bedBuilt = true;
  sleeping.camp.structures?.push(
    placed("structure.shelter.sleep", "shelter", 0, 0),
    placed("structure.bed.sleep", "bed", 0, -1),
    placed("rack.sleep", "smoking-rack", 2, 0, {
      kind: "smoking-meat",
      inputExpiresAtTick:
        sleeping.clock.tick + FOOD_SPOILAGE["raw-meat"].shelfLifeSeconds * FIXED_HZ,
      progressSeconds: SMOKING_RACK_REQUIRED_PROGRESS_SECONDS - 1,
      status: "processing",
    }),
  );
  sleeping.player.position = { x: 0, y: 0, z: -1 };
  sleeping = applyCommand(sleeping, { type: "rest" });
  assert.equal(
    sleeping.camp.structures?.find((entry) => entry.id === "rack.sleep")
      ?.process?.status,
    "ready",
  );
  assert.ok(
    sleeping.eventLog.some(
      (event) => event.type === "structure-process-completed",
    ),
  );
  assert.equal(sleeping.eventLog.at(-1)?.type, "rest-completed");
});

test("finished meat keeps aging on the rack and collection preserves its real deadline", () => {
  let state = makeWorkingCamp("rack-output-aging");
  const rack = placed("rack.output", "smoking-rack", 2, 0, {
    kind: "smoking-meat",
    inputExpiresAtTick: 100_000,
    progressSeconds: SMOKING_RACK_REQUIRED_PROGRESS_SECONDS - 0.5,
    status: "processing",
  });
  state.camp.structures?.push(rack);
  state.player.position = { ...rack.position };
  state = stepSimulation(state, {}, 1);
  const ready = state.camp.structures?.find((entry) => entry.id === rack.id);
  assert.equal(ready?.process?.status, "ready");
  const outputDeadline = ready?.process?.outputExpiresAtTick;
  assert.ok(outputDeadline);

  state = applyCommand(state, {
    type: "use-structure",
    structureId: rack.id,
  });
  assert.equal(state.inventory["smoked-meat"], 1);
  assert.equal(
    getPerishableInventoryStatus(state, "smoked-meat").nextExpiryTick,
    outputDeadline,
    "collecting must not grant a fresh 120-hour batch",
  );

  const expiring = makeWorkingCamp("rack-output-atomic-collection");
  const expiringRack = placed("rack.expiring", "smoking-rack", 2, 0, {
    kind: "smoking-meat",
    inputExpiresAtTick: 1,
    progressSeconds: SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
    outputExpiresAtTick: expiring.clock.tick + FIXED_HZ,
    status: "ready",
  });
  expiring.camp.structures?.push(expiringRack);
  expiring.player.position = { ...expiringRack.position };
  const rejectedCollection = applyCommand(expiring, {
    type: "use-structure",
    structureId: expiringRack.id,
  });
  assert.equal(rejectedCollection.inventory["smoked-meat"], 0);
  assert.equal(
    rejectedCollection.camp.structures?.find(
      (entry) => entry.id === expiringRack.id,
    )?.process?.status,
    "spoiled",
  );
  assert.equal(rejectedCollection.eventLog.at(-1)?.type, "command-rejected");

  const abandoned = makeWorkingCamp("rack-output-spoil");
  abandoned.camp.structures?.push(
    placed("rack.abandoned", "smoking-rack", 2, 0, {
      kind: "smoking-meat",
      inputExpiresAtTick: 1,
      progressSeconds: SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
      outputExpiresAtTick: abandoned.clock.tick + FIXED_HZ,
      status: "ready",
    }),
  );
  const spoiled = stepSimulation(abandoned, {}, 2);
  assert.equal(
    spoiled.camp.structures?.find((entry) => entry.id === "rack.abandoned")
      ?.process?.status,
    "spoiled",
  );
  assert.ok(
    spoiled.eventLog.some(
      (event) => event.cause.code === "smoking-rack:output-spoiled",
    ),
  );

  const migrated = migrateGameState(
    expandGameStateSavePayload(
      compactGameStateSavePayload(
        JSON.parse(JSON.stringify(spoiled)) as GameState,
      ),
    ) as GameState,
  );
  assert.equal(
    migrated.camp.structures?.find((entry) => entry.id === "rack.abandoned")
      ?.process?.status,
    "spoiled",
  );
});
