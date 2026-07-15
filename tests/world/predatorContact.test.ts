import assert from "node:assert/strict";
import test from "node:test";

import { MAX_HIT_BLOCKER_SHAPES } from "../../src/game/world/hitGeometry";
import {
  buildPredatorContactSweep,
  colliderNearContactSweep,
  predatorContactBlockerShape,
  resolvePredatorContact,
  type PredatorContactPose,
} from "../../src/game/world/predatorContact";
import {
  surveyRockShelterColliders,
  surveyShelterLocalToWorld,
  weatherStationCollider,
} from "../../src/game/world/interactionGeometry";
import { terrainHeight } from "../../src/game/world/terrain";
import { structureWorldColliders } from "../../src/game/sim/structureGeometry";

function poseBetween(
  predator: Readonly<{ x: number; z: number }>,
  player: Readonly<{ x: number; z: number }>,
): PredatorContactPose {
  return {
    predatorX: predator.x,
    predatorZ: predator.z,
    predatorGroundY: terrainHeight(predator.x, predator.z),
    playerX: player.x,
    playerZ: player.z,
    playerGroundY: terrainHeight(player.x, player.z),
    speciesId: "coiled-viper",
    scale: 0.9,
  };
}

test("rock-shelter walls block contact while its real entrance stays open", () => {
  const entrancePose = poseBetween(
    surveyShelterLocalToWorld({ x: 0, z: -2.2 }),
    surveyShelterLocalToWorld({ x: 0, z: -0.75 }),
  );
  const entranceBlockers = surveyRockShelterColliders().map((collider, index) =>
    predatorContactBlockerShape(`rock-shelter:${index}`, collider),
  );
  assert.equal(resolvePredatorContact(entrancePose, entranceBlockers).ok, true);

  const wallPose = poseBetween(
    surveyShelterLocalToWorld({ x: -2.7, z: 0 }),
    surveyShelterLocalToWorld({ x: -1.3, z: 0 }),
  );
  const wallHit = resolvePredatorContact(wallPose, entranceBlockers);
  assert.equal(wallHit.ok, false);
  assert.equal(wallHit.ok ? null : wallHit.reason, "occluded");
});

test("precise shelter supports block only their footprints, not the opening", () => {
  const structure = {
    id: "structure.shelter.contact-test",
    kind: "shelter" as const,
    x: 10,
    z: 10,
    yaw: 0,
  };
  const blockers = structureWorldColliders(structure).map((collider, index) =>
    predatorContactBlockerShape(`${structure.id}:part:${index}`, collider),
  );
  assert.equal(
    resolvePredatorContact(
      poseBetween({ x: 10, z: 9.3 }, { x: 10, z: 10.7 }),
      blockers,
    ).ok,
    true,
  );
  const supportHit = resolvePredatorContact(
    poseBetween({ x: 11.3, z: 9.3 }, { x: 11.3, z: 10.7 }),
    blockers,
  );
  assert.equal(supportHit.ok, false);
  assert.equal(supportHit.ok ? null : supportHit.reason, "occluded");
});

test("the weather-station solid footprint blocks predator contact", () => {
  const pose = poseBetween({ x: 30.3, z: 27 }, { x: 31.7, z: 27 });
  const result = resolvePredatorContact(pose, [
    predatorContactBlockerShape(
      "authored:weather-station",
      weatherStationCollider(),
    ),
  ]);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.reason, "occluded");
});

test("contact first-entry work remains hard-capped at 512 blocker shapes", () => {
  const pose = poseBetween({ x: 20, z: 20 }, { x: 21.4, z: 20 });
  const sweep = buildPredatorContactSweep(pose);
  const far = Array.from({ length: 900 }, (_, index) => ({
    kind: "circle" as const,
    x: 100 + index,
    z: 100,
    radius: 0.2,
  })).filter((collider) => colliderNearContactSweep(collider, sweep));
  assert.equal(far.length, 0, "broad phase must discard distant world shapes");

  const crowded = Array.from(
    { length: MAX_HIT_BLOCKER_SHAPES + 1 },
    (_, index) =>
      predatorContactBlockerShape(`crowded:${index}`, {
        kind: "circle",
        x: 20,
        z: 21,
        radius: 0.01,
      }),
  );
  const result = resolvePredatorContact(pose, crowded);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.reason, "geometry-budget");
  assert.equal(result.scanned, MAX_HIT_BLOCKER_SHAPES);
});
