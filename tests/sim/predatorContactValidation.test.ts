import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  authoredSnakeIndividualId,
  createInitialState,
} from "../../src/game/sim";
import { gameHoursToTicks } from "../../src/game/sim/time";
import type {
  GameState,
  PlacedStructureState,
  WorldEntity,
} from "../../src/game/sim/types";

const SNAKE_ENTITY_ID = "hazard.snake.stream-ridge";
const SNAKE_POSITION = { x: 80, y: 0, z: 80 } as const;

function contactState(): GameState {
  const state = createInitialState("predator-contact-validation");
  state.player.vitals.health = 100;
  state.player.vitals.sanity = 100;
  state.player.conditions.wound = {
    open: false,
    treated: false,
    severity: 0,
    infection: 0,
  };
  state.world.entities[SNAKE_ENTITY_ID].position = { ...SNAKE_POSITION };
  state.player.position = { x: 81.4, y: 0, z: 80 };
  return state;
}

function structure(
  kind: PlacedStructureState["kind"],
  x: number,
  z: number,
): PlacedStructureState {
  return {
    id: `structure.${kind}.predator-contact`,
    kind,
    position: { x, y: 0, z },
    yaw: 0,
    builtAtTick: 0,
  };
}

function encounter(state: GameState): GameState {
  return applyCommand(state, {
    type: "encounter-wildlife",
    individualId: authoredSnakeIndividualId(SNAKE_ENTITY_ID),
  });
}

function standingTree(id: string, x: number, z: number): WorldEntity {
  return {
    id,
    kind: "resource",
    label: "contact test tree",
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
    label: "contact test rock",
    position: { x, y: 0, z },
    interactRadius: 3,
    itemId: "stone",
    quantity: 3,
    depleted: false,
    tags: ["semantic", "mineable-rock"],
    semantic: {
      generatorVersion: 1,
      category: "mineable-rock",
      material: "granite",
      size: "medium",
      visualVariant: "contact-test",
      yaw: 0,
      scale: 1,
      action: "mine",
      toolClass: "pick",
      toolTier: 1,
      yieldTableId: "contact-test/rock",
      primaryMaterial: "stone",
      yieldMinimum: 3,
      yieldMaximum: 3,
      baselineQuantity: 3,
    },
  };
}

test("blocked encounter is atomic and does not consume contact cooldown", () => {
  let state = contactState();
  const snakeId = authoredSnakeIndividualId(SNAKE_ENTITY_ID);
  state.camp.structures = [structure("radio-beacon", 80.7, 80)];
  const before = structuredClone(state);

  state = encounter(state);
  assert.equal(state.player.vitals.health, before.player.vitals.health);
  assert.equal(state.player.vitals.sanity, before.player.vitals.sanity);
  assert.equal(state.eventLog.length, before.eventLog.length);
  assert.deepEqual(state.player.conditions.wound, before.player.conditions.wound);
  assert.equal(state.ecology?.individuals?.[snakeId]?.lastContactTick, undefined);

  state.camp.structures = [];
  state = encounter(state);
  const firstContactTick = state.ecology?.individuals?.[snakeId]?.lastContactTick;
  assert.equal(firstContactTick, state.clock.tick);
  assert.equal(state.eventLog.at(-1)?.type, "snake-bite");
  const healthAfterFirstHit = state.player.vitals.health;
  const eventsAfterFirstHit = state.eventLog.length;

  state = encounter(state);
  assert.equal(state.player.vitals.health, healthAfterFirstHit);
  assert.equal(state.eventLog.length, eventsAfterFirstHit);
  assert.equal(
    state.ecology?.individuals?.[snakeId]?.lastContactTick,
    firstContactTick,
  );

  state.clock.tick += gameHoursToTicks(0.2);
  state.camp.structures = [structure("radio-beacon", 80.7, 80)];
  state = encounter(state);
  assert.equal(state.player.vitals.health, healthAfterFirstHit);
  assert.equal(state.eventLog.length, eventsAfterFirstHit);
  assert.equal(
    state.ecology?.individuals?.[snakeId]?.lastContactTick,
    firstContactTick,
  );

  state.camp.structures = [];
  state = encounter(state);
  assert.ok(state.player.vitals.health < healthAfterFirstHit);
  assert.equal(
    state.ecology?.individuals?.[snakeId]?.lastContactTick,
    state.clock.tick,
  );
  assert.equal(state.eventLog.at(-1)?.type, "snake-bite");
});

test("exact shelter opening permits contact while its support remains solid", () => {
  let openState = contactState();
  openState.world.entities[SNAKE_ENTITY_ID].position = { x: 80, y: 0, z: 79.3 };
  openState.player.position = { x: 80, y: 0, z: 80.7 };
  openState.camp.structures = [structure("shelter", 80, 80)];
  openState = encounter(openState);
  assert.equal(openState.eventLog.at(-1)?.type, "snake-bite");

  let supportState = contactState();
  supportState.world.entities[SNAKE_ENTITY_ID].position = {
    x: 81.3,
    y: 0,
    z: 79.3,
  };
  supportState.player.position = { x: 81.3, y: 0, z: 80.7 };
  supportState.camp.structures = [structure("shelter", 80, 80)];
  const healthBefore = supportState.player.vitals.health;
  const eventsBefore = supportState.eventLog.length;
  supportState = encounter(supportState);
  assert.equal(supportState.player.vitals.health, healthBefore);
  assert.equal(supportState.eventLog.length, eventsBefore);
});

test("standing tree, fallen trunk, rock and weather station share contact blockers", () => {
  const cases: Array<{ label: string; state: GameState }> = [];

  const treeState = contactState();
  treeState.world.entities["contact.tree"] = standingTree(
    "contact.tree",
    80.7,
    80,
  );
  cases.push({ label: "standing tree", state: treeState });

  const fallenState = contactState();
  const fallen = standingTree("contact.fallen-tree", 79.7, 80);
  fallen.quantity = 0;
  fallen.treeHarvest = {
    fallDirection: 0,
    branches: 2,
    trunkSegments: 2,
    looseLog: false,
  };
  fallenState.world.entities[fallen.id] = fallen;
  cases.push({ label: "fallen trunk", state: fallenState });

  const rockState = contactState();
  rockState.world.entities["contact.rock"] = mineableRock(
    "contact.rock",
    80.7,
    80,
  );
  cases.push({ label: "mineable rock", state: rockState });

  const weatherState = contactState();
  weatherState.world.entities[SNAKE_ENTITY_ID].position = {
    x: 30.3,
    y: 0,
    z: 27,
  };
  weatherState.player.position = { x: 31.7, y: 0, z: 27 };
  cases.push({ label: "weather station", state: weatherState });

  for (const entry of cases) {
    const healthBefore = entry.state.player.vitals.health;
    const woundBefore = structuredClone(entry.state.player.conditions.wound);
    const eventsBefore = entry.state.eventLog.length;
    const next = encounter(entry.state);
    assert.equal(next.player.vitals.health, healthBefore, entry.label);
    assert.deepEqual(next.player.conditions.wound, woundBefore, entry.label);
    assert.equal(next.eventLog.length, eventsBefore, entry.label);
  }
});
