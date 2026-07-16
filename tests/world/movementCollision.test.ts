import assert from "node:assert/strict";
import test from "node:test";

import {
  canMovePointThroughColliders,
  colliderPenetrationDepth,
  type WorldCollider,
} from "../../src/game/world/interactionGeometry";

test("a player enclosed by a newly fallen trunk can move only toward escape", () => {
  const fallenTree: WorldCollider = {
    kind: "capsule",
    startX: 0,
    startZ: 0,
    endX: 4,
    endZ: 0,
    radius: 0.3,
  };
  const trapped = { x: -0.1, z: 0 };

  assert.ok(colliderPenetrationDepth(fallenTree, trapped.x, trapped.z) > 0);
  assert.equal(
    canMovePointThroughColliders([fallenTree], trapped, { x: -0.2, z: 0 }),
    true,
  );
  assert.equal(
    canMovePointThroughColliders([fallenTree], trapped, { x: 0, z: 0 }),
    false,
  );
  assert.equal(
    canMovePointThroughColliders([fallenTree], trapped, { x: -0.9, z: 0 }),
    true,
  );
});

test("normal movement cannot enter a collider from outside", () => {
  const trunk: WorldCollider = {
    kind: "circle",
    x: 0,
    z: 0,
    radius: 0.5,
  };
  assert.equal(
    canMovePointThroughColliders([trunk], { x: -1.1, z: 0 }, { x: -0.7, z: 0 }),
    false,
  );
  assert.equal(
    canMovePointThroughColliders([trunk], { x: -1.1, z: 0 }, { x: -1, z: 0 }),
    true,
  );
});

test("escape cannot trade one penetration for a deeper second obstacle", () => {
  const colliders: WorldCollider[] = [
    { kind: "circle", x: 0, z: 0, radius: 0.5 },
    { kind: "box", x: 0.72, z: 0, halfWidth: 0.2, halfDepth: 0.5 },
  ];
  assert.equal(
    canMovePointThroughColliders(colliders, { x: 0.4, z: 0 }, { x: 0.52, z: 0 }),
    false,
  );
});

test("escape cannot swap a shallow old collider for a different new collider", () => {
  const colliders: WorldCollider[] = [
    { kind: "circle", x: 0, z: 0, radius: 0.2 },
    { kind: "circle", x: 1, z: 0, radius: 0.2 },
  ];
  assert.ok(colliderPenetrationDepth(colliders[0], 0.4, 0) > 0);
  assert.equal(colliderPenetrationDepth(colliders[1], 0.4, 0), 0);
  assert.equal(
    canMovePointThroughColliders(colliders, { x: 0.4, z: 0 }, { x: 0.55, z: 0 }),
    false,
  );
});
