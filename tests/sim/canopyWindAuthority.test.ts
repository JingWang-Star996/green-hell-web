import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_FACTS,
  EMERGENCY_CANOPY_RESPONSE,
} from "../../src/game/sim/campaignContent";
import {
  CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD,
  CANOPY_JUNCTION_ID,
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  CANOPY_JUNCTION_POSITION,
  CANOPY_JUNCTION_TENSION_VINE_IDS,
  CANOPY_SAMPLE_STABLE_TICKS,
  createCanopyJunctionState,
} from "../../src/game/sim/canopyJunction";
import { TOOL_DURABILITY } from "../../src/game/sim/content";
import { addLifecycleInventory } from "../../src/game/sim/lifecycle";
import { hasObjectiveFact, recordObjectiveFact } from "../../src/game/sim/objectiveFacts";
import {
  FIXED_DT_SECONDS,
  applyCommand,
  stepSimulation,
} from "../../src/game/sim/simulation";
import { createInitialState } from "../../src/game/sim/state";
import type { GameState, ObjectiveFactReference, PlacedStructureState } from "../../src/game/sim";

function addFact(
  state: GameState,
  fact: ObjectiveFactReference,
): void {
  state.knowledge!.objectiveFacts = recordObjectiveFact(
    state.knowledge!.objectiveFacts,
    fact,
    state.clock.tick,
  );
}

function activeA2State(seed = "a2-authority"): GameState {
  const state = createInitialState(seed);
  state.objectives.currentTaskId = "canopy-wind";
  state.objectives.completedTaskIds = [
    "treat-wound",
    "purify-water",
    "establish-camp",
    "recover-battery",
    "transmit-signal",
    "river-rising",
  ];
  addFact(state, CAMPAIGN_FACTS.canopyRequestHeard);
  const beacon: PlacedStructureState = {
    id: "structure.radio-beacon.a2",
    kind: "radio-beacon",
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    builtAtTick: 0,
  };
  state.camp.structures = [beacon];
  state.camp.beaconBuilt = true;
  state.weather.rainIntensity = 0.08;
  state.weather.targetRainIntensity = 0.08;
  state.weather.secondsUntilChange = 100_000;
  state.inventory["stone-blade"] = 1;
  state.player.equippedItem = "stone-blade";
  state.itemLifecycle!.tools["stone-blade"] = [{
    durability: TOOL_DURABILITY["stone-blade"].maxDurability,
    maxDurability: TOOL_DURABILITY["stone-blade"].maxDurability,
  }];
  return state;
}

function cutTensionVine(state: GameState, id: string): GameState {
  const vine = state.world.entities[id];
  state.player.position = {
    x: vine.position.x,
    y: 0,
    z: vine.position.z + 1.35,
  };
  state.player.lookYaw = 0;
  state.player.lookPitch = -0.2;
  state.player.poseRevision = Math.max(0, state.player.poseRevision ?? 0) + 1;
  return applyCommand(state, {
    type: "physical-action",
    targetId: id,
    actionId: "cut",
    poseRevision: state.player.poseRevision,
  });
}

function addC17Shelter(state: GameState, id = "structure.shelter.c17"): void {
  state.camp.structures = [
    ...(state.camp.structures ?? []),
    {
      id,
      kind: "shelter",
      position: { ...CANOPY_JUNCTION_POSITION },
      yaw: 0,
      builtAtTick: state.clock.tick,
    },
  ];
  state.camp.shelterBuilt = true;
}

function setSampleReady(state: GameState): void {
  const tree = state.world.entities[CANOPY_JUNCTION_OBSTRUCTION_TREE_ID];
  tree.quantity = 0;
  tree.depleted = true;
  delete tree.treeHarvest;
  const base = createCanopyJunctionState(state.clock.tick);
  state.world.canopyJunction = {
    ...base,
    phase: "sample-ready",
    clearedObstructionIds: [CANOPY_JUNCTION_OBSTRUCTION_TREE_ID],
    samplingStartedTick: state.clock.tick,
    sample: {
      directionRadians: Math.PI / 2,
      strength: 0.84,
      signalQuality: 0.93,
      capturedAtTick: state.clock.tick,
      stableTicks: CANOPY_SAMPLE_STABLE_TICKS,
    },
  };
}

