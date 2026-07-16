import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  TORCH_WAYMARK_LAYER_CAPACITY,
  TorchWaymarkLayer,
  type TorchWaymarkVisualInput,
} from "../../src/game/render/TorchWaymarkLayer";
import { TORCH_WAYMARK_LAYOUT } from "../../src/game/sim/structureGeometry";

function waymark(
  id: string,
  x: number,
  z: number,
  overrides: Partial<TorchWaymarkVisualInput> = {},
): TorchWaymarkVisualInput {
  return {
    id,
    x,
    y: 0.4,
    z,
    yaw: 0.2,
    lit: true,
    totalFuelSeconds: 240,
    slotCount: 1,
    ...overrides,
  };
}

function sceneResources(root: THREE.Object3D) {
  const meshes: THREE.InstancedMesh[] = [];
  const lights: THREE.PointLight[] = [];
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) {
      meshes.push(object);
      geometries.add(object.geometry);
      const source = Array.isArray(object.material)
        ? object.material
        : [object.material];
      source.forEach((material) => materials.add(material));
    }
    if (object instanceof THREE.PointLight) lights.push(object);
  });
  return { meshes, lights, geometries, materials };
}

test("80/96 waymarks reuse one fixed low-poly instance and light pool", () => {
  const layer = new TorchWaymarkLayer();
  const original = sceneResources(layer.root);
  const originalChildren = [...layer.root.children];
  const originalMatrixArrays = original.meshes.map(
    (mesh) => mesh.instanceMatrix.array,
  );
  const eighty = Array.from({ length: 80 }, (_, index) =>
    waymark(
      `waymark-${String(index).padStart(3, "0")}`,
      (index % 10) * 2,
      Math.floor(index / 10) * 2,
      { slotCount: index % 3 === 0 ? 2 : 1 },
    ),
  );

  layer.sync(eighty, { x: 4, z: 3 });
  const first = layer.getDiagnostics();
  assert.deepEqual(
    {
      capacity: first.capacity,
      activeWaymarks: first.activeWaymarks,
      meshes: first.instancedMeshObjects,
      geometries: first.geometryObjects,
      materials: first.materialObjects,
      lights: first.lightObjectCount,
      activeLights: first.activeLightCount,
    },
    {
      capacity: 128,
      activeWaymarks: 80,
      meshes: 7,
      geometries: 4,
      materials: 5,
      lights: 3,
      activeLights: 3,
    },
  );
  assert.equal(TORCH_WAYMARK_LAYER_CAPACITY, 128);
  assert.equal(original.meshes.length, 7);
  assert.equal(original.lights.length, 3);
  assert.ok(original.lights.every((light) => light.castShadow === false));

  const ninetySix = Array.from({ length: 96 }, (_, index) =>
    waymark(
      `stress-${String(index).padStart(3, "0")}`,
      ((index * 17) % 31) - 15,
      ((index * 29) % 37) - 18,
      { lit: index % 7 !== 0 },
    ),
  );
  for (let repeat = 0; repeat < 8; repeat += 1) {
    layer.sync(repeat % 2 ? [...ninetySix].reverse() : ninetySix, {
      x: 2.5,
      z: -4.25,
    });
  }

  const after = sceneResources(layer.root);
  assert.deepEqual(layer.root.children, originalChildren);
  assert.deepEqual(after.meshes, original.meshes);
  assert.deepEqual(after.lights, original.lights);
  assert.deepEqual([...after.geometries], [...original.geometries]);
  assert.deepEqual([...after.materials], [...original.materials]);
  assert.deepEqual(
    after.meshes.map((mesh) => mesh.instanceMatrix.array),
    originalMatrixArrays,
  );
  assert.equal(layer.getDiagnostics().activeWaymarks, 96);
  assert.equal(layer.getDiagnostics().activeLightCount, 3);
});

