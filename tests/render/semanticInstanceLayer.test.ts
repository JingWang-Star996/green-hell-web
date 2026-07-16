import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { SemanticInstanceLayer } from "../../src/game/render/SemanticInstanceLayer";
import { generateSemanticChunkPlan } from "../../src/game/world/semanticGeneration";
import { rockInteractionGeometry } from "../../src/game/sim/rockHarvest";
import { chunkKey, chunkRing } from "../../src/game/world/generation";

test("plantain and ambient foliage use different batched silhouettes and focus contracts", () => {
  const seed = "plantain-depth-fill-render";
  const coordinate = chunkRing({ x: 0, z: 0 }, 4).find((candidate) => {
    const objects = generateSemanticChunkPlan(seed, candidate).objects;
    return (
      objects.some(
        (object) =>
          object.category === "harvestable-plant" &&
          object.species === "wild-plantain",
      ) && objects.some((object) => object.category === "ambient-foliage")
    );
  });
  assert.ok(coordinate);
  const source = generateSemanticChunkPlan(seed, coordinate);
  const plantain = source.objects.find(
    (object) =>
      object.category === "harvestable-plant" &&
      object.species === "wild-plantain",
  );
  const ambient = source.objects.find(
    (object) => object.category === "ambient-foliage",
  );
  assert.ok(plantain && ambient);

  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, [coordinate], []);
  const plantainMesh = layer.root.getObjectByName("semantic-wild-plantains");
  const ambientMesh = layer.root.getObjectByName("semantic-ambient-foliage");
  assert.ok(plantainMesh instanceof THREE.InstancedMesh);
  assert.ok(ambientMesh instanceof THREE.InstancedMesh);
  assert.ok(
    (plantainMesh.geometry.getAttribute("position")?.count ?? 0) > 80,
  );
  assert.equal(layer.getRecord(plantain.id)?.focusPolicy, "capability");
  assert.equal(layer.getRecord(plantain.id)?.interactive, true);
  assert.equal(layer.getRecord(ambient.id)?.focusPolicy, "never-focus");
  assert.equal(layer.getRecord(ambient.id)?.interactive, false);
  assert.equal(ambientMesh.userData.selectionPolicy, "never-focus");
  layer.dispose();
});

test("semantic instance registry has exactly one visual identity per source object", () => {
  const seed = "semantic-instance-registry";
  const coordinates = [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 0, z: 1 },
  ];
  const source = coordinates.flatMap(
    (coordinate) => generateSemanticChunkPlan(seed, coordinate).objects,
  );
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, coordinates, []);

  const diagnostics = layer.getDiagnostics();
  assert.equal(diagnostics.chunks, coordinates.length);
  assert.equal(diagnostics.instances, source.length);
  assert.equal(
    diagnostics.interactiveInstances,
    source.filter((object) => object.interactive).length,
  );
  for (const object of source) {
    const record = layer.getRecord(object.id);
    assert.ok(record, `missing semantic instance ${object.id}`);
    assert.equal(record?.chunkKey, object.chunkKey);
    assert.equal(
      record?.focusPolicy,
      object.interactive ? "capability" : "never-focus",
    );
  }

  layer.sync(seed, coordinates, []);
  const repeated = layer.getDiagnostics();
  assert.deepEqual(
    {
      chunks: repeated.chunks,
      instances: repeated.instances,
      interactiveInstances: repeated.interactiveInstances,
      colliders: repeated.colliders,
      staticChunkRebuilds: repeated.staticChunkRebuilds,
      treePoolCapacity: repeated.treePool.capacity,
      treePoolOccupied: repeated.treePool.occupied,
      treePoolMeshes: repeated.treePool.meshes,
      treePoolSlotWrites: repeated.treePool.slotWrites,
      rockPoolCapacity: repeated.rockPool.capacity,
      rockPoolOccupied: repeated.rockPool.occupied,
      rockPoolMeshes: repeated.rockPool.meshes,
      rockPoolSlotWrites: repeated.rockPool.slotWrites,
      lastSyncPlannedChunks: repeated.lastSyncPlannedChunks,
      lastSyncPlanGenerations: repeated.lastSyncPlanGenerations,
    },
    {
      chunks: diagnostics.chunks,
      instances: diagnostics.instances,
      interactiveInstances: diagnostics.interactiveInstances,
      colliders: diagnostics.colliders,
      staticChunkRebuilds: diagnostics.staticChunkRebuilds,
      treePoolCapacity: diagnostics.treePool.capacity,
      treePoolOccupied: diagnostics.treePool.occupied,
      treePoolMeshes: diagnostics.treePool.meshes,
      treePoolSlotWrites: diagnostics.treePool.slotWrites,
      rockPoolCapacity: diagnostics.rockPool.capacity,
      rockPoolOccupied: diagnostics.rockPool.occupied,
      rockPoolMeshes: diagnostics.rockPool.meshes,
      rockPoolSlotWrites: diagnostics.rockPool.slotWrites,
      lastSyncPlannedChunks: diagnostics.lastSyncPlannedChunks,
      lastSyncPlanGenerations: diagnostics.lastSyncPlanGenerations,
    },
  );
  assert.equal(repeated.treePool.lastSyncSlotWrites, 0);
  assert.equal(repeated.rockPool.lastSyncSlotWrites, 0);
  layer.dispose();
});

