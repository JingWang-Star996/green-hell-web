import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TOUCH_PANEL_ENTRIES,
  TouchControls,
} from "../../src/game/ui/TouchControls";
import { PANEL_IDS } from "../../src/game/ui/types";

const noop = () => undefined;
const menuProps = {
  equipmentSlots: [],
  equipped: null,
  onEquip: noop,
  onOpenPanel: noop,
};

test("touch action exposes the resolved world verb and target", () => {
  const markup = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "砍伐",
      actionTarget: "棕榈树",
      actionDetail: "需要装备石斧；长按完成砍伐。",
      interactionMode: "execute",
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      ...menuProps,
    }),
  );

  assert.match(markup, /aria-label="砍伐：棕榈树"/);
  assert.match(markup, /<strong>砍伐<\/strong>/);
  assert.match(markup, /<small>棕榈树<\/small>/);
  assert.match(markup, /需要装备石斧；长按完成砍伐。/);
  assert.doesNotMatch(markup, /disabled=""/);
});

test("touch action is a non-clickable status when no action is available", () => {
  const markup = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "互动",
      interactionMode: "unavailable",
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      ...menuProps,
    }),
  );

  assert.match(markup, /class="touch-action touch-action-status"/);
  assert.match(markup, /data-interaction-mode="unavailable"/);
  assert.doesNotMatch(markup, /<button[^>]*class="touch-action"/);
});

test("touch inspect stays actionable while movement is advice only", () => {
  const inspect = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "调查",
      actionTarget: "气象站控制柜",
      interactionMode: "inspect",
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      ...menuProps,
    }),
  );
  assert.match(inspect, /<button[^>]*data-interaction-mode="inspect"/);
  assert.match(inspect, /<strong>查看<\/strong>/);
  assert.doesNotMatch(inspect, /disabled=""/);

  const movement = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "保持距离",
      actionTarget: "矛头蝮蛇",
      interactionMode: "movement",
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      ...menuProps,
    }),
  );
  assert.match(movement, /data-interaction-mode="movement"/);
  assert.match(movement, /<strong>行动建议<\/strong>/);
  assert.doesNotMatch(movement, /<button[^>]*class="touch-action"/);
});

test("touch exposes crafting and the exact shared blocker explanation", () => {
  const markup = renderToStaticMarkup(
    createElement(TouchControls, {
      visible: true,
      onInput: noop,
      onInteract: noop,
      actionLabel: "添柴",
      actionTarget: "营火",
      actionDetail: "燃料已满；无需浪费木棍。",
      interactionMode: "unavailable",
      placementActive: false,
      onRotatePlacement: noop,
      onCancelPlacement: noop,
      ...menuProps,
    }),
  );

  assert.match(markup, /class="touch-menu-toggle"[^>]*aria-expanded="false"/);
  assert.match(markup, /aria-controls="touch-survival-menu"/);
  assert.match(markup, /id="touch-survival-menu"[^>]*hidden=""/);
  assert.deepEqual(TOUCH_PANEL_ENTRIES.map((entry) => entry.id), [...PANEL_IDS]);
  for (const panelId of PANEL_IDS) {
    assert.match(markup, new RegExp(`data-panel-id="${panelId}"`));
  }
  assert.match(markup, /class="touch-action-explanation" role="status"/);
  assert.match(markup, /燃料已满；无需浪费木棍。/);
});
