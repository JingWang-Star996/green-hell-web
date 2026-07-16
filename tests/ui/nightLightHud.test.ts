import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Hud } from "../../src/game/ui/Hud";

const baseProps = {
  watch: {
    day: 1,
    time: "23:00",
    coordinates: "03° 07.00' S / 61° 18.00' W",
    weather: "小雨",
    biome: "低地雨林",
    rain: 0.3,
    meters: [],
  },
  meters: [],
  objective: null,
  target: null,
  pointerLocked: true,
  ready: true,
  events: [],
  compassDegrees: 0,
  onFocusGame: () => undefined,
  onOpenWatch: () => undefined,
  onOpenBody: () => undefined,
};

test("HUD names the automatic navigation floor and the stronger occupied-hand light", () => {
  const watch = renderToStaticMarkup(
    createElement(Hud, { ...baseProps, personalLight: "watch" }),
  );
  assert.match(watch, /手表夜光 · 近距自动/);
  assert.match(watch, /personal-light-watch/);

  const torch = renderToStaticMarkup(
    createElement(Hud, { ...baseProps, personalLight: "torch" }),
  );
  assert.match(torch, /火把照明 · 占手燃烧/);
  assert.match(torch, /personal-light-torch/);
});
