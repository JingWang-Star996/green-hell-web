import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTHORED_SNAKE_DEATH_PRESENTATION_TICKS,
  FIXED_DT_SECONDS,
  applyCommand,
  authoredSnakeIndividualId,
  createInitialState,
  migrateGameState,
  projectAuthoredSnakesForRender,
  stepSimulation,
} from "../../src/game/sim";
import { ITEMS } from "../../src/game/sim/content";
import type { GameState } from "../../src/game/sim";
import type { EcologyIndividualState } from "../../src/game/ecology";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

const SNAKE_ENTITY_ID = "hazard.snake.stream-ridge";

function healthyState(seed: string): GameState {
  const state = createInitialState(seed);
  state.player.vitals.health = 100;
  state.player.vitals.sanity = 100;
  state.player.conditions.wound = {
    open: false,
    treated: false,
    severity: 0,
    infection: 0,
  };
  return state;
}

test("authored ground snakes render only as stable focusable wildlife actors", () => {
  const state = healthyState("embodied-snake-projection");
  const snakeEntity = state.world.entities[SNAKE_ENTITY_ID];
  state.player.position = { ...snakeEntity.position };

  const first = projectAuthoredSnakesForRender(state).find(
    (snake) => snake.individualId.endsWith(SNAKE_ENTITY_ID),
  );
  const second = projectAuthoredSnakesForRender(state).find(
    (snake) => snake.individualId.endsWith(SNAKE_ENTITY_ID),
  );
  assert.ok(first);
  assert.deepEqual(second, first);
  assert.equal(first.speciesId, "coiled-viper");
  assert.equal(first.behavior, "coil");
  assert.equal(first.health, 44);

  const snapshot = createRenderSnapshot(state);
  assert.equal(
    snapshot.entities.some((entity) => entity.id === SNAKE_ENTITY_ID),
    false,
    "the legacy hazard mesh must not coexist with the living actor",
  );
  const livingActor = snapshot.wildlife.find(
    (snake) => snake.individualId === first.individualId,
  );
  assert.ok(livingActor);
  assert.equal(livingActor.affordance.preview.health, 44);
  assert.equal(livingActor.affordance.actionId, "avoid");
});

test("proximity and routing around a snake do not apply radius damage", () => {
  let state = healthyState("embodied-snake-avoidance");
  const snakeEntity = state.world.entities[SNAKE_ENTITY_ID];
  const snakeId = authoredSnakeIndividualId(SNAKE_ENTITY_ID);
  state.player.position = {
    x: snakeEntity.position.x + 4,
    y: snakeEntity.position.y,
    z: snakeEntity.position.z,
  };
  const healthBefore = state.player.vitals.health;

  state = stepSimulation(state, {}, 2);
  assert.equal(state.player.vitals.health, healthBefore);
  state = applyCommand(state, {
    type: "encounter-wildlife",
    individualId: snakeId,
  });
  assert.equal(state.player.vitals.health, healthBefore);
  assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
});

test("a focused spear attack has range, hit, hurt, death, loot and respawn truth", () => {
  let state = healthyState("embodied-snake-combat");
  const snakeEntity = state.world.entities[SNAKE_ENTITY_ID];
  const snakeId = authoredSnakeIndividualId(SNAKE_ENTITY_ID);
  state.player.position = { ...snakeEntity.position };
  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(state.ecology?.individuals?.[snakeId], undefined);

  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  state.player.position = {
    x: snakeEntity.position.x + 3.21,
    y: snakeEntity.position.y,
    z: snakeEntity.position.z,
  };

  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(state.ecology?.individuals?.[snakeId], undefined);

  state.player.position = { ...snakeEntity.position };
  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  assert.equal(state.ecology?.individuals?.[snakeId]?.health, 16);
  assert.equal(
    projectAuthoredSnakesForRender(state).find(
      (snake) => snake.individualId === snakeId,
    )?.behavior,
    "hurt",
  );

  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  const defeated = state.ecology?.individuals?.[snakeId];
  assert.ok(defeated);
  assert.equal(defeated.health, 0);
  assert.ok((defeated.respawnAtTick ?? 0) > state.clock.tick);
  assert.equal(state.world.entities[SNAKE_ENTITY_ID].depleted, false);
  assert.equal(state.inventory["raw-meat"], 1);
  assert.ok(
    state.eventLog.some((event) => event.type === "wildlife-defeated"),
  );
  assert.equal(
    projectAuthoredSnakesForRender(state).find(
      (snake) => snake.individualId === snakeId,
    )?.behavior,
    "dead",
  );

  state = stepSimulation(
    state,
    {},
    (AUTHORED_SNAKE_DEATH_PRESENTATION_TICKS + 1) * FIXED_DT_SECONDS,
  );
  assert.equal(
    projectAuthoredSnakesForRender(state).some(
      (snake) => snake.individualId === snakeId,
    ),
    false,
  );

  const respawnCondition = (
    state.ecology?.individuals as Record<string, EcologyIndividualState>
  )[snakeId];
  assert.ok(respawnCondition);
  respawnCondition.respawnAtTick = state.clock.tick + 1;
  state = stepSimulation(state, {}, 1);
  assert.equal(state.ecology?.individuals?.[snakeId], undefined);
  const respawned = projectAuthoredSnakesForRender(state).find(
    (snake) => snake.individualId === snakeId,
  );
  assert.ok(respawned);
  assert.equal(respawned.health, respawned.maxHealth);
});

