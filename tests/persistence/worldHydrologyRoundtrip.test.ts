import assert from "node:assert/strict";
import test from "node:test";

import {
  MemoryKV,
  SaveRepository,
} from "../../src/game/persistence";
import { createInitialState } from "../../src/game/sim/state";
import type { GameState } from "../../src/game/sim/types";

function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GameState>;
  return (
    candidate.version === 1 &&
    typeof candidate.seed === "number" &&
    Boolean(candidate.player && candidate.world && candidate.world.entities)
  );
}

test("repository compact save/load preserves authoritative river hydrology exactly", async () => {
  const state = createInitialState("river-hydrology-repository-roundtrip");
  state.world.riverHydrology = {
    version: 1,
    levelMeters: 0.317_625,
    runoff: 0.683_125,
    trendMetersPerGameHour: -0.127_5,
    lastAdvancedTick: 45_678,
  };
  const expected = structuredClone(state.world.riverHydrology);
  const kv = new MemoryKV();
  const repository = new SaveRepository<GameState>({
    key: "river-hydrology-roundtrip",
    schema: 1,
    content: "canopy@river-roundtrip",
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
  assert.deepEqual(restored.envelope.payload.world.riverHydrology, expected);
});

test("repository still loads pre-river compact saves with no hydrology field", async () => {
  const state = createInitialState("pre-river-compact-compatibility");
  delete state.world.riverHydrology;
  const kv = new MemoryKV();
  const repository = new SaveRepository<GameState>({
    key: "pre-river-compact-compatibility",
    schema: 1,
    content: "canopy@pre-river",
    device: "legacy-device",
    kv,
    payloadValidator: isGameState,
  });

  assert.equal(
    (
      await repository.save(state, {
        seed: state.seed,
        simTick: state.clock.tick,
      })
    ).ok,
    true,
  );
  const restored = await repository.load({ allowCloudFallback: false });
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.equal(restored.envelope.payload.world.riverHydrology, undefined);
});
