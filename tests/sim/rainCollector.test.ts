import assert from "node:assert/strict";
import test from "node:test";

import { commandForInteraction } from "../../src/game/GameClient";
import {
  FIXED_HZ,
  RAIN_COLLECTOR_CAPACITY,
  RECIPES,
  REST_SIMULATION_SECONDS,
  applyCommand,
  canCraft,
  createInitialState,
  getAvailableWaterContainerCount,
  migrateGameState,
  rainCollectorEnvironmentForStructure,
  resolveAffordance,
  stepSimulation,
} from "../../src/game/sim";
import type {
  GameState,
  PlacedStructureState,
} from "../../src/game/sim/types";
import { createActionReceipt } from "../../src/game/ui/actionReceipt";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
} from "../../src/game/world/saveDelta";
import { riverCenter } from "../../src/game/world/terrain";

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

function collector(
  id: string,
  x: number,
  z: number,
  storedUnits = 0,
  lastAdvancedTick = 0,
): PlacedStructureState {
  return {
    id,
    kind: "rain-collector",
    position: { x, y: 0, z },
    yaw: 0,
    builtAtTick: 0,
    storedUnits,
    capacity: RAIN_COLLECTOR_CAPACITY,
    lastAdvancedTick,
  };
}

function giveBuildMaterials(state: GameState, count: number): void {
  state.inventory.stick = 6 * count;
  state.inventory.vine = 4 * count;
  state.inventory["broad-leaf"] = 6 * count;
  state.inventory["coconut-shell"] = 2 * count;
  state.inventory["stone-blade"] = 1;
}

test("rain collectors are repeatable infrastructure outside the original camp and retain stable ids", () => {
  let state = makeSafe(createInitialState("rain-collector-multi"));
  state.player.position = { x: 100, y: 0, z: 100 };
  giveBuildMaterials(state, 3);
  state = migrateGameState(state);

  state = applyCommand(state, {
    type: "craft",
    recipeId: "rain-collector",
    placement: { position: { x: 98, y: 0, z: 100 }, yaw: 0 },
  });
  state = applyCommand(state, {
    type: "craft",
    recipeId: "rain-collector",
    placement: { position: { x: 102, y: 0, z: 100 }, yaw: Math.PI / 2 },
  });
  const firstIds = state.camp.structures!
    .filter((entry) => entry.kind === "rain-collector")
    .map((entry) => entry.id);
  assert.equal(firstIds.length, 2);
  assert.equal(new Set(firstIds).size, 2);
  assert.ok(
    state.camp.structures!
      .filter((entry) => entry.kind === "rain-collector")
      .every(
        (entry) =>
          entry.capacity === 4 &&
          entry.storedUnits === 0 &&
          entry.lastAdvancedTick! >= entry.builtAtTick &&
          entry.lastAdvancedTick! <= state.clock.tick,
      ),
  );

  const expanded = expandGameStateSavePayload(
    compactGameStateSavePayload(state),
  ) as GameState;
  state = migrateGameState(expanded);
  assert.deepEqual(
    state.camp.structures!
      .filter((entry) => entry.kind === "rain-collector")
      .map((entry) => entry.id),
    firstIds,
  );
  state = applyCommand(state, {
    type: "craft",
    recipeId: "rain-collector",
    placement: { position: { x: 106, y: 0, z: 100 }, yaw: 0 },
  });
  const allIds = state.camp.structures!
    .filter((entry) => entry.kind === "rain-collector")
    .map((entry) => entry.id);
  assert.equal(allIds.length, 3);
  assert.equal(new Set(allIds).size, 3);
});

