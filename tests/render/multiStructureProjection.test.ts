import assert from "node:assert/strict";
import test from "node:test";

import { createInitialState } from "../../src/game/sim/state";
import type {
  PlacedStructureKind,
  PlacedStructureState,
} from "../../src/game/sim/types";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

function placed(
  id: string,
  kind: PlacedStructureKind,
  x: number,
  z: number,
): PlacedStructureState {
  return {
    id,
    kind,
    position: { x, y: 0, z },
    yaw: 0,
    builtAtTick: 0,
  };
}

test("render projection contains every ordinary structure instance and each fire state", () => {
  const state = createInitialState("multi-structure-render");
  const fireA = placed("fire.a", "campfire", -3, 0);
  fireA.fire = { lit: true, fuelSeconds: 500, rainExposure: 0, sheltered: true };
  const fireB = placed("fire.b", "campfire", 3, 0);
  fireB.fire = { lit: false, fuelSeconds: 80, rainExposure: 0, sheltered: false };
  state.camp.structures = [
    fireA,
    fireB,
    placed("shelter.a", "shelter", -4, 3),
    placed("shelter.b", "shelter", 4, 3),
    placed("bed.a", "bed", -4, 3),
    placed("bed.b", "bed", 4, 3),
  ];
  state.camp.fire = { built: true, ...fireA.fire };
  state.camp.shelterBuilt = true;
  state.camp.bedBuilt = true;

  const snapshot = createRenderSnapshot(state);
  assert.deepEqual(
    snapshot.structures
      .filter(({ kind }) => ["campfire", "shelter", "bed"].includes(kind))
      .map(({ id }) => id)
      .sort(),
    ["bed.a", "bed.b", "fire.a", "fire.b", "shelter.a", "shelter.b"],
  );
  const projectedA = snapshot.structures.find(({ id }) => id === "fire.a");
  const projectedB = snapshot.structures.find(({ id }) => id === "fire.b");
  assert.deepEqual(
    [projectedA?.lit, projectedA?.totalFuelSeconds, projectedA?.sheltered],
    [true, 500, true],
  );
  assert.deepEqual(
    [projectedB?.lit, projectedB?.totalFuelSeconds, projectedB?.sheltered],
    [false, 80, false],
  );
  assert.equal(
    snapshot.entities.filter(({ source, kind }) =>
      source === "structure" && ["campfire", "shelter", "bed"].includes(kind),
    ).length,
    6,
  );
});
