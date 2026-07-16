import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_DURABILITY } from "../../src/game/sim/content";
import { applyCommand } from "../../src/game/sim/simulation";
import { createInitialState, migrateGameState } from "../../src/game/sim/state";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import type {
  GameCommand,
  GameState,
  WorldEntity,
} from "../../src/game/sim/types";

function rock(id: string, x: number, z: number): WorldEntity {
  return {
    id,
    kind: "resource",
    label: "测试岩体",
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
      size: "small",
      visualVariant: "test",
      yaw: 0,
      scale: 1,
      action: "mine",
      toolClass: "pick",
      toolTier: 1,
      yieldTableId: "test/rock",
      primaryMaterial: "stone",
      yieldMinimum: 3,
      yieldMaximum: 3,
      baselineQuantity: 3,
    },
  };
}

function readyState(target = rock("rock.target", 100, 98.6)): GameState {
  const state = createInitialState("physical-hit-authority");
  state.player.position = { x: 100, y: 0, z: 100 };
  state.player.lookYaw = 0;
  state.player.lookPitch = -0.08;
  state.player.poseRevision = 12;
  state.inventory["stone-pick"] = 1;
  state.player.equippedItem = "stone-pick";
  state.itemLifecycle!.tools["stone-pick"] = [{
    durability: TOOL_DURABILITY["stone-pick"].maxDurability,
    maxDurability: TOOL_DURABILITY["stone-pick"].maxDurability,
  }];
  state.world.entities = { [target.id]: target };
  state.world.entityDeltas = {};
  state.world.generatedResourceChunks = [];
  return state;
}

function physicalCommand(
  state: GameState,
  targetId = "rock.target",
): Extract<GameCommand, { type: "physical-action" }> {
  return {
    type: "physical-action",
    targetId,
    actionId: "mine",
    poseRevision: state.player.poseRevision ?? 0,
  };
}

function outcome(state: GameState, targetId = "rock.target") {
  return {
    tick: state.clock.tick,
    elapsedSeconds: state.clock.elapsedSeconds,
    stamina: state.player.vitals.stamina,
    stone: state.inventory.stone,
    pick: state.itemLifecycle?.tools["stone-pick"]?.map((tool) => ({ ...tool })),
    quantity: state.world.entities[targetId]?.quantity,
  };
}

test("authoritative physical command accepts a front hit and settles once", () => {
  const state = readyState();
  const before = outcome(state);
  const next = applyCommand(state, physicalCommand(state));
  assert.equal(next.eventLog.at(-1)?.type, "harvest-struck");
  assert.equal(next.world.entities["rock.target"].quantity, before.quantity! - 1);
  assert.equal(next.inventory.stone, before.stone + 1);
  assert.ok(next.clock.elapsedSeconds > before.elapsedSeconds);
});

test("back, side, occluded, forged and stale physical hits reject atomically", () => {
  const cases: Array<{
    label: string;
    state: GameState;
    command: GameCommand;
    reason: string;
  }> = [];

  const behind = readyState(rock("rock.target", 100, 101.4));
  cases.push({
    label: "behind",
    state: behind,
    command: physicalCommand(behind),
    reason: "target-missed",
  });

  const side = readyState(rock("rock.target", 101.4, 100));
  cases.push({
    label: "side",
    state: side,
    command: physicalCommand(side),
    reason: "target-missed",
  });

  const occluded = readyState(rock("rock.target", 100, 97.8));
  occluded.world.entities["rock.blocker"] = rock("rock.blocker", 100, 99.05);
  occluded.world.entities["rock.blocker"].semantic!.size = "large";
  cases.push({
    label: "occluded",
    state: occluded,
    command: physicalCommand(occluded),
    reason: "occluded",
  });

  const forged = readyState(rock("rock.target", 101.4, 100));
  cases.push({
    label: "forged payload coordinates and damage",
    state: forged,
    command: {
      ...physicalCommand(forged),
      position: { x: 101.4, y: 0, z: 100 },
      damage: 999,
    } as GameCommand,
    reason: "target-missed",
  });

  const stale = readyState();
  cases.push({
    label: "stale revision",
    state: stale,
    command: { ...physicalCommand(stale), poseRevision: 11 },
    reason: "stale-pose",
  });

  for (const entry of cases) {
    const before = outcome(entry.state);
    const next = applyCommand(entry.state, entry.command);
    assert.equal(next.eventLog.at(-1)?.type, "command-rejected", entry.label);
    assert.equal(next.eventLog.at(-1)?.details?.hitReason, entry.reason, entry.label);
    assert.deepEqual(outcome(next), before, entry.label);
  }
});

