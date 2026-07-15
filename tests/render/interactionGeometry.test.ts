import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  SURVEY_ROCK_SHELTER_LAYOUT,
  WEATHER_STATION_LAYOUT,
  authoredInteractionAnchor,
  isPointShelteredBySurveyRockShelter,
  isPointBlocked,
  surveyRockShelterApproachPoint,
  surveyRockShelterCacheAnchor,
  surveyRockShelterColliders,
  surveyShelterLocalToWorld,
  weatherStationApproachPoint,
  weatherStationCollider,
} from "../../src/game/render/interactionGeometry";
import {
  createSurveyRockShelter,
  isLineOfSightBlocked,
} from "../../src/game/render/RainforestRenderer";
import { createInitialState } from "../../src/game/sim";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

test("weather-station console and battery expose separate front-face interaction anchors", () => {
  const fallback = { x: 33, z: 27, height: 0 };
  const consoleAnchor = authoredInteractionAnchor("landmark.weather-station", fallback);
  const batteryAnchor = authoredInteractionAnchor("resource.battery.weather-station", fallback);

  assert.deepEqual(consoleAnchor, WEATHER_STATION_LAYOUT.console);
  assert.deepEqual(batteryAnchor, WEATHER_STATION_LAYOUT.battery);
  assert.notDeepEqual(consoleAnchor, batteryAnchor);
});

test("a normal standing approach reaches both station targets without entering collision", () => {
  const collider = weatherStationCollider();
  const authoredTargets = [
    {
      id: "landmark.weather-station",
      fallback: { x: 33, z: 27, height: 0 },
      simulationPosition: { x: 33, z: 27 },
      simulationRadius: 5,
    },
    {
      id: "resource.battery.weather-station",
      fallback: { x: 32, z: 25, height: 0 },
      simulationPosition: { x: 32, z: 25 },
      simulationRadius: 2.5,
    },
  ];

  for (const target of authoredTargets) {
    const anchor = authoredInteractionAnchor(target.id, target.fallback);
    const approach = weatherStationApproachPoint(anchor);
    assert.equal(isPointBlocked(collider, approach.x, approach.z), false, `${target.id} approach must not collide`);
    assert.ok(Math.hypot(approach.x - anchor.x, approach.z - anchor.z) < 3.2, `${target.id} must be inside renderer reach`);
    assert.ok(
      Math.hypot(
        approach.x - target.simulationPosition.x,
        approach.z - target.simulationPosition.z,
      ) < target.simulationRadius,
      `${target.id} must also pass deterministic simulation distance validation`,
    );
  }
});

test("unknown entities preserve their authored position", () => {
  const fallback = { x: -4, z: 9, height: 0.4 };
  assert.deepEqual(authoredInteractionAnchor("resource.stick.anywhere", fallback), fallback);
});

test("survey shelter shares one U-shaped collision, entrance and reachable cache layout", () => {
  const layout = SURVEY_ROCK_SHELTER_LAYOUT;
  assert.equal(layout.roof.width, 4.6);
  assert.equal(layout.roof.depth, 3.8);
  assert.ok(layout.entrance.width >= 2.6);
  assert.ok(layout.entrance.height >= 1.9);

  const colliders = surveyRockShelterColliders();
  assert.equal(colliders.length, 3);
  const approach = surveyRockShelterApproachPoint();
  const anchor = surveyRockShelterCacheAnchor();
  assert.equal(
    colliders.some((collider) =>
      isPointBlocked(collider, approach.x, approach.z, 0),
    ),
    false,
  );
  assert.ok(
    Math.hypot(
      approach.x - layout.centerX,
      approach.z - layout.centerZ,
    ) < 3,
    "approach must pass deterministic landmark range",
  );
  assert.ok(
    Math.hypot(approach.x - anchor.x, approach.z - anchor.z) < 3,
    "approach must also reach the visible crate anchor",
  );
  for (const wall of layout.walls) {
    const midpoint = surveyShelterLocalToWorld({
      x: (wall.fromX + wall.toX) / 2,
      z: (wall.fromZ + wall.toZ) / 2,
    });
    assert.equal(
      colliders.some((collider) =>
        isPointBlocked(collider, midpoint.x, midpoint.z, 0),
      ),
      true,
    );
  }
  assert.equal(
    isPointShelteredBySurveyRockShelter(layout.centerX, layout.centerZ),
    true,
  );
  assert.equal(
    isPointShelteredBySurveyRockShelter(approach.x, approach.z),
    false,
  );

  const sixMetresOut = surveyShelterLocalToWorld({ x: 0, z: -6 });
  assert.equal(
    isLineOfSightBlocked(sixMetresOut, anchor, colliders),
    false,
    "the warm crate must remain visible through the open front",
  );
  assert.deepEqual(
    authoredInteractionAnchor("landmark.survey-cache", {
      x: layout.centerX,
      z: layout.centerZ,
      height: 0,
    }),
    anchor,
  );
});

test("survey shelter uses landmark-only slab geometry while the crate owns focus", () => {
  const shelter = createSurveyRockShelter();
  const names: string[] = [];
  let dodecahedrons = 0;
  let focusOwners = 0;
  shelter.traverse((object) => {
    names.push(object.name);
    if (object instanceof THREE.Mesh) {
      if (object.geometry instanceof THREE.DodecahedronGeometry) {
        dodecahedrons += 1;
      }
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    }
    if (typeof object.userData.entityId === "string") focusOwners += 1;
  });
  assert.equal(dodecahedrons, 0, "landmark shell cannot reuse mineable outcrop geometry");
  assert.equal(
    names.filter((name) => name === "survey-shelter-side-support").length,
    2,
  );
  assert.ok(names.includes("survey-shelter-roof"));
  assert.ok(names.includes("survey-shelter-back-support"));
  assert.ok(names.includes("survey-shelter-dark-interior"));
  assert.equal(focusOwners, 0, "the shell is scenery, never an interaction target");

  const state = createInitialState("survey-shelter-focus-owner");
  const cache = createRenderSnapshot(state).entities.find(
    (entity) => entity.id === "landmark.survey-cache",
  );
  const anchor = surveyRockShelterCacheAnchor();
  assert.ok(cache);
  assert.deepEqual(cache.interactionAnchor, anchor);
  assert.equal(cache.x, anchor.x);
  assert.equal(cache.z, anchor.z);
  assert.equal(cache.kind, "cache");
});
