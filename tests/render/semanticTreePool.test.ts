import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  SemanticInstanceLayer,
  type SemanticInstanceRecord,
} from "../../src/game/render/SemanticInstanceLayer";
import type { SemanticRenderState } from "../../src/game/render/types";
import {
  treeInteractionAnchor,
  type TreeGeometrySource,
} from "../../src/game/sim/treeHarvest";
import type { TreeHarvestState } from "../../src/game/sim/types";
import {
  generateSemanticChunkPlan,
  type SemanticTreeObject,
} from "../../src/game/world/semanticGeneration";
import { chunkKey, chunkRing } from "../../src/game/world/generation";

const TREE_MESH_NAMES = [
  "semantic-tree-trunks",
  "semantic-tree-crowns",
  "semantic-tree-stumps",
  "semantic-tree-branch-bundles",
  "semantic-tree-loose-logs",
] as const;

const ALL_POOL_MESH_NAMES = [
  ...TREE_MESH_NAMES,
  "semantic-rock-bodies",
  "semantic-rock-accents",
  "semantic-rock-exhausted-rubble",
] as const;

function treesFor(
  seed: string,
  coordinates: readonly { x: number; z: number }[],
): SemanticTreeObject[] {
  return coordinates.flatMap((coordinate) =>
    generateSemanticChunkPlan(seed, coordinate).objects.filter(
      (object): object is SemanticTreeObject => object.category === "tree",
    ),
  );
}

function sourceFor(
  tree: SemanticTreeObject,
  harvest?: TreeHarvestState,
): TreeGeometrySource {
  return {
    id: tree.id,
    position: {
      x: tree.transform.x,
      y: tree.transform.y,
      z: tree.transform.z,
    },
    quantity: harvest ? 0 : tree.baselineQuantity,
    semantic: {
      category: "tree",
      species: tree.species,
      material: tree.material,
      growthStage: tree.growthStage,
      size: tree.size,
      scale: tree.transform.scale,
    },
    ...(harvest ? { treeHarvest: { ...harvest } } : {}),
  };
}

function stateFor(
  tree: SemanticTreeObject,
  treeHarvest: TreeHarvestState,
): SemanticRenderState {
  return {
    id: tree.id,
    chunkKey: tree.chunkKey,
    quantity: 0,
    nextRegenerationTick: null,
    treeHarvest,
  };
}

function poolMesh(
  layer: SemanticInstanceLayer,
  name: (typeof ALL_POOL_MESH_NAMES)[number],
): THREE.InstancedMesh {
  const mesh = layer.root.getObjectByName(name);
  assert.ok(mesh instanceof THREE.InstancedMesh, `missing ${name}`);
  return mesh;
}

function instanceDeterminant(
  layer: SemanticInstanceLayer,
  name: (typeof TREE_MESH_NAMES)[number],
  slot: number,
): number {
  const matrix = new THREE.Matrix4();
  poolMesh(layer, name).getMatrixAt(slot, matrix);
  return Math.abs(matrix.determinant());
}

function assertTreeVisibility(
  layer: SemanticInstanceLayer,
  slot: number,
  visible: readonly (typeof TREE_MESH_NAMES)[number][],
): void {
  const expected = new Set(visible);
  for (const name of TREE_MESH_NAMES) {
    const determinant = instanceDeterminant(layer, name, slot);
    if (expected.has(name)) {
      assert.ok(determinant > 0.000001, `${name} should be visible`);
    } else {
      assert.ok(determinant < 0.00000001, `${name} should be hidden`);
    }
  }
}

