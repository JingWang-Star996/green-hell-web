import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  RESOURCE_PLANT_GEOMETRY_SPECIES,
  createPlantGeometryCatalogEntry,
} from "../../src/game/render/plantGeometryCatalog";
import { SemanticInstanceLayer } from "../../src/game/render/SemanticInstanceLayer";
import { generateSemanticChunkPlan } from "../../src/game/world/semanticGeneration";

const SEED = "plant-geometry-runtime";
const COORDINATES = [
  { x: -3, z: -3 },
  { x: 1, z: -3 },
] as const;

function geometrySignature(geometry: THREE.BufferGeometry): string {
  const positions = geometry.getAttribute("position");
  const index = geometry.getIndex();
  assert.ok(positions);
  assert.ok(index);
  let hash = 0x811c9dc5;
  for (const array of [positions.array, index.array]) {
    for (let item = 0; item < array.length; item += 1) {
      hash ^= Math.round(Number(array[item]) * 10_000);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return `${positions.count}:${index.count}:${hash >>> 0}`;
}

function meshesNamed(root: THREE.Object3D, name: string): THREE.InstancedMesh[] {
  const meshes: THREE.InstancedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name === name) {
      meshes.push(object);
    }
  });
  return meshes;
}

test("the runtime layer batches all four species with their catalog geometry", () => {
  const coordinate = COORDINATES[0];
  const source = generateSemanticChunkPlan(SEED, coordinate);
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(SEED, [coordinate], []);

  assert.equal(layer.root.getObjectByName("semantic-harvestable-plants"), undefined);
  const runtimeSignatures = new Set<string>();
  for (const species of RESOURCE_PLANT_GEOMETRY_SPECIES) {
    const sourceObjects = source.objects.filter(
      (object) =>
        object.category === "harvestable-plant" && object.species === species,
    );
    assert.ok(sourceObjects.length > 0, species);
    const meshes = meshesNamed(
      layer.root,
      `semantic-resource-plant-${species}`,
    );
    assert.equal(meshes.length, 1, species);
    const mesh = meshes[0];
    const catalog = createPlantGeometryCatalogEntry(species);
    assert.ok(catalog);
    if (!catalog) continue;

    assert.equal(mesh.count, sourceObjects.length, species);
    assert.equal(mesh.userData.resourcePlantSpecies, species);
    assert.equal(mesh.userData.geometryFamily, catalog.family);
    assert.equal(mesh.userData.anchorHeight, catalog.anchorHeight);
    assert.equal(mesh.userData.footprint, catalog.footprint);
    assert.equal(geometrySignature(mesh.geometry), geometrySignature(catalog.geometry));
    assert.ok((mesh.geometry.getIndex()?.count ?? 0) / 3 <= 120, species);
    runtimeSignatures.add(geometrySignature(mesh.geometry));
    for (const object of sourceObjects) {
      const record = layer.getRecord(object.id);
      assert.ok(record, object.id);
      assert.equal(record?.interactive, true);
      assert.equal(record?.focusPolicy, "capability");
      assert.ok((record?.anchor.height ?? 0) >= 0.18);
    }
    catalog.geometry.dispose();
  }
  assert.equal(runtimeSignatures.size, 4);
  layer.dispose();
});

test("chunk meshes share one geometry per species and dispose it only with the layer", () => {
  for (const coordinate of COORDINATES) {
    const species = new Set(
      generateSemanticChunkPlan(SEED, coordinate).objects
        .filter((object) => object.category === "harvestable-plant")
        .map((object) => object.species),
    );
    for (const required of RESOURCE_PLANT_GEOMETRY_SPECIES) {
      assert.ok(species.has(required), `${coordinate.x}:${coordinate.z}:${required}`);
    }
  }

  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(SEED, COORDINATES, []);
  const disposalCounts = new Map<THREE.BufferGeometry, number>();

  for (const species of RESOURCE_PLANT_GEOMETRY_SPECIES) {
    const meshes = meshesNamed(
      layer.root,
      `semantic-resource-plant-${species}`,
    );
    assert.equal(meshes.length, COORDINATES.length, species);
    const geometry = meshes[0].geometry;
    assert.ok(meshes.every((mesh) => mesh.geometry === geometry), species);
    disposalCounts.set(geometry, 0);
    geometry.addEventListener("dispose", () => {
      disposalCounts.set(geometry, (disposalCounts.get(geometry) ?? 0) + 1);
    });
  }

  // Removing every chunk must release instance buffers but retain the shared
  // catalog geometries for a later streamed chunk.
  layer.sync(SEED, [], []);
  assert.ok([...disposalCounts.values()].every((count) => count === 0));
  layer.sync(SEED, [COORDINATES[0]], []);
  for (const species of RESOURCE_PLANT_GEOMETRY_SPECIES) {
    const mesh = meshesNamed(
      layer.root,
      `semantic-resource-plant-${species}`,
    )[0];
    assert.ok(mesh);
    assert.ok(disposalCounts.has(mesh.geometry), species);
  }

  layer.dispose();
  assert.ok([...disposalCounts.values()].every((count) => count === 1));
});

test("resource plant draw submissions remain bounded to present geometry families", () => {
  const coordinate = COORDINATES[0];
  const source = generateSemanticChunkPlan(SEED, coordinate);
  const present = new Set(
    source.objects.flatMap((object) =>
      object.category === "harvestable-plant" &&
      object.species !== "wild-plantain"
        ? [object.species]
        : [],
    ),
  );
  const layer = new SemanticInstanceLayer({
    detail: "standard",
    shadows: false,
    terrainHeight: () => 0,
  });
  layer.sync(SEED, [coordinate], []);
  const resourcePlantMeshes: THREE.InstancedMesh[] = [];
  layer.root.traverse((object) => {
    if (
      object instanceof THREE.InstancedMesh &&
      object.name.startsWith("semantic-resource-plant-")
    ) {
      resourcePlantMeshes.push(object);
    }
  });
  assert.equal(resourcePlantMeshes.length, present.size);
  assert.ok(resourcePlantMeshes.length <= RESOURCE_PLANT_GEOMETRY_SPECIES.length);
  assert.ok(resourcePlantMeshes.every((mesh) => mesh.count > 0));
  layer.dispose();
});