test("fixed ticks advance one wind truth and deliver the delayed A2 response once", () => {
  let state = createInitialState("a2-radio-authority");
  state.knowledge!.objectiveFacts = recordObjectiveFact(
    state.knowledge!.objectiveFacts,
    CAMPAIGN_FACTS.riverTrendReported,
    state.clock.tick,
  );

  state = stepSimulation(
    state,
    {},
    FIXED_DT_SECONDS * (EMERGENCY_CANOPY_RESPONSE.delayTicks - 1),
  );
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyRequestHeard,
    ),
    false,
  );

  state = stepSimulation(state, {}, FIXED_DT_SECONDS);
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyRequestHeard,
    ),
    true,
  );
  assert.equal(state.world.windField?.lastAdvancedTick, state.clock.tick);
  const firstResponseCount = state.eventLog.filter(
    (event) => event.details?.responseId === EMERGENCY_CANOPY_RESPONSE.id,
  ).length;
  state = stepSimulation(state, {}, FIXED_DT_SECONDS * 30);
  assert.equal(
    state.eventLog.filter(
      (event) => event.details?.responseId === EMERGENCY_CANOPY_RESPONSE.id,
    ).length,
    firstResponseCount,
  );
});

test("the C-17 vine route restores, samples, requires inspection, and reports without ending play", () => {
  let state = activeA2State("a2-happy-path");
  for (const id of CANOPY_JUNCTION_TENSION_VINE_IDS) {
    state = cutTensionVine(state, id);
    assert.equal(state.world.entities[id].depleted, true);
  }
  assert.equal(state.world.canopyJunction?.phase, "exposed");
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyRepairKitPrepared,
    ),
    true,
  );

  const junction = state.world.entities[CANOPY_JUNCTION_ID];
  state = applyCommand(state, {
    type: "move-player",
    position: { ...junction.position },
  });
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: CANOPY_JUNCTION_ID,
  });
  assert.equal(state.world.canopyJunction?.phase, "connector-open");
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyContradictionObserved,
    ),
    true,
  );
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: CANOPY_JUNCTION_ID,
  });
  assert.equal(state.world.canopyJunction?.phase, "link-restored");
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyLinkRestored,
    ),
    true,
  );

  state = stepSimulation(state, {}, FIXED_DT_SECONDS * 3_600);
  assert.equal(
    state.world.canopyJunction?.phase,
    "sample-ready",
    JSON.stringify({
      tick: state.clock.tick,
      status: state.status,
      consecutive: state.world.canopyJunction?.consecutiveReadableTicks,
      wind: state.world.windField,
    }),
  );
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyLiveSampleObserved,
    ),
    false,
    "sample readiness must not auto-claim that the player read it",
  );
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: CANOPY_JUNCTION_ID,
  });
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyLiveSampleObserved,
    ),
    true,
  );

  state = applyCommand(state, {
    type: "move-player",
    position: { x: 0, y: 0, z: 0 },
  });
  state = applyCommand(state, {
    type: "transmit",
    structureId: "structure.radio-beacon.a2",
  });
  assert.equal(state.status, "playing");
  assert.equal(state.world.canopyJunction?.phase, "reported");
  assert.equal(state.objectives.flags.sandboxContinued, true);
  assert.ok(state.objectives.completedTaskIds.includes("canopy-wind"));
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyWindSampleReported,
    ),
    true,
  );
  assert.equal(state.eventLog.some((event) => event.type === "game-won"), false);
});

