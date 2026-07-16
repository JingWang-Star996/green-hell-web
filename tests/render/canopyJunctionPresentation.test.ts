import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  createCanopyJunctionModel,
  syncCanopyJunctionModel,
} from "../../src/game/render/RainforestRenderer";
import {
  CANOPY_JUNCTION_ID,
  createCanopyJunctionState,
} from "../../src/game/sim/canopyJunction";
import { createInitialState } from "../../src/game/sim/state";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import { createWindFieldState } from "../../src/game/world/windField";

test("C-17 is a raised readable cabinet rather than a rock-sized generic landmark", () => {
  const model = createCanopyJunctionModel();
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  assert.equal(model.name, "canopy-junction-c17-model");
  assert.ok(model.getObjectByName("c17-cabinet"));
  assert.ok(model.getObjectByName("c17-door-pivot"));
  assert.ok(model.getObjectByName("c17-uplink-cable"));
  assert.ok(model.getObjectByName("c17-orange-mark"));
  assert.ok(bounds.max.y > 2.8);
  assert.ok(bounds.max.x - bounds.min.x < 1.2);
  assert.ok(bounds.max.z - bounds.min.z < 0.7);
});

test("C-17 door and signal colors visibly follow the authoritative junction phase", () => {
  const model = createCanopyJunctionModel();
  syncCanopyJunctionModel(model, "connector-open");
  assert.ok(
    Math.abs(
      (model.getObjectByName("c17-door-pivot")?.rotation.y ?? 0) +
        Math.PI * 0.62,
    ) < 1e-6,
  );

  syncCanopyJunctionModel(model, "sampling");
  assert.equal(model.getObjectByName("c17-door-pivot")?.rotation.y, 0);
  const samplingDisplay = model.getObjectByName("c17-display") as THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  >;
  assert.equal(samplingDisplay.material.color.getHex(), 0x75c7bb);

  syncCanopyJunctionModel(model, "sample-ready");
  const readyDisplay = model.getObjectByName("c17-display") as THREE.Mesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  >;
  assert.equal(readyDisplay.material.color.getHex(), 0x7ed58a);
});

test("render snapshot carries one wind truth and identifies the authored C-17 model", () => {
  const state = createInitialState(42);
  state.clock.tick = 1_234;
  state.player.position = { x: 118, y: 0, z: 92 };
  state.world.windField = createWindFieldState(state.seed, state.clock.tick);
  state.world.canopyJunction = {
    ...createCanopyJunctionState(state.clock.tick),
    phase: "exposed",
    clearedObstructionIds: ["resource.tree.canopy-c17-obstruction"],
  };
  const snapshot = createRenderSnapshot(state);
  assert.deepEqual(snapshot.wind, state.world.windField);
  assert.equal(snapshot.canopyJunctionPhase, "exposed");
  assert.equal(
    snapshot.entities.find((entity) => entity.id === CANOPY_JUNCTION_ID)?.kind,
    "canopy-junction",
  );
});