test("depleted lifecycle changes the same record and removes its solid collider", () => {
  const seed = "semantic-instance-lifecycle";
  const coordinate = { x: 3, z: -2 };
  const source = generateSemanticChunkPlan(seed, coordinate);
  const rock = source.objects.find(
    (object) =>
      object.category === "mineable-rock" && object.baselineQuantity > 1,
  );
  assert.ok(rock && rock.interactive);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, [coordinate], []);
  assert.equal(layer.getRecord(rock.id)?.lifecycle, "full");
  assert.ok(layer.getRecord(rock.id)?.collider);
  assert.deepEqual(
    layer.getRecord(rock.id)?.anchor,
    rockInteractionGeometry(rock).anchor,
  );

  layer.sync(seed, [coordinate], [
    {
      id: rock.id,
      chunkKey: source.chunkKey,
      quantity: Math.max(1, rock.baselineQuantity - 1),
      nextRegenerationTick: null,
    },
  ]);
  assert.equal(layer.getRecord(rock.id)?.lifecycle, "partial");
  const partialCollider = layer.getRecord(rock.id)?.collider;
  assert.equal(
    partialCollider?.kind === "circle"
      ? partialCollider.radius
      : null,
    rockInteractionGeometry(rock).colliderRadius,
  );

  layer.sync(seed, [coordinate], [
    {
      id: rock.id,
      chunkKey: source.chunkKey,
      quantity: 0,
      nextRegenerationTick: null,
    },
  ]);
  assert.equal(layer.getRecord(rock.id)?.lifecycle, "depleted");
  assert.equal(layer.getRecord(rock.id)?.collider, undefined);
  assert.equal(layer.getRecord(rock.id)?.interactive, false);
  assert.equal(layer.getRecord(rock.id)?.focusPolicy, "never-focus");
  layer.dispose();
});

test("low detail may reduce only ambient clutter, never interactive identities", () => {
  const seed = "semantic-instance-low-detail";
  const coordinate = { x: -6, z: 7 };
  const standard = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  const low = new SemanticInstanceLayer({
    detail: "low",
    shadows: false,
    terrainHeight: () => 0,
  });
  standard.sync(seed, [coordinate], []);
  low.sync(seed, [coordinate], []);

  assert.equal(
    low.getDiagnostics().interactiveInstances,
    standard.getDiagnostics().interactiveInstances,
  );
  assert.ok(low.getDiagnostics().instances <= standard.getDiagnostics().instances);
  standard.dispose();
  low.dispose();
});

