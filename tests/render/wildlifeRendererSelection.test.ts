import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { RainforestRenderer } from "../../src/game/render/RainforestRenderer";
import type { RenderSnapshot } from "../../src/game/render/types";
import { createInitialState } from "../../src/game/sim/state";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

type Projection = RenderSnapshot["wildlife"][number];

function rendererReceiver(maxWildlifeViews: number) {
  return Object.assign(Object.create(RainforestRenderer.prototype), {
    player: { x: 0, z: 0 },
    currentTarget: null as { id: string } | null,
    actionTransaction: null as { targetId: string } | null,
    dynamicGroup: new THREE.Group(),
    wildlifeViews: new Map<
      string,
      { projection: Projection; object: THREE.Object3D }
    >(),
    maxWildlifeViews,
    wildlifeProtectedViews: 0,
    wildlifeProtectedCandidates: 0,
    wildlifeProtectedDropped: 0,
    wildlifeOverflowViews: 0,
    hazardWarned: new Set<string>(),
    hazardTriggered: new Set<string>(),
    hazardTelegraphStarted: new Map<string, number>(),
    hazardBlockedUntil: new Map<string, number>(),
  });
}

function firstMaterialOpacity(object: THREE.Object3D): number | null {
  let opacity: number | null = null;
  object.traverse((child) => {
    if (opacity !== null || !(child instanceof THREE.Mesh)) return;
    const material = Array.isArray(child.material)
      ? child.material[0]
      : child.material;
    opacity = material?.opacity ?? null;
  });
  return opacity;
}

function firstMaterialDepthWrite(object: THREE.Object3D): boolean | null {
  let depthWrite: boolean | null = null;
  object.traverse((child) => {
    if (depthWrite !== null || !(child instanceof THREE.Mesh)) return;
    const material = Array.isArray(child.material)
      ? child.material[0]
      : child.material;
    depthWrite = material?.depthWrite ?? null;
  });
  return depthWrite;
}

test("renderer keeps zero-readability wildlife present and admits an aware predator before ambience", () => {
  const snapshot = createRenderSnapshot(
    createInitialState("wildlife-render-selection"),
  );
  const base = snapshot.wildlife.find((candidate) => candidate.health > 0);
  assert.ok(base);
  const make = (
    individualId: string,
    overrides: Partial<Projection>,
  ): Projection => ({
    ...base,
    individualId,
    populationKey: `test|${individualId}`,
    visible: true,
    ...overrides,
  });
  const ambient = make("ambient-near", {
    position: { x: 0.5, y: 0, z: 0 },
    awareness: 0,
    visibility: 0,
    role: "small-prey",
  });
  const predator = make("aware-predator-far", {
    position: { x: 80, y: 0, z: 0 },
    awareness: 0.2,
    visibility: 0,
    role: "predator",
  });
  const receiver = rendererReceiver(1);
  const syncWildlife = Reflect.get(
    RainforestRenderer.prototype,
    "syncWildlife",
  ) as (this: typeof receiver, wildlife: Projection[]) => void;

  syncWildlife.call(receiver, [ambient]);
  const ambientObject = receiver.wildlifeViews.get(ambient.individualId)?.object;
  assert.ok(ambientObject);
  assert.equal(ambientObject.visible, true, "readability zero is not absence");
  assert.equal(firstMaterialOpacity(ambientObject), 0.5);
  assert.equal(
    firstMaterialDepthWrite(ambientObject),
    false,
    "partially transparent wildlife must not cut out layers behind it",
  );
  assert.equal(ambientObject.userData.wildlifeProtected, false);

  syncWildlife.call(receiver, [ambient, predator]);
  assert.deepEqual([...receiver.wildlifeViews.keys()], [predator.individualId]);
  const predatorObject = receiver.wildlifeViews.get(predator.individualId)?.object;
  assert.ok(predatorObject);
  assert.equal(predatorObject.userData.wildlifeProtected, true);
  assert.equal(firstMaterialOpacity(predatorObject), 1);
  assert.equal(firstMaterialDepthWrite(predatorObject), true);
  assert.equal(receiver.wildlifeProtectedViews, 1);
  assert.equal(receiver.wildlifeOverflowViews, 0);
});

test("renderer reports protected overflow and keeps corpse, focus and bound action", () => {
  const snapshot = createRenderSnapshot(
    createInitialState("wildlife-render-protected-overflow"),
  );
  const base = snapshot.wildlife.find((candidate) => candidate.health > 0);
  assert.ok(base);
  const make = (
    individualId: string,
    overrides: Partial<Projection> = {},
  ): Projection => ({
    ...base,
    individualId,
    populationKey: `test|${individualId}`,
    visible: true,
    awareness: 0,
    visibility: 0.1,
    ...overrides,
  });
  const corpse = make("corpse", {
    health: 0,
    behavior: "dead",
    pendingMeat: 1,
  });
  const focused = make("focused");
  const action = make("action");
  const ambient = make("ambient", { position: { x: 0.1, y: 0, z: 0 } });
  const receiver = rendererReceiver(1);
  receiver.currentTarget = { id: `wildlife:${focused.individualId}` };
  receiver.actionTransaction = { targetId: `wildlife:${action.individualId}` };
  const syncWildlife = Reflect.get(
    RainforestRenderer.prototype,
    "syncWildlife",
  ) as (this: typeof receiver, wildlife: Projection[]) => void;

  syncWildlife.call(receiver, [ambient, action, focused, corpse]);
  assert.deepEqual(
    [...receiver.wildlifeViews.keys()],
    [action.individualId, focused.individualId, corpse.individualId],
  );
  assert.equal(receiver.wildlifeProtectedViews, 3);
  assert.equal(receiver.wildlifeOverflowViews, 2);
  assert.equal(receiver.wildlifeProtectedCandidates, 3);
  assert.equal(receiver.wildlifeProtectedDropped, 0);
  assert.ok(
    [...receiver.wildlifeViews.values()].every(
      (view) => view.object.userData.wildlifeProtected === true,
    ),
  );
});