test("building consumes empty coconut shells only and all rejected placements are atomic", () => {
  let occupied = makeSafe(createInitialState("rain-collector-occupied-shells"));
  occupied.player.position = { x: 100, y: 0, z: 100 };
  giveBuildMaterials(occupied, 1);
  occupied.inventory["clean-water"] = 2;
  occupied = migrateGameState(occupied);
  assert.equal(getAvailableWaterContainerCount(occupied), 0);
  assert.equal(canCraft(occupied, "rain-collector").reason, "missing-empty-containers");
  const occupiedInventory = structuredClone(occupied.inventory);
  const occupiedTick = occupied.clock.tick;
  occupied = applyCommand(occupied, {
    type: "craft",
    recipeId: "rain-collector",
    placement: { position: { x: 100, y: 0, z: 100 }, yaw: 0 },
  });
  assert.deepEqual(occupied.inventory, occupiedInventory);
  assert.equal(occupied.clock.tick, occupiedTick);
  assert.equal(occupied.camp.structures?.length, 0);

  let invalid = makeSafe(createInitialState("rain-collector-invalid"));
  invalid.player.position = { x: 100, y: 0, z: 100 };
  giveBuildMaterials(invalid, 1);
  invalid = migrateGameState(invalid);
  const before = structuredClone(invalid.inventory);
  invalid = applyCommand(invalid, {
    type: "craft",
    recipeId: "rain-collector",
    placement: {
      position: { x: 100, y: 0, z: riverCenter(100) },
      yaw: 0,
    },
  });
  assert.equal(invalid.eventLog.at(-1)?.type, "craft-failed");
  assert.deepEqual(invalid.inventory, before);

  invalid = applyCommand(invalid, {
    type: "craft",
    recipeId: "rain-collector",
    placement: { position: { x: 110, y: 0, z: 100 }, yaw: 0 },
  });
  assert.deepEqual(invalid.inventory, before);
});

test("death during represented build time consumes no materials and creates no structure", () => {
  let state = makeSafe(createInitialState("rain-collector-build-death"));
  state.player.position = { x: 100, y: 0, z: 100 };
  giveBuildMaterials(state, 1);
  state = migrateGameState(state);
  state.player.vitals.health = 0;
  const before = structuredClone(state.inventory);
  state = applyCommand(state, {
    type: "craft",
    recipeId: "rain-collector",
    placement: { position: { x: 100, y: 0, z: 100 }, yaw: 0 },
  });
  assert.equal(state.status, "lost");
  assert.equal(state.clock.tick, 1);
  assert.deepEqual(state.inventory, before);
  assert.equal(state.camp.structures?.length, 0);
});

test("deterministic rain, biome canopy and capacity advance in ordinary steps", () => {
  let wet = makeSafe(createInitialState("rain-collector-rate"));
  const rack = collector("collector.rate", 100, 100);
  wet.camp.structures = [rack];
  wet.weather.rainIntensity = 1;
  wet.weather.targetRainIntensity = 1;
  wet = migrateGameState(wet);
  const environment = rainCollectorEnvironmentForStructure(
    wet,
    wet.camp.structures![0]!,
  );
  wet = stepSimulation(wet, {}, 180);
  const stored = wet.camp.structures![0]!.storedUnits!;
  assert.ok(Math.abs(stored - environment.ratePerSecond * 180) < 1e-6);
  assert.equal(wet.camp.structures![0]!.lastAdvancedTick, 180 * FIXED_HZ);

  let dry = makeSafe(createInitialState("rain-collector-dry"));
  dry.camp.structures = [collector("collector.dry", 100, 100, 0.4)];
  dry = migrateGameState(dry);
  dry = stepSimulation(dry, {}, 300);
  assert.equal(dry.camp.structures![0]!.storedUnits, 0.4);

  let nearlyFull = makeSafe(createInitialState("rain-collector-capacity"));
  nearlyFull.camp.structures = [collector("collector.full", 100, 100, 3.99)];
  nearlyFull.weather.rainIntensity = 1;
  nearlyFull.weather.targetRainIntensity = 1;
  nearlyFull = migrateGameState(nearlyFull);
  nearlyFull = stepSimulation(nearlyFull, {}, 600);
  assert.equal(nearlyFull.camp.structures![0]!.storedUnits, 4);
});

test("a collector under a real shelter stops filling and explains the local blocker", () => {
  let state = makeSafe(createInitialState("rain-collector-overhead-cover"));
  state.player.position = { x: 100, y: 0, z: 100 };
  state.weather.rainIntensity = 1;
  state.weather.targetRainIntensity = 1;
  state.camp.structures = [
    {
      id: "shelter.overhead",
      kind: "shelter",
      position: { x: 100, y: 0, z: 100 },
      yaw: 0,
      builtAtTick: 0,
    },
    collector("collector.overhead", 100, 100),
  ];
  state = migrateGameState(state);

  const placedCollector = state.camp.structures!.find(
    (structure) => structure.id === "collector.overhead",
  )!;
  const environment = rainCollectorEnvironmentForStructure(
    state,
    placedCollector,
  );
  assert.equal(environment.blocker, "overhead-cover");
  assert.equal(environment.ratePerSecond, 0);
  const affordance = resolveAffordance(state, placedCollector);
  assert.equal(affordance.preview.environmentBlocker, "overhead-cover");
  assert.match(affordance.preview.detail, /叶棚顶挡住了集水口/);

  state = stepSimulation(state, {}, 300);
  assert.equal(
    state.camp.structures!.find(
      (structure) => structure.id === "collector.overhead",
    )!.storedUnits,
    0,
  );
});