test("strong rain blocks both C-17 open-box operations without partial settlement", () => {
  let state = activeA2State("a2-rain-atomicity");
  for (const id of CANOPY_JUNCTION_TENSION_VINE_IDS) {
    const vine = state.world.entities[id];
    vine.quantity = 0;
    vine.depleted = true;
  }
  state = stepSimulation(state, {}, FIXED_DT_SECONDS);
  assert.equal(state.world.canopyJunction?.phase, "exposed");
  state.weather.rainIntensity = CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD;
  state.weather.targetRainIntensity = CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD;
  state.weather.secondsUntilChange = 100_000;
  state = applyCommand(state, {
    type: "move-player",
    position: { ...CANOPY_JUNCTION_POSITION },
  });

  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: CANOPY_JUNCTION_ID,
  });
  assert.equal(state.world.canopyJunction?.phase, "exposed");
  assert.equal(
    state.eventLog.at(-1)?.details?.reason,
    "rain-exposed",
  );

  addC17Shelter(state);
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: CANOPY_JUNCTION_ID,
  });
  assert.equal(state.world.canopyJunction?.phase, "connector-open");

  state.camp.structures = state.camp.structures?.filter(
    (structure) => structure.kind !== "shelter",
  );
  state.camp.shelterBuilt = false;
  const beforeRestoreTick = state.world.canopyJunction?.phaseEnteredTick;
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: CANOPY_JUNCTION_ID,
  });
  assert.equal(state.world.canopyJunction?.phase, "connector-open");
  assert.equal(state.world.canopyJunction?.phaseEnteredTick, beforeRestoreTick);
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyLinkRestored,
    ),
    false,
  );

  addC17Shelter(state, "structure.shelter.c17-restored");
  state = applyCommand(state, {
    type: "inspect-landmark",
    entityId: CANOPY_JUNCTION_ID,
  });
  assert.equal(state.world.canopyJunction?.phase, "link-restored");
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyLinkRestored,
    ),
    true,
  );
});

test("C-17 report rejects a valid sample until one real preparation fact exists", () => {
  let state = activeA2State("a2-report-strict");
  setSampleReady(state);
  for (const fact of [
    CAMPAIGN_FACTS.canopyContradictionObserved,
    CAMPAIGN_FACTS.canopyLinkRestored,
    CAMPAIGN_FACTS.canopyLiveSampleObserved,
  ]) {
    addFact(state, fact);
  }
  state = applyCommand(state, {
    type: "move-player",
    position: { x: 0, y: 0, z: 0 },
  });
  state = applyCommand(state, {
    type: "transmit",
    structureId: "structure.radio-beacon.a2",
  });
  assert.equal(state.world.canopyJunction?.phase, "sample-ready");
  assert.equal(
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyWindSampleReported,
    ),
    false,
  );
  assert.equal(
    state.eventLog.at(-1)?.details?.reason,
    "canopy-report-prerequisites",
  );

  addFact(state, CAMPAIGN_FACTS.canopyForwardOutpostPrepared);
  state = applyCommand(state, {
    type: "transmit",
    structureId: "structure.radio-beacon.a2",
  });
  assert.equal(state.world.canopyJunction?.phase, "reported");
});

test("A2 preparation records only a real departure or a geometrically valid forward outpost", () => {
  let provisioned = activeA2State("a2-provisioned-departure");
  addLifecycleInventory(provisioned, "torch", 1);
  addLifecycleInventory(provisioned, "clean-water", 2);
  addLifecycleInventory(provisioned, "palm-fruit", 2);
  provisioned = applyCommand(provisioned, {
    type: "move-player",
    position: { x: 8.5, y: 0, z: 0 },
  });
  assert.equal(
    hasObjectiveFact(
      provisioned.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyProvisioned,
    ),
    true,
  );

  let outpost = activeA2State("a2-forward-outpost-geometry");
  outpost.camp.structures = [
    ...(outpost.camp.structures ?? []),
    {
      id: "structure.shelter.c17-outpost",
      kind: "shelter",
      position: {
        x: CANOPY_JUNCTION_POSITION.x + 31,
        y: 0,
        z: CANOPY_JUNCTION_POSITION.z,
      },
      yaw: 0,
      builtAtTick: 0,
    },
    {
      id: "structure.bed.c17-too-far",
      kind: "bed",
      position: {
        x: CANOPY_JUNCTION_POSITION.x + 32.1,
        y: 0,
        z: CANOPY_JUNCTION_POSITION.z,
      },
      yaw: 0,
      builtAtTick: 0,
    },
  ];
  outpost = stepSimulation(outpost, {}, FIXED_DT_SECONDS);
  assert.equal(
    hasObjectiveFact(
      outpost.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyForwardOutpostPrepared,
    ),
    false,
  );
  const bed = outpost.camp.structures!.find(
    (structure) => structure.id === "structure.bed.c17-too-far",
  )!;
  bed.position.x = CANOPY_JUNCTION_POSITION.x + 31.5;
  outpost = stepSimulation(outpost, {}, FIXED_DT_SECONDS);
  assert.equal(
    hasObjectiveFact(
      outpost.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyForwardOutpostPrepared,
    ),
    true,
  );
});
