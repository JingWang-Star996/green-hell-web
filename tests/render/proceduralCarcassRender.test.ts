import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { RainforestRenderer } from "../../src/game/render/RainforestRenderer";
import { applyCommand } from "../../src/game/sim/simulation";
import { createInitialState } from "../../src/game/sim/state";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import { wildlifeHitShape } from "../../src/game/sim/hitValidation";
import { hitProfileFor } from "../../src/game/world/hitGeometry";
import { terrainHeight } from "../../src/game/world/terrain";

test("retained procedural corpses win the wildlife view budget and remain physically still", () => {
  let state = createInitialState("carcass-render-contract");
  const prey = createRenderSnapshot(state).wildlife.find(
    (candidate) =>
      candidate.visible && candidate.speciesId === "reedtail-scuttler",
  );
  assert.ok(prey);
  state.player.position = { ...prey.position };
  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  state.world.entities = Object.fromEntries(
    Object.entries(state.world.entities).filter(
      ([, entity]) =>
        entity.semantic?.category !== "tree" &&
        entity.semantic?.category !== "mineable-rock",
    ),
  );
  const attacked = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  assert.ok(attacked);
  state.player.lookYaw = Math.atan2(
    -(attacked.position.x - state.player.position.x),
    -(attacked.position.z - state.player.position.z),
  );
  const hitShape = wildlifeHitShape(attacked);
  state.player.lookPitch = Math.atan2(
    (hitShape.minimumY + hitShape.maximumY) / 2 -
      (terrainHeight(state.player.position.x, state.player.position.z) +
        hitProfileFor("attack").originHeight),
    Math.hypot(
      attacked.position.x - state.player.position.x,
      attacked.position.z - state.player.position.z,
    ),
  );
  state = applyCommand(state, {
    type: "physical-action",
    targetId: `wildlife:${prey.individualId}`,
    actionId: "attack",
    poseRevision: state.player.poseRevision ?? 0,
  });
  const snapshot = createRenderSnapshot(state);
  const corpse = snapshot.wildlife.find(
    (candidate) => candidate.individualId === prey.individualId,
  );
  const living = snapshot.wildlife.find(
    (candidate) => candidate.health > 0 && candidate.individualId !== prey.individualId,
  );
  assert.ok(corpse);
  assert.ok(living);

  const wildlifeViews = new Map<
    string,
    { projection: typeof corpse; object: THREE.Object3D }
  >();
  const receiver = Object.assign(Object.create(RainforestRenderer.prototype), {
    player: { x: 0, z: 0 },
    dynamicGroup: new THREE.Group(),
    wildlifeViews,
    maxWildlifeViews: 1,
    hazardWarned: new Set<string>(),
    hazardTriggered: new Set<string>(),
    hazardTelegraphStarted: new Map<string, number>(),
    hazardBlockedUntil: new Map<string, number>(),
    wildlifeTime: 0,
    reducedMotion: false,
  });
  const syncWildlife = Reflect.get(
    RainforestRenderer.prototype,
    "syncWildlife",
  ) as (this: typeof receiver, wildlife: typeof snapshot.wildlife) => void;
  syncWildlife.call(receiver, [
    { ...living, position: { x: 0, y: 0, z: 0 }, visible: true },
    { ...corpse, position: { x: 30, y: 0, z: 30 }, visible: true },
  ]);
  assert.deepEqual(
    [...wildlifeViews.keys()],
    [corpse.individualId],
    "a recoverable corpse cannot be evicted by a nearer living animal",
  );

  const updateWildlife = Reflect.get(
    RainforestRenderer.prototype,
    "updateWildlife",
  ) as (this: typeof receiver, delta: number, daylight: number) => void;
  updateWildlife.call(receiver, 0.4, 0.8);
  const corpseObject = wildlifeViews.get(corpse.individualId)?.object;
  assert.ok(corpseObject);
  const firstY = corpseObject.position.y;
  assert.equal(corpseObject.rotation.z, Math.PI * 0.5);

  updateWildlife.call(receiver, 1.7, 0.2);
  assert.equal(corpseObject.position.y, firstY, "dead bodies do not keep bobbing");
  assert.equal(corpseObject.rotation.z, Math.PI * 0.5);
});
