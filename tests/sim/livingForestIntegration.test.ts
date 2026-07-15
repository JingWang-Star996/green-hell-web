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
    entity.tags.includes("chunk:100:-75") &&
    (!entity.semantic || entity.semantic.toolTier <= 1),
  );
  assert.ok(generated?.itemId);
  let besideResource = applyCommand(moved, {
    type: "move-player",
    position: generated!.position,
  });
  const toolClass = generated!.semantic?.toolClass;
  if (toolClass && toolClass !== "hand") {
    const tool = {
      blade: "stone-blade",
      axe: "axe",
      pick: "stone-pick",
    }[toolClass] as "stone-blade" | "axe" | "stone-pick";
    besideResource.inventory[tool] = 1;
    besideResource = migrateGameState(besideResource);
    besideResource = applyCommand(besideResource, {
      type: "equip-item",
      itemId: tool,
    });
  }
  const before = besideResource.inventory[generated!.itemId!];
  const beforeQuantity = besideResource.world.entities[generated!.id].quantity;
  const harvested = generated!.semantic
    ? applyCommand(besideResource, {
        type: "harvest",
        entityId: generated!.id,
      })
    : applyCommand(besideResource, {
        type: "pick-up",
        entityId: generated!.id,
      });
  if (generated!.semantic?.category === "tree") {
    assert.ok(
      harvested.world.entities[generated!.id].quantity < beforeQuantity,
      "the first axe strike should advance tree structure damage",
    );
    assert.equal(
      harvested.inventory[generated!.itemId!],
      before,
      "standing trees should not turn a single strike into loose inventory",
    );
  } else {
    assert.ok(harvested.inventory[generated!.itemId!] > before);
  }
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
