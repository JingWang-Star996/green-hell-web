import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TOUCH_PANEL_ENTRIES } from "../../src/game/ui/TouchControls";
import { nextActivePanel } from "../../src/game/ui/menuShortcuts";
import { PANEL_IDS } from "../../src/game/ui/types";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

test("touch navigation covers every panel exactly once", () => {
  assert.deepEqual(TOUCH_PANEL_ENTRIES.map((entry) => entry.id), [...PANEL_IDS]);
  assert.equal(new Set(TOUCH_PANEL_ENTRIES.map((entry) => entry.id)).size, PANEL_IDS.length);
});

test("requesting a panel replaces the current panel while requesting it twice closes it", () => {
  assert.equal(nextActivePanel(null, "inventory"), "inventory");
  assert.equal(nextActivePanel("inventory", "map"), "map");
  assert.equal(nextActivePanel("map", "map"), null);
});

test("mobile CSS reserves safe areas and keeps panels inside the dynamic viewport", () => {
  for (const edge of ["top", "right", "bottom", "left"]) {
    assert.match(
      css,
      new RegExp(`--safe-${edge}:\\s*env\\(safe-area-inset-${edge},\\s*0px\\)`),
    );
  }
  assert.match(css, /height:\s*calc\(100dvh - env\(safe-area-inset-top/);
  assert.match(css, /\.panel-body\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*auto/);
  assert.match(css, /\.panel-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
});

test("mobile CSS collapses persistent clutter and has a short-height layout", () => {
  assert.match(css, /\.equipment-bar\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.event-stack p:nth-child\(n\+2\)\s*\{\s*display:\s*none;/);
  assert.match(css, /max-height:\s*20dvh/);
  assert.match(
    css,
    /@media \(pointer:\s*coarse\), \(any-pointer:\s*coarse\), \(max-width:\s*820px\), \(max-width:\s*1024px\) and \(max-height:\s*500px\)/,
    "touch controls need primary-pointer, hybrid-touch, narrow-width and phone-landscape activation paths",
  );
  assert.match(
    css,
    /@media \(max-height:\s*500px\) and \(pointer:\s*coarse\), \(max-height:\s*500px\) and \(any-pointer:\s*coarse\), \(max-width:\s*1024px\) and \(max-height:\s*500px\)/,
    "the compact landscape layout must activate for 844x390 even when an embedded WebView omits pointer media features",
  );
  assert.match(css, /\.touch-menu-drawer\s*\{[^}]*max-height:\s*calc\(100dvh/);
});

test("CSS never falls below the 11px readable floor and touch labels are capped for narrow screens", () => {
  assert.match(
    css,
    /--ui-font-touch-assist:\s*clamp\(11px,\s*calc\(10px \* var\(--ui-scale\)\),\s*12px\)/,
  );
  assert.match(
    css,
    /--ui-font-touch-label:\s*clamp\(12px,\s*calc\(11px \* var\(--ui-scale\)\),\s*14px\)/,
  );
  assert.doesNotMatch(
    css,
    /(?:font-size|font)\s*:[^;{}]*\b(?:[1-9]|10)px\b/,
    "literal font declarations below 11px bypass the UI-scale readable floor",
  );

  assert.match(
    css,
    /\.touch-action,\s*\.touch-sprint,\s*\.touch-menu-toggle\s*\{[^}]*font-size:\s*var\(--ui-font-touch-label\)/,
  );
  assert.match(
    css,
    /\.touch-menu-tabs button\s*\{[^}]*min-height:\s*44px[^}]*font-size:\s*var\(--ui-font-touch-label\)/,
  );
  assert.match(
    css,
    /\.touch-menu-section button strong,\s*\.touch-menu-section button small\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/,
  );
});

test("390px HUD keeps enlarged auxiliary text inside bounded single-line regions", () => {
  assert.match(
    css,
    /\.objective-card strong\s*\{[^}]*font-size:\s*var\(--ui-font-touch-label\)[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/,
  );
  assert.match(
    css,
    /\.objective-card small\s*\{[^}]*font-size:\s*var\(--ui-font-touch-assist\)[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/,
  );
  assert.match(
    css,
    /\.save-status-indicator\s*\{[^}]*max-width:\s*min\(170px,\s*44vw\)[^}]*font-size:\s*var\(--ui-font-touch-assist\)[^}]*text-overflow:\s*ellipsis/,
  );
  assert.match(
    css,
    /\.event-stack p\s*\{[^}]*font-size:\s*var\(--ui-font-touch-assist\)[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/,
  );
});