test("a full backpack leaves one collectible snake drop and never duplicates it", () => {
  let state = healthyState("embodied-snake-full-pack");
  const snakeEntity = state.world.entities[SNAKE_ENTITY_ID];
  const snakeId = authoredSnakeIndividualId(SNAKE_ENTITY_ID);
  state.player.position = { ...snakeEntity.position };
  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  state.inventory["raw-meat"] = ITEMS["raw-meat"].stackLimit;

  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  assert.equal(state.inventory["raw-meat"], ITEMS["raw-meat"].stackLimit);
  assert.equal(state.ecology?.individuals?.[snakeId]?.pendingMeat, 1);
  assert.equal(
    state.eventLog.filter((event) => event.type === "wildlife-defeated").length,
    1,
  );
  assert.match(
    state.eventLog.find((event) => event.type === "wildlife-defeated")?.message ?? "",
    /仍留在尸体上/,
  );
  const corpse = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === snakeId,
  );
  assert.ok(corpse);
  assert.equal(corpse.affordance.actionId, "collect-wildlife-loot");
  assert.equal(corpse.affordance.state, "blocked");

  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  assert.equal(
    state.eventLog.filter((event) => event.type === "wildlife-defeated").length,
    1,
  );

  state = applyCommand(state, { type: "eat", itemId: "raw-meat" });
  state = applyCommand(state, {
    type: "collect-wildlife-loot",
    individualId: snakeId,
  });
  assert.equal(state.inventory["raw-meat"], ITEMS["raw-meat"].stackLimit);
  assert.equal(state.ecology?.individuals?.[snakeId]?.pendingMeat, 0);
  assert.equal(state.eventLog.at(-1)?.type, "wildlife-loot-collected");
});

test("snake death and its future respawn survive JSON migration", () => {
  let state = healthyState("embodied-snake-save-death");
  const snakeEntity = state.world.entities[SNAKE_ENTITY_ID];
  const snakeId = authoredSnakeIndividualId(SNAKE_ENTITY_ID);
  state.player.position = { ...snakeEntity.position };
  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  state = applyCommand(state, {
    type: "attack-wildlife",
    individualId: snakeId,
  });
  const savedRespawnTick = state.ecology?.individuals?.[snakeId]?.respawnAtTick;
  assert.ok(savedRespawnTick);

  state = migrateGameState(JSON.parse(JSON.stringify(state)) as GameState);
  assert.equal(
    state.ecology?.individuals?.[snakeId]?.respawnAtTick,
    savedRespawnTick,
  );
  state = stepSimulation(
    state,
    {},
    (AUTHORED_SNAKE_DEATH_PRESENTATION_TICKS + 1) * FIXED_DT_SECONDS,
  );
  assert.equal(
    projectAuthoredSnakesForRender(state).some(
      (snake) => snake.individualId === snakeId,
    ),
    false,
  );

  const condition = (
    state.ecology?.individuals as Record<string, EcologyIndividualState>
  )[snakeId];
  assert.ok(condition);
  condition.respawnAtTick = state.clock.tick + 1;
  state = stepSimulation(state, {}, 1);
  assert.ok(
    projectAuthoredSnakesForRender(state).some(
      (snake) => snake.individualId === snakeId && snake.health === snake.maxHealth,
    ),
  );
});

test("bite recovery and legacy one-shot depletion migrate into sparse ecology memory", () => {
  let state = healthyState("embodied-snake-bite");
  const snakeEntity = state.world.entities[SNAKE_ENTITY_ID];
  const snakeId = authoredSnakeIndividualId(SNAKE_ENTITY_ID);
  state.player.position = { ...snakeEntity.position };

  state = applyCommand(state, {
    type: "encounter-wildlife",
    individualId: snakeId,
  });
  assert.equal(state.eventLog.at(-1)?.type, "snake-bite");
  assert.equal(state.player.conditions.wound.open, true);
  assert.equal(
    projectAuthoredSnakesForRender(state).find(
      (snake) => snake.individualId === snakeId,
    )?.behavior,
    "recover",
  );

  const legacy = healthyState("legacy-snake-depletion");
  legacy.world.entities[SNAKE_ENTITY_ID].depleted = true;
  legacy.world.entities[SNAKE_ENTITY_ID].quantity = 0;
  const persisted = JSON.parse(JSON.stringify(legacy)) as GameState;
  const migrated = migrateGameState(persisted);
  assert.equal(migrated.world.entities[SNAKE_ENTITY_ID].depleted, false);
  const migratedCondition = migrated.ecology?.individuals?.[snakeId];
  assert.ok(migratedCondition);
  assert.equal(migratedCondition.health, 0);
  assert.ok((migratedCondition.respawnAtTick ?? 0) > migrated.clock.tick);
  const afterDeathPresentation = stepSimulation(migrated, {}, 2);
  assert.equal(
    projectAuthoredSnakesForRender(afterDeathPresentation).some(
      (snake) => snake.individualId === snakeId,
    ),
    false,
    "legacy depletion stays dead instead of becoming an immediately live snake",
  );
  assert.equal(
    afterDeathPresentation.ecology?.individuals?.[snakeId]?.health,
    0,
  );
});
