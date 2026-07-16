import assert from "node:assert/strict";
import test from "node:test";

import { RECIPES, TOOL_DURABILITY } from "../../src/game/sim/content";
import {
  FIXED_HZ,
  applyCommand,
  createInitialState,
} from "../../src/game/sim";

test("split-log death advances time without consuming input, producing output, or wearing the axe", () => {
  const state = createInitialState("craft-atomic-death");
  const axeDurability = TOOL_DURABILITY.axe.maxDurability - 3;
  state.inventory.log = 1;
  state.inventory.axe = 1;
  state.itemLifecycle!.tools.axe = [
    {
      durability: axeDurability,
      maxDurability: TOOL_DURABILITY.axe.maxDurability,
    },
  ];
  state.player.vitals.health = 0;
  const startingTick = state.clock.tick;
  const startingSticks = state.inventory.stick;
  const startingEventCount = state.eventLog.length;

  const result = applyCommand(state, {
    type: "craft",
    recipeId: "split-log",
  });

  assert.equal(result.status, "lost");
  assert.equal(
    result.clock.tick,
    startingTick + 1,
    "the fatal simulation tick remains part of the interrupted work",
  );
  assert.equal(result.inventory.log, 1);
  assert.equal(result.inventory.stick, startingSticks);
  assert.equal(result.inventory.axe, 1);
  assert.equal(
    result.itemLifecycle?.tools.axe?.[0]?.durability,
    axeDurability,
  );
  const newEvents = result.eventLog.slice(startingEventCount);
  assert.ok(newEvents.some((event) => event.type === "game-lost"));
  assert.ok(newEvents.every((event) => event.type !== "craft-succeeded"));
});

test("a prerequisite lost during ordinary recipe work fails before inventory settlement", () => {
  const state = createInitialState("craft-atomic-revalidation");
  state.player.position = { ...state.camp.position };
  state.inventory["raw-meat"] = 1;
  state.inventory["cooked-meat"] = 0;
  state.camp.fire.built = true;
  state.camp.fire.lit = true;
  state.camp.fire.fuelSeconds = 0.01;
  state.weather.rainIntensity = 0;
  state.weather.targetRainIntensity = 0;
  const startingTick = state.clock.tick;

  const result = applyCommand(state, {
    type: "craft",
    recipeId: "cooked-meat",
  });

  assert.equal(result.status, "playing");
  assert.equal(
    result.clock.tick - startingTick,
    RECIPES["cooked-meat"].workSeconds * FIXED_HZ,
  );
  assert.equal(result.camp.fire.lit, false);
  assert.equal(result.inventory["raw-meat"], 1);
  assert.equal(result.inventory["cooked-meat"], 0);
  assert.equal(result.eventLog.at(-1)?.type, "craft-failed");
  assert.equal(result.eventLog.at(-1)?.details?.reason, "fire-not-lit");
  assert.equal(result.eventLog.at(-1)?.details?.phase, "settlement");
});

test("ordinary successful crafting still consumes and produces after represented work", () => {
  const state = createInitialState("craft-atomic-success");
  state.inventory.stone = 2;
  state.inventory["stone-blade"] = 0;
  state.itemLifecycle!.tools["stone-blade"] = [];
  const startingTick = state.clock.tick;

  const result = applyCommand(state, {
    type: "craft",
    recipeId: "stone-blade",
  });

  assert.equal(result.status, "playing");
  assert.equal(
    result.clock.tick - startingTick,
    RECIPES["stone-blade"].workSeconds * FIXED_HZ,
  );
  assert.equal(result.inventory.stone, 0);
  assert.equal(result.inventory["stone-blade"], 1);
  assert.equal(result.eventLog.at(-1)?.type, "craft-succeeded");
});
