import assert from "node:assert/strict";
import test from "node:test";

import {
  createStableRiverWaterTarget,
  createRiverWaterTarget,
  parseRiverWaterTargetId,
  riverTargetFromFirstRayHit,
} from "../../src/game/world/riverWater";
import { riverCenter } from "../../src/game/world/terrain";

test("river target IDs round-trip across distant segments and both banks", () => {
  for (const x of [-4096.25, -73.1, 0, 12.4, 989.9, 65_535.2]) {
    for (const bankOffset of [-2.2, -1.1, 0, 1.1, 2.2]) {
      const target = createRiverWaterTarget({
        x,
        z: riverCenter(x) + bankOffset,
      });
      assert.ok(target, `${x}/${bankOffset} should address visible river water`);
      assert.deepEqual(parseRiverWaterTargetId(target.id), target);
      assert.equal(createRiverWaterTarget(target.anchor)?.id, target.id);
    }
  }
});

test("river target decoder rejects aliases, overflow and fuzzed non-canonical IDs", () => {
  const invalid = [
    "water:river:v1:00:0",
    "water:river:v1:-0:0",
    "water:river:v1:+1:0",
    "water:river:v1:1e2:0",
    "water:river:v1:1:00",
    "water:river:v1:1:-0",
    "water:river:v1:1:5",
    "water:river:v1:1:-5",
    "water:river:v1:9007199254740992:0",
    "water:river:v1:12345678901234567:0",
    "water:river:v2:1:0",
    "water:river:v1:1:0:tail",
    "landmark.stream",
    "",
  ];
  for (const id of invalid) assert.equal(parseRiverWaterTargetId(id), null, id);

  let seed = 0x3c6ef35f;
  const alphabet = "water:river:v1:+-0123456789.eXYZ_";
  for (let index = 0; index < 2_000; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const length = seed % 48;
    let candidate = "";
    for (let char = 0; char < length; char += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      candidate += alphabet[seed % alphabet.length];
    }
    const parsed = parseRiverWaterTargetId(candidate);
    if (parsed) assert.equal(createRiverWaterTarget(parsed.anchor)?.id, candidate);
  }
});

test("only the centre ray's first semantic surface may create a river target", () => {
  const point = { x: 18, z: riverCenter(18) };
  assert.ok(
    riverTargetFromFirstRayHit([
      { distance: 2.2, kind: "river", point },
      { distance: 2.4, kind: "ground", point },
    ]),
  );
  assert.equal(
    riverTargetFromFirstRayHit([
      { distance: 2.1, kind: "ground", point },
      { distance: 2.2, kind: "river", point },
    ]),
    null,
  );
  assert.equal(
    riverTargetFromFirstRayHit([
      { distance: 2.1, kind: "mud", point },
      { distance: 2.2, kind: "river", point },
    ]),
    null,
  );
  assert.equal(
    riverTargetFromFirstRayHit([
      { distance: 3.51, kind: "river", point },
    ]),
    null,
  );
  assert.equal(
    riverTargetFromFirstRayHit([
      { distance: 2.2, kind: "river", point },
      { distance: 2.2, kind: "ground", point },
    ]),
    null,
    "a non-river surface wins a numerical tie regardless of array order",
  );
});

test("small aim tremors keep one ID while a real cell crossing changes target", () => {
  const x = 24;
  const initial = createRiverWaterTarget({ x, z: riverCenter(x) });
  assert.ok(initial);
  const trembling = createStableRiverWaterTarget(
    {
      x: initial.anchor.x + 0.29,
      z: riverCenter(initial.anchor.x + 0.29) + 0.03,
    },
    initial.id,
  );
  assert.equal(trembling?.id, initial.id);

  const crossed = createStableRiverWaterTarget(
    {
      x: initial.anchor.x + 0.36,
      z: riverCenter(initial.anchor.x + 0.36),
    },
    initial.id,
  );
  assert.ok(crossed);
  assert.notEqual(crossed.id, initial.id);
});