test("one tree slot preserves every felling phase without rebuilding plant or clutter chunks", () => {
  const seed = "semantic-tree-lifecycle-slot";
  const coordinate = { x: 2, z: -3 };
  const trees = treesFor(seed, [coordinate]);
  const tree = trees.find((candidate) => candidate.growthStage !== "sapling");
  assert.ok(tree);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, [coordinate], []);

  const originalMeshes = TREE_MESH_NAMES.map((name) => poolMesh(layer, name));
  const staticChunk = layer.root.getObjectByName(
    `semantic-chunk-${chunkKey(coordinate)}`,
  );
  assert.ok(staticChunk);
  const staticChildren = [...staticChunk.children];
  const rebuilds = layer.getDiagnostics().staticChunkRebuilds;
  const stableSlots = new Map(
    trees.map((candidate) => [
      candidate.id,
      layer.getRecord(candidate.id)!.instanceIndex,
    ]),
  );
  const slot = layer.getRecord(tree.id)!.instanceIndex;

  assertTreeVisibility(layer, slot, [
    "semantic-tree-trunks",
    "semantic-tree-crowns",
  ]);
  assert.equal(layer.getRecord(tree.id)?.collider?.kind, "circle");
  assert.equal(layer.getRecord(tree.id)?.movementBlocking, true);
  assert.deepEqual(
    layer.getRecord(tree.id)?.anchor,
    treeInteractionAnchor(sourceFor(tree)),
  );
  const trunks = poolMesh(layer, "semantic-tree-trunks");
  const baseColor = new THREE.Color();
  const focusedColor = new THREE.Color();
  const restoredColor = new THREE.Color();
  trunks.getColorAt(slot, baseColor);
  layer.setFocus(tree.id, new THREE.Color(0xb5d66f));
  trunks.getColorAt(slot, focusedColor);
  assert.notEqual(focusedColor.getHex(), baseColor.getHex());
  layer.setFocus(null);
  trunks.getColorAt(slot, restoredColor);
  assert.equal(restoredColor.getHex(), baseColor.getHex());

  const phases: Array<{
    harvest: TreeHarvestState;
    visible: readonly (typeof TREE_MESH_NAMES)[number][];
    collider: "circle" | "capsule";
    movementBlocking: boolean;
  }> = [
    {
      harvest: {
        fallDirection: 167,
        branches: 3,
        trunkSegments: 2,
        looseLog: false,
      },
      visible: [
        "semantic-tree-trunks",
        "semantic-tree-crowns",
        "semantic-tree-stumps",
        "semantic-tree-branch-bundles",
      ],
      collider: "capsule",
      movementBlocking: true,
    },
    {
      harvest: {
        fallDirection: 167,
        branches: 0,
        trunkSegments: 2,
        looseLog: false,
      },
      visible: ["semantic-tree-trunks", "semantic-tree-stumps"],
      collider: "capsule",
      movementBlocking: true,
    },
    {
      harvest: {
        fallDirection: 167,
        branches: 0,
        trunkSegments: 1,
        looseLog: true,
      },
      visible: [
        "semantic-tree-trunks",
        "semantic-tree-stumps",
        "semantic-tree-loose-logs",
      ],
      collider: "capsule",
      movementBlocking: true,
    },
    {
      harvest: {
        fallDirection: 167,
        branches: 0,
        trunkSegments: 0,
        looseLog: false,
      },
      visible: ["semantic-tree-stumps"],
      collider: "circle",
      movementBlocking: false,
    },
  ];

  for (const phase of phases) {
    layer.sync(seed, [coordinate], [stateFor(tree, phase.harvest)]);
    const record: SemanticInstanceRecord = layer.getRecord(tree.id)!;
    assert.equal(record.instanceIndex, slot);
    assert.equal(record.lifecycle, "felled");
    assert.equal(record.collider?.kind, phase.collider);
    assert.equal(record.movementBlocking, phase.movementBlocking);
    assert.deepEqual(
      record.anchor,
      treeInteractionAnchor(sourceFor(tree, phase.harvest)),
    );
    assertTreeVisibility(layer, slot, phase.visible);
    const diagnostics = layer.getDiagnostics();
    assert.equal(diagnostics.staticChunkRebuilds, rebuilds);
    assert.equal(diagnostics.treePool.lastSyncSlotWrites, 1);
    assert.equal(
      layer.root.getObjectByName(`semantic-chunk-${chunkKey(coordinate)}`),
      staticChunk,
    );
    assert.equal(staticChunk.children.length, staticChildren.length);
    staticChildren.forEach((child, index) => {
      assert.equal(staticChunk.children[index], child);
    });
    TREE_MESH_NAMES.forEach((name, index) => {
      assert.equal(poolMesh(layer, name), originalMeshes[index]);
    });
    for (const candidate of trees) {
      assert.equal(
        layer.getRecord(candidate.id)?.instanceIndex,
        stableSlots.get(candidate.id),
      );
    }
  }

  layer.dispose();
});