test("formal silhouette follows the shared pole-height and stone-base contract", () => {
  const layer = new TorchWaymarkLayer();
  layer.sync(
    [
      waymark("layout", 0, 0, {
        y: 0,
        yaw: 0,
        lit: false,
        totalFuelSeconds: 0,
        slotCount: 0,
      }),
    ],
    { x: 0, z: 0 },
  );
  const pole = layer.root.getObjectByName(
    "torch-waymark-poles",
  ) as THREE.InstancedMesh;
  const stones = layer.root.getObjectByName(
    "torch-waymark-stone-base",
  ) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  pole.getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  assert.ok(Math.abs(position.y - TORCH_WAYMARK_LAYOUT.poleHeight / 2) < 1e-6);
  assert.ok(Math.abs(scale.y - TORCH_WAYMARK_LAYOUT.poleHeight) < 1e-6);

  stones.getMatrixAt(0, matrix);
  matrix.decompose(position, quaternion, scale);
  assert.ok(
    Math.abs(position.x - -0.39 * TORCH_WAYMARK_LAYOUT.stoneBaseRadius) < 1e-6,
  );
  assert.ok(
    Math.abs(scale.x - 0.59 * TORCH_WAYMARK_LAYOUT.stoneBaseRadius) < 1e-6,
  );
  layer.dispose();
});

test("visible nearest authoritative fires bind stably to no more than three reused lights", () => {
  const layer = new TorchWaymarkLayer();
  const lights = sceneResources(layer.root).lights;
  const source = [
    waymark("offscreen-near", 0.1, 0),
    waymark("visible-far", 12, 0),
    waymark("visible-b", 4, 0),
    waymark("visible-a", 0, 4),
    waymark("unlit", 0.01, 0, { lit: false }),
  ];
  const predicate = (entry: TorchWaymarkVisualInput) =>
    entry.id !== "offscreen-near";

  layer.sync(source, { x: 0, z: 0 }, predicate);
  const ordered = layer.getDiagnostics().lightIds;
  assert.deepEqual(ordered, ["visible-a", "visible-b", "visible-far"]);
  assert.equal(layer.getDiagnostics().activeLightCount, 3);
  assert.deepEqual(
    lights.map((light) => light.userData.waymarkId),
    ordered,
  );
  assert.ok(lights.every((light) => light.visible && light.intensity > 0));

  layer.sync([...source].reverse(), { x: 0, z: 0 }, predicate);
  assert.deepEqual(layer.getDiagnostics().lightIds, ordered);
  assert.deepEqual(sceneResources(layer.root).lights, lights);

  layer.sync(source, { x: Number.NaN, z: 0 }, predicate);
  assert.equal(layer.getDiagnostics().activeLightCount, 0);
  assert.ok(lights.every((light) => !light.visible && light.intensity === 0));
  assert.equal(
    layer.getDiagnostics().activeWaymarks,
    source.length,
    "invalid observer only disables borrowed lights, not valid silhouettes",
  );
});

test("only authoritative lit plus positive-fuel state owns emissive flame instances", () => {
  const layer = new TorchWaymarkLayer();
  layer.sync(
    [
      waymark("dark-with-fuel", 0, 0, {
        lit: false,
        totalFuelSeconds: 500,
      }),
      waymark("lit", 2, 0, { lit: true, totalFuelSeconds: 1 }),
      waymark("empty", 4, 0, {
        lit: false,
        totalFuelSeconds: 0,
        slotCount: 0,
      }),
      waymark("reserve", 6, 0, { lit: false, slotCount: 2 }),
    ],
    { x: 0, z: 0 },
  );

  const diagnostics = layer.getDiagnostics();
  assert.equal(diagnostics.activeWaymarks, 4);
  assert.equal(diagnostics.burningWaymarks, 1);
  assert.equal(diagnostics.reserveSlotWaymarks, 1);
  assert.equal(diagnostics.activeLightCount, 1);

  const flames = layer.root.getObjectByName(
    "torch-waymark-flames",
  ) as THREE.InstancedMesh;
  const embers = layer.root.getObjectByName(
    "torch-waymark-embers",
  ) as THREE.InstancedMesh;
  const heads = layer.root.getObjectByName(
    "torch-waymark-charred-heads",
  ) as THREE.InstancedMesh;
  const reserves = layer.root.getObjectByName(
    "torch-waymark-bound-reserves",
  ) as THREE.InstancedMesh;
  assert.equal(flames.count, 1);
  assert.equal(embers.count, 1);
  assert.equal(heads.count, 3);
  assert.equal(reserves.count, 1);
  const flameMaterial = flames.material as THREE.MeshStandardMaterial;
  const emberMaterial = embers.material as THREE.MeshStandardMaterial;
  assert.ok(flameMaterial.emissiveIntensity > 0);
  assert.ok(emberMaterial.emissiveIntensity > 0);
  assert.equal(flameMaterial.transparent, true);
  assert.equal(flameMaterial.depthWrite, false);
});

