import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_UI_SETTINGS,
  UI_SETTINGS_KEY,
  normalizeUiScale,
  normalizeUiSettings,
  readUiSettings,
  uiScaleFactor,
  writeUiSettings,
} from "../../src/game/ui/uiSettings";

class SettingsStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

test("UI scale clamps to 80-140 and snaps to five-percent steps", () => {
  assert.equal(normalizeUiScale(77), 80);
  assert.equal(normalizeUiScale(142), 140);
  assert.equal(normalizeUiScale(112), 110);
  assert.equal(normalizeUiScale(113), 115);
  assert.equal(normalizeUiScale(Number.NaN), 100);
  assert.equal(uiScaleFactor(125), 1.25);
});

test("versioned UI settings round-trip independently from game saves", () => {
  const localStorage = new SettingsStorage();
  const host = { localStorage };
  assert.equal(writeUiSettings({
    version: 1,
    uiScale: 125,
    audioEnabled: false,
    reducedMotion: true,
  }, host), true);
  assert.deepEqual(readUiSettings(host), {
    version: 1,
    uiScale: 125,
    audioEnabled: false,
    reducedMotion: true,
  });
  assert.ok(localStorage.values.has(UI_SETTINGS_KEY));
});

test("invalid or unavailable settings storage falls back without throwing", () => {
  const broken = {
    localStorage: {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
    },
  };
  assert.deepEqual(readUiSettings(broken), DEFAULT_UI_SETTINGS);
  assert.equal(writeUiSettings(DEFAULT_UI_SETTINGS, broken), false);
  assert.deepEqual(normalizeUiSettings({ version: 999, uiScale: 140 }), DEFAULT_UI_SETTINGS);
});
