import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ActionPhase } from "../../src/game/render/types";
import { Hud } from "../../src/game/ui/Hud";
import { TouchControls } from "../../src/game/ui/TouchControls";

const noop = () => undefined;
const touchMenuProps = {
  equipmentSlots: [],
  equipped: null,
  onEquip: noop,
  onOpenPanel: noop,
};

const windup: ActionPhase = {
  phase: "windup",
  targetId: "tree:one",
  targetLabel: "棕榈树",
  verb: "砍伐",
  progress: 0.5,
};

const hudBase = {
  watch: {
    day: 1,
    time: "12:00",
    coordinates: "0 / 0",
    weather: "晴",
    biome: "低地雨林",
    rain: 0,
    meters: [],
  },
  meters: [],
  objective: null,
  target: null,
  pointerLocked: true,
  ready: true,
  events: [],
  compassDegrees: 0,
  onFocusGame: noop,
  onOpenWatch: noop,
  onOpenBody: noop,
};

test("HUD renders session action progress and a clear uncommitted interruption", () => {
  const active = renderToStaticMarkup(
    createElement(Hud, { ...hudBase, actionPhase: windup }),
  );
  assert.match(active, /class="action-phase action-phase-windup"/);
  assert.match(active, /准备砍伐/);
  assert.match(active, /aria-valuenow="50"/);
  assert.equal((active.match(/aria-live="polite"/g) ?? []).length, 1);
  assert.doesNotMatch(
    active,
    /class="action-phase action-phase-windup"[^>]*aria-live/,
  );

  const hitWindow = renderToStaticMarkup(
    createElement(Hud, {
      ...hudBase,
      actionPhase: { ...windup, phase: "hit-window" },
    }),
  );
  assert.match(hitWindow, /砍伐判定/);
  assert.match(hitWindow, /结果以系统回执为准/);
  assert.doesNotMatch(hitWindow, /砍伐命中/);

  const interrupted = renderToStaticMarkup(
    createElement(Hud, {
      ...hudBase,
      actionPhase: {
        ...windup,
        phase: "interrupted",
        interruptReason: "target-lost",
      },
    }),
  );
  assert.match(interrupted, /动作中断/);
  assert.match(interrupted, /动作没有提交/);
  assert.doesNotMatch(interrupted, /role="progressbar"/);
});

test("touch action shows progress and disables repeat input until recovery ends", () => {
  const markup = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "砍伐",
      actionTarget: "棕榈树",
      interactionMode: "execute",
      actionPhase: windup,
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      ...touchMenuProps,
    }),
  );
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /disabled=""/);
  assert.match(markup, /准备砍伐/);
  assert.match(markup, /class="touch-action-progress"/);
});
