import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_HIT_BLOCKER_SHAPES,
  buildPhysicalHitSweep,
  hitPoseWithinWindupTolerance,
  hitProfileFor,
  nearestBlockingEntry,
  resolveBoundPhysicalHit,
  shortestAngleDelta,
  sweptCapsuleFirstEntry,
  type HitShape,
  type HitSweep,
} from "../../src/game/world/hitGeometry";

const horizontalSweep: HitSweep = {
  startX: 0,
  startY: 1,
  startZ: 0,
  endX: 10,
  endY: 1,
  endZ: 0,
  radius: 0.25,
};

function circle(
  id: string,
  x: number,
  z: number,
  radius = 0.5,
  minimumY = 0,
  maximumY = 2,
): HitShape {
  return {
    id,
    collider: { kind: "circle", x, z, radius },
    minimumY,
    maximumY,
  };
}

test("swept capsule returns deterministic first entry for circle, box and capsule", () => {
  const shapes: HitShape[] = [
    circle("circle", 5, 0),
    {
      id: "box",
      collider: { kind: "box", x: 5, z: 0, halfWidth: 0.5, halfDepth: 0.4 },
      minimumY: 0,
      maximumY: 2,
    },
    {
      id: "capsule",
      collider: {
        kind: "capsule",
        startX: 5,
        startZ: -1,
        endX: 5,
        endZ: 1,
        radius: 0.25,
      },
      minimumY: 0,
      maximumY: 2,
    },
  ];
  const entries = shapes.map((shape) => sweptCapsuleFirstEntry(horizontalSweep, shape));
  assert.ok(entries[0] > 0.42 && entries[0] < 0.43);
  assert.ok(entries[1] > 0.42 && entries[1] < 0.43);
  assert.ok(entries[2] > 0.44 && entries[2] < 0.46);
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    assert.deepEqual(
      shapes.map((shape) => sweptCapsuleFirstEntry(horizontalSweep, shape)),
      entries,
    );
  }
});

test("tangent contact is a hit, while epsilon outside and wrong height miss", () => {
  const tangent = circle("tangent", 5, 0.75, 0.5);
  assert.ok(Number.isFinite(sweptCapsuleFirstEntry(horizontalSweep, tangent)));
  assert.equal(
    sweptCapsuleFirstEntry(horizontalSweep, circle("outside", 5, 0.7502, 0.5)),
    Number.POSITIVE_INFINITY,
  );
  assert.equal(
    sweptCapsuleFirstEntry(horizontalSweep, circle("overhead", 5, 0, 0.5, 2, 3)),
    Number.POSITIVE_INFINITY,
  );
  const rising: HitSweep = { ...horizontalSweep, endY: 3 };
  assert.ok(
    Number.isFinite(
      sweptCapsuleFirstEntry(rising, circle("raised", 5, 0, 0.5, 1.8, 2.4)),
    ),
  );
});

test("target must be reached before the nearest blocker", () => {
  const target = circle("target", 7, 0);
  const blocker = circle("tree", 4, 0, 0.65);
  const blocked = resolveBoundPhysicalHit(horizontalSweep, target, [blocker]);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "occluded");
  assert.equal(blocked.blocker?.id, "tree");

  const behind = resolveBoundPhysicalHit(
    horizontalSweep,
    circle("near-target", 3, 0),
    [circle("behind", 8, 0)],
  );
  assert.equal(behind.ok, true);

  const excludedTargetCollider = resolveBoundPhysicalHit(
    horizontalSweep,
    target,
    [target],
  );
  assert.equal(excludedTargetCollider.ok, true);
});

test("blocker queries fail closed at the bounded active-world budget", () => {
  const blockers = Array.from(
    { length: MAX_HIT_BLOCKER_SHAPES + 1 },
    (_, index) => circle(`far-${index}`, 20 + index, 20),
  );
  const nearest = nearestBlockingEntry(horizontalSweep, blockers, "target");
  assert.equal(nearest.scanned, MAX_HIT_BLOCKER_SHAPES);
  assert.equal(nearest.truncated, true);
  const result = resolveBoundPhysicalHit(
    horizontalSweep,
    circle("target", 7, 0),
    blockers,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "geometry-budget");
});

test("invalid migrated collider coordinates and dimensions fail closed", () => {
  const invalidShapes: HitShape[] = [
    circle("nan-circle", Number.NaN, 0),
    circle("negative-circle", 4, 0, -0.5),
    {
      id: "infinite-box",
      collider: {
        kind: "box",
        x: 4,
        z: 0,
        halfWidth: Number.POSITIVE_INFINITY,
        halfDepth: 0.5,
      },
      minimumY: 0,
      maximumY: 2,
    },
    {
      id: "negative-box",
      collider: { kind: "box", x: 4, z: 0, halfWidth: -1, halfDepth: 0.5 },
      minimumY: 0,
      maximumY: 2,
    },
    {
      id: "nan-capsule",
      collider: {
        kind: "capsule",
        startX: 4,
        startZ: 0,
        endX: Number.NaN,
        endZ: 1,
        radius: 0.5,
      },
      minimumY: 0,
      maximumY: 2,
    },
    { ...circle("bad-height", 4, 0), maximumY: Number.NaN },
  ];
  for (const shape of invalidShapes) {
    assert.equal(
      sweptCapsuleFirstEntry(horizontalSweep, shape),
      Number.POSITIVE_INFINITY,
    );
  }
});

test("action profiles build camera-forward sweeps and windup tolerances wrap yaw", () => {
  const chop = hitProfileFor("chop");
  const sweep = buildPhysicalHitSweep(
    { x: 2, z: 3, groundY: 4, yaw: Math.PI, pitch: 0 },
    chop,
  );
  assert.ok(Math.abs(sweep.startX - 2) < 1e-9);
  assert.ok(sweep.endZ > sweep.startZ);
  assert.equal(sweep.radius, chop.radius);

  assert.ok(
    Math.abs(shortestAngleDelta(Math.PI - 0.01, -Math.PI + 0.01) - 0.02) <
      1e-9,
  );
  assert.equal(
    hitPoseWithinWindupTolerance(
      { x: 0, z: 0, yaw: Math.PI - 0.01, pitch: 0 },
      { x: 0.1, z: 0, yaw: -Math.PI + 0.01, pitch: 0.01 },
      chop,
    ),
    true,
  );
  assert.equal(
    hitPoseWithinWindupTolerance(
      { x: 0, z: 0, yaw: 0, pitch: 0 },
      { x: chop.maximumWindupDrift + 0.01, z: 0, yaw: 0, pitch: 0 },
      chop,
    ),
    false,
  );
  assert.equal(
    hitPoseWithinWindupTolerance(
      { x: 0, z: 0, yaw: 0, pitch: 0 },
      { x: 0, z: 0, yaw: chop.maximumWindupTurnRadians + 0.01, pitch: 0 },
      chop,
    ),
    false,
  );
  assert.equal(
    hitPoseWithinWindupTolerance(
      { x: 0, z: 0, yaw: 0, pitch: 0 },
      { x: 0, z: 0, yaw: 0, pitch: chop.maximumWindupPitchRadians + 0.01 },
      chop,
    ),
    false,
  );
});