test("rock body, accent and exhausted rubble stay in three fixed instance pools", () => {
  const seed = "semantic-rock-fixed-pools";
  const coordinate = { x: 2, z: 3 };
  const source = generateSemanticChunkPlan(seed, coordinate);
  const rock = source.objects.find(
    (object) =>
      object.category === "mineable-rock" && object.baselineQuantity > 1,
  );
  assert.ok(rock && rock.category === "mineable-rock");
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  const names = [
    "semantic-rock-bodies",
    "semantic-rock-accents",
    "semantic-rock-exhausted-rubble",
  ] as const;
  const matrix = new THREE.Matrix4();
  const determinant = (name: (typeof names)[number], instanceIndex: number) => {
    const mesh = layer.root.getObjectByName(name);
    assert.ok(mesh instanceof THREE.InstancedMesh, `missing ${name}`);
    mesh.getMatrixAt(instanceIndex, matrix);
    return Math.abs(matrix.determinant());
  };
  const assertFixedPools = () => {
    for (const name of names) {
      let count = 0;
      layer.root.traverse((object) => {
        if (object.name === name) count += 1;
      });
      assert.equal(count, 1, `${name} must remain one pool per chunk`);
    }
  };

  layer.sync(seed, [coordinate], []);
  assertFixedPools();
  const record = layer.getRecord(rock.id);
  assert.ok(record);
  const fullBody = determinant("semantic-rock-bodies", record.instanceIndex);
  const hiddenRubble = determinant(
    "semantic-rock-exhausted-rubble",
    record.instanceIndex * 3,
  );
  assert.ok(fullBody > 0.001);
  assert.ok(hiddenRubble < 0.00000001);

  layer.sync(seed, [coordinate], [
    {
      id: rock.id,
      chunkKey: source.chunkKey,
      quantity: rock.baselineQuantity - 1,
      nextRegenerationTick: null,
    },
  ]);
  assertFixedPools();
  const partialBody = determinant(
    "semantic-rock-bodies",
    layer.getRecord(rock.id)!.instanceIndex,
  );
  assert.ok(partialBody > 0.001 && partialBody < fullBody);
  assert.ok(
    determinant(
      "semantic-rock-accents",
      layer.getRecord(rock.id)!.instanceIndex * 2,
    ) > 0.000001,
  );

  layer.sync(seed, [coordinate], [
    {
      id: rock.id,
      chunkKey: source.chunkKey,
      quantity: 0,
      nextRegenerationTick: null,
    },
  ]);
  assertFixedPools();
  const exhaustedIndex = layer.getRecord(rock.id)!.instanceIndex;
  assert.ok(
    determinant("semantic-rock-bodies", exhaustedIndex) < 0.00000001,
  );
  assert.ok(
    determinant("semantic-rock-exhausted-rubble", exhaustedIndex * 3) >
      0.000001,
  );
  assert.equal(layer.getRecord(rock.id)?.collider, undefined);
  assert.equal(layer.getRecord(rock.id)?.focusPolicy, "never-focus");
  layer.dispose();
});

test("non-pebble micro clutter keeps one visible ground-cover instance", () => {
  const seed = "semantic-ground-cover-preserved";
  const coordinate = { x: 0, z: 0 };
  const source = generateSemanticChunkPlan(seed, coordinate);
  const groundCover = source.objects.find(
    (object) =>
      object.category === "micro-clutter" &&
      !object.visualVariant.startsWith("pebble"),
  );
  assert.ok(groundCover);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, [coordinate], []);
  const record = layer.getRecord(groundCover.id);
  const mesh = layer.root.getObjectByName("semantic-micro-clutter");
  assert.ok(record);
  assert.ok(mesh instanceof THREE.InstancedMesh);
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(record.instanceIndex * 5, matrix);
  assert.ok(Math.abs(matrix.determinant()) > 0.00001);
  mesh.getMatrixAt(record.instanceIndex * 5 + 1, matrix);
  assert.ok(Math.abs(matrix.determinant()) < 0.00000001);
  layer.dispose();
});