test("building a collector under a shelter is rejected before time or materials settle", () => {
  let state = makeSafe(createInitialState("rain-collector-overhead-placement"));
  state.player.position = { x: 100, y: 0, z: 100 };
  giveBuildMaterials(state, 1);
  state.camp.structures = [
    {
      id: "shelter.placement",
      kind: "shelter",
      position: { x: 100, y: 0, z: 100 },
      yaw: 0,
      builtAtTick: 0,
    },
  ];
  state = migrateGameState(state);
  const beforeInventory = structuredClone(state.inventory);
  const beforeTick = state.clock.tick;

  state = applyCommand(state, {
    type: "craft",
    recipeId: "rain-collector",
    placement: { position: { x: 100, y: 0, z: 100 }, yaw: 0 },
  });
  assert.equal(state.eventLog.at(-1)?.type, "craft-failed");
  assert.equal(state.eventLog.at(-1)?.details?.reason, "invalid-placement");
  assert.deepEqual(state.inventory, beforeInventory);
  assert.equal(state.clock.tick, beforeTick);
  assert.equal(
    state.camp.structures?.filter((structure) => structure.kind === "rain-collector").length,
    0,
  );
});

test("sleep and ordinary catch-up use the same simulation advancement path", () => {
  const base = makeSafe(createInitialState("rain-collector-sleep"));
  base.player.position = { x: 100, y: 0, z: 100 };
  base.camp.bedBuilt = true;
  base.camp.structures = [
    {
      id: "bed.sleep",
      kind: "bed",
      position: { x: 100, y: 0, z: 100 },
      yaw: 0,
      builtAtTick: 0,
    },
    collector("collector.sleep", 104, 100),
  ];
  base.weather.rainIntensity = 0.7;
  base.weather.targetRainIntensity = 0.7;
  const migrated = migrateGameState(base);
  const slept = applyCommand(migrated, { type: "rest" });
  const stepped = stepSimulation(migrated, {}, REST_SIMULATION_SECONDS);
  assert.equal(slept.status, "playing");
  assert.equal(slept.clock.tick, stepped.clock.tick);
  assert.ok(
    Math.abs(
      slept.camp.structures![1]!.storedUnits! -
        stepped.camp.structures![1]!.storedUnits!,
    ) < 1e-9,
  );
});

test("repeatable structures stay in the save while render activity follows the 3x3 bubble", () => {
  let state = makeSafe(createInitialState("rain-collector-bubble"));
  state.camp.structures = [collector("collector.far", 100, 100)];
  state.weather.rainIntensity = 1;
  state.weather.targetRainIntensity = 1;
  state = migrateGameState(state);
  const hidden = createRenderSnapshot(state);
  assert.equal(
    hidden.structures.some((entry) => entry.id === "collector.far"),
    false,
  );
  state = stepSimulation(state, {}, 180);
  assert.ok(state.camp.structures![0]!.storedUnits! > 0);
  state = applyCommand(state, {
    type: "move-player",
    position: { x: 100, y: 0, z: 100 },
  });
  const revisited = createRenderSnapshot(state);
  assert.equal(
    revisited.structures.some((entry) => entry.id === "collector.far"),
    true,
  );
  assert.equal(
    revisited.entities.some((entry) => entry.id === "collector.far"),
    true,
  );
});

