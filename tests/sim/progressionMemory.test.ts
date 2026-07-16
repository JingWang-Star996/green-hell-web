import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STRUCTURE_PLACEMENTS,
  MAX_EVENT_LOG,
  applyCommand,
  cloneGameState,
  createInitialState,
  getDiscoveredRecipeIds,
  hasCollectedWater,
  hasCompletedRest,
  hasInspectedLandmark,
  migrateGameState,
} from "../../src/game/sim/index";
import type {
  GameEvent,
  GameState,
} from "../../src/game/sim/index";

const LANDMARK_IDS = [
  "landmark.camp-radio",
  "landmark.survey-cache",
  "landmark.weather-station",
] as const;

function moveToEntity(state: GameState, entityId: string): void {
  state.player.position = { ...state.world.entities[entityId].position };
}

function makeSurvivalSafe(state: GameState): void {
  state.player.conditions.wound = {
    open: false,
    treated: true,
    severity: 0,
    infection: 0,
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
}

test("bounded events cannot erase landmark, recipe, water, or rest progression", () => {
  let state = createInitialState("durable-progression");
  makeSurvivalSafe(state);
  state.inventory.axe = 1;
  state.inventory.stone = 2;
  state.inventory["coconut-shell"] = 1;

  state = applyCommand(state, { type: "craft", recipeId: "stone-blade" });
  for (const entityId of ["resource.stick.camp-01", "resource.vine.camp-01"]) {
    moveToEntity(state, entityId);
    state = applyCommand(state, { type: "pick-up", entityId });
  }
  moveToEntity(state, "landmark.stream");
  state = applyCommand(state, {
    type: "collect-water",
    sourceEntityId: "landmark.stream",
  });
  for (const entityId of LANDMARK_IDS) {
    moveToEntity(state, entityId);
    state = applyCommand(state, { type: "inspect-landmark", entityId });
  }

  state.camp.bedBuilt = true;
  state.camp.shelterBuilt = true;
  state.player.position = {
    ...DEFAULT_STRUCTURE_PLACEMENTS.bed.position,
  };
  state = applyCommand(state, { type: "rest" });
  assert.equal(state.eventLog.at(-1)?.type, "rest-completed");

  // Empty consumed material/tool slots so discovery must come from durable
  // memory, not the current inventory.
  state.inventory.stick = 0;
  state.inventory.vine = 0;
  state.inventory["stone-blade"] = 0;
  for (let index = 0; index < MAX_EVENT_LOG + 32; index += 1) {
    state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  }

  assert.equal(state.eventLog.length, MAX_EVENT_LOG);
  assert.equal(
    state.eventLog.some((event) => event.type === "landmark-inspected"),
    false,
  );
  assert.equal(state.eventLog.some((event) => event.type === "water-collected"), false);
  assert.equal(state.eventLog.some((event) => event.type === "rest-completed"), false);
  for (const entityId of LANDMARK_IDS) {
    assert.equal(hasInspectedLandmark(state, entityId), true);
  }
  assert.equal(hasCollectedWater(state), true);
  assert.equal(hasCompletedRest(state), true);
  assert.ok(getDiscoveredRecipeIds(state).includes("axe"));
  assert.deepEqual(state.knowledge?.craftedRecipeIds, ["stone-blade"]);
  state.camp.fire.built = true;
  state.camp.fire.lit = true;
  state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  assert.equal(
    state.objectives.flags.campEstablished,
    true,
    "the camp milestone must continue to recognize the old rest",
  );

  // The battery gate consults the same persistent landmark memory after its
  // source events have long since rolled out of the log.
  moveToEntity(state, "resource.battery.weather-station");
  state = applyCommand(state, {
    type: "pick-up",
    entityId: "resource.battery.weather-station",
  });
  assert.equal(state.inventory.battery, 1);
  assert.equal(state.objectives.flags.batteryRecovered, true);

  for (let index = 0; index < MAX_EVENT_LOG + 1; index += 1) {
    state = applyCommand(state, { type: "equip-item", itemId: "axe" });
  }
  state.inventory.battery = 0;
  assert.ok(
    getDiscoveredRecipeIds(state).includes("radio-beacon"),
    "observing the battery remains known after both event and item are gone",
  );
});

test("migration backfills durable memory from event-log-era saves", () => {
  const legacy = createInitialState("legacy-progress-memory");
  delete legacy.knowledge;
  delete legacy.progress;
  const events: GameEvent[] = [
    {
      id: 2,
      tick: 1,
      elapsedSeconds: 1,
      type: "landmark-inspected",
      message: "legacy landmark",
      cause: { source: "command", code: "legacy" },
      details: { entityId: "landmark.camp-radio" },
    },
    {
      id: 3,
      tick: 2,
      elapsedSeconds: 2,
      type: "resource-picked",
      message: "legacy item",
      cause: { source: "command", code: "legacy" },
      details: { itemId: "vine" },
    },
    {
      id: 4,
      tick: 3,
      elapsedSeconds: 3,
      type: "craft-succeeded",
      message: "legacy craft",
      cause: { source: "command", code: "legacy" },
      details: { recipeId: "stone-blade" },
    },
    {
      id: 5,
      tick: 4,
      elapsedSeconds: 4,
      type: "recipe-discovered",
      message: "legacy announcement",
      cause: { source: "system", code: "legacy" },
      details: { recipeId: "bandage" },
    },
    {
      id: 6,
      tick: 5,
      elapsedSeconds: 5,
      type: "water-collected",
      message: "legacy water",
      cause: { source: "command", code: "legacy" },
    },
    {
      id: 7,
      tick: 6,
      elapsedSeconds: 6,
      type: "rest-completed",
      message: "legacy rest",
      cause: { source: "command", code: "legacy" },
    },
  ];
  legacy.eventLog.push(...events);
  legacy.nextEventId = 8;

  const migrated = migrateGameState(legacy);
  assert.deepEqual(migrated.knowledge, {
    inspectedLandmarkIds: ["landmark.camp-radio"],
    observedItemIds: ["vine"],
    craftedRecipeIds: ["stone-blade"],
    announcedRecipeIds: ["bandage"],
    objectiveFacts: [],
  });
  assert.deepEqual(migrated.progress, {
    restEverCompleted: true,
    waterEverCollected: true,
  });

  const cloned = cloneGameState(migrated);
  cloned.knowledge?.inspectedLandmarkIds.push("landmark.survey-cache");
  if (cloned.progress) cloned.progress.restEverCompleted = false;
  assert.deepEqual(migrated.knowledge?.inspectedLandmarkIds, [
    "landmark.camp-radio",
  ]);
  assert.equal(migrated.progress?.restEverCompleted, true);
  assert.equal(legacy.knowledge, undefined, "migration must not mutate the save payload");
});
