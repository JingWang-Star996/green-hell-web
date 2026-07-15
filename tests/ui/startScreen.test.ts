import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { StartScreen } from "../../src/game/ui/StartScreen";

function renderStartScreen(saveDiscoveryComplete: boolean): string {
  return renderToStaticMarkup(
    createElement(StartScreen, {
      saveDiscoveryComplete,
      canContinue: true,
      onNewGame: () => undefined,
      onContinue: () => undefined,
    }),
  );
}

test("continue remains disabled while the bounded Toy cloud refresh is pending", () => {
  const markup = renderStartScreen(false);

  assert.match(markup, /正在核对 Toy 云存档…/);
  assert.match(
    markup,
    /<button class="button-ghost" disabled="" aria-busy="true">正在核对 Toy 云存档…<\/button>/,
  );
});

test("the local continuation becomes available after cloud discovery settles", () => {
  const markup = renderStartScreen(true);

  assert.match(markup, /<button class="button-ghost" aria-busy="false">继续最近存档<\/button>/);
  assert.doesNotMatch(markup, /正在核对 Toy 云存档…/);
});