test("tool switch and forged action reject before time, stamina, wear or yield", () => {
  for (const forgedAction of [false, true]) {
    const state = readyState();
    if (forgedAction) {
      state.inventory.axe = 1;
      state.player.equippedItem = "axe";
    }
    const before = outcome(state);
    const command = forgedAction
      ? physicalCommand(state)
      : { ...physicalCommand(state), actionId: "chop" as const };
    const next = applyCommand(state, command);
    assert.equal(next.eventLog.at(-1)?.type, "command-rejected");
    assert.deepEqual(outcome(next), before);
  }
});

test("legacy harvest cannot bypass spatial validation", () => {
  const state = readyState(rock("rock.target", 100, 101.4));
  const before = outcome(state);
  const next = applyCommand(state, { type: "harvest", entityId: "rock.target" });
  assert.equal(next.eventLog.at(-1)?.details?.hitReason, "target-missed");
  assert.deepEqual(outcome(next), before);
});

test("legacy wildlife attack cannot bypass back-facing validation", () => {
  const state = createInitialState("legacy-wildlife-spatial-guard");
  const prey = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.visible && candidate.health > 0,
  );
  assert.ok(prey);
  state.player.position = { ...prey.position };
  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  state.itemLifecycle!.tools.spear = [{
    durability: TOOL_DURABILITY.spear.maxDurability,
    maxDurability: TOOL_DURABILITY.spear.maxDurability,
  }];
  const current = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.ok(current);
  const targetYaw = Math.atan2(
    -(current.position.x - state.player.position.x),
    -(current.position.z - state.player.position.z),
  );
  state.player.lookYaw = targetYaw + Math.PI;
  state.player.lookPitch = -0.2;
  const before = {
    clock: structuredClone(state.clock),
    stamina: state.player.vitals.stamina,
    health: current.health,
    spear: structuredClone(state.itemLifecycle!.tools.spear),
  };
  const next = applyCommand(state, {
    type: "attack-wildlife",
    individualId: prey.individualId,
  });
  const afterProjection = createRenderSnapshot(next).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.equal(next.eventLog.at(-1)?.details?.hitReason, "target-missed");
  assert.deepEqual(next.clock, before.clock);
  assert.equal(next.player.vitals.stamina, before.stamina);
  assert.equal(afterProjection?.health, before.health);
  assert.deepEqual(next.itemLifecycle?.tools.spear, before.spear);
});

test("old saves migrate look pose and hot-path look sync only revises real changes", () => {
  const legacy = createInitialState("legacy-look-pose");
  delete legacy.player.lookYaw;
  delete legacy.player.lookPitch;
  delete legacy.player.poseRevision;
  let state = migrateGameState(legacy);
  assert.equal(state.player.lookYaw, Math.PI);
  assert.equal(state.player.lookPitch, -0.05);
  assert.equal(state.player.poseRevision, 0);

  state = applyCommand(state, {
    type: "move-player",
    position: { ...state.player.position },
    look: { yaw: Math.PI, pitch: -0.05 },
  });
  assert.equal(state.player.poseRevision, 0);
  const eventCount = state.eventLog.length;
  state = applyCommand(state, {
    type: "move-player",
    position: { ...state.player.position },
    look: { yaw: Math.PI - 0.2, pitch: -0.15 },
  });
  assert.equal(state.player.poseRevision, 1);
  assert.equal(state.eventLog.length, eventCount, "look sync must not add log noise");
});
