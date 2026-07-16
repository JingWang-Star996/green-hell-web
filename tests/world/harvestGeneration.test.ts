import assert from "node:assert/strict";
import test from "node:test";
import { generateChunkStandingTreePlan } from "../../src/game/world/harvestGeneration";

test("standing tree plans are stable and chunk-local", () => {
  const coordinate = { x: 4, z: -3 };
  const first = generateChunkStandingTreePlan("canopy-seed", coordinate);
  const second = generateChunkStandingTreePlan("canopy-seed", coordinate);
  assert.deepEqual(first, second);
  assert.ok(first.length >= 1);
  for (const tree of first) {
    assert.match(tree.id, /^tree\.generated\.2:4:-3:/);
    assert.ok(tree.x >= 4 * 48 && tree.x < 5 * 48);
    assert.ok(tree.z >= -3 * 48 && tree.z < -2 * 48);
    assert.ok(tree.yieldUnits >= 4 && tree.yieldUnits <= 7);
  }
});

test("standing tree plans vary by seed and coordinate", () => {
  const original = generateChunkStandingTreePlan("canopy-a", { x: 2, z: 2 });
  const otherSeed = generateChunkStandingTreePlan("canopy-b", { x: 2, z: 2 });
  const otherChunk = generateChunkStandingTreePlan("canopy-a", { x: 3, z: 2 });
  assert.notDeepEqual(original, otherSeed);
  assert.notDeepEqual(original, otherChunk);
});
