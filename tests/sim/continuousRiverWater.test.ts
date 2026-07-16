import assert from "node:assert/strict";
import test from "node:test";

import { applyCommand, createInitialState } from "../../src/game/sim";
import { structurePlacementRadius } from "../../src/game/sim/structureGeometry";
import type { GameState, WorldEntity } from "../../src/game/sim/types";
import { MAX_HIT_BLOCKER_SHAPES } from "../../src/game/world/hitGeometry";
import { isWorldLineOfSightBlocked } from "../../src/game/world/interactionGeometry";
import {
  RIVER_WATER_CONTAMINATION,
  createRiverWaterTarget,
} from "../../src/game/world/riverWater";
import { riverCenter } from "../../src/game/world/terrain";

function stableWaterState(seed: string): GameState {
  const state = createInitialState(seed);
  state.inventory["coconut-shell"] = 2;
  state.inventory["dirty-water"] = 0;
  state.inventory["clean-water"] = 0;
  state.player.vitals.health = 100;
  state.player.vitals.energy = 100;
  state.player.nutrition.hydration = 100;
  state.player.nutrition.carbohydrates = 100;
  state.player.nutrition.protein = 100;
  state.player.nutrition.fat = 100;
  return state;
}

function targetAt(x: number, laneOffset = 0) {
  const target = createRiverWaterTarget({
    x,
    z: riverCenter(x) + laneOffset,
  });
  assert.ok(target);
  return target;
}

function moveToBank(
  state: GameState,
  target: ReturnType<typeof targetAt>,
  side: -1 | 1,
): void {
  state.player.position = {
    x: target.anchor.x,
    y: 0,
    z: target.anchor.z + side * 0.5,
  };
}

function primeBankState(
  state: GameState,
  target: ReturnType<typeof targetAt>,
  distance = 2.4,
): GameState {
  return applyCommand(state, {
    type: "move-player",
    position: {
      x: target.anchor.x,
      y: 0,
      z: target.anchor.z + distance,
    },
  });
}

function standingTree(id: string, x: number, z: number): WorldEntity {
  return {
    id,
    kind: "resource",
    label: "water reach test tree",
    position: { x, y: 0, z },
    interactRadius: 3,
    itemId: "log",
    quantity: 1,
    depleted: false,
    tags: ["standing-tree"],
  };
}

function mineableRock(id: string, x: number, z: number): WorldEntity {
  return {
    id,
    kind: "resource",
    label: "water reach test rock",
    position: { x, y: 0, z },
    interactRadius: 3,
    itemId: "stone",
    quantity: 3,
    depleted: false,
    regeneration: {
      capacity: 3,
      nextTick: null,
      cycle: 0,
      nextAmount: null,
    },
    tags: ["semantic", "mineable-rock"],
    semantic: {
      generatorVersion: 1,
      category: "mineable-rock",
      material: "granite",
      size: "medium",
      visualVariant: "water-reach-test",
      yaw: 0,
      scale: 1,
      action: "mine",
      toolClass: "pick",
      toolTier: 1,
      yieldTableId: "water-reach-test/rock",
      primaryMaterial: "stone",
      yieldMinimum: 3,
      yieldMaximum: 3,
      baselineQuantity: 3,
    },
  };
}

function stateWithoutEvents(state: GameState): GameState {
  const copy = structuredClone(state);
  copy.eventLog = [];
  copy.nextEventId = 0;
  return copy;
}

test("ephemeral river targets collect from distant segments and both banks", () => {
  const samples = [
    { x: -720.25, lane: -2, side: -1 as const },
    { x: 61.2, lane: 0, side: 1 as const },
    { x: 2048.4, lane: 2, side: 1 as const },
  ];
  for (const sample of samples) {
    let state = stableWaterState(`continuous-water-${sample.x}`);
    const target = targetAt(sample.x, sample.lane);
    moveToBank(state, target, sample.side);
    state = applyCommand(state, {
      type: "collect-water",
      sourceEntityId: target.id,
    });
    assert.equal(state.inventory["dirty-water"], 1);
    const collected = state.eventLog.filter(
      (event) => event.type === "water-collected",
    );
    assert.equal(collected.length, 1);
    assert.deepEqual(collected[0]?.details, {
      sourceEntityId: target.id,
      sourceKind: "river",
      itemId: "dirty-water",
      contamination: RIVER_WATER_CONTAMINATION,
    });
    assert.equal(state.progress?.waterEverCollected, true);
    assert.ok(state.knowledge?.observedItemIds.includes("dirty-water"));
  }
});