test("one rock lifecycle change updates one stable pool slot without rebuilding its chunk", () => {
  const seed = "semantic-rock-single-slot-update";
  const coordinate = { x: 4, z: -1 };
  const source = generateSemanticChunkPlan(seed, coordinate);
  const rocks = source.objects.filter(
    (object) => object.category === "mineable-rock",
  );
  const rock = rocks.find((object) => object.baselineQuantity > 1);
  assert.ok(rock);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, [coordinate], []);

  const chunk = layer.root.getObjectByName(
    `semantic-chunk-${chunkKey(coordinate)}`,
  );
  assert.ok(chunk);
  const poolMeshes = [
    layer.root.getObjectByName("semantic-rock-bodies"),
    layer.root.getObjectByName("semantic-rock-accents"),
    layer.root.getObjectByName("semantic-rock-exhausted-rubble"),
  ];
  assert.ok(poolMeshes.every((mesh) => mesh instanceof THREE.InstancedMesh));
  const stableSlots = new Map(
    rocks.map((object) => [object.id, layer.getRecord(object.id)!.instanceIndex]),
  );
  const full = layer.getRecord(rock.id)!;
  const fullColliderCount = layer.getDiagnostics().colliders;
  const rebuilds = layer.getDiagnostics().staticChunkRebuilds;

  layer.sync(seed, [coordinate], [
    {
      id: rock.id,
      chunkKey: source.chunkKey,
      quantity: rock.baselineQuantity - 1,
      nextRegenerationTick: null,
    },
  ]);
  const partial = layer.getRecord(rock.id)!;
  assert.equal(partial.instanceIndex, full.instanceIndex);
  assert.deepEqual(partial.collider, {
    kind: "circle",
    x: rockInteractionGeometry(rock).anchor.x,
    z: rockInteractionGeometry(rock).anchor.z,
    radius: rockInteractionGeometry(rock).colliderRadius,
  });
  assert.equal(layer.getDiagnostics().staticChunkRebuilds, rebuilds);
  assert.equal(layer.getDiagnostics().rockPool.lastSyncSlotWrites, 1);
  assert.equal(
    layer.root.getObjectByName(`semantic-chunk-${chunkKey(coordinate)}`),
    chunk,
  );
  assert.deepEqual(
    poolMeshes,
    [
      layer.root.getObjectByName("semantic-rock-bodies"),
      layer.root.getObjectByName("semantic-rock-accents"),
      layer.root.getObjectByName("semantic-rock-exhausted-rubble"),
    ],
  );
  for (const object of rocks) {
    assert.equal(
      layer.getRecord(object.id)?.instanceIndex,
      stableSlots.get(object.id),
    );
  }

  layer.sync(seed, [coordinate], [
    {
      id: rock.id,
      chunkKey: source.chunkKey,
      quantity: 0,
      nextRegenerationTick: null,
    },
  ]);
  const exhausted = layer.getRecord(rock.id)!;
  assert.equal(exhausted.instanceIndex, full.instanceIndex);
  assert.equal(exhausted.collider, undefined);
  assert.equal(exhausted.interactive, false);
  assert.equal(exhausted.focusPolicy, "never-focus");
  assert.equal(layer.getDiagnostics().colliders, fullColliderCount - 1);
  assert.equal(layer.getDiagnostics().staticChunkRebuilds, rebuilds);
  assert.equal(layer.getDiagnostics().rockPool.lastSyncSlotWrites, 1);
  layer.dispose();
});

