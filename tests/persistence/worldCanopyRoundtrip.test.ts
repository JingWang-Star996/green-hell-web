import assert from "node:assert/strict";
import test from "node:test";

import { MemoryKV, SaveRepository } from "../../src/game/persistence";
import {
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  advanceCanopyJunctionSampling,
  createCanopyJunctionState,
  recordCanopyObstructionCleared,
  transitionCanopyJunctionPhase,
} from "../../src/game/sim/canopyJunction";
import { createInitialState } from "../../src/game/sim/state";
import type { GameState } from "../../src/game/sim/types";
import { createWindFieldState } from "../../src/game/world/windField";

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  return candidate.version === 1 &&
    typeof candidate.seed === "number" &&
    Boolean(candidate.player && candidate.world && candidate.world.entities);
}

test("repository compact save/load preserves wind and C-17 state through the real envelope path", async () => {
  const state = createInitialState(42);
  const captureTick = 1_620;
  state.clock.tick = captureTick;
  state.world.windField = createWindFieldState(state.seed, captureTick);
  let junction = createCanopyJunctionState(0);
  junction = recordCanopyObstructionCleared(
    junction,
    CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
    0,
  );
  junction = transitionCanopyJunctionPhase(junction, "connector-open", 0);
  junction = transitionCanopyJunctionPhase(junction, "link-restored", 0);
  junction = advanceCanopyJunctionSampling(junction, {
    worldSeed: state.seed,
    tick: captureTick,
  });
  assert.equal(junction.phase, "sample-ready");
  state.world.canopyJunction = junction;

  const expectedWind = structuredClone(state.world.windField);
  const expectedJunction = structuredClone(state.world.canopyJunction);
  const kv = new MemoryKV();
  const repository = new SaveRepository<GameState>({
    key: "canopy-world-roundtrip",
    schema: 1,
    content: "canopy@a2-roundtrip",
    device: "roundtrip-device",
    kv,
    payloadValidator: isGameState,
  });

  const saved = await repository.save(state, {
    seed: state.seed,
    simTick: state.clock.tick,
  });
  assert.equal(saved.ok, true);
  const restored = await repository.load({ allowCloudFallback: false });
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.deepEqual(restored.envelope.payload.world.windField, expectedWind);
  assert.deepEqual(
    restored.envelope.payload.world.canopyJunction,
    expectedJunction,
  );
});