test("tree pool keeps one five-mesh resource set and an id-slot bijection across ten chunks and return travel", () => {
  const seed = "semantic-tree-ten-chunk-return";
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
    maxActiveChunks: 25,
  });
  const originalMeshes = TREE_MESH_NAMES.map((name) => poolMesh(layer, name));
  const centers = [
    ...Array.from({ length: 11 }, (_, x) => ({ x, z: 0 })),
    ...Array.from({ length: 10 }, (_, offset) => ({ x: 9 - offset, z: 0 })),
  ];
  let initialTruth:
    | Map<string, { anchor: unknown; collider: unknown }>
    | undefined;

  for (const [travelIndex, center] of centers.entries()) {
    const coordinates = chunkRing(center, 2);
    const trees = treesFor(seed, coordinates);
    layer.sync(
      seed,
      travelIndex === 5 ? [...coordinates, coordinates[0]!] : coordinates,
      [],
    );
    const diagnostics = layer.getDiagnostics();
    assert.equal(diagnostics.chunks, 25);
    assert.equal(diagnostics.treePool.occupied, trees.length);
    assert.equal(diagnostics.treePool.meshes, 5);
    assert.equal(diagnostics.treePool.meshCreations, 5);
    assert.equal(diagnostics.treePool.overflows, 0);
    assert.ok(diagnostics.treePool.highWater >= diagnostics.treePool.occupied);
    assert.equal(
      diagnostics.treePool.holes,
      diagnostics.treePool.highWater - diagnostics.treePool.occupied,
    );
    assert.equal(
      diagnostics.treePool.submittedInstances,
      diagnostics.treePool.highWater * 5,
    );
    assert.equal(diagnostics.lastSyncPlannedChunks, 25);
    assert.equal(diagnostics.lastSyncPlanGenerations, 25);
    TREE_MESH_NAMES.forEach((name, index) => {
      assert.equal(poolMesh(layer, name), originalMeshes[index]);
    });
    for (const name of TREE_MESH_NAMES) {
      let meshCount = 0;
      layer.root.traverse((object) => {
        if (object.name === name) meshCount += 1;
      });
      assert.equal(meshCount, 1, `${name} must be active-ring global`);
    }

    const ids = new Set<string>();
    const slots = new Set<number>();
    const truth = new Map<string, { anchor: unknown; collider: unknown }>();
    for (const tree of trees) {
      const record = layer.getRecord(tree.id);
      assert.ok(record, `missing pooled tree ${tree.id}`);
      assert.equal(ids.has(record.id), false, `duplicate id ${record.id}`);
      assert.equal(
        slots.has(record.instanceIndex),
        false,
        `duplicate slot ${record.instanceIndex}`,
      );
      ids.add(record.id);
      slots.add(record.instanceIndex);
      assert.deepEqual(record.anchor, treeInteractionAnchor(sourceFor(tree)));
      assert.equal(record.collider?.kind, "circle");
      truth.set(record.id, {
        anchor: record.anchor,
        collider: record.collider,
      });
    }
    assert.equal(ids.size, trees.length);
    assert.equal(slots.size, trees.length);
    if (travelIndex === 0) initialTruth = truth;
    if (travelIndex === centers.length - 1) {
      assert.deepEqual(truth, initialTruth);
    }
  }

  assert.ok(layer.getDiagnostics().treePool.releases > 0);
  layer.dispose();
});

