import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { SemanticInstanceLayer } from "../../src/game/render/SemanticInstanceLayer";
import {
  isPointBlocked,
  renderTreeCollider,
} from "../../src/game/render/interactionGeometry";
import type { SemanticRenderState } from "../../src/game/render/types";
import { generateSemanticChunkPlan } from "../../src/game/world/semanticGeneration";

function instancedDrawCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) count += 1;
  });
  return count;
}

test("felled trees use fixed active-ring instance pools and capsule collision", () => {
  const seed = "tree-felling-instance-pool";
  const coordinates = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 0, z: 1 },
    { x: 1, z: 1 },
    { x: -1, z: 1 },
  ];
  const trees = coordinates.flatMap((coordinate) =>
    generateSemanticChunkPlan(seed, coordinate).objects.filter(
      (object) => object.category === "tree",
    ),
  );
  assert.ok(trees.length >= 30);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, coordinates, []);
  const drawPoolsBefore = instancedDrawCount(layer.root);
  const states: SemanticRenderState[] = trees.slice(0, 30).map((tree, index) => ({
    id: tree.id,
    chunkKey: tree.chunkKey,
    quantity: 0,
    nextRegenerationTick: null,
    treeHarvest: {
      fallDirection: (index * 37) % 1024,
      branches: 2,
      trunkSegments: 1,
      looseLog: false,
    },
  }));
  layer.sync(seed, coordinates, states);
  assert.equal(instancedDrawCount(layer.root), drawPoolsBefore);
  for (const tree of trees.slice(0, 30)) {
    const record = layer.getRecord(tree.id)!;
    assert.equal(record.lifecycle, "felled");
    assert.equal(record.collider?.kind, "capsule");
  }
  layer.dispose();
});

test("authored fallen trunks and processed stumps share physical collider truth", () => {
  const fallen = renderTreeCollider({
    x: 8,
    z: 6,
    available: true,
    treeHarvest: {
      fallDirection: 0,
      branches: 2,
      trunkSegments: 1,
      looseLog: false,
    },
  });
  assert.equal(fallen.kind, "capsule");
  assert.equal(isPointBlocked(fallen, 10.4, 6), true);
  assert.equal(isPointBlocked(fallen, 8, 8), false);

  const stump = renderTreeCollider({ x: 8, z: 6, available: false });
  assert.equal(stump.kind, "circle");
  assert.equal(isPointBlocked(stump, 8, 6, 0), true);
  assert.equal(isPointBlocked(stump, 9, 6, 0), false);
});
