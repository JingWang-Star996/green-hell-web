import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { SemanticInstanceLayer } from "../../src/game/render/SemanticInstanceLayer";
import type { SemanticRenderState } from "../../src/game/render/types";
import {
  advanceTreeRegrowthState,
  createTreeRegrowthState,
  treeRegrowthDurabilityRatio,
  type TreeRegrowthState,
} from "../../src/game/sim/treeRegrowth";
import { treeRegrowthNextTick } from "../../src/game/sim/treeRegrowthRuntime";
import { chunkRing } from "../../src/game/world/generation";
import {
  generateSemanticChunkPlan,
  type SemanticTreeObject,
} from "../../src/game/world/semanticGeneration";
import {
  buildSemanticChunkRenderPlan,
  type SemanticRenderObject,
} from "../../src/game/world/semanticRenderPlan";

type TreeMeshName =
  | "semantic-tree-trunks"
  | "semantic-tree-crowns"
  | "semantic-tree-stumps";

function instanceDeterminant(
  layer: SemanticInstanceLayer,
  name: TreeMeshName,
  slot: number,
): number {
  const mesh = layer.root.getObjectByName(name);
  assert.ok(mesh instanceof THREE.InstancedMesh, `missing ${name}`);
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(slot, matrix);
  return Math.abs(matrix.determinant());
}

function renderState(
  tree: SemanticTreeObject,
  regrowth: TreeRegrowthState,
): SemanticRenderState {
  const ratio = treeRegrowthDurabilityRatio(regrowth.stage);
  return {
    id: tree.id,
    chunkKey: tree.chunkKey,
    quantity:
      regrowth.stage === "stump"
        ? 0
        : regrowth.stage === "mature"
          ? tree.baselineQuantity
          : Math.max(1, Math.round(tree.baselineQuantity * ratio)),
    nextRegenerationTick: treeRegrowthNextTick(regrowth),
    treeRegrowth: structuredClone(regrowth),
  };
}

test("stump, sapling, young, and mature project readable monotonic tree stages", () => {
  const seed = "tree-regrowth-render-stages";
  const coordinate = chunkRing({ x: 0, z: 0 }, 4).find((candidate) =>
    generateSemanticChunkPlan(seed, candidate).objects.some(
      (object) =>
        object.category === "tree" && object.growthStage === "sapling",
    ),
  );
  assert.ok(coordinate, "fixture needs a chunk with an originally small tree");
  const source = generateSemanticChunkPlan(seed, coordinate);
  const tree = source.objects.find(
    (object): object is SemanticTreeObject =>
      object.category === "tree" && object.growthStage === "sapling",
  );
  assert.ok(tree, "fixture needs an originally small tree");
  const stump = createTreeRegrowthState(seed, tree.id, 0, 10);
  assert.ok(stump);
  const sapling = advanceTreeRegrowthState(stump, stump.schedule.saplingAtTick);
  const young = sapling
    ? advanceTreeRegrowthState(sapling, stump.schedule.youngAtTick)
    : null;
  const mature = young
    ? advanceTreeRegrowthState(young, stump.schedule.matureAtTick)
    : null;
  assert.ok(sapling && young && mature);
  const stages = { stump, sapling, young, mature } as const;

  const expected = {
    stump: { size: "small", lifecycle: "regrowing" },
    sapling: { size: "small", lifecycle: "regrowing" },
    young: { size: "medium", lifecycle: "regrowing" },
    mature: { size: "large", lifecycle: "full" },
  } as const;
  for (const [stage, regrowth] of Object.entries(stages)) {
    const plan = buildSemanticChunkRenderPlan(source, {
      [tree.id]: renderState(tree, regrowth),
    });
    const projected: SemanticRenderObject | undefined = plan.objects.find(
      (object: SemanticRenderObject) => object.id === tree.id,
    );
    assert.ok(projected);
    assert.equal(projected.morphology.growthStage, stage);
    assert.equal(
      projected.morphology.size,
      expected[stage as keyof typeof expected].size,
    );
    assert.equal(
      projected.lifecycle,
      expected[stage as keyof typeof expected].lifecycle,
    );
    assert.equal(projected.interactive, true);
    assert.equal(projected.focusPolicy, "capability");
  }

  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
    maxActiveChunks: 1,
  });
  const determinants = new Map<string, number>();
  let stableSlot: number | undefined;
  let previousRadius = 0;
  for (const [stage, regrowth] of Object.entries(stages)) {
    layer.sync(seed, [coordinate], [renderState(tree, regrowth)]);
    const record = layer.getRecord(tree.id);
    assert.ok(record);
    stableSlot ??= record.instanceIndex;
    assert.equal(record.instanceIndex, stableSlot);
    assert.equal(record.collider?.kind, "circle");
    const radius = record.collider?.kind === "circle" ? record.collider.radius : 0;
    if (stage !== "stump") {
      assert.ok(radius > previousRadius, `${stage} collider must grow`);
      previousRadius = radius;
    }
    const trunk = instanceDeterminant(layer, "semantic-tree-trunks", stableSlot);
    const crown = instanceDeterminant(layer, "semantic-tree-crowns", stableSlot);
    const stumpMesh = instanceDeterminant(layer, "semantic-tree-stumps", stableSlot);
    if (stage === "stump") {
      assert.ok(trunk < 1e-8 && crown < 1e-8);
      assert.ok(stumpMesh > 1e-6);
    } else {
      assert.ok(trunk > 1e-6 && crown > 1e-6);
      assert.ok(stumpMesh < 1e-8);
      determinants.set(stage, trunk);
    }
  }
  assert.ok(determinants.get("sapling")! < determinants.get("young")!);
  assert.ok(determinants.get("young")! < determinants.get("mature")!);
  layer.dispose();
});
