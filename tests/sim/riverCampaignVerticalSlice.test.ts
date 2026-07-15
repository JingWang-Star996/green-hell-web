import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_DT_SECONDS,
  applyCommand,
  createInitialState,
  migrateGameState,
  stepSimulation,
} from "../../src/game/sim";
import {
  CAMPAIGN_FACTS,
  RIVER_GAUGE_ID,
  RIVER_GAUGE_OBSTRUCTION_ID,
} from "../../src/game/sim/campaignContent";
import { TOOL_DURABILITY } from "../../src/game/sim/content";
import { hasObjectiveFact } from "../../src/game/sim/objectiveFacts";
import type { GameState, PlacedStructureState } from "../../src/game/sim/types";
import { treeInteractionAnchor } from "../../src/game/sim/treeHarvest";
import { createGameViewModel } from "../../src/game/ui/viewModel";

function prologueReadyState(seed = "a1-prologue"): GameState {
  const state = createInitialState(seed);
  state.objectives.currentTaskId = "transmit-signal";
  state.objectives.completedTaskIds = [
    "treat-wound",
    "purify-water",
    "establish-camp",
    "recover-battery",
  ];
  state.objectives.flags = {
    woundTreated: true,
    waterPurified: true,
    campEstablished: true,
    batteryRecovered: true,
    transmitted: false,
  };
  const beacon: PlacedStructureState = {
    id: "structure.radio-beacon.a1",
    kind: "radio-beacon",
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    builtAtTick: 0,
  };
  state.camp.structures = [beacon];
  state.camp.beaconBuilt = true;
  state.player.position = { x: 0, y: 0, z: 0 };
  return state;
}

function radioRequestState(seed = "a1-radio-ready"): GameState {
  let state = applyCommand(prologueReadyState(seed), {
    type: "transmit",
    structureId: "structure.radio-beacon.a1",
  });
  state = stepSimulation(state, {}, FIXED_DT_SECONDS * 120);
  return state;
}

function giveAxe(state: GameState): GameState {
  state.inventory.axe = 1;
  state.itemLifecycle!.tools.axe = [
    {
      durability: TOOL_DURABILITY.axe.maxDurability,
      maxDurability: TOOL_DURABILITY.axe.maxDurability,
    },
  ];
  return applyCommand(state, { type: "equip-item", itemId: "axe" });
}

function moveToTreeWorkPoint(state: GameState, entityId: string): GameState {
  const tree = state.world.entities[entityId];
  const anchor = treeInteractionAnchor(tree);
  return applyCommand(state, {
    type: "move-player",
    position: { x: anchor.x, y: 0, z: anchor.z },
    look: { yaw: state.player.lookYaw ?? Math.PI, pitch: -0.45 },
  });
}

test("prologue transmission stays playable and opens A1 instead of ending the run", () => {
  const state = applyCommand(prologueReadyState(), {
    type: "transmit",
    structureId: "structure.radio-beacon.a1",
  });

  assert.equal(state.status, "playing");
  assert.equal(state.objectives.currentTaskId, "river-rising");
  assert.ok(state.objectives.completedTaskIds.includes("transmit-signal"));
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.distressReported,
    ),
    true,
  );
  assert.equal(state.eventLog.some((event) => event.type === "game-won"), false);
  assert.equal(createGameViewModel(state).currentObjective?.label, "等待应急回执");
});

test("radio response arrives on the exact 120th simulation tick and is idempotent", () => {
  let state = applyCommand(prologueReadyState("a1-radio-delay"), {
    type: "transmit",
    structureId: "structure.radio-beacon.a1",
  });
  const triggerTick = state.clock.tick;
  state = stepSimulation(state, {}, FIXED_DT_SECONDS * 119);
  assert.equal(state.clock.tick, triggerTick + 119);
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverRequestHeard,
    ),
    false,
  );

  state = stepSimulation(state, {}, FIXED_DT_SECONDS);
  assert.equal(state.clock.tick, triggerTick + 120);
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverRequestHeard,
    ),
    true,
  );
  assert.equal(
    state.eventLog.filter((event) => event.type === "radio-message-received")
      .length,
    1,
  );
  assert.equal(createGameViewModel(state).currentObjective?.label, "选择远征准备");

  state = stepSimulation(state, {}, FIXED_DT_SECONDS * 300);
  assert.equal(
    state.eventLog.filter((event) => event.type === "radio-message-received")
      .length,
    1,
  );
});

test("leaving camp records any valid preparation without consuming carried items", () => {
  let state = radioRequestState("a1-preparation");
  state.inventory.spear = 1;
  state.inventory.bandage = 1;
  const before = { ...state.inventory };

  state = applyCommand(state, {
    type: "move-player",
    position: { x: 9, y: 0, z: 0 },
  });

  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverDefenseKitPrepared,
    ),
    true,
  );
  assert.deepEqual(state.inventory, before);
  assert.equal(createGameViewModel(state).currentObjective?.label, "清开水尺入口");
});

test("A1 radio refuses guessed reports before a real gauge observation", () => {
  const state = applyCommand(radioRequestState("a1-no-guessed-report"), {
    type: "transmit",
    structureId: "structure.radio-beacon.a1",
  });
  assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(
    state.eventLog.at(-1)?.details?.reason,
    "river-reading-required",
  );
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverTrendReported,
    ),
    false,
  );
});

