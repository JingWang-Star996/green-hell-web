import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCommand,
  createInitialState,
  gameHoursToTicks,
} from "../../src/game/sim/index";
import { RIVER_SURFACE_HALF_WIDTH, riverDistance } from "../../src/game/world/terrain";

const GUARANTEED_STONES = [
  "resource.stone.river-bank-west-01",
  "resource.stone.river-bank-south-01",
  "resource.stone.river-bank-east-01",
] as const;

const GUARANTEED_VINES = [
  "resource.vine.river-approach-01",
  "resource.vine.river-east-01",
] as const;

const GUARANTEED_TINDER = [
  "resource.dry-leaf.camp-01",
  "resource.dry-leaf.camp-02",
  "resource.dry-leaf.river-approach-01",
] as const;

test("the opening route guarantees loose stone and fallen vine outside the crash site", () => {
  const state = createInitialState("opening-resource-guarantees");
  const ids = [...GUARANTEED_STONES, ...GUARANTEED_VINES];
  const entities = ids.map((id) => state.world.entities[id]);

  assert.ok(entities.every(Boolean));
  assert.equal(new Set(entities.map((entity) => entity.id)).size, 5);
  assert.ok(
    entities.every((entity) => entity.tags.includes("guaranteed-early")),
  );
  assert.ok(
    entities.every(
      (entity) =>
        Math.hypot(
          entity.position.x - state.player.position.x,
          entity.position.z - state.player.position.z,
        ) <= 34,
    ),
    "every authored guarantee stays within the opening exploration radius",
  );

  const stones = GUARANTEED_STONES.map((id) => state.world.entities[id]);
  assert.ok(stones.every((entity) => entity.itemId === "stone"));
  assert.ok(stones.every((entity) => entity.tags.includes("loose-stone")));
  assert.equal(
    stones.reduce((total, entity) => total + entity.quantity, 0),
    6,
  );
  assert.ok(
    stones.every((entity) => {
      const distance = riverDistance(entity.position.x, entity.position.z);
      return distance > RIVER_SURFACE_HALF_WIDTH && distance <= 4.8;
    }),
    "loose stones sit on the visible river bank instead of only at the plane",
  );

  const vines = GUARANTEED_VINES.map((id) => state.world.entities[id]);
  assert.ok(vines.every((entity) => entity.itemId === "vine"));
  assert.ok(vines.every((entity) => entity.tags.includes("fallen-vine")));
  assert.equal(
    vines.reduce((total, entity) => total + entity.quantity, 0),
    4,
  );
  assert.ok(
    vines.every((entity) => entity.position.z < state.player.position.z),
    "fallen vines pull the player from the crash site toward the river route",
  );
});

test("the camp stone label distinguishes a loose pickup pile from a rock body", () => {
  const state = createInitialState("opening-stone-language");
  const campStone = state.world.entities["resource.stone.camp-01"];

  assert.equal(campStone.label, "坠机碎石堆");
  assert.equal(campStone.itemId, "stone");
  assert.equal(campStone.tags.includes("mineable-rock"), false);
});

test("every opening seed exposes several landmarked tinder piles without spawning at the player's feet", () => {
  for (const seed of Array.from({ length: 48 }, (_, index) => `opening-tinder-${index}`)) {
    const state = createInitialState(seed);
    const tinder = GUARANTEED_TINDER.map((id) => state.world.entities[id]);
    assert.ok(tinder.every(Boolean), seed);
    assert.ok(
      tinder.every(
        (entity) =>
          entity.itemId === "dry-leaf" &&
          entity.tags.includes("guaranteed-early") &&
          entity.tags.includes("tinder") &&
          entity.label.includes("干叶"),
      ),
      seed,
    );
    assert.ok(
      tinder.every((entity) => {
        const distance = Math.hypot(
          entity.position.x - state.player.position.x,
          entity.position.z - state.player.position.z,
        );
        return distance >= 4 && distance <= 18;
      }),
      `${seed}: authored piles must be searched for, but remain on the opening route`,
    );
    assert.ok(
      tinder.reduce((total, entity) => total + entity.quantity, 0) >= 8,
      `${seed}: one campfire, one torch, and recovery margin must be available`,
    );
  }
});

test("depleted starter tinder schedules a bounded recovery window instead of an instant refill", () => {
  let state = createInitialState("opening-tinder-regeneration");
  const id = "resource.dry-leaf.camp-02";
  state = applyCommand(state, {
    type: "move-player",
    position: state.world.entities[id].position,
  });
  const quantity = state.world.entities[id].quantity;
  for (let index = 0; index < quantity; index += 1) {
    state = applyCommand(state, { type: "pick-up", entityId: id });
  }

  const entity = state.world.entities[id];
  assert.equal(entity.quantity, 0);
  assert.equal(entity.depleted, true);
  assert.ok(entity.regeneration?.nextTick);
  const delay = entity.regeneration.nextTick! - state.clock.tick;
  assert.ok(delay >= gameHoursToTicks(2));
  assert.ok(delay <= gameHoursToTicks(6));
});
