import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STRUCTURE_PLACEMENTS,
  SHELTER_COVERAGE_RADIUS,
  isPointBlockedByStructure,
  isWithinStructureRadius,
  resolveStructureTransform,
  structurePlacementsOverlap,
  type StructureTransform2D,
} from "../../src/game/sim/index";

function structure(
  kind: StructureTransform2D["kind"],
  x: number,
  z: number,
  yaw = 0,
): StructureTransform2D {
  return { id: `structure.${kind}.test`, kind, x, z, yaw };
}

test("legacy built flags resolve to the same authored transforms used by rendering", () => {
  const fire = resolveStructureTransform("campfire", undefined, true);
  assert.deepEqual(fire, {
    id: "structure.campfire.legacy-fallback",
    kind: "campfire",
    x: DEFAULT_STRUCTURE_PLACEMENTS.campfire.position.x,
    z: DEFAULT_STRUCTURE_PLACEMENTS.campfire.position.z,
    yaw: DEFAULT_STRUCTURE_PLACEMENTS.campfire.yaw,
  });
  assert.equal(resolveStructureTransform("campfire", undefined, false), null);
});

test("movement footprints rotate with beds and keep shelters enterable between poles", () => {
  const bed = structure("bed", 0, 0, Math.PI / 2);
  assert.equal(isPointBlockedByStructure(bed, 0, -1, 0), true);
  assert.equal(isPointBlockedByStructure(bed, 1, 0, 0), false);

  const shelter = structure("shelter", 0, 0, Math.PI / 2);
  assert.equal(isPointBlockedByStructure(shelter, 0, 0, 0), false);
  assert.equal(isPointBlockedByStructure(shelter, 0, -1.3, 0), true);
});

test("placement envelopes reject occupied ground while allowing a bed under shelter", () => {
  const fire = structure("campfire", 0, 0);
  const beacon = structure("radio-beacon", 1, 0);
  assert.equal(structurePlacementsOverlap(fire, beacon), true);

  const shelter = structure("shelter", 4, 0);
  const bed = structure("bed", 4, 0, Math.PI / 2);
  assert.equal(structurePlacementsOverlap(shelter, bed), false);

  const rackA = structure("smoking-rack", -2, 0);
  const rackB = structure("smoking-rack", -0.4, 0);
  const rackC = structure("smoking-rack", 2, 0);
  assert.equal(structurePlacementsOverlap(rackA, rackB), true);
  assert.equal(structurePlacementsOverlap(rackA, rackC), false);
  assert.equal(isPointBlockedByStructure(rackA, -2, 0, 0), true);
  assert.equal(isPointBlockedByStructure(rackA, -2, 0.8, 0), false);
  assert.equal(
    structurePlacementsOverlap(shelter, structure("smoking-rack", 4, 0)),
    false,
    "working structures can occupy the shelter interior just like the bed",
  );
});

test("renderer shelter coverage uses the same roof-scale boundary as simulation", () => {
  const shelter = structure("shelter", 0, 0);
  assert.equal(
    isWithinStructureRadius(
      { x: SHELTER_COVERAGE_RADIUS - 0.01, z: 0 },
      shelter,
      SHELTER_COVERAGE_RADIUS,
    ),
    true,
  );
  assert.equal(
    isWithinStructureRadius(
      { x: 4, z: 0 },
      shelter,
      SHELTER_COVERAGE_RADIUS,
    ),
    false,
  );
});
