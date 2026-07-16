import assert from "node:assert/strict";
import test from "node:test";

import {
  RECIPES,
  TORCH_MAX_BURN_SECONDS,
  createInitialState,
  getDiscoveredRecipeIds,
  migrateGameState,
  type PlacedStructureState,
} from "../../src/game/sim";
import {
  STRUCTURE_USE_RADII,
  TORCH_WAYMARK_LAYOUT,
  structurePlacementRadius,
  structureWorldColliders,
  torchWaymarkInteractionAnchor,
} from "../../src/game/sim/structureGeometry";
import {
  advanceTorchWaymarkFuel,
  classifyTorchWaymarkUseOperation,
  normalizeTorchWaymarkState,
  torchWaymarkTotalFuelSeconds,
} from "../../src/game/sim/torchWaymarkRules";

function waymark(
  overrides: Partial<PlacedStructureState> = {},
): PlacedStructureState {
  return {
    id: "structure.torch-waymark.test",
    kind: "torch-waymark",
    position: { x: 4, y: 0, z: -3 },
    yaw: 0,
    builtAtTick: 12,
    torchFuelQueueSeconds: [120],
    lit: true,
    everLit: true,
    lastAdvancedTick: 12,
    ...overrides,
  };
}

test("torch-waymark recipe and discovery require a crafted torch plus observed stone and vine", () => {
  assert.deepEqual(RECIPES["torch-waymark"], {
    id: "torch-waymark",
    label: "搭建火把路标",
    ingredients: { stick: 4, stone: 3, vine: 1, torch: 1 },
    effect: "build-torch-waymark",
    workSeconds: 40,
  });

  const state = createInitialState("waymark-discovery");
  state.knowledge!.observedItemIds = ["stone", "vine"];
  assert.equal(getDiscoveredRecipeIds(state).includes("torch-waymark"), false);
  state.knowledge!.craftedRecipeIds.push("torch");
  assert.equal(getDiscoveredRecipeIds(state).includes("torch-waymark"), true);

  state.knowledge!.observedItemIds = ["stone"];
  assert.equal(getDiscoveredRecipeIds(state).includes("torch-waymark"), false);
});

test("torch-waymark layout owns one readable base, collider, range and front anchor", () => {
  assert.equal(TORCH_WAYMARK_LAYOUT.stoneBaseRadius, 0.46);
  assert.equal(TORCH_WAYMARK_LAYOUT.poleHeight, 2.15);
  assert.equal(structurePlacementRadius("torch-waymark"), 0.65);
  assert.equal(STRUCTURE_USE_RADII["torch-waymark"], 3.2);
  assert.deepEqual(
    structureWorldColliders({
      id: "waymark",
      kind: "torch-waymark",
      x: 4,
      z: -3,
      yaw: 0,
    }),
    [{ kind: "circle", x: 4, z: -3, radius: 0.38 }],
  );
  assert.deepEqual(
    torchWaymarkInteractionAnchor({
      position: { x: 4, z: -3 },
      yaw: 0,
    }),
    { x: 4, z: -2.3, height: 1 },
  );
});

test("waymark migration deep-clones exact fuel and fails closed on malformed queues", () => {
  const state = createInitialState("waymark-migration");
  state.clock.tick = 90;
  const original = waymark({
    torchFuelQueueSeconds: [75.25, TORCH_MAX_BURN_SECONDS],
    lastAdvancedTick: 75,
  });
  state.camp.structures!.push(original);

  const migrated = migrateGameState(state);
  const restored = migrated.camp.structures!.find(
    (structure) => structure.id === original.id,
  )!;
  assert.deepEqual(restored.torchFuelQueueSeconds, [
    75.25,
    TORCH_MAX_BURN_SECONDS,
  ]);
  assert.notEqual(restored.torchFuelQueueSeconds, original.torchFuelQueueSeconds);
  original.torchFuelQueueSeconds![0] = 1;
  assert.equal(restored.torchFuelQueueSeconds![0], 75.25);

  const malformed = normalizeTorchWaymarkState(
    {
      torchFuelQueueSeconds: [10, Number.NaN],
      lit: true,
      everLit: false,
      lastAdvancedTick: Number.POSITIVE_INFINITY,
    },
    90,
  );
  assert.deepEqual(malformed, {
    torchFuelQueueSeconds: [],
    lit: false,
    everLit: false,
    lastAdvancedTick: 90,
  });
  const remembered = normalizeTorchWaymarkState(
    {
      torchFuelQueueSeconds: [],
      lit: true,
      everLit: true,
      lastAdvancedTick: -1,
    },
    90,
  );
  assert.equal(remembered.everLit, true);
  assert.equal(remembered.lit, false);
});

test("waymark fuel advances exact FIFO, crosses slots and heavy rain preserves fuel", () => {
  const crossed = advanceTorchWaymarkFuel({
    torchFuelQueueSeconds: [1, 2],
    lit: true,
    elapsedSeconds: 2,
    rainIntensity: 0,
    sheltered: false,
    ignitionAllowed: true,
  });
  assert.deepEqual(crossed.torchFuelQueueSeconds, [1]);
  assert.equal(crossed.consumedSeconds, 2);
  assert.equal(crossed.lit, true);
  assert.equal(
    classifyTorchWaymarkUseOperation({
      torchFuelQueueSeconds: crossed.torchFuelQueueSeconds,
      lit: crossed.lit,
    }),
    "top-up-torch-waymark",
  );

  const storm = advanceTorchWaymarkFuel({
    torchFuelQueueSeconds: [10, 20],
    lit: true,
    elapsedSeconds: 30,
    rainIntensity: 0.8,
    sheltered: false,
    ignitionAllowed: false,
  });
  assert.deepEqual(storm.torchFuelQueueSeconds, [10, 20]);
  assert.equal(storm.consumedSeconds, 0);
  assert.equal(storm.lit, false);
  assert.equal(storm.extinguishReason, "rain-exposed");
  assert.equal(
    torchWaymarkTotalFuelSeconds({
      torchFuelQueueSeconds: storm.torchFuelQueueSeconds,
    }),
    30,
  );
});
