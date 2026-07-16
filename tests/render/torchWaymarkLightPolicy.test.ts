import assert from "node:assert/strict";
import test from "node:test";

import {
  TORCH_WAYMARK_ACTIVE_LIGHT_LIMIT,
  TORCH_WAYMARK_LIGHT_ID_MAX_LENGTH,
  selectTorchWaymarkLightAssignments,
} from "../../src/game/render/torchWaymarkLightPolicy";
import type { TorchWaymarkLightCandidate } from "../../src/game/render/torchWaymarkLightPolicy";

function waymark(
  id: string,
  x: number,
  z: number,
  overrides: Partial<TorchWaymarkLightCandidate> = {},
): TorchWaymarkLightCandidate {
  return {
    id,
    x,
    z,
    lit: true,
    totalFuelSeconds: 120,
    inFrustum: true,
    ...overrides,
  };
}

test("visible waymarks borrow the fixed light pool before nearer offscreen ones", () => {
  const candidates = [
    waymark("offscreen-nearest", 0.1, 0, { inFrustum: false }),
    waymark("visible-far", 12, 0),
    waymark("visible-b", 4, 0),
    waymark("visible-a", 0, 4),
    waymark("offscreen-second", 0.2, 0, { inFrustum: false }),
  ];

  const selected = selectTorchWaymarkLightAssignments(candidates, {
    x: 0,
    z: 0,
  });

  assert.equal(selected.length, TORCH_WAYMARK_ACTIVE_LIGHT_LIMIT);
  assert.deepEqual(
    selected.map(({ id }) => id),
    ["visible-a", "visible-b", "visible-far"],
  );
  assert.strictEqual(selected[0], candidates[3], "selection returns source references");
});

test("80+ valid waymarks remain capped and selection is invariant to input order", () => {
  const candidates = Array.from({ length: 96 }, (_, index) =>
    waymark(
      `waymark-${String(index).padStart(3, "0")}`,
      ((index * 17) % 31) - 15,
      ((index * 29) % 37) - 18,
      { inFrustum: index % 5 !== 0 },
    ),
  );
  const shuffled = [
    ...candidates.filter((_, index) => index % 2 === 1).reverse(),
    ...candidates.filter((_, index) => index % 2 === 0).reverse(),
  ];
  const observer = { x: 2.5, z: -4.25 };

  const orderedSelection = selectTorchWaymarkLightAssignments(
    candidates,
    observer,
  );
  const shuffledSelection = selectTorchWaymarkLightAssignments(
    shuffled,
    observer,
  );

  assert.ok(orderedSelection.length <= TORCH_WAYMARK_ACTIVE_LIGHT_LIMIT);
  assert.deepEqual(
    shuffledSelection.map(({ id }) => id),
    orderedSelection.map(({ id }) => id),
  );
});

test("unlit, empty-fuel, malformed, and duplicate candidates fail closed", () => {
  const valid = waymark("valid", 2, 3);
  const duplicateA = waymark("duplicate", 1, 1);
  const duplicateB = waymark("duplicate", 2, 2);
  const malformed = [
    null,
    waymark("unlit", 0, 0, { lit: false }),
    waymark("empty", 0, 0, { totalFuelSeconds: 0 }),
    waymark("negative", 0, 0, { totalFuelSeconds: -1 }),
    waymark("bad-fuel", 0, 0, { totalFuelSeconds: Number.NaN }),
    waymark("bad-x", Number.POSITIVE_INFINITY, 0),
    waymark("bad-z", 0, Number.NEGATIVE_INFINITY),
    waymark(" ", 0, 0),
    waymark(" padded-id ", 0, 0),
    waymark("x".repeat(TORCH_WAYMARK_LIGHT_ID_MAX_LENGTH + 1), 0, 0),
    { ...waymark("bad-frustum", 0, 0), inFrustum: undefined },
    duplicateA,
    duplicateB,
    valid,
  ] as unknown as TorchWaymarkLightCandidate[];

  const selected = selectTorchWaymarkLightAssignments(malformed, {
    x: 0,
    z: 0,
  });

  assert.deepEqual(selected, [valid]);
  assert.deepEqual(
    selectTorchWaymarkLightAssignments(malformed, { x: Number.NaN, z: 0 }),
    [],
  );
  assert.deepEqual(selectTorchWaymarkLightAssignments(null, { x: 0, z: 0 }), []);
});
