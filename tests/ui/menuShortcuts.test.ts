import assert from "node:assert/strict";
import test from "node:test";

import {
  PANEL_BY_SHORTCUT_CODE,
  isGameHotkeySuppressedTarget,
  normalizeMenuShortcutCode,
  panelForShortcutCode,
  resolveMenuKeyAction,
} from "../../src/game/ui/menuShortcuts";
import type { PanelId } from "../../src/game/ui/types";

const PANEL_SHORTCUTS: ReadonlyArray<readonly [string, PanelId]> = [
  ["Tab", "inventory"],
  ["KeyC", "crafting"],
  ["KeyB", "body"],
  ["KeyN", "notebook"],
  ["KeyM", "map"],
  ["KeyF", "watch"],
];

test("embedded-browser printable keys normalize to stable shortcut codes", () => {
  assert.equal(normalizeMenuShortcutCode("", "c"), "KeyC");
  assert.equal(normalizeMenuShortcutCode("C", "C"), "KeyC");
  assert.equal(normalizeMenuShortcutCode("", "Tab"), "Tab");
  assert.equal(normalizeMenuShortcutCode("", "Esc"), "Escape");
  assert.equal(normalizeMenuShortcutCode("KeyM", "m"), "KeyM");
  assert.equal(normalizeMenuShortcutCode("Digit1", "1"), "Digit1");
});

test("desktop panel shortcut table covers Tab/C/B/N/M/F exactly once", () => {
  assert.deepEqual(
    Object.entries(PANEL_BY_SHORTCUT_CODE).sort(),
    [...PANEL_SHORTCUTS].sort(),
  );
  for (const [code, panel] of PANEL_SHORTCUTS) {
    assert.equal(panelForShortcutCode(code), panel);
  }
  assert.equal(panelForShortcutCode("KeyX"), null);
});

test("every panel hotkey opens, closes itself, and replaces a conflicting panel", () => {
  for (const [code, panel] of PANEL_SHORTCUTS) {
    assert.deepEqual(resolveMenuKeyAction({
      code,
      currentPanel: null,
      placementActive: false,
      playing: true,
    }), { type: "set-panel", panel });
    assert.deepEqual(resolveMenuKeyAction({
      code,
      currentPanel: panel,
      placementActive: false,
      playing: true,
    }), { type: "set-panel", panel: null });
    assert.deepEqual(resolveMenuKeyAction({
      code,
      currentPanel: panel === "map" ? "body" : "map",
      placementActive: false,
      playing: true,
    }), { type: "set-panel", panel });
  }
});

test("Escape pops the current panel before pause and cancels placement before pause", () => {
  assert.deepEqual(resolveMenuKeyAction({
    code: "Escape",
    currentPanel: "notebook",
    placementActive: false,
    playing: true,
  }), { type: "set-panel", panel: null });
  assert.deepEqual(resolveMenuKeyAction({
    code: "Escape",
    currentPanel: null,
    placementActive: false,
    playing: true,
  }), { type: "set-panel", panel: "pause" });
  assert.deepEqual(resolveMenuKeyAction({
    code: "Escape",
    currentPanel: "pause",
    placementActive: false,
    playing: true,
  }), { type: "set-panel", panel: null });
  assert.deepEqual(resolveMenuKeyAction({
    code: "Escape",
    currentPanel: null,
    placementActive: true,
    playing: true,
  }), { type: "cancel-placement" });
});

test("placement and completed runs cannot accidentally open a new system panel", () => {
  assert.deepEqual(resolveMenuKeyAction({
    code: "KeyC",
    currentPanel: null,
    placementActive: true,
    playing: true,
  }), { type: "none" });
  assert.deepEqual(resolveMenuKeyAction({
    code: "KeyM",
    currentPanel: null,
    placementActive: false,
    playing: false,
  }), { type: "none" });
  assert.deepEqual(resolveMenuKeyAction({
    code: "KeyN",
    currentPanel: "notebook",
    placementActive: false,
    playing: false,
  }), { type: "set-panel", panel: null });
});

test("form controls, sliders and editable descendants suppress game hotkeys", () => {
  const input = { tagName: "input" } as unknown as EventTarget;
  const slider = {
    tagName: "div",
    getAttribute: (name: string) => name === "role" ? "slider" : null,
  } as unknown as EventTarget;
  const editableChild = {
    tagName: "span",
    closest: () => ({ contentEditable: true }),
  } as unknown as EventTarget;
  const button = {
    tagName: "button",
    getAttribute: () => null,
    closest: () => null,
  } as unknown as EventTarget;

  assert.equal(isGameHotkeySuppressedTarget(input), true);
  assert.equal(isGameHotkeySuppressedTarget(slider), true);
  assert.equal(isGameHotkeySuppressedTarget(editableChild), true);
  assert.equal(isGameHotkeySuppressedTarget(button), false);
  assert.deepEqual(resolveMenuKeyAction({
    code: "KeyF",
    currentPanel: "pause",
    placementActive: false,
    playing: true,
    focusTarget: input,
  }), { type: "bypass-game-hotkeys" });
  assert.deepEqual(resolveMenuKeyAction({
    code: "Escape",
    currentPanel: "pause",
    placementActive: false,
    playing: true,
    focusTarget: slider,
  }), { type: "release-control-focus" });
});

test("repeats, browser modifiers and reverse tabbing bypass game hotkeys", () => {
  const base = {
    code: "KeyF",
    currentPanel: null,
    placementActive: false,
    playing: true,
  } as const;
  assert.deepEqual(resolveMenuKeyAction({ ...base, repeat: true }), { type: "bypass-game-hotkeys" });
  assert.deepEqual(resolveMenuKeyAction({ ...base, ctrlKey: true }), { type: "bypass-game-hotkeys" });
  assert.deepEqual(resolveMenuKeyAction({ ...base, altKey: true }), { type: "bypass-game-hotkeys" });
  assert.deepEqual(resolveMenuKeyAction({ ...base, metaKey: true }), { type: "bypass-game-hotkeys" });
  assert.deepEqual(resolveMenuKeyAction({ ...base, code: "Tab", shiftKey: true }), { type: "bypass-game-hotkeys" });
});
