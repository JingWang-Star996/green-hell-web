import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  applyRiverLevelToGroup,
  createRiverGaugeModel,
} from "../../src/game/render/RainforestRenderer";
import {
  RIVER_GAUGE_ID,
  RIVER_GAUGE_OBSTRUCTION_ID,
  RIVER_GAUGE_POSITION,
} from "../../src/game/sim/campaignContent";
import { createInitialState } from "../../src/game/sim/state";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import { RIVER_GAUGE_SAFE_LEVEL_METERS } from "../../src/game/world/riverHydrology";
import {
  RIVER_SURFACE_HALF_WIDTH,
  riverCenter,
  riverSurfaceHeight,
  terrainHeight,
} from "../../src/game/world/terrain";

test("gauge has a dedicated model and authored interaction anchor", () => {
  const state = createInitialState("river-gauge-render");
  state.player.position = { ...state.world.entities[RIVER_GAUGE_ID].position };
  const snapshot = createRenderSnapshot(state);
  const gauge = snapshot.entities.find((entity) => entity.id === RIVER_GAUGE_ID);
  const obstruction = snapshot.entities.find(
    (entity) => entity.id === RIVER_GAUGE_OBSTRUCTION_ID,
  );

  assert.equal(gauge?.kind, "river-gauge");
  assert.equal(gauge?.interactionAnchor?.height, 1.2);
  assert.equal(gauge?.affordance.blocker, "access-obstructed");
  assert.equal(obstruction?.kind, "tree");

  const model = createRiverGaugeModel();
  assert.ok(model.getObjectByName("river-gauge-post"));
  const safeLine = model.getObjectByName("river-gauge-safe-line");
  assert.ok(safeLine);
  assert.ok(model.getObjectByName("river-gauge-orange-cap"));
  assert.equal(
    model.children.filter((child) => child.name.startsWith("river-gauge-mark-")).length,
    8,
  );
  assert.ok(
    Math.abs(RIVER_GAUGE_POSITION.z - riverCenter(RIVER_GAUGE_POSITION.x)) <
      RIVER_SURFACE_HALF_WIDTH,
    "the staff must stand in the water rather than on a dry bank",
  );
  assert.ok(
    Math.abs(
      terrainHeight(RIVER_GAUGE_POSITION.x, RIVER_GAUGE_POSITION.z) +
        safeLine.position.y -
        riverSurfaceHeight(
          RIVER_GAUGE_POSITION.x,
          RIVER_GAUGE_SAFE_LEVEL_METERS,
        ),
    ) < 1e-9,
    "the orange line must be the same physical threshold used by the report",
  );
});

test("snapshot, river surface and existing river groups share one level offset", () => {
  const state = createInitialState("river-level-render");
  state.world.riverHydrology!.levelMeters = 0.31;
  state.world.riverHydrology!.trendMetersPerGameHour = 0.12;
  const snapshot = createRenderSnapshot(state);
  const x = 48;

  assert.equal(snapshot.riverLevelMeters, 0.31);
  assert.equal(snapshot.riverTrend, "rising");
  assert.ok(
    Math.abs(
      riverSurfaceHeight(x, snapshot.riverLevelMeters) -
        riverSurfaceHeight(x) -
        0.31,
    ) < 1e-12,
  );

  const existingGroup = new THREE.Group();
  applyRiverLevelToGroup(existingGroup, snapshot.riverLevelMeters);
  assert.equal(existingGroup.position.y, 0.31);
  applyRiverLevelToGroup(existingGroup, -0.04);
  assert.equal(existingGroup.position.y, -0.04);
});
