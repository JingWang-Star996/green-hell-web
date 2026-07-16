import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";

import { PlacementPreview } from "../../src/game/render/PlacementPreview";
import {
  RainforestRenderer,
  torchWaymarkVisualInputsFromStructures,
} from "../../src/game/render/RainforestRenderer";
import { TorchWaymarkLayer } from "../../src/game/render/TorchWaymarkLayer";
import type {
  RenderSnapshot,
  RenderStructure,
} from "../../src/game/render/types";
import { TORCH_WAYMARK_LAYOUT } from "../../src/game/sim/structureGeometry";
import { terrainHeight } from "../../src/game/world/terrain";

function structure(
  overrides: Partial<RenderStructure> = {},
): RenderStructure {
  return {
    id: "waymark.integration",
    kind: "torch-waymark",
    x: 3,
    y: 0.25,
    z: -4,
    yaw: 0.4,
    lit: true,
    totalFuelSeconds: 320,
    slotCount: 2,
    ...overrides,
  };
}

test("waymark preview derives its stone base and pole silhouette from shared layout", () => {
  const preview = new PlacementPreview();
  preview.setKind("torch-waymark");

  const pole = preview.root.getObjectByName(
    "torch-waymark-preview-pole",
  ) as THREE.Mesh<THREE.CylinderGeometry>;
  const stones = preview.root.children[0].children.filter(
    (object) => object.name === "torch-waymark-preview-stone",
  );
  const head = preview.root.getObjectByName("torch-waymark-preview-torch-slot");
  const reserve = preview.root.getObjectByName(
    "torch-waymark-preview-reserve-slot",
  );

  assert.ok(pole instanceof THREE.Mesh);
  assert.equal(pole.geometry.parameters.height, TORCH_WAYMARK_LAYOUT.poleHeight);
  assert.equal(pole.position.y, TORCH_WAYMARK_LAYOUT.poleHeight / 2);
  assert.equal(stones.length, 3);
  assert.ok(
    stones.every(
      (stone) =>
        Math.hypot(stone.position.x, stone.position.z) <
        TORCH_WAYMARK_LAYOUT.stoneBaseRadius,
    ),
  );
  assert.ok(head instanceof THREE.Mesh);
  assert.ok(reserve instanceof THREE.Mesh);
  preview.dispose();
});

test("render projection preserves exact authoritative fuel and fails legacy gaps closed", () => {
  const projected = torchWaymarkVisualInputsFromStructures([
    structure(),
    structure({
      id: "waymark.missing",
      lit: true,
      totalFuelSeconds: undefined,
      slotCount: undefined,
    }),
    structure({
      id: "waymark.contradiction",
      lit: true,
      totalFuelSeconds: 90,
      slotCount: 0,
    }),
    {
      id: "collector.not-waymark",
      kind: "rain-collector",
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
    },
  ]);

  assert.deepEqual(projected, [
    {
      id: "waymark.integration",
      x: 3,
      y: terrainHeight(3, -4),
      z: -4,
      yaw: 0.4,
      lit: true,
      totalFuelSeconds: 320,
      slotCount: 2,
    },
    {
      id: "waymark.missing",
      x: 3,
      y: terrainHeight(3, -4),
      z: -4,
      yaw: 0.4,
      lit: false,
      totalFuelSeconds: 0,
      slotCount: 0,
    },
    {
      id: "waymark.contradiction",
      x: 3,
      y: terrainHeight(3, -4),
      z: -4,
      yaw: 0.4,
      lit: false,
      totalFuelSeconds: 0,
      slotCount: 0,
    },
  ]);
  assert.notEqual(
    projected[0].y,
    structure().y,
    "saved horizontal Y must not flatten a remote waymark onto the wrong plane",
  );
});

test("integration inputs remain inside one fixed three-light allocation", () => {
  const layer = new TorchWaymarkLayer();
  const initialChildren = [...layer.root.children];
  const inputs = torchWaymarkVisualInputsFromStructures(
    Array.from({ length: 80 }, (_, index) =>
      structure({
        id: `waymark-${index}`,
        x: index % 10,
        z: Math.floor(index / 10),
      }),
    ),
  );

  layer.sync(inputs, { x: 0, z: 0 }, () => true);
  layer.sync([...inputs].reverse(), { x: 2, z: 2 }, () => true);
  const diagnostics = layer.getDiagnostics();
  assert.equal(diagnostics.activeWaymarks, 80);
  assert.equal(diagnostics.lightObjectCount, 3);
  assert.equal(diagnostics.activeLightCount, 3);
  assert.deepEqual(layer.root.children, initialChildren);
  layer.dispose();
});

test("renderer light selection uses the real camera frustum", () => {
  const camera = new THREE.PerspectiveCamera(72, 1, 0.08, 180);
  camera.position.set(0, 1.68, 0);
  camera.updateProjectionMatrix();
  let projected: ReturnType<typeof torchWaymarkVisualInputsFromStructures> = [];
  let predicate: ((entry: (typeof projected)[number]) => boolean) | undefined;
  const receiver = Object.assign(Object.create(RainforestRenderer.prototype), {
    camera,
    torchWaymarkFrustum: new THREE.Frustum(),
    torchWaymarkFrustumMatrix: new THREE.Matrix4(),
    torchWaymarkFrustumSphere: new THREE.Sphere(),
    torchWaymarkLayer: {
      sync: (
        inputs: typeof projected,
        _observer: { x: number; z: number },
        inFrustum: typeof predicate,
      ) => {
        projected = inputs;
        predicate = inFrustum;
      },
    },
    snapshot: {
      structures: [
        structure({ id: "front", x: 0, y: 0, z: -6 }),
        structure({ id: "behind", x: 0, y: 0, z: 6 }),
      ],
    } as RenderSnapshot,
    player: new THREE.Vector3(0, 0, 0),
  }) as RainforestRenderer;
  const sync = Reflect.get(
    RainforestRenderer.prototype,
    "syncTorchWaymarks",
  ) as (this: RainforestRenderer) => void;

  sync.call(receiver);
  assert.equal(projected.length, 2);
  assert.equal(predicate?.(projected[0]), true);
  assert.equal(predicate?.(projected[1]), false);
});

test("waymark instance uploads stay out of the requestAnimationFrame loop", () => {
  const source = readFileSync(
    new URL("../../src/game/render/RainforestRenderer.ts", import.meta.url),
    "utf8",
  );
  const animate = source.slice(
    source.indexOf("private animate ="),
    source.indexOf("private updateActionTransaction"),
  );
  assert.doesNotMatch(animate, /syncTorchWaymarks/);
  assert.match(source, /this\.syncStructures\(\);\s+this\.syncTorchWaymarks\(\);/);
  assert.match(source, /this\.syncWorldChunks\(\);\s+this\.syncTorchWaymarks\(\);/);
});