test("A1 radio cannot accept an early reading before the response and expedition chain", () => {
  const state = applyCommand(prologueReadyState("a1-sequence-gate"), {
    type: "transmit",
    structureId: "structure.radio-beacon.a1",
  });
  state.knowledge!.objectiveFacts!.push({
    ...CAMPAIGN_FACTS.riverTrendObserved,
    firstKnownTick: state.clock.tick,
  });

  const rejected = applyCommand(state, {
    type: "transmit",
    structureId: "structure.radio-beacon.a1",
  });
  assert.equal(rejected.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(
    rejected.eventLog.at(-1)?.details?.reason,
    "river-report-prerequisites",
  );
  assert.equal(
    hasObjectiveFact(
      rejected.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverTrendReported,
    ),
    false,
  );
});

test("objective facts and hydrology survive migration without relying on event history", () => {
  const source = radioRequestState("a1-migration");
  source.eventLog = source.eventLog.slice(-1);
  source.world.riverHydrology!.levelMeters = 0.27;
  source.knowledge!.objectiveFacts!.push(
    { ...CAMPAIGN_FACTS.riverRequestHeard, firstKnownTick: 999_999 },
    { verb: "heard", subjectId: "../invalid", firstKnownTick: 1 },
  );

  const migrated = migrateGameState(source);
  assert.equal(
    hasObjectiveFact(
      migrated.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.distressReported,
    ),
    true,
  );
  assert.equal(
    migrated.knowledge?.objectiveFacts?.filter(
      (fact) => fact.subjectId === CAMPAIGN_FACTS.riverRequestHeard.subjectId,
    ).length,
    1,
  );
  assert.equal(
    migrated.knowledge?.objectiveFacts?.some(
      (fact) => fact.subjectId === "../invalid",
    ),
    false,
  );
  assert.equal(migrated.world.riverHydrology?.levelMeters, 0.27);
});

test("hydrology replay is identical across a save migration boundary", () => {
  const initial = createInitialState("a1-hydrology-reload");
  initial.weather.rainIntensity = 0.88;
  initial.weather.targetRainIntensity = 0.88;
  initial.weather.storm = true;
  initial.weather.secondsUntilChange = 10_000;
  const checkpoint = stepSimulation(initial, {}, FIXED_DT_SECONDS * 150);
  const restored = migrateGameState(structuredClone(checkpoint));

  const uninterrupted = stepSimulation(checkpoint, {}, FIXED_DT_SECONDS * 300);
  const resumed = stepSimulation(restored, {}, FIXED_DT_SECONDS * 300);
  assert.deepEqual(
    resumed.world.riverHydrology,
    uninterrupted.world.riverHydrology,
  );
});

test("blocked gauge, staged fallen-tree clearance, repeat readings and A1 report form one playable loop", () => {
  let state = radioRequestState("a1-full-loop");
  state.inventory.spear = 1;
  state.inventory.bandage = 1;
  state = giveAxe(state);
  state = applyCommand(state, {
    type: "move-player",
    position: { x: 9, y: 0, z: 0 },
  });

  const gauge = state.world.entities[RIVER_GAUGE_ID];
  state = applyCommand(state, {
    type: "move-player",
    position: { ...gauge.position },
  });
  const blocked = applyCommand(state, {
    type: "inspect-landmark",
    entityId: RIVER_GAUGE_ID,
  });
  assert.equal(blocked.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(blocked.eventLog.at(-1)?.details?.reason, "access-obstructed");

  state = moveToTreeWorkPoint(blocked, RIVER_GAUGE_OBSTRUCTION_ID);
  state = applyCommand(state, {
    type: "harvest",
    entityId: RIVER_GAUGE_OBSTRUCTION_ID,
  });
  assert.equal(
    state.world.entities[RIVER_GAUGE_OBSTRUCTION_ID].treeHarvest?.looseLog,
    true,
  );
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverGaugeCleared,
    ),
    false,
  );

  state = moveToTreeWorkPoint(state, RIVER_GAUGE_OBSTRUCTION_ID);
  state = applyCommand(state, {
    type: "harvest",
    entityId: RIVER_GAUGE_OBSTRUCTION_ID,
  });
  assert.equal(state.world.entities[RIVER_GAUGE_OBSTRUCTION_ID].depleted, true);
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverGaugeCleared,
    ),
    true,
  );

  state = applyCommand(state, {
    type: "move-player",
    position: { ...gauge.position },
  });
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: RIVER_GAUGE_ID,
  });
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverTrendObserved,
    ),
    true,
  );
  const firstReadingCount = state.eventLog.filter(
    (event) =>
      event.type === "landmark-inspected" &&
      event.details?.entityId === RIVER_GAUGE_ID,
  ).length;
  const firstReading = state.eventLog.findLast(
    (event) =>
      event.type === "landmark-inspected" &&
      event.details?.entityId === RIVER_GAUGE_ID,
  );
  assert.equal(firstReading?.details?.createsMilestone, true);
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: RIVER_GAUGE_ID,
  });
  assert.equal(
    state.eventLog.filter(
      (event) =>
        event.type === "landmark-inspected" &&
        event.details?.entityId === RIVER_GAUGE_ID,
    ).length,
    firstReadingCount + 1,
  );
  assert.equal(
    state.eventLog.findLast(
      (event) =>
        event.type === "landmark-inspected" &&
        event.details?.entityId === RIVER_GAUGE_ID,
    )?.details?.createsMilestone,
    false,
  );

  state = applyCommand(state, {
    type: "move-player",
    position: { x: 0, y: 0, z: 0 },
  });
  state = applyCommand(state, {
    type: "transmit",
    structureId: "structure.radio-beacon.a1",
  });
  assert.equal(state.status, "playing");
  assert.equal(state.objectives.currentTaskId, "canopy-wind");
  assert.ok(state.objectives.completedTaskIds.includes("river-rising"));
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverTrendReported,
    ),
    true,
  );
  assert.equal(state.eventLog.some((event) => event.type === "game-won"), false);
});