test("invalid, distant, non-water and containerless river commands are atomic", () => {
  const target = targetAt(80);
  const cases: Array<{
    name: string;
    id: string;
    prepare?: (state: GameState) => void;
  }> = [
    { name: "non-canonical", id: "water:river:v1:0160:0" },
    { name: "lane outside water", id: "water:river:v1:160:5" },
    { name: "non-water entity", id: "landmark.weather-station" },
    {
      name: "distant segment",
      id: target.id,
      prepare: (state) => {
        state.player.position = { x: -80, y: 0, z: riverCenter(-80) };
      },
    },
    {
      name: "occupied shell",
      id: target.id,
      prepare: (state) => {
        moveToBank(state, target, 1);
        state.inventory["coconut-shell"] = 1;
        state.inventory["dirty-water"] = 1;
      },
    },
  ];

  for (const entry of cases) {
    const state = stableWaterState(`river-reject-${entry.name}`);
    entry.prepare?.(state);
    const beforeTick = state.clock.tick;
    const beforeInventory = { ...state.inventory };
    const next = applyCommand(state, {
      type: "collect-water",
      sourceEntityId: entry.id,
    });
    assert.deepEqual(next.inventory, beforeInventory, entry.name);
    assert.equal(next.clock.tick, beforeTick, entry.name);
    assert.equal(next.eventLog.at(-1)?.type, "command-rejected", entry.name);
  }
});

test("authored landmark.stream remains a compatible water command", () => {
  let state = stableWaterState("legacy-stream-compatible");
  const stream = state.world.entities["landmark.stream"];
  assert.ok(stream);
  state.player.position = { ...stream.position };
  state = applyCommand(state, {
    type: "collect-water",
    sourceEntityId: "landmark.stream",
  });
  assert.equal(state.inventory["dirty-water"], 1);
  assert.equal(state.eventLog.at(-1)?.type, "water-collected");
  assert.equal(state.eventLog.at(-1)?.details?.sourceKind, "authored");
  assert.equal(
    state.eventLog.at(-1)?.details?.contamination,
    RIVER_WATER_CONTAMINATION,
  );
  assert.ok(state.knowledge?.observedItemIds.includes("dirty-water"));
});

test("manual rain collection records the actually occupied clean-water shell", () => {
  let state = stableWaterState("manual-rain-water-memory");
  state.weather.rainIntensity = 1;
  state = applyCommand(state, { type: "collect-rainwater" });
  assert.equal(state.inventory["clean-water"], 1);
  assert.equal(state.eventLog.at(-1)?.details?.itemId, "clean-water");
  assert.ok(state.knowledge?.observedItemIds.includes("clean-water"));
});

