import assert from "node:assert/strict";
import test from "node:test";

import { commandForInteraction } from "../../src/game/GameClient";
import { ITEMS } from "../../src/game/sim/content";
import type { InteractionTarget } from "../../src/game/render/types";
import { resolveWildlifeAffordance } from "../../src/game/sim/affordances";
import { canCraft } from "../../src/game/sim/selectors";
import { applyCommand, stepSimulation } from "../../src/game/sim/simulation";
import { createInitialState } from "../../src/game/sim/state";
import type { GameState } from "../../src/game/sim/types";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

function visibleWildlife(
  state: GameState,
  predicate: (wildlife: ReturnType<typeof createRenderSnapshot>["wildlife"][number]) => boolean,
) {
  const wildlife = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.visible && predicate(candidate),
  );
  assert.ok(wildlife, "expected a deterministic visible wildlife candidate");
  return wildlife;
}

function aimAtWildlife(
  state: GameState,
  individualId: string,
): void {
  const current = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === individualId,
  );
  assert.ok(current);
  const dx = current.position.x - state.player.position.x;
  const dz = current.position.z - state.player.position.z;
  state.player.lookYaw = Math.atan2(-dx, -dz);
  state.player.lookPitch = -0.25;
}

test("wildlife requires an equipped spear and routes through an explicit attack command", () => {
  const state = createInitialState("wildlife-check");
  const prey = visibleWildlife(
    state,
    (candidate) => candidate.speciesId === "reedtail-scuttler",
  );
  state.player.position = { x: prey.position.x, y: 0, z: prey.position.z };

  const blocked = resolveWildlifeAffordance(state, prey);
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.requiredItem, "spear");

  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  const ready = resolveWildlifeAffordance(state, prey);
  const target: InteractionTarget = {
    id: `wildlife:${prey.individualId}`,
    kind: "animal",
    label: prey.label,
    distance: 1,
    affordance: ready,
  };
  assert.deepEqual(commandForInteraction(state, target), {
    type: "physical-action",
    targetId: `wildlife:${prey.individualId}`,
    actionId: "attack",
    poseRevision: 0,
  });
});

test("a successful procedural hunt freezes a recoverable corpse before rewarding inventory", () => {
  let state = createInitialState("wildlife-check");
  const prey = visibleWildlife(
    state,
    (candidate) => candidate.speciesId === "reedtail-scuttler",
  );
  state.player.position = { x: prey.position.x, y: 0, z: prey.position.z };
  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  const attackedProjection = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.ok(attackedProjection);
  aimAtWildlife(state, prey.individualId);

  state = applyCommand(state, {
    type: "physical-action",
    targetId: `wildlife:${prey.individualId}`,
    actionId: "attack",
    poseRevision: state.player.poseRevision ?? 0,
  });

  const condition = state.ecology?.individuals?.[prey.individualId];
  assert.ok(condition);
  assert.equal(condition.health, 0);
  assert.ok((condition.respawnAtTick ?? 0) > state.clock.tick);
  assert.equal(state.inventory["raw-meat"], 0);
  assert.equal(condition.pendingMeat, 1);
  assert.equal(condition.pendingHide, 0);
  assert.deepEqual(condition.corpse?.position, attackedProjection.position);
  assert.equal(condition.corpse?.headingRadians, attackedProjection.headingRadians);
  const defeatedEvent = state.eventLog.find(
    (event) => event.type === "wildlife-defeated",
  );
  assert.ok(defeatedEvent);
  assert.equal(defeatedEvent.details?.amount, 0);
  assert.equal(defeatedEvent.details?.pendingMeat, 1);
  assert.match(defeatedEvent.message, /留在尸体上/);
  assert.equal(
    state.eventLog.some(
      (event) =>
        event.type === "recipe-discovered" &&
        event.details?.recipeId === "cooked-meat",
    ),
    false,
  );
  const corpse = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.ok(corpse);
  assert.equal(corpse.behavior, "dead");
  assert.deepEqual(corpse.position, attackedProjection.position);
  assert.equal(corpse.affordance.actionId, "collect-wildlife-loot");
  assert.equal(corpse.affordance.state, "ready");

  state = applyCommand(state, {
    type: "collect-wildlife-loot",
    individualId: prey.individualId,
  });
  assert.equal(state.inventory["raw-meat"], 1);
  assert.equal(state.eventLog.at(-2)?.type, "wildlife-loot-collected");
  assert.equal(state.eventLog.at(-1)?.type, "recipe-discovered");
  assert.equal(
    createRenderSnapshot(state).wildlife.some(
      (candidate) => candidate.individualId === prey.individualId,
    ),
    false,
    "the emptied corpse is gone in the same command snapshot",
  );

  const collectedCondition = state.ecology?.individuals?.[prey.individualId];
  assert.ok(collectedCondition);
  assert.equal(collectedCondition.corpse, undefined);
  collectedCondition.respawnAtTick = state.clock.tick;
  state = stepSimulation(state, {}, 1);
  assert.equal(state.ecology?.individuals?.[prey.individualId], undefined);
  const restored = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.ok(restored);
  assert.equal(restored.health, restored.maxHealth);
});

