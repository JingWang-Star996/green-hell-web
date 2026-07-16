import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  RESOURCE_PLANT_GEOMETRY_SPECIES,
  createPlantGeometryCatalogEntry,
} from "../../src/game/render/plantGeometryCatalog";

function geometrySignature(geometry: THREE.BufferGeometry): string {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  assert.ok(position);
  assert.ok(index);
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    const quantized = Math.round(value * 10_000);
    hash ^= quantized;
    hash = Math.imul(hash, 0x01000193);
  };
  for (let item = 0; item < position.array.length; item += 1) {
    mix(Number(position.array[item]));
  }
  for (let item = 0; item < index.array.length; item += 1) {
    mix(Number(index.array[item]));
  }
  return `${position.count}:${index.count}:${hash >>> 0}`;
}

test("four resource species own distinct geometry families and topology signatures", () => {
  const entries = RESOURCE_PLANT_GEOMETRY_SPECIES.map((species) => {
    const entry = createPlantGeometryCatalogEntry(species);
    assert.ok(entry, species);
    return entry;
  });
  assert.equal(entries.length, 4);
  assert.equal(new Set(entries.map((entry) => entry.family)).size, 4);
  assert.equal(
    new Set(entries.map((entry) => geometrySignature(entry.geometry))).size,
    4,
  );
  for (const entry of entries) entry.geometry.dispose();
});

test("every family stays within the 120-triangle instancing budget", () => {
  for (const species of RESOURCE_PLANT_GEOMETRY_SPECIES) {
    const entry = createPlantGeometryCatalogEntry(species);
    assert.ok(entry);
    if (!entry) continue;
    const index = entry.geometry.getIndex();
    assert.ok(index);
    assert.ok((index?.count ?? 0) > 0, species);
    assert.ok((index?.count ?? 0) % 3 === 0, species);
    assert.ok((index?.count ?? 0) / 3 <= 120, species);
    entry.geometry.dispose();
  }
});

test("bounding boxes, anchors, and footprints are finite and spatially honest", () => {
  for (const species of RESOURCE_PLANT_GEOMETRY_SPECIES) {
    const entry = createPlantGeometryCatalogEntry(species);
    assert.ok(entry);
    if (!entry) continue;
    const geometry = entry.geometry;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    assert.ok(box, species);
    if (!box) continue;
    for (const value of [
      box.min.x,
      box.min.y,
      box.min.z,
      box.max.x,
      box.max.y,
      box.max.z,
      entry.anchorHeight,
      entry.footprint,
    ]) {
      assert.ok(Number.isFinite(value), species);
    }
    assert.ok(box.min.y >= -1e-6, species);
    assert.ok(box.max.y > box.min.y, species);
    assert.ok(entry.anchorHeight > box.min.y, species);
    assert.ok(entry.anchorHeight <= box.max.y + 1e-6, species);
    assert.ok(entry.footprint > 0, species);
    assert.ok(Math.abs(box.min.x) <= entry.footprint + 1e-6, species);
    assert.ok(Math.abs(box.max.x) <= entry.footprint + 1e-6, species);
    assert.ok(Math.abs(box.min.z) <= entry.footprint + 1e-6, species);
    assert.ok(Math.abs(box.max.z) <= entry.footprint + 1e-6, species);

    const positions = geometry.getAttribute("position");
    assert.ok(positions);
    for (let item = 0; item < positions.array.length; item += 1) {
      assert.ok(Number.isFinite(Number(positions.array[item])), species);
    }
    geometry.dispose();
  }
});

test("catalog construction is stable and returns fresh caller-owned geometries", () => {
  for (const species of RESOURCE_PLANT_GEOMETRY_SPECIES) {
    const first = createPlantGeometryCatalogEntry(species);
    const second = createPlantGeometryCatalogEntry(species);
    assert.ok(first && second);
    if (!first || !second) continue;
    assert.notEqual(first.geometry, second.geometry);
    assert.equal(geometrySignature(first.geometry), geometrySignature(second.geometry));
    assert.equal(first.geometry.name, second.geometry.name);
    assert.equal(first.geometry.userData.family, first.family);
    assert.equal(first.geometry.userData.species, species);
    first.geometry.dispose();
    assert.ok(second.geometry.getAttribute("position").count > 0);
    second.geometry.dispose();
  }
});

test("clones remain independent and safe when either geometry is disposed", () => {
  const entry = createPlantGeometryCatalogEntry("fiber-vine");
  assert.ok(entry);
  if (!entry) return;
  const clone = entry.geometry.clone();
  assert.notEqual(clone.getAttribute("position"), entry.geometry.getAttribute("position"));
  assert.equal(geometrySignature(clone), geometrySignature(entry.geometry));

  let originalDisposed = false;
  let cloneDisposed = false;
  entry.geometry.addEventListener("dispose", () => {
    originalDisposed = true;
  });
  clone.addEventListener("dispose", () => {
    cloneDisposed = true;
  });
  entry.geometry.dispose();
  assert.equal(originalDisposed, true);
  assert.ok(clone.getAttribute("position").count > 0);
  clone.dispose();
  assert.equal(cloneDisposed, true);
});

test("unsupported, empty, and inherited species names fail closed", () => {
  for (const species of [
    "",
    "wild-plantain",
    "unknown-resource-plant",
    "toString",
    "__proto__",
  ]) {
    assert.equal(createPlantGeometryCatalogEntry(species), null);
  }
});
