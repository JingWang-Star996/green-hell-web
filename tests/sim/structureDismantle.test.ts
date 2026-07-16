import assert from "node:assert/strict";
import test from "node:test";

import {
  STRUCTURE_DISMANTLE_RULES,
  applyCommand,
  createInitialState,
  getStructureDismantlePlan,
  migrateGameState,
} from "../../src/game/sim";
import type {
  GameState,
  PlacedStructureKind,
  PlacedStructureState,
  SmokingRackProcessState,
} from "../../src/game/sim/types";
import {
  compactGameStateSavePayload,
  expandGameStateSavePayload,
} from "../../src/game/world/saveDelta";

function structure(
  id: string,
  kind: PlacedStructureKind,
  x = 0,
  z = 0,
  options: Partial<PlacedStructureState> = {},
): PlacedStructureState {
  return {
    id,
    kind,
    position: { x, y: 0, z },
    yaw: 0,
    builtAtTick: 0,
    ...options,
  };
}

function safeState(seed: string): GameState {
  const state = createInitialState(seed);
  state.player.position = { x: 0, y: 0, z: 0 };
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
  state.weather.rainIntensity = 0;
  state.weather.targetRainIntensity = 0;
  state.weather.secondsUntilChange = 10_000;
  state.camp.structures = [];
  return migrateGameState(state);
}

function rackProcess(status: SmokingRackProcessState["status"]): SmokingRackProcessState {
  return {
    kind: "smoking-meat",
    inputExpiresAtTick: 100_000,
    progressSeconds: status === "processing" ? 10 : 1_000,
    ...(status === "ready" ? { outputExpiresAtTick: 100_000 } : {}),
    status,
  };
}

test("dismantle rules use an explicit version-stable partial refund table", () => {
  assert.deepEqual(STRUCTURE_DISMANTLE_RULES["smoking-rack"], {
    workSeconds: 16,
    refund: { stick: 2, vine: 1 },
  });
  assert.deepEqual(STRUCTURE_DISMANTLE_RULES["rain-collector"], {
    workSeconds: 23,
    refund: {
      stick: 3,
      vine: 2,
      "broad-leaf": 3,
      "coconut-shell": 1,
    },
  });
});

test("an empty rack is removed by exact id and its partial materials survive save roundtrip", () => {
  let state = safeState("dismantle-rack-success");
  state.camp.structures = [
    structure("rack.keep", "smoking-rack", 2, 0),
    structure("rack.remove", "smoking-rack", 0, 0),
  ];
  const beforeStick = state.inventory.stick;
  const beforeVine = state.inventory.vine;

  state = applyCommand(state, {
    type: "dismantle-structure",
    structureId: "rack.remove",
  });

  assert.deepEqual(state.camp.structures?.map((entry) => entry.id), ["rack.keep"]);
  assert.equal(state.inventory.stick, beforeStick + 2);
  assert.equal(state.inventory.vine, beforeVine + 1);
  const event = state.eventLog.at(-1);
  assert.equal(event?.type, "structure-dismantled");
  assert.equal(event?.details?.structureId, "rack.remove");
  assert.equal(event?.details?.refundStick, 2);
  assert.equal(event?.details?.refundVine, 1);

  const reloaded = migrateGameState(
    expandGameStateSavePayload(compactGameStateSavePayload(state)) as GameState,
  );
  assert.equal(
    reloaded.camp.structures?.some((entry) => entry.id === "rack.remove"),
    false,
  );
  assert.equal(reloaded.inventory.stick, beforeStick + 2);
});

test("a collector with stored water rejects before time or materials change", () => {
  const state = safeState("dismantle-collector-stored-water");
  state.camp.structures = [
    structure("collector.remove", "rain-collector", 0, 0, {
      storedUnits: 2.375,
      capacity: 4,
      lastAdvancedTick: state.clock.tick,
    }),
  ];
  const plan = getStructureDismantlePlan(state, "collector.remove");
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, "collector-not-empty");
  assert.match(plan.message, /还有 2\.38 份雨水/);
  assert.match(plan.message, /集满后一次收完/);

  const next = applyCommand(state, {
    type: "dismantle-structure",
    structureId: "collector.remove",
  });
  assert.equal(next.clock.tick, state.clock.tick);
  assert.equal(next.camp.structures?.[0]?.storedUnits, 2.375);
  assert.deepEqual(next.inventory, state.inventory);
  assert.equal(next.eventLog.at(-1)?.type, "command-rejected");
});

