import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { createDryLeafPileModel } from "../../src/game/render/RainforestRenderer";
import { createInitialState } from "../../src/game/sim";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

test("dry leaf resources project a dedicated tinder category instead of green herb semantics", () => {
  const state = createInitialState("dry-leaf-visual-category");
  const snapshot = createRenderSnapshot(state);

  assert.equal(
    snapshot.entities.find((entity) => entity.id === "resource.dry-leaf.camp-01")
      ?.kind,
    "tinder",
  );
  assert.equal(
    snapshot.entities.find(
      (entity) => entity.id === "resource.medicinal.camp-01",
    )?.kind,
    "herb",
  );
});

test("the tinder model is a low radial leaf pile with readable ribs", () => {
  const model = createDryLeafPileModel();
  model.updateMatrixWorld(true);

  assert.equal(model.name, "dry-leaf-resource-pile");
  assert.equal(
    model.children.filter((child) => child.name === "dry-leaf-fan").length,
    7,
  );
  assert.equal(
    model.children.filter((child) => child.name === "dry-leaf-rib").length,
    3,
  );

  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  assert.ok(size.x > 0.7 || size.z > 0.7, "pile must read from several metres away");
  assert.ok(size.y < 0.5, "pile must stay visibly ground-hugging rather than herb-like");
});
