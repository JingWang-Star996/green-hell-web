import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { CampfireFeedbackRig } from "../../src/game/render/CampfireFeedbackRig";
import { resolveCampfireFeedback } from "../../src/game/render/campfireFeedback";
import type { GameEvent } from "../../src/game/sim/types";

function event(
  id: number,
  type: GameEvent["type"],
  details: GameEvent["details"] = {},
): GameEvent {
  return {
    id,
    tick: id,
    elapsedSeconds: id,
    type,
    message: type,
    cause: { source: "command", code: `test:${type}` },
    details,
  };
}

function fireVisuals() {
  const root = new THREE.Group();
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0x694128 }),
  );
  log.userData.fireLog = true;
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.7, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8a2c }),
  );
  flame.userData.flame = true;
  root.add(log, flame);
  const light = new THREE.PointLight(0xff7a2d, 0, 12, 2);
  root.add(light);
  return { root, log, flame, light, rig: new CampfireFeedbackRig(root, light) };
}

test("rig turns authoritative fuel into visible static fire and plays one deduplicated log drop", () => {
  const { root, flame, light, rig } = fireVisuals();
  const started: number[] = [];
  rig.setTransientStartListener((descriptor) => started.push(descriptor.eventId));
  assert.equal(root.visible, false);
  const feedback = resolveCampfireFeedback({
    built: true,
    lit: true,
    fuelSeconds: 800,
    fuelCapacitySeconds: 900,
    reducedMotion: false,
    authoritativeEvents: [
      event(4, "fuel-added", { fuelAddedSeconds: 240 }),
    ],
    lastProcessedEventId: 0,
  });
  assert.equal(feedback.transients.length, 1);
  rig.apply(feedback);
  rig.apply(feedback);
  assert.deepEqual(rig.getDebugState(), {
    stage: "steady",
    queued: 1,
    activeEventId: null,
    seen: 1,
  });
  assert.deepEqual(started, [], "apply only queues; sound cannot run before the visual clock");

  rig.update(0, 1_000);
  assert.equal(root.visible, true);
  assert.equal(flame.visible, true);
  assert.ok(light.intensity > 0);
  assert.equal(rig.getDebugState().activeEventId, 4);
  assert.deepEqual(started, [4]);
  assert.equal(root.getObjectByName("campfire-transient-log")?.visible, true);
  const flameMaterial = flame.material as THREE.MeshBasicMaterial;
  assert.equal(flameMaterial.transparent, true);
  assert.equal(flameMaterial.depthWrite, false);

  rig.update(0.1, 1_000 + feedback.transients[0].durationMs / 2);
  assert.equal(root.getObjectByName("campfire-transient-sparks")?.visible, true);
  rig.update(0.1, 1_001 + feedback.transients[0].durationMs);
  assert.equal(rig.getDebugState().activeEventId, null);
  assert.equal(root.getObjectByName("campfire-transient-log")?.visible, false);
});

test("full run reset clears prior static fire, queued events, and event history", () => {
  const { root, flame, light, rig } = fireVisuals();
  rig.apply(
    resolveCampfireFeedback({
      built: true,
      lit: true,
      fuelSeconds: 700,
      fuelCapacitySeconds: 900,
      reducedMotion: false,
      authoritativeEvents: [
        event(31, "fuel-added", { fuelAddedSeconds: 100 }),
      ],
      lastProcessedEventId: 30,
    }),
  );
  rig.update(0, 3_000);
  assert.equal(root.visible, true);
  assert.ok(light.intensity > 0);

  rig.reset();

  assert.deepEqual(rig.getDebugState(), {
    stage: "unbuilt",
    queued: 0,
    activeEventId: null,
    seen: 0,
  });
  assert.equal(root.visible, false);
  assert.equal(flame.visible, false);
  assert.equal(light.intensity, 0);
  assert.equal(root.getObjectByName("campfire-transient-log")?.visible, false);
});

test("extinguish keeps the built fire readable while swapping flame for bounded smoke", () => {
  const { root, flame, light, rig } = fireVisuals();
  const feedback = resolveCampfireFeedback({
    built: true,
    lit: false,
    fuelSeconds: 0,
    fuelCapacitySeconds: 900,
    reducedMotion: true,
    authoritativeEvents: [event(9, "fire-extinguished")],
    lastProcessedEventId: 8,
  });
  rig.apply(feedback);
  rig.update(0, 2_000);
  rig.update(0.1, 2_000 + feedback.transients[0].durationMs / 2);

  assert.equal(root.visible, true);
  assert.equal(flame.visible, false);
  assert.equal(light.intensity, 0);
  assert.equal(root.getObjectByName("campfire-transient-smoke")?.visible, true);
  const smoke = root.getObjectByName(
    "campfire-transient-smoke",
  ) as THREE.Points;
  assert.ok(smoke.geometry.getAttribute("position").count <= 6);
});

test("rig queue remains bounded even if a caller submits repeated event batches", () => {
  const { rig } = fireVisuals();
  for (let batch = 0; batch < 5; batch += 1) {
    const firstId = batch * 4 + 1;
    rig.apply(
      resolveCampfireFeedback({
        built: true,
        lit: true,
        fuelSeconds: 500,
        fuelCapacitySeconds: 900,
        reducedMotion: false,
        authoritativeEvents: Array.from({ length: 4 }, (_, index) =>
          event(firstId + index, "fuel-added", { fuelAddedSeconds: 1 }),
        ),
        lastProcessedEventId: firstId - 1,
      }),
    );
  }
  assert.equal(rig.getDebugState().queued, 8);
  assert.equal(rig.getDebugState().seen, 20);
});
