import assert from "node:assert/strict";
import test from "node:test";

import { generateSemanticChunkPlan } from "../../src/game/world/semanticGeneration";
import { buildSemanticChunkRenderPlan } from "../../src/game/world/semanticRenderPlan";

test("semantic render input preserves one identity set and keeps clutter out of focus", () => {
  const source = generateSemanticChunkPlan("render-contract", { x: 2, z: -3 });
  const first = buildSemanticChunkRenderPlan(source);
  const second = buildSemanticChunkRenderPlan(source);

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.objects.map((object) => object.id),
    source.objects.map((object) => object.id),
  );
  for (const object of first.objects) {
    if (
      object.category === "micro-clutter" ||
      object.category === "ambient-foliage"
    ) {
      assert.equal(object.interactive, false);
      assert.equal(object.focusPolicy, "never-focus");
      assert.equal(object.lifecycle, "ambient");
      assert.equal(object.quantity, null);
    } else {
      assert.equal(object.interactive, true);
      assert.equal(object.focusPolicy, "capability");
      assert.equal(object.lifecycle, "full");
      assert.equal(object.quantity, object.baselineQuantity);
    }
  }
});

test("sparse runtime state projects partial, depleted, and regrowing visuals", () => {
  const source = generateSemanticChunkPlan("render-lifecycle", { x: 4, z: 5 });
  const interactive = source.objects.filter((object) => object.interactive);
  assert.ok(interactive.length >= 3);
  const [partial, depleted, regrowing] = interactive;
  const rendered = buildSemanticChunkRenderPlan(source, {
    [partial.id]: { quantity: Math.max(1, partial.baselineQuantity - 1) },
    [depleted.id]: { quantity: 0 },
    [regrowing.id]: { quantity: 0, nextRegenerationTick: 42_000 },
  });
  const byId = new Map(rendered.objects.map((object) => [object.id, object]));

  assert.equal(byId.get(partial.id)?.lifecycle, "partial");
  assert.equal(byId.get(depleted.id)?.lifecycle, "depleted");
  assert.equal(byId.get(depleted.id)?.interactive, false);
  assert.equal(byId.get(depleted.id)?.focusPolicy, "never-focus");
  assert.equal(byId.get(regrowing.id)?.lifecycle, "regrowing");
  assert.equal(byId.get(regrowing.id)?.nextRegenerationTick, 42_000);
});