test("malformed, duplicate and overflow inputs fail closed with stable bounded selection", () => {
  const layer = new TorchWaymarkLayer();
  const valid = Array.from(
    { length: TORCH_WAYMARK_LAYER_CAPACITY + 12 },
    (_, index) =>
      waymark(
        `valid-${String(index).padStart(3, "0")}`,
        ((index * 13) % 43) - 21,
        ((index * 19) % 47) - 23,
      ),
  );
  const duplicateA = waymark("duplicate", 0, 0);
  const duplicateB = waymark("duplicate", 1, 1);
  const dirty = [
    null,
    waymark("bad-x", Number.POSITIVE_INFINITY, 0),
    waymark("bad-y", 0, 0, { y: Number.NaN }),
    waymark("bad-yaw", 0, 0, { yaw: Number.NEGATIVE_INFINITY }),
    waymark("bad-fuel", 0, 0, { totalFuelSeconds: -1 }),
    waymark("bad-slot", 0, 0, { slotCount: 0.5 }),
    waymark("too-many-slots", 0, 0, { slotCount: 3 }),
    waymark("fuel-without-slot", 0, 0, { slotCount: 0 }),
    waymark("slot-without-fuel", 0, 0, {
      lit: false,
      totalFuelSeconds: 0,
      slotCount: 1,
    }),
    waymark("lit-without-slot", 0, 0, {
      lit: true,
      totalFuelSeconds: 0,
      slotCount: 0,
    }),
    waymark(" padded ", 0, 0),
  ] as unknown as TorchWaymarkVisualInput[];
  const source = [...valid, duplicateA, ...dirty, duplicateB];
  const observer = { x: 2.25, z: -3.75 };

  layer.sync(source, observer, (entry) => !entry.id.endsWith("7"));
  const first = layer.getDiagnostics();
  assert.equal(first.activeWaymarks, TORCH_WAYMARK_LAYER_CAPACITY);
  assert.equal(first.overflowDroppedCount, 12);
  assert.equal(first.duplicateInputCount, 2);
  assert.equal(first.invalidInputCount, dirty.length);
  assert.ok(first.activeLightCount <= 3);
  const selected = first.renderedIds;

  layer.sync(
    [...source].reverse(),
    observer,
    (entry) => !entry.id.endsWith("7"),
  );
  assert.deepEqual(layer.getDiagnostics().renderedIds, selected);
  assert.equal(layer.getDiagnostics().activeWaymarks, 128);

  layer.sync([waymark("only", 0, 0, { lit: false })], observer);
  const poles = layer.root.getObjectByName(
    "torch-waymark-poles",
  ) as THREE.InstancedMesh;
  const stale = new THREE.Matrix4();
  poles.getMatrixAt(1, stale);
  assert.equal(poles.count, 1);
  assert.equal(stale.determinant(), 0, "stale matrices are explicitly hidden");
});

test("dispose is idempotent and releases every fixed GPU resource once", () => {
  const layer = new TorchWaymarkLayer();
  layer.sync([waymark("one", 0, 0)], { x: 0, z: 0 });
  const resources = sceneResources(layer.root);
  const disposeCounts = new Map<THREE.EventDispatcher, number>();
  for (const resource of [...resources.geometries, ...resources.materials]) {
    disposeCounts.set(resource, 0);
    resource.addEventListener("dispose", () => {
      disposeCounts.set(resource, (disposeCounts.get(resource) ?? 0) + 1);
    });
  }

  layer.dispose();
  layer.dispose();
  layer.sync([waymark("ignored-after-dispose", 2, 0)], { x: 0, z: 0 });

  assert.ok([...disposeCounts.values()].every((count) => count === 1));
  assert.equal(layer.root.children.length, 0);
  assert.deepEqual(
    {
      active: layer.getDiagnostics().activeWaymarks,
      lights: layer.getDiagnostics().activeLightCount,
      disposed: layer.getDiagnostics().disposed,
    },
    { active: 0, lights: 0, disposed: true },
  );
});
