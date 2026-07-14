import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createInitialState,
  migrateGameState,
  stepSimulation,
} from "../../src/game/sim";
import { createGameViewModel } from "../../src/game/ui/viewModel";

test("dynamic world coordinates survive simulation and legacy-bound migration", () => {
  const initial = createInitialState("unbounded-world");
  initial.world.bounds = { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
  const migrated = migrateGameState(initial);
  const moved = applyCommand(migrated, {
    type: "move-player",
    position: { x: 4_800, y: 0, z: -3_600 },
  });

  assert.equal(moved.player.position.x, 4_800);
  assert.equal(moved.player.position.z, -3_600);
  assert.ok(moved.world.bounds.maxX >= 1_000_000);
  assert.equal(moved.world.exploredChunks?.at(-1), "100:-75");
  assert.ok(moved.world.generatedResourceChunks?.includes("100:-75"));
  const generated = Object.values(moved.world.entities).find((entity) =>
    entity.tags.includes("chunk:100:-75"),
  );
  assert.ok(generated?.itemId);
  const besideResource = applyCommand(moved, {
    type: "move-player",
    position: generated!.position,
  });
  const before = besideResource.inventory[generated!.itemId!];
  const harvested = applyCommand(besideResource, {
    type: "pick-up",
    entityId: generated!.id,
  });
  assert.ok(harvested.inventory[generated!.itemId!] > before);
});

test("ecology is persisted, advanced, and projected for the active biome", () => {
  const initial = createInitialState("ecology-integration");
  const advanced = stepSimulation(initial, {}, 31);
  const view = createGameViewModel(advanced);

  assert.ok(advanced.ecology);
  assert.equal(advanced.ecology?.simulatedThroughTick, 930);
  assert.ok(Object.keys(advanced.ecology?.populations ?? {}).length >= 27);
  assert.equal(view.render.worldSeed, String(initial.seed));
  assert.ok(view.render.wildlife.length > 0);
  assert.ok(view.watch.biome.length > 0);
  assert.ok(view.mapChunks.some((chunk) => chunk.current));
});

test("the authored ending can transition into a persistent living-forest sandbox", () => {
  const won = createInitialState("continue-after-signal");
  won.status = "won";
  won.objectives.currentTaskId = null;
  won.objectives.flags.transmitted = true;

  const continued = applyCommand(won, { type: "continue-expedition" });
  const advanced = stepSimulation(continued, {}, 1);
  const view = createGameViewModel(advanced);

  assert.equal(advanced.status, "playing");
  assert.equal(advanced.objectives.flags.sandboxContinued, true);
  assert.equal(advanced.eventLog.at(-1)?.type, "sandbox-continued");
  assert.equal(view.currentObjective?.id, "living-forest");
});
