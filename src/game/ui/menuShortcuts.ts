import type { PanelId } from "./types";

export const PANEL_BY_SHORTCUT_CODE: Readonly<Partial<Record<string, PanelId>>> = {
  KeyF: "watch",
  Tab: "inventory",
  KeyC: "crafting",
  KeyB: "body",
  KeyN: "notebook",
  KeyM: "map",
};

type KeyboardTargetLike = {
  tagName?: unknown;
  isContentEditable?: unknown;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
};

export type MenuKeyAction =
  | { type: "none" }
  | { type: "bypass-game-hotkeys" }
  | { type: "release-control-focus" }
  | { type: "set-panel"; panel: PanelId | null }
  | { type: "cancel-placement" };

export type MenuKeyState = {
  code: string;
  currentPanel: PanelId | null;
  placementActive: boolean;
  playing: boolean;
  focusTarget?: EventTarget | null;
  repeat?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
};

export function panelForShortcutCode(code: string): PanelId | null {
  return PANEL_BY_SHORTCUT_CODE[code] ?? null;
}

/**
 * Some embedded/mobile browser shells omit `KeyboardEvent.code` or expose the
 * printable key instead. Prefer the physical code, but retain a reliable
 * fallback when a control inside a panel owns focus.
 */
export function normalizeMenuShortcutCode(code: string, key: string): string {
  if (code === "Escape" || Object.prototype.hasOwnProperty.call(PANEL_BY_SHORTCUT_CODE, code)) {
    return code;
  }
  if (key === "Escape" || key === "Esc") return "Escape";
  if (key === "Tab") return "Tab";
  switch (key.toLowerCase()) {
    case "f": return "KeyF";
    case "c": return "KeyC";
    case "b": return "KeyB";
    case "n": return "KeyN";
    case "m": return "KeyM";
    default: return code;
  }
}

export function nextActivePanel(
  current: PanelId | null,
  requested: PanelId,
): PanelId | null {
  return current === requested ? null : requested;
}

/**
 * Native form controls keep ownership of keyboard input. Escape first releases
 * that focused control; the next Escape can then pop the current game layer.
 */
export function isGameHotkeySuppressedTarget(target: EventTarget | null | undefined): boolean {
  if (!target) return false;
  const candidate = target as EventTarget & KeyboardTargetLike;
  const tagName = typeof candidate.tagName === "string"
    ? candidate.tagName.toUpperCase()
    : "";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }
  if (candidate.isContentEditable === true) return true;
  const role = typeof candidate.getAttribute === "function"
    ? candidate.getAttribute("role")
    : null;
  if (role === "slider" || role === "textbox" || role === "combobox" || role === "spinbutton") {
    return true;
  }
  return typeof candidate.closest === "function" && Boolean(candidate.closest(
    "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='slider'], [role='textbox'], [role='combobox'], [role='spinbutton']",
  ));
}

/**
 * One deterministic keyboard state machine for every desktop system panel.
 * The caller only performs the returned action; panel replacement, same-key
 * closing and Escape layer order cannot drift into separate event branches.
 */
export function resolveMenuKeyAction(state: MenuKeyState): MenuKeyAction {
  if (
    state.repeat ||
    state.altKey ||
    state.ctrlKey ||
    state.metaKey ||
    (state.code === "Tab" && state.shiftKey)
  ) {
    return { type: "bypass-game-hotkeys" };
  }

  if (isGameHotkeySuppressedTarget(state.focusTarget)) {
    return state.code === "Escape"
      ? { type: "release-control-focus" }
      : { type: "bypass-game-hotkeys" };
  }

  const requestedPanel = panelForShortcutCode(state.code);
  if (requestedPanel) {
    if (!state.playing) {
      return state.currentPanel === requestedPanel
        ? { type: "set-panel", panel: null }
        : { type: "none" };
    }
    if (state.placementActive && state.currentPanel === null) {
      return { type: "none" };
    }
    return {
      type: "set-panel",
      panel: nextActivePanel(state.currentPanel, requestedPanel),
    };
  }

  if (state.code !== "Escape") return { type: "none" };
  if (state.currentPanel !== null) return { type: "set-panel", panel: null };
  if (state.placementActive) return { type: "cancel-placement" };
  if (state.playing) return { type: "set-panel", panel: "pause" };
  return { type: "none" };
}
