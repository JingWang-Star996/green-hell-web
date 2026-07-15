import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MemoryKV,
  SaveRepository,
  autosaveReasonForEvents,
} from "../../src/game/persistence";
import {
  eventsNeedingAutosave,
  markRestCompletionAsCheckpointed,
  resolveDialogEscapeAction,
  writeVerifiedNewGameCheckpoint,
} from "../../src/game/GameClient";
import {
  createInitialState,
  type GameState,
} from "../../src/game/sim";
import { shouldCloseCraftingPanelImmediately } from "../../src/game/ui/Panels";

function isGameState(value: unknown): value is GameState {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as GameState).seed === "number" &&
      typeof (value as GameState).clock?.tick === "number",
  );
}

test("a new run publishes one verified, immediately loadable new-game recovery point", () => {
  const repository = new SaveRepository<GameState>({
    key: "new-game.integration",
    schema: 1,
    content: "new-game@test",
    device: "test-device",
    kv: new MemoryKV(),
    payloadValidator: isGameState,
  });
  const state = createInitialState(9_001);

  const written = writeVerifiedNewGameCheckpoint(repository, state);
  assert.equal(written.ok, true);

  const timeline = repository.listCheckpoints();
  assert.equal(timeline.entries.length, 1);
  assert.equal(timeline.entries[0]?.reason, "new-game");
  assert.equal(timeline.entries[0]?.validation, "verified");

  const loaded = repository.loadCheckpoint(timeline.entries[0]!.slotId);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.envelope.seed, state.seed);
  assert.equal(loaded.envelope.simTick, state.clock.tick);
});

test("the verified rest completion is consumed once by checkpoint ownership, not autosaved again", () => {
  const checkpointedIds = new Set<number>();
  const restOnly = [{ id: 41, type: "rest-completed" }];

  assert.equal(
    markRestCompletionAsCheckpointed(restOnly, 40, checkpointedIds),
    41,
  );
  const remaining = eventsNeedingAutosave(restOnly, checkpointedIds);
  assert.deepEqual(remaining, []);
  assert.equal(autosaveReasonForEvents(remaining), null);
  assert.equal(checkpointedIds.size, 0);
});

test("rest ownership suppresses only the duplicate rest save and preserves a simultaneous task save", () => {
  const checkpointedIds = new Set<number>();
  const events = [
    { id: 51, type: "rest-completed" },
    { id: 52, type: "task-completed" },
  ];

  markRestCompletionAsCheckpointed(events, 50, checkpointedIds);
  const remaining = eventsNeedingAutosave(events, checkpointedIds);
  assert.deepEqual(remaining, [{ id: 52, type: "task-completed" }]);
  assert.equal(autosaveReasonForEvents(remaining), "task");
});

test("checkpoint recovery owns Escape and consumes it without closing while loading", () => {
  assert.equal(resolveDialogEscapeAction("Tab", true, false), "none");
  assert.equal(resolveDialogEscapeAction("Escape", false, false), "none");
  assert.equal(resolveDialogEscapeAction("Escape", true, false), "close");
  assert.equal(resolveDialogEscapeAction("Escape", true, true), "consume");
});

test("rest never closes synchronously; world placement still closes after acceptance", () => {
  assert.equal(shouldCloseCraftingPanelImmediately("rest", true), false);
  assert.equal(shouldCloseCraftingPanelImmediately("rest", false), false);
  assert.equal(shouldCloseCraftingPanelImmediately("campfire", true), true);
  assert.equal(shouldCloseCraftingPanelImmediately("campfire", false), false);
  assert.equal(shouldCloseCraftingPanelImmediately("add-fuel", true), false);
});

test("the client wires the policies into the new-run, rest, and top-dialog paths", () => {
  const clientSource = readFileSync(
    new URL("../../src/game/GameClient.tsx", import.meta.url),
    "utf8",
  );
  const panelsSource = readFileSync(
    new URL("../../src/game/ui/Panels.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(
    [...clientSource.matchAll(/writeVerifiedNewGameCheckpoint\(repository, current\)/g)].length >= 2,
    "both pre-initialization and normal title-screen starts must create a recovery point",
  );
  assert.match(
    clientSource,
    /const runSeed = state\.seed;[\s\S]*if \(!current \|\| current\.seed !== runSeed\) return;/,
    "the async clear guard must compare the hashed GameState seed, not the unhashed session seed",
  );
  assert.match(
    clientSource,
    /const committed = commitAppliedCommand[\s\S]*markRestCompletionAsCheckpointed\([\s\S]*return committed;/,
  );
  assert.match(
    clientSource,
    /const autosaveEvents = eventsNeedingAutosave\([\s\S]*autosaveReasonForEvents\(autosaveEvents\)/,
  );
  assert.match(
    clientSource,
    /useDialogFocus\(\{\s*onEscape: onClose,\s*escapeDisabled: loading,?\s*\}\)/,
  );
  assert.match(clientSource, /event\.stopPropagation\(\)/);
  assert.match(
    clientSource,
    /if \(!transaction\.ok\)[\s\S]*return;[\s\S]*activePanelRef\.current = null;\s*setActivePanel\(null\);/,
  );
  assert.match(
    panelsSource,
    /shouldCloseCraftingPanelImmediately\(recipe\.id, accepted\)/,
  );
});
