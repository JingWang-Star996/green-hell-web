import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { PlacementPreview } from "../../src/game/render/PlacementPreview";
import {
  createRainCollectorObject,
  updateRainCollectorObject,
} from "../../src/game/render/RainforestRenderer";
import {
  RAIN_COLLECTOR_LAYOUT,
  isPointBlockedByStructure,
  rainCollectorInteractionAnchor,
  structurePlacementRadius,
} from "../../src/game/sim";
import type { PlacedStructureState } from "../../src/game/sim/types";
import { createInitialState, migrateGameState } from "../../src/game/sim";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

function placed(
  id = "collector.render",
  x = 2,
  z = 2,
  yaw = 0,
  storedUnits = 0,
): PlacedStructureState {
  return {
    id,
    kind: "rain-collector",
    position: { x, y: 0, z },
    yaw,
    builtAtTick: 0,
    storedUnits,
    capacity: 4,
    lastAdvancedTick: 0,
  };
}

test("shared layout keeps the interaction anchor reachable outside all four leg colliders", () => {
  const structure = placed("collector.geometry", 10, -4, Math.PI / 2);
  const anchor = rainCollectorInteractionAnchor(structure);
  assert.equal(
    isPointBlockedByStructure(
      {
        id: structure.id,
        kind: structure.kind,
        x: structure.position.x,
        z: structure.position.z,
        yaw: structure.yaw,
      },
      anchor.x,
      anchor.z,
      0,
    ),
    false,
  );
  const leg = RAIN_COLLECTOR_LAYOUT.legPositions[0];
  const cosine = Math.cos(structure.yaw);
  const sine = Math.sin(structure.yaw);
  const legX = structure.position.x + leg.x * cosine + leg.z * sine;
  const legZ = structure.position.z - leg.x * sine + leg.z * cosine;
  assert.equal(
    isPointBlockedByStructure(
      {
        id: structure.id,
        kind: structure.kind,
        x: structure.position.x,
        z: structure.position.z,
        yaw: structure.yaw,
      },
      legX,
      legZ,
      0,
    ),
    true,
  );
  assert.equal(structurePlacementRadius("rain-collector"), 1.08);
});

test("placement preview consumes the shared layout and exposes green, orange and red states", () => {
  const preview = new PlacementPreview();
  preview.setKind("rain-collector");
  let meshCount = 0;
  preview.root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshCount += 1;
  });
  assert.ok(
    meshCount >= RAIN_COLLECTOR_LAYOUT.legPositions.length + 5,
    "the silhouette includes legs, rails, leaf funnel and basin",
  );

  for (const [status, color] of [
    ["valid-high", 0x7ddc78],
    ["valid-low", 0xe9a94a],
    ["invalid", 0xef655b],
  ] as const) {
    preview.setStatus(status);
    assert.equal(preview.getStatus(), status);
    assert.equal(preview.isValid(), status !== "invalid");
    const mesh = preview.root.getObjectByProperty("type", "Mesh") as THREE.Mesh;
    assert.ok(mesh.material instanceof THREE.MeshBasicMaterial);
    assert.equal(mesh.material.color.getHex(), color);
  }
  preview.dispose();
});

test("the authored code-native model exposes a visible reservoir level", () => {
  const object = createRainCollectorObject();
  const water = object.getObjectByName("rain-collector-water");
  assert.ok(water instanceof THREE.Mesh);
  updateRainCollectorObject(object, {
    id: "collector.model",
    kind: "rain-collector",
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    storedUnits: 0,
    storageCapacity: 4,
  });
  assert.equal(water.visible, false);
  updateRainCollectorObject(object, {
    id: "collector.model",
    kind: "rain-collector",
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    storedUnits: 3,
    storageCapacity: 4,
  });
  assert.equal(water.visible, true);
  assert.ok(water.position.y > 0.85);
  assert.ok(water.scale.x > 0.8);
});

test("render projection keeps multiple reservoirs independent and emits one proxy per active model", () => {
  const state = createInitialState("rain-collector-render-projection");
  state.player.position = { x: 2, y: 0, z: 2 };
  state.camp.structures = [
    placed("collector.one", 2, 2, 0, 0.5),
    placed("collector.two", 6, 2, Math.PI / 2, 3.25),
  ];
  const snapshot = createRenderSnapshot(migrateGameState(state));
  assert.deepEqual(
    snapshot.structures
      .filter((entry) => entry.kind === "rain-collector")
      .map((entry) => ({
        id: entry.id,
        storedUnits: entry.storedUnits,
        storageCapacity: entry.storageCapacity,
      })),
    [
      { id: "collector.one", storedUnits: 0.5, storageCapacity: 4 },
      { id: "collector.two", storedUnits: 3.25, storageCapacity: 4 },
    ],
  );
  assert.deepEqual(
    snapshot.entities
      .filter((entry) => entry.kind === "rain-collector")
      .map((entry) => entry.id),
    ["collector.one", "collector.two"],
  );
});