test("collection transfers only whole units, retains fractions and writes one receipt/progress event", () => {
  let state = makeSafe(createInitialState("rain-collector-collect"));
  state.player.position = { x: 100, y: 0, z: 100 };
  state.camp.structures = [collector("collector.collect", 100, 100, 2.7)];
  state.inventory["coconut-shell"] = 3;
  state = migrateGameState(state);
  const structure = state.camp.structures![0]!;
  const affordance = resolveAffordance(state, structure);
  assert.equal(affordance.actionId, "collect-rain-collector");
  assert.equal(affordance.state, "ready");
  assert.match(affordance.preview.detail, /2\.70\/4/);
  const target = {
    id: structure.id,
    kind: "rain-collector" as const,
    label: "雨水收集架",
    distance: 1,
    affordance,
  };
  const command = commandForInteraction(state, target);
  assert.deepEqual(command, {
    type: "use-structure",
    structureId: "collector.collect",
  });
  const beforeEventId = state.eventLog.at(-1)!.id;
  state = applyCommand(state, command!);
  assert.equal(state.inventory["clean-water"], 2);
  assert.ok(Math.abs(state.camp.structures![0]!.storedUnits! - 0.7) < 1e-9);
  assert.equal(state.progress?.waterEverCollected, true);
  assert.ok(state.knowledge?.observedItemIds.includes("clean-water"));
  const newEvents = state.eventLog.filter((event) => event.id > beforeEventId);
  assert.equal(
    newEvents.filter((event) => event.type === "structure-output-collected")
      .length,
    1,
  );
  const receipt = createActionReceipt({
    transactionId: "rain-collect-1",
    command: command!,
    beforeEventId,
    events: state.eventLog,
    nowMs: 100,
  });
  assert.equal(receipt?.primary.type, "structure-output-collected");
  assert.equal(receipt?.status, "completed");
});

test("empty containers, full inventory and fatal collection all preserve reservoir contents", () => {
  const make = (seed: string) => {
    const state = makeSafe(createInitialState(seed));
    state.player.position = { x: 100, y: 0, z: 100 };
    state.camp.structures = [collector(`collector.${seed}`, 100, 100, 2)];
    return migrateGameState(state);
  };

  let missing = make("missing-container");
  const missingTick = missing.clock.tick;
  missing = applyCommand(missing, {
    type: "use-structure",
    structureId: missing.camp.structures![0]!.id,
  });
  assert.equal(missing.camp.structures![0]!.storedUnits, 2);
  assert.equal(missing.inventory["clean-water"], 0);
  assert.equal(missing.clock.tick, missingTick);

  let full = make("full-water");
  full.inventory["coconut-shell"] = 8;
  full.inventory["clean-water"] = 8;
  const fullTick = full.clock.tick;
  full = applyCommand(full, {
    type: "use-structure",
    structureId: full.camp.structures![0]!.id,
  });
  assert.equal(full.camp.structures![0]!.storedUnits, 2);
  assert.equal(full.inventory["clean-water"], 8);
  assert.equal(full.clock.tick, fullTick);

  let fatal = make("fatal-collect");
  fatal.inventory["coconut-shell"] = 2;
  fatal.player.vitals.health = 0;
  fatal = applyCommand(fatal, {
    type: "use-structure",
    structureId: fatal.camp.structures![0]!.id,
  });
  assert.equal(fatal.status, "lost");
  assert.equal(fatal.inventory["clean-water"], 0);
  assert.equal(fatal.camp.structures![0]!.storedUnits, 2);
});

test("migration clamps reservoir tampering and does not backfill missing timestamps", () => {
  const state = makeSafe(createInitialState("rain-collector-migrate"));
  state.clock.tick = 900;
  state.clock.elapsedSeconds = 30;
  state.camp.structures = [
    {
      ...collector("collector.corrupt", 100, 100, 99, -30),
      capacity: 999,
    },
    {
      ...collector("collector.missing", 104, 100),
      storedUnits: Number.NaN,
      capacity: Number.NaN,
      lastAdvancedTick: Number.NaN,
    },
  ];
  const migrated = migrateGameState(state);
  assert.deepEqual(
    migrated.camp.structures?.map((entry) => ({
      id: entry.id,
      storedUnits: entry.storedUnits,
      capacity: entry.capacity,
      lastAdvancedTick: entry.lastAdvancedTick,
    })),
    [
      {
        id: "collector.corrupt",
        storedUnits: 4,
        capacity: 4,
        lastAdvancedTick: 900,
      },
      {
        id: "collector.missing",
        storedUnits: 0,
        capacity: 4,
        lastAdvancedTick: 900,
      },
    ],
  );
});

test("rain collector recipe keeps its intended work and material contract", () => {
  assert.deepEqual(RECIPES["rain-collector"].ingredients, {
    stick: 6,
    vine: 4,
    "broad-leaf": 6,
    "coconut-shell": 2,
  });
  assert.equal(RECIPES["rain-collector"].workSeconds, 65);
  assert.equal(RECIPES["rain-collector"].requiresCamp, undefined);
});