test("fixed rock pools preserve an id-slot bijection through ten chunks and return travel", () => {
  const seed = "semantic-rock-ten-chunk-return";
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
    maxActiveChunks: 25,
  });
  const names = [
    "semantic-rock-bodies",
    "semantic-rock-accents",
    "semantic-rock-exhausted-rubble",
  ] as const;
  const originalMeshes = names.map((name) => layer.root.getObjectByName(name));
  assert.ok(
    originalMeshes.every((mesh) => mesh instanceof THREE.InstancedMesh),
  );
  const centers = [
    ...Array.from({ length: 11 }, (_, x) => ({ x, z: 0 })),
    ...Array.from({ length: 10 }, (_, offset) => ({ x: 9 - offset, z: 0 })),
  ];
  let initialRockTruth:
    | Map<string, { anchor: unknown; collider: unknown }>
    | undefined;

  for (const [travelIndex, center] of centers.entries()) {
    const coordinates = chunkRing(center, 2);
    const rocks = coordinates.flatMap((coordinate) =>
      generateSemanticChunkPlan(seed, coordinate).objects.filter(
        (object) => object.category === "mineable-rock",
      ),
    );
    // A duplicated streaming coordinate must not duplicate identities or
    // consume extra fixed slots.
    layer.sync(
      seed,
      travelIndex === 5 ? [...coordinates, coordinates[0]!] : coordinates,
      [],
    );
    const diagnostics = layer.getDiagnostics();
    assert.equal(diagnostics.chunks, 25);
    assert.equal(diagnostics.rockPool.occupied, rocks.length);
    assert.equal(diagnostics.rockPool.meshes, 3);
    assert.equal(diagnostics.rockPool.meshCreations, 3);
    assert.equal(diagnostics.rockPool.overflows, 0);
    assert.ok(diagnostics.rockPool.highWater >= diagnostics.rockPool.occupied);
    assert.equal(
      diagnostics.rockPool.holes,
      diagnostics.rockPool.highWater - diagnostics.rockPool.occupied,
    );
    assert.equal(
      diagnostics.rockPool.submittedInstances,
      diagnostics.rockPool.highWater * 6,
    );
    assert.equal(diagnostics.lastSyncPlannedChunks, 25);
    assert.equal(diagnostics.lastSyncPlanGenerations, 25);
    assert.deepEqual(
      names.map((name) => layer.root.getObjectByName(name)),
      originalMeshes,
    );
    for (const name of names) {
      let meshCount = 0;
      layer.root.traverse((object) => {
        if (object.name === name) meshCount += 1;
      });
      assert.equal(meshCount, 1, `${name} must be global, not per chunk`);
    }

    const ids = new Set<string>();
    const slots = new Set<number>();
    const truth = new Map<string, { anchor: unknown; collider: unknown }>();
    for (const rock of rocks) {
      const record = layer.getRecord(rock.id);
      assert.ok(record, `missing pooled rock ${rock.id}`);
      assert.equal(ids.has(record.id), false, `duplicate id ${record.id}`);
      assert.equal(
        slots.has(record.instanceIndex),
        false,
        `duplicate slot ${record.instanceIndex}`,
      );
      ids.add(record.id);
      slots.add(record.instanceIndex);
      const geometry = rockInteractionGeometry(rock);
      assert.deepEqual(record.anchor, geometry.anchor);
      assert.deepEqual(record.collider, {
        kind: "circle",
        x: geometry.anchor.x,
        z: geometry.anchor.z,
        radius: geometry.colliderRadius,
      });
      truth.set(record.id, {
        anchor: record.anchor,
        collider: record.collider,
      });
    }
    assert.equal(ids.size, rocks.length);
    assert.equal(slots.size, rocks.length);
    if (travelIndex === 0) initialRockTruth = truth;
    if (travelIndex === centers.length - 1) {
      assert.deepEqual(truth, initialRockTruth);
    }
  }

  const diagnostics = layer.getDiagnostics();
  assert.ok(diagnostics.rockPool.releases > 0);
  assert.ok(diagnostics.staticChunkRebuilds > diagnostics.chunks);
  layer.dispose();
});

