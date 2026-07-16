import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { InteractionTarget } from "../../src/game/render/types";
import {
  getStructureDismantlePlan,
  migrateGameState,
} from "../../src/game/sim";
import { createInitialState } from "../../src/game/sim/state";
import { DismantleConfirmation } from "../../src/game/ui/DismantleConfirmation";
import { Hud } from "../../src/game/ui/Hud";
import { TouchControls } from "../../src/game/ui/TouchControls";
import { createGameViewModel } from "../../src/game/ui/viewModel";

const noop = () => undefined;

function stateWithCollector() {
  const state = createInitialState("dismantle-ui");
  state.player.position = { x: 0, y: 0, z: 0 };
  state.camp.structures = [
    {
      id: "collector.ui",
      kind: "rain-collector",
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 0,
      storedUnits: 0,
      capacity: 4,
      lastAdvancedTick: state.clock.tick,
    },
  ];
  return migrateGameState(state);
}

test("confirmation defaults to preserving the empty structure and exposes refunds", () => {
  const plan = getStructureDismantlePlan(stateWithCollector(), "collector.ui");
  assert.equal(plan.ok, true);
  const markup = renderToStaticMarkup(
    createElement(DismantleConfirmation, {
      plan,
      onConfirm: noop,
      onCancel: noop,
    }),
  );

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /拆除雨水收集架/);
  assert.match(markup, /木棍/);
  assert.match(markup, /宽叶/);
  assert.doesNotMatch(markup, /倾倒/);
  assert.match(markup, /tabindex="-1"/);
  assert.match(markup, />保留建筑</);
  assert.doesNotMatch(markup, /确认拆除[^<]*disabled/);
});

test("desktop HUD and touch controls expose the same contextual dismantle action", () => {
  const state = stateWithCollector();
  const renderEntity = createGameViewModel(state).render.entities.find(
    (entity) => entity.id === "collector.ui",
  );
  assert.ok(renderEntity);
  const target: InteractionTarget = {
    id: renderEntity.id,
    kind: renderEntity.kind,
    label: renderEntity.label,
    distance: 1,
    affordance: renderEntity.affordance,
  };
  const plan = getStructureDismantlePlan(state, target.id);

  const hud = renderToStaticMarkup(
    createElement(Hud, {
      watch: {
        day: 1,
        time: "12:00",
        coordinates: "0 / 0",
        weather: "clear",
        biome: "forest",
        rain: 0,
        meters: [],
      },
      meters: [],
      objective: null,
      target,
      pointerLocked: true,
      ready: true,
      events: [],
      compassDegrees: 0,
      onFocusGame: noop,
      onOpenWatch: noop,
      onOpenBody: noop,
      dismantleAction: {
        available: plan.ok,
        detail: plan.message,
        onRequest: noop,
      },
    }),
  );
  assert.match(hud, /class="interaction-dismantle"/);
  assert.match(hud, /aria-keyshortcuts="R"/);
  assert.match(hud, /返还 木棍/);

  const touch = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "收取",
      actionTarget: "雨水收集架",
      interactionMode: "execute",
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      equipmentSlots: [],
      equipped: null,
      onEquip: noop,
      onOpenPanel: noop,
      secondaryAction: {
        label: "拆除",
        target: "雨水收集架",
        detail: plan.message,
        onTrigger: noop,
      },
    }),
  );
  assert.match(touch, /class="touch-secondary-action"/);
  assert.match(touch, /aria-label="拆除：雨水收集架"/);
});

test("blocked touch dismantle remains tappable and exposes the exact remedy", () => {
  const state = stateWithCollector();
  state.inventory.stick = 32;
  const plan = getStructureDismantlePlan(state, "collector.ui");
  assert.equal(plan.ok, false);
  assert.equal(plan.blocker, "inventory-full");

  const markup = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "收取",
      actionTarget: "雨水收集架",
      interactionMode: "execute",
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      equipmentSlots: [],
      equipped: null,
      onEquip: noop,
      onOpenPanel: noop,
      secondaryAction: {
        label: "拆除",
        target: "雨水收集架",
        detail: plan.message,
        blocked: true,
        onTrigger: noop,
      },
    }),
  );

  assert.match(markup, /class="touch-secondary-action is-blocked"/);
  assert.match(markup, /aria-disabled="true"/);
  assert.match(markup, /aria-label="暂不可拆：雨水收集架；背包装不下返还的木棍/);
  assert.match(markup, />暂不可拆</);
  assert.doesNotMatch(
    markup,
    /class="touch-secondary-action is-blocked"[^>]*\sdisabled(?:=|\s|>)/,
  );
});

test("client pause and modal focus contracts protect a pending dismantle", () => {
  const clientSource = readFileSync(
    new URL("../../src/game/GameClient.tsx", import.meta.url),
    "utf8",
  );
  const dialogSource = readFileSync(
    new URL("../../src/game/ui/DismantleConfirmation.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    clientSource,
    /restCheckpointBarrierRef\.current \|\| pendingDismantleIdRef\.current \|\| !rendererReadyRef\.current/,
  );
  assert.match(dialogSource, /cancelRef\.current\?\.focus/);
  assert.match(dialogSource, /event\.key !== "Tab"/);
  assert.match(dialogSource, /setAttribute\("inert", ""\)/);
  assert.match(dialogSource, /previousActiveElement\.focus/);
});

test("dismantle touch action and confirmation choices keep 44px targets", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.touch-secondary-action\s*\{[^}]*min-height:\s*48px/);
  assert.match(css, /\.dismantle-dialog > footer button\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.dismantle-dialog > header button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
});