test("tree capacity overflow is atomic for the current and a replacement seed", () => {
  const seed = "semantic-pool-overflow-search";
  const home = { x: -20, z: -20 };
  const homePlan = generateSemanticChunkPlan(seed, home);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
    maxActiveChunks: 1,
  });
  layer.sync(seed, [home], []);

  const rootChildren = [...layer.root.children];
  const records = new Map(
    homePlan.objects.map((object) => [object.id, layer.getRecord(object.id)]),
  );
  const colliders = layer.getColliders();
  const diagnostics = layer.getDiagnostics();
  const meshSnapshot = ALL_POOL_MESH_NAMES.map((name) => {
    const mesh = poolMesh(layer, name);
    return {
      name,
      mesh,
      count: mesh.count,
      matrices: Array.from(mesh.instanceMatrix.array),
      colors: mesh.instanceColor ? Array.from(mesh.instanceColor.array) : null,
    };
  });

  const assertUnchanged = () => {
    assert.deepEqual(layer.getDiagnostics(), diagnostics);
    assert.deepEqual(layer.getColliders(), colliders);
    assert.deepEqual(
      new Map(
        homePlan.objects.map((object) => [
          object.id,
          layer.getRecord(object.id),
        ]),
      ),
      records,
    );
    assert.equal(layer.root.children.length, rootChildren.length);
    rootChildren.forEach((child, index) => {
      assert.equal(layer.root.children[index], child);
    });
    for (const snapshot of meshSnapshot) {
      assert.equal(poolMesh(layer, snapshot.name), snapshot.mesh);
      assert.equal(snapshot.mesh.count, snapshot.count);
      assert.deepEqual(
        Array.from(snapshot.mesh.instanceMatrix.array),
        snapshot.matrices,
      );
      assert.deepEqual(
        snapshot.mesh.instanceColor
          ? Array.from(snapshot.mesh.instanceColor.array)
          : null,
        snapshot.colors,
      );
    }
  };

  const treeCapacity = diagnostics.treePool.capacity;
  const adjacentCoordinates = [home, { x: -20, z: -19 }];
  const adjacentTreeCount = treesFor(seed, adjacentCoordinates).length;
  assert.ok(adjacentTreeCount > treeCapacity);
  assert.throws(
    () => layer.sync(seed, adjacentCoordinates, []),
    new RegExp(
      `tree pool capacity ${treeCapacity} cannot hold ${adjacentTreeCount}`,
    ),
  );
  assertUnchanged();
  const replacementCoordinates = chunkRing(home, 2);
  const replacementTreeCount = treesFor(
    "semantic-tree-overflow-other-seed",
    replacementCoordinates,
  ).length;
  assert.ok(replacementTreeCount > treeCapacity);
  assert.throws(
    () =>
      layer.sync(
        "semantic-tree-overflow-other-seed",
        replacementCoordinates,
        [],
      ),
    new RegExp(
      `tree pool capacity ${treeCapacity} cannot hold ${replacementTreeCount}`,
    ),
  );
  assertUnchanged();
  layer.dispose();
});

test("an old tree impact callback cannot recolor a reused id-slot generation", async () => {
  const seed = "semantic-tree-impact-generation";
  const home = { x: 0, z: 0 };
  const away = { x: 30, z: 30 };
  const homeTree = treesFor(seed, [home]).sort((left, right) =>
    left.id.localeCompare(right.id),
  )[0];
  assert.ok(homeTree);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, [home], []);
  const firstSlot = layer.getRecord(homeTree.id)!.instanceIndex;
  layer.playImpact(homeTree.id);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));
  layer.sync(seed, [away], []);
  layer.sync(seed, [home], []);
  assert.equal(layer.getRecord(homeTree.id)?.instanceIndex, firstSlot);
  layer.playImpact(homeTree.id);

  const trunks = poolMesh(layer, "semantic-tree-trunks");
  const newerImpact = new THREE.Color();
  trunks.getColorAt(firstSlot, newerImpact);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 105));
  const afterOldCallback = new THREE.Color();
  trunks.getColorAt(firstSlot, afterOldCallback);
  assert.equal(afterOldCallback.getHex(), newerImpact.getHex());
  await new Promise((resolve) => globalThis.setTimeout(resolve, 90));
  const afterNewCallback = new THREE.Color();
  trunks.getColorAt(firstSlot, afterNewCallback);
  assert.notEqual(afterNewCallback.getHex(), newerImpact.getHex());
  layer.dispose();
});
