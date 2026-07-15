import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../../src/game/sim/state";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import {
  dematerializeGeneratedWorldChunk,
  materializeGeneratedWorldChunk,
  syncGeneratedWorldBubble,
} from "../../src/game/world/saveDelta";

test("travelling through 1,000 pristine chunks keeps runtime entities bounded and creates no deltas", () => {
  const state = createInitialState("semantic-stream-pristine");
  for (let index = 0; index < 1_000; index += 1) {
    const coordinate = { x: index + 20, z: -index - 40 };
    const result = syncGeneratedWorldBubble(state, coordinate, 0);
    assert.deepEqual(result.activeChunks, [`${coordinate.x}:${coordinate.z}`]);
    assert.equal(state.world.generatedResourceChunks?.length, 1);
  }

  assert.equal(Object.keys(state.world.entityDeltas ?? {}).length, 0);
  const generatedRuntime = Object.values(state.world.entities).filter((entity) =>
    entity.tags.includes("generated"),
  );
  assert.ok(generatedRuntime.length > 0);
  assert.ok(generatedRuntime.length < 80);
});

test("dematerialization retains only partial, depleted, and regrowing consequences", () => {
  const state = createInitialState("semantic-stream-deltas");
  const coordinate = { x: 14, z: -9 };
  syncGeneratedWorldBubble(state, coordinate, 0);
  const chunkTag = `chunk:${coordinate.x}:${coordinate.z}`;
  const entities = Object.values(state.world.entities).filter((entity) =>
    entity.tags.includes(chunkTag),
  );
  const partial = entities.find(
    (entity) => entity.semantic?.category === "tree" && entity.quantity > 1,
  );
  const depleted = entities.find(
    (entity) => entity.semantic?.category === "mineable-rock",
  );
  const regrowing = entities.find(
    (entity) =>
      entity.semantic?.category === "harvestable-plant" && entity.regeneration,
  );
  assert.ok(partial && depleted && regrowing);

  partial.quantity -= 1;
  depleted.quantity = 0;
  depleted.depleted = true;
  regrowing.quantity = 0;
  regrowing.depleted = true;
  regrowing.regeneration!.nextTick = 91_000;
  const expected = {
    [partial.id]: partial.quantity,
    [depleted.id]: depleted.quantity,
    [regrowing.id]: regrowing.quantity,
  };

  const removed = dematerializeGeneratedWorldChunk(state, coordinate);
  assert.ok(removed > 0);
  assert.equal(
    Object.values(state.world.entities).some((entity) =>
      entity.tags.includes(chunkTag),
    ),
    false,
  );
  assert.deepEqual(
    new Set(Object.keys(state.world.entityDeltas ?? {})),
    new Set(Object.keys(expected)),
  );
  const renderStates = new Map(
    createRenderSnapshot(state).semanticStates.map((entry) => [entry.id, entry]),
  );
  for (const [id, quantity] of Object.entries(expected)) {
    assert.equal(renderStates.get(id)?.quantity, quantity);
    assert.equal(renderStates.get(id)?.chunkKey, `${coordinate.x}:${coordinate.z}`);
  }

  materializeGeneratedWorldChunk(state, coordinate);
  for (const [id, quantity] of Object.entries(expected)) {
    assert.equal(state.world.entities[id]?.quantity, quantity);
  }
  assert.equal(
    state.world.entities[regrowing.id]?.regeneration?.nextTick,
    91_000,
  );
});

test("a 3x3 activity bubble is device-independent and stable across boundary moves", () => {
  const state = createInitialState("semantic-stream-bubble");
  const first = syncGeneratedWorldBubble(state, { x: 0, z: 0 });
  assert.equal(first.activeChunks.length, 9);
  assert.deepEqual(
    new Set(first.activeChunks),
    new Set([
      "-1:-1", "-1:0", "-1:1",
      "0:-1", "0:0", "0:1",
      "1:-1", "1:0", "1:1",
    ]),
  );

  const shifted = syncGeneratedWorldBubble(state, { x: 1, z: 0 });
  assert.equal(shifted.activeChunks.length, 9);
  assert.deepEqual(
    new Set(shifted.dematerializedChunks),
    new Set(["-1:-1", "-1:0", "-1:1"]),
  );
  assert.deepEqual(
    new Set(shifted.materializedChunks),
    new Set(["2:-1", "2:0", "2:1"]),
  );
});
