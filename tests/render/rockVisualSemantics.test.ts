import assert from "node:assert/strict";
import test from "node:test";

import {
  ROCK_VISUAL_LIMITS,
  looseStonePieceTransforms,
  pebbleClusterTransforms,
} from "../../src/game/render/rockVisualSemantics";
import { rockInteractionGeometry } from "../../src/game/sim/rockHarvest";
import { applyCommand, createInitialState } from "../../src/game/sim";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import { createGeneratedChunkEntities } from "../../src/game/world/saveDelta";
import { generateSemanticChunkPlan } from "../../src/game/world/semanticGeneration";

test("pickup stones, mineable outcrops and pebble clutter occupy disjoint silhouette bands", () => {
  const loose = looseStonePieceTransforms(5);
  assert.equal(loose.length, 5);
  for (const piece of loose) {
    const width = piece.scaleX * 2;
    const height = piece.scaleY * 2;
    assert.ok(width >= ROCK_VISUAL_LIMITS.looseStone.minimumWidth);
    assert.ok(width <= ROCK_VISUAL_LIMITS.looseStone.maximumWidth);
    assert.ok(height >= ROCK_VISUAL_LIMITS.looseStone.minimumHeight);
    assert.ok(height <= ROCK_VISUAL_LIMITS.looseStone.maximumHeight);
  }

  const pebbles = pebbleClusterTransforms(0.37);
  assert.equal(pebbles.length, 5);
  assert.ok(
    pebbles.every(
      (piece) =>
        piece.scaleX * 2 <= ROCK_VISUAL_LIMITS.pebble.maximumWidth &&
        piece.scaleY * 2 <= ROCK_VISUAL_LIMITS.pebble.maximumHeight,
    ),
  );

  const smallestOutcrop = rockInteractionGeometry({
    scale: 0.9,
    semantic: { size: "small" },
  });
  assert.ok(
    ROCK_VISUAL_LIMITS.pebble.maximumWidth <
      ROCK_VISUAL_LIMITS.looseStone.minimumWidth,
  );
  assert.ok(
    ROCK_VISUAL_LIMITS.looseStone.maximumWidth <
      smallestOutcrop.bodyScale.x * 2,
  );
  assert.ok(
    ROCK_VISUAL_LIMITS.looseStone.maximumHeight <
      smallestOutcrop.bodyScale.y * 2,
  );
});

test("pickup pile piece count follows quantity on the next render snapshot", () => {
  let state = createInitialState("loose-stone-quantity");
  const id = "resource.stone.camp-01";
  const source = state.world.entities[id];
  assert.equal(source.quantity, 5);
  let rendered = createRenderSnapshot(state).entities.find(
    (entity) => entity.id === id,
  );
  assert.equal(rendered?.quantity, 5);
  assert.equal(looseStonePieceTransforms(rendered?.quantity ?? 0).length, 5);

  state = applyCommand(state, { type: "move-player", position: source.position });
  state = applyCommand(state, { type: "pick-up", entityId: id });
  rendered = createRenderSnapshot(state).entities.find(
    (entity) => entity.id === id,
  );
  assert.equal(rendered?.quantity, 4);
  assert.equal(looseStonePieceTransforms(rendered?.quantity ?? 0).length, 4);
});

test("visual categories preserve pickup, mine and never-focus semantics", () => {
  const state = createInitialState("rock-visual-category-truth");
  const loose = state.world.entities["resource.stone.camp-01"];
  assert.equal(loose.semantic, undefined);
  assert.equal(
    createRenderSnapshot(state).entities.find((entity) => entity.id === loose.id)
      ?.affordance.actionId,
    "pickup",
  );

  const generated = Object.values(
    createGeneratedChunkEntities(state.seed, { x: 0, z: 0 }),
  );
  const outcrop = generated.find(
    (entity) => entity.semantic?.category === "mineable-rock",
  );
  assert.ok(outcrop);
  assert.equal(outcrop.semantic?.action, "mine");

  const plan = generateSemanticChunkPlan(String(state.seed), { x: 0, z: 0 });
  const clutter = plan.objects.filter(
    (object) => object.category === "micro-clutter",
  );
  assert.ok(clutter.length > 0);
  assert.ok(clutter.every((object) => object.selectionPolicy === "never-focus"));
  assert.ok(
    clutter.every((object) => generated.every((entity) => entity.id !== object.id)),
  );
});