test("a full backpack rejects corpse collection without changing loot or respawn state", () => {
  let state = createInitialState("wildlife-check");
  const prey = visibleWildlife(
    state,
    (candidate) => candidate.speciesId === "reedtail-scuttler",
  );
  state.player.position = { x: prey.position.x, y: 0, z: prey.position.z };
  state.inventory.spear = 1;
  state.inventory["raw-meat"] = ITEMS["raw-meat"].stackLimit;
  state.player.equippedItem = "spear";
  aimAtWildlife(state, prey.individualId);

  state = applyCommand(state, {
    type: "physical-action",
    targetId: `wildlife:${prey.individualId}`,
    actionId: "attack",
    poseRevision: state.player.poseRevision ?? 0,
  });
  const defeated = state.eventLog.find(
    (event) => event.type === "wildlife-defeated",
  );
  assert.ok(defeated);
  assert.match(defeated.message, /留在尸体上/);
  assert.equal(state.ecology?.individuals?.[prey.individualId]?.pendingMeat, 1);
  const corpse = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.ok(corpse);
  assert.equal(corpse.affordance.state, "blocked");
  assert.equal(corpse.affordance.blocker, "inventory-full");

  const conditionBefore = structuredClone(
    state.ecology?.individuals?.[prey.individualId],
  );
  const lifecycleBefore = structuredClone(state.itemLifecycle);
  const clockBefore = structuredClone(state.clock);
  state = applyCommand(state, {
    type: "collect-wildlife-loot",
    individualId: prey.individualId,
  });
  assert.equal(state.eventLog.at(-1)?.type, "command-rejected");
  assert.equal(state.inventory["raw-meat"], ITEMS["raw-meat"].stackLimit);
  assert.deepEqual(
    state.ecology?.individuals?.[prey.individualId],
    conditionBefore,
  );
  assert.deepEqual(state.itemLifecycle, lifecycleBefore);
  assert.deepEqual(state.clock, clockBefore);
});

test("predator contact damages the player only inside embodied contact range", () => {
  let state = createInitialState("pred-4");
  const predator = visibleWildlife(
    state,
    (candidate) => candidate.role === "predator",
  );
  const originalHealth = state.player.vitals.health;

  state.player.position = {
    x: predator.position.x + 5,
    y: 0,
    z: predator.position.z,
  };
  const avoided = applyCommand(state, {
    type: "encounter-wildlife",
    individualId: predator.individualId,
  });
  assert.equal(avoided.player.vitals.health, originalHealth);
  assert.equal(avoided.eventLog.at(-1)?.type, "command-rejected");

  state.player.position = { x: predator.position.x, y: 0, z: predator.position.z };
  state = applyCommand(state, {
    type: "encounter-wildlife",
    individualId: predator.individualId,
  });
  assert.ok(state.player.vitals.health < originalHealth);
  assert.equal(state.eventLog.at(-1)?.type, "wildlife-attack");
  assert.equal(state.player.conditions.wound.open, true);
});

test("hunted meat can only be cooked at a nearby burning campfire", () => {
  let state = createInitialState("wildlife-cooking");
  state.player.position = { x: 0, y: 0, z: 0 };
  state.inventory["raw-meat"] = 1;
  state.knowledge?.observedItemIds.push("raw-meat");
  state.camp.fire.built = true;
  state.camp.fire.lit = false;
  state.camp.fire.fuelSeconds = 100;
  state.camp.structures = [
    {
      id: "structure.campfire.test",
      kind: "campfire",
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 0,
    },
  ];

  assert.equal(canCraft(state, "cooked-meat").reason, "fire-not-lit");
  state.camp.fire.lit = true;
  assert.equal(canCraft(state, "cooked-meat").ok, true);

  state = applyCommand(state, { type: "craft", recipeId: "cooked-meat" });
  assert.equal(state.inventory["raw-meat"], 0);
  assert.equal(state.inventory["cooked-meat"], 1);
});