test("an empty collector that catches rain during work aborts at settlement", () => {
  let state = safeState("dismantle-collector-rain-race");
  state.weather.rainIntensity = 1;
  state.weather.targetRainIntensity = 1;
  state.weather.secondsUntilChange = 10_000;
  state.camp.structures = [
    structure("collector.rain-race", "rain-collector", 0, 0, {
      storedUnits: 0,
      capacity: 4,
      lastAdvancedTick: state.clock.tick,
    }),
  ];
  assert.equal(
    getStructureDismantlePlan(state, "collector.rain-race").ok,
    true,
  );
  const beforeTick = state.clock.tick;
  const beforeRefundMaterials = {
    stick: state.inventory.stick,
    vine: state.inventory.vine,
    broadLeaf: state.inventory["broad-leaf"],
    coconutShell: state.inventory["coconut-shell"],
  };

  state = applyCommand(state, {
    type: "dismantle-structure",
    structureId: "collector.rain-race",
  });

  const collector = state.camp.structures?.find(
    (candidate) => candidate.id === "collector.rain-race",
  );
  assert.ok(collector);
  assert.ok((collector.storedUnits ?? 0) > 0);
  assert.equal(
    state.clock.tick - beforeTick,
    STRUCTURE_DISMANTLE_RULES["rain-collector"].workSeconds * 30,
  );
  assert.deepEqual(
    {
      stick: state.inventory.stick,
      vine: state.inventory.vine,
      broadLeaf: state.inventory["broad-leaf"],
      coconutShell: state.inventory["coconut-shell"],
    },
    beforeRefundMaterials,
  );
  assert.equal(
    state.eventLog.some((event) => event.type === "structure-dismantled"),
    false,
  );
  const rejection = state.eventLog.findLast(
    (event) => event.type === "command-rejected",
  );
  assert.equal(rejection?.details?.blocker, "collector-not-empty");
  assert.equal(rejection?.details?.interrupted, true);
});

test("every smoking-rack payload state blocks removal with a specific remedy", () => {
  for (const status of ["processing", "ready", "spoiled"] as const) {
    const state = safeState(`dismantle-rack-${status}`);
    state.camp.structures = [
      structure("rack.busy", "smoking-rack", 0, 0, {
        process: rackProcess(status),
      }),
    ];
    const plan = getStructureDismantlePlan(state, "rack.busy");
    assert.equal(plan.ok, false);
    assert.equal(plan.blocker, `rack-${status}`);
    const next = applyCommand(state, {
      type: "dismantle-structure",
      structureId: "rack.busy",
    });
    assert.equal(next.camp.structures?.length, 1);
    assert.equal(next.eventLog.at(-1)?.type, "command-rejected");
  }
});

test("range, inventory capacity, unsupported and legacy targets reject atomically", () => {
  const cases: Array<{
    name: string;
    prepare: (state: GameState) => void;
    target: string;
    blocker: string;
  }> = [
    {
      name: "range",
      prepare: (state) => {
        state.camp.structures = [structure("rack.far", "smoking-rack", 10, 0)];
      },
      target: "rack.far",
      blocker: "out-of-range",
    },
    {
      name: "capacity",
      prepare: (state) => {
        state.camp.structures = [structure("rack.full", "smoking-rack")];
        state.inventory.stick = 32;
      },
      target: "rack.full",
      blocker: "inventory-full",
    },
    {
      name: "unsupported",
      prepare: (state) => {
        state.camp.structures = [structure("bed.story", "bed")];
      },
      target: "bed.story",
      blocker: "unsupported",
    },
    {
      name: "legacy",
      prepare: () => undefined,
      target: "structure.smoking-rack.legacy-fallback",
      blocker: "legacy-fallback",
    },
  ];

  for (const entry of cases) {
    let state = safeState(`dismantle-reject-${entry.name}`);
    entry.prepare(state);
    const beforeInventory = structuredClone(state.inventory);
    const beforeStructures = structuredClone(state.camp.structures);
    const beforeTick = state.clock.tick;
    assert.equal(getStructureDismantlePlan(state, entry.target).blocker, entry.blocker);
    state = applyCommand(state, {
      type: "dismantle-structure",
      structureId: entry.target,
    });
    assert.deepEqual(state.inventory, beforeInventory);
    assert.deepEqual(state.camp.structures, beforeStructures);
    assert.equal(state.clock.tick, beforeTick);
  }
});

test("death during represented dismantle time removes nothing and refunds nothing", () => {
  let state = safeState("dismantle-death");
  state.camp.structures = [structure("rack.safe", "smoking-rack")];
  state.player.vitals.health = 0;
  const beforeInventory = structuredClone(state.inventory);

  state = applyCommand(state, {
    type: "dismantle-structure",
    structureId: "rack.safe",
  });

  assert.equal(state.status, "lost");
  assert.equal(state.camp.structures?.[0]?.id, "rack.safe");
  assert.deepEqual(state.inventory, beforeInventory);
  assert.equal(
    state.eventLog.some((event) => event.type === "structure-dismantled"),
    false,
  );
});