test("rock capacity overflow leaves both pooled and static snapshots atomic", () => {
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
  const homeChunk = layer.root.getObjectByName(
    `semantic-chunk-${chunkKey(home)}`,
  );
  assert.ok(homeChunk);
  const rootChildren = [...layer.root.children];
  const recordSnapshot = new Map(
    homePlan.objects.map((object) => [object.id, layer.getRecord(object.id)]),
  );
  const colliderSnapshot = layer.getColliders();
  const diagnosticSnapshot = layer.getDiagnostics();
  const poolMeshes = [
    layer.root.getObjectByName("semantic-tree-trunks"),
    layer.root.getObjectByName("semantic-tree-crowns"),
    layer.root.getObjectByName("semantic-tree-stumps"),
    layer.root.getObjectByName("semantic-tree-branch-bundles"),
    layer.root.getObjectByName("semantic-tree-loose-logs"),
    layer.root.getObjectByName("semantic-rock-bodies"),
    layer.root.getObjectByName("semantic-rock-accents"),
    layer.root.getObjectByName("semantic-rock-exhausted-rubble"),
  ];
  assert.ok(poolMeshes.every((mesh) => mesh instanceof THREE.InstancedMesh));
  const poolSnapshot = poolMeshes.map((object) => {
    const mesh = object as THREE.InstancedMesh;
    return {
      count: mesh.count,
      matrices: Array.from(mesh.instanceMatrix.array),
      colors: mesh.instanceColor
        ? Array.from(mesh.instanceColor.array)
        : null,
    };
  });

  const assertCommittedSnapshotUnchanged = () => {
    assert.deepEqual(layer.getDiagnostics(), diagnosticSnapshot);
    assert.deepEqual(layer.getColliders(), colliderSnapshot);
    assert.deepEqual(
      new Map(
        homePlan.objects.map((object) => [
          object.id,
          layer.getRecord(object.id),
        ]),
      ),
      recordSnapshot,
    );
    assert.equal(
      layer.root.getObjectByName(`semantic-chunk-${chunkKey(home)}`),
      homeChunk,
    );
    assert.equal(layer.root.children.length, rootChildren.length);
    rootChildren.forEach((child, index) => {
      assert.equal(layer.root.children[index], child);
    });
    assert.deepEqual(
      poolMeshes.map((object) => {
        const mesh = object as THREE.InstancedMesh;
        return {
          count: mesh.count,
          matrices: Array.from(mesh.instanceMatrix.array),
          colors: mesh.instanceColor
            ? Array.from(mesh.instanceColor.array)
            : null,
        };
      }),
      poolSnapshot,
    );
  };

  // This pair has 15 trees (within 17) but 18 rocks (over 16), so the rock
  // preflight itself is covered without tree capacity masking it.
  const oversized = [home, { x: -20, z: -6 }];
  assert.throws(
    () => layer.sync(seed, oversized, []),
    /rock pool capacity 16 cannot hold 18/,
  );
  assertCommittedSnapshotUnchanged();
  // A rejected new seed must not clear the already committed old world.
  assert.throws(
    () =>
      layer.sync(
        "semantic-rock-overflow-other-seed",
        chunkRing(home, 2),
        [],
      ),
    /pool capacity/,
  );
  assertCommittedSnapshotUnchanged();

  // The normal path deduplicates before planning and preserves every ID.
  layer.sync(seed, [home, home, home], []);
  assert.equal(layer.getDiagnostics().lastSyncPlannedChunks, 1);
  assert.equal(layer.getDiagnostics().lastSyncPlanGenerations, 1);
  assert.equal(
    layer.getDiagnostics().staticChunkRebuilds,
    diagnosticSnapshot.staticChunkRebuilds,
  );
  for (const object of homePlan.objects) {
    assert.deepEqual(layer.getRecord(object.id), recordSnapshot.get(object.id));
  }
  layer.dispose();
});

test("an old impact callback cannot recolor a slot reused by the same id generation", async () => {
  const seed = "semantic-rock-impact-generation";
  const home = { x: 0, z: 0 };
  const away = { x: 30, z: 30 };
  const homeRock = generateSemanticChunkPlan(seed, home).objects.find(
    (object) => object.category === "mineable-rock",
  );
  assert.ok(homeRock);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(seed, [home], []);
  layer.playImpact(homeRock.id);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 80));
  layer.sync(seed, [away], []);
  layer.sync(seed, [home], []);
  layer.playImpact(homeRock.id);

  const record = layer.getRecord(homeRock.id)!;
  const bodies = layer.root.getObjectByName("semantic-rock-bodies");
  assert.ok(bodies instanceof THREE.InstancedMesh);
  const newerImpact = new THREE.Color();
  bodies.getColorAt(record.instanceIndex, newerImpact);
  // The first callback has fired, but the newer impact still owns this
  // generation/token and must retain its highlight.
  await new Promise((resolve) => globalThis.setTimeout(resolve, 105));
  const afterOldCallback = new THREE.Color();
  bodies.getColorAt(record.instanceIndex, afterOldCallback);
  assert.equal(afterOldCallback.getHex(), newerImpact.getHex());
  await new Promise((resolve) => globalThis.setTimeout(resolve, 90));
  const afterNewCallback = new THREE.Color();
  bodies.getColorAt(record.instanceIndex, afterNewCallback);
  assert.notEqual(afterNewCallback.getHex(), newerImpact.getHex());
  layer.dispose();
});