test("authored and placed building collision blocks taking water through geometry", () => {
  const target = targetAt(60);
  const state = stableWaterState("river-structure-los");
  state.player.position = {
    x: target.anchor.x,
    y: 0,
    z: target.anchor.z + 2.4,
  };
  state.camp.structures = [
    {
      id: "structure.smoking-rack.river-wall",
      kind: "smoking-rack",
      position: {
        x: target.anchor.x,
        y: 0,
        z: target.anchor.z + 1.2,
      },
      yaw: 0,
      builtAtTick: 0,
    },
  ];
  const next = applyCommand(state, {
    type: "collect-water",
    sourceEntityId: target.id,
  });
  assert.equal(next.inventory["dirty-water"], 0);
  assert.equal(next.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(
    next.eventLog.at(-1)?.details?.blockedByWorldGeometry,
    true,
  );
});

test("a shelter placement circle would false-block, but its real opening permits reach", () => {
  const target = targetAt(60);
  let state = primeBankState(
    stableWaterState("river-exact-shelter-opening"),
    target,
    2.5,
  );
  const shelter = {
    id: "structure.shelter.river-opening",
    kind: "shelter" as const,
    position: {
      x: target.anchor.x,
      y: 0,
      z: target.anchor.z + 2,
    },
    yaw: 0,
    builtAtTick: 0,
  };
  state.camp.structures = [shelter];
  assert.equal(
    isWorldLineOfSightBlocked(state.player.position, target.anchor, [
      {
        kind: "circle",
        x: shelter.position.x,
        z: shelter.position.z,
        radius: structurePlacementRadius("shelter"),
      },
    ]),
    true,
    "the removed placement-radius shortcut would reject this open centre path",
  );

  state = applyCommand(state, {
    type: "collect-water",
    sourceEntityId: target.id,
  });
  assert.equal(state.inventory["dirty-water"], 1);
  assert.equal(state.eventLog.at(-1)?.type, "water-collected");
});

test("strict water focus does not excuse an unrelated blocker containing the endpoint", () => {
  const from = { x: -12.25, z: -21.3946508886 };
  const to = { x: -14.5, z: -21.3946508886 };
  const containingTree = {
    kind: "circle" as const,
    x: to.x,
    z: to.z,
    radius: 0.72,
  };

  assert.equal(
    isWorldLineOfSightBlocked(from, to, [containingTree]),
    false,
    "embedded authored controls retain the legacy target-contained exception",
  );
  assert.equal(
    isWorldLineOfSightBlocked(from, to, [containingTree], {
      ignoreBlockersContainingTarget: false,
    }),
    true,
    "river focus must match authoritative first-entry occlusion",
  );
});

test("a shelter support blocks reach with zero side effects beyond rejection", () => {
  const target = targetAt(60);
  let state = primeBankState(
    stableWaterState("river-exact-shelter-support"),
    target,
  );
  state.camp.structures = [
    {
      id: "structure.shelter.river-support",
      kind: "shelter",
      position: {
        // The +1.3 local support is exactly on the hand-to-water path.
        x: target.anchor.x - 1.3,
        y: 0,
        z: target.anchor.z + 1.2,
      },
      yaw: 0,
      builtAtTick: 0,
    },
  ];
  state.camp.shelterBuilt = true;
  const before = structuredClone(state);
  state = applyCommand(state, {
    type: "collect-water",
    sourceEntityId: target.id,
  });
  assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(state.eventLog.at(-1)?.details?.blockedByWorldGeometry, true);
  assert.match(
    String(state.eventLog.at(-1)?.details?.blockerId),
    /^structure\.shelter\.river-support:part:/,
  );
  assert.deepEqual(stateWithoutEvents(state), stateWithoutEvents(before));
});

test("standing tree, fallen trunk and mineable rock all block water reach", () => {
  const target = targetAt(140);
  const cases: Array<{
    label: string;
    blocker: WorldEntity;
  }> = [
    {
      label: "standing tree",
      blocker: standingTree(
        "water.blocker.tree",
        target.anchor.x,
        target.anchor.z + 1.2,
      ),
    },
    {
      label: "fallen trunk",
      blocker: {
        ...standingTree(
          "water.blocker.fallen-tree",
          target.anchor.x,
          target.anchor.z + 0.2,
        ),
        quantity: 0,
        treeHarvest: {
          fallDirection: 256,
          branches: 2,
          trunkSegments: 2,
          looseLog: false,
        },
      },
    },
    {
      label: "mineable rock",
      blocker: mineableRock(
        "water.blocker.rock",
        target.anchor.x,
        target.anchor.z + 1.2,
      ),
    },
  ];

  for (const entry of cases) {
    let state = primeBankState(
      stableWaterState(`river-${entry.label}`),
      target,
    );
    state.world.entities[entry.blocker.id] = entry.blocker;
    const before = structuredClone(state);
    state = applyCommand(state, {
      type: "collect-water",
      sourceEntityId: target.id,
    });
    assert.equal(state.eventLog.at(-1)?.type, "command-rejected", entry.label);
    assert.equal(
      state.eventLog.at(-1)?.details?.blockerId,
      entry.blocker.id,
      entry.label,
    );
    assert.deepEqual(
      stateWithoutEvents(state),
      stateWithoutEvents(before),
      entry.label,
    );
  }
});

test("water reach fails closed at the 512-shape geometry budget", () => {
  const target = targetAt(300);
  let state = primeBankState(
    stableWaterState("river-water-geometry-budget"),
    target,
  );
  for (let index = 0; index <= MAX_HIT_BLOCKER_SHAPES; index += 1) {
    const tree = standingTree(
      `water.geometry-budget.${index}`,
      target.anchor.x,
      target.anchor.z + 1.2,
    );
    state.world.entities[tree.id] = tree;
  }
  const before = structuredClone(state);
  state = applyCommand(state, {
    type: "collect-water",
    sourceEntityId: target.id,
  });
  assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(state.eventLog.at(-1)?.details?.hitReason, "geometry-budget");
  assert.deepEqual(stateWithoutEvents(state), stateWithoutEvents(before));
});

test("fatal work revalidation never grants water after the action is interrupted", () => {
  const target = targetAt(110);
  let state = stableWaterState("river-fatal-work");
  moveToBank(state, target, 1);
  state.player.vitals.health = 0.001;
  state.player.conditions.wound.open = true;
  state.player.conditions.wound.severity = 100;
  state.player.conditions.wound.infection = 100;
  state = applyCommand(state, {
    type: "collect-water",
    sourceEntityId: target.id,
  });
  assert.equal(state.status, "lost");
  assert.equal(state.inventory["dirty-water"], 0);
  assert.equal(
    state.eventLog.filter((event) => event.type === "water-collected").length,
    0,
  );
});

test("creating one thousand ephemeral river targets cannot grow state or save deltas", () => {
  const state = stableWaterState("river-ephemeral-budget");
  const before = JSON.stringify(state);
  for (let index = -500; index < 500; index += 1) {
    const x = index * 17.25;
    assert.ok(createRiverWaterTarget({ x, z: riverCenter(x) }));
  }
  assert.equal(JSON.stringify(state), before);
  assert.equal(Object.keys(state.world.entityDeltas ?? {}).length, 0);
});
