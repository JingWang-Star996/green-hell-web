import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  CANONICAL_PLAYER_WIKI_URL,
  LATEST_GAME_RELEASE,
} from "../../src/game/releaseNotes";
import { StartScreen } from "../../src/game/ui/StartScreen";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

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

test("update history stays collapsed behind a native disclosure after the primary play actions", () => {
  const markup = renderStartScreen(true);
  const playActionIndex = markup.indexOf("继续最近存档");
  const releaseIndex = markup.indexOf("更新公告");

  assert.ok(playActionIndex >= 0 && releaseIndex > playActionIndex);
  assert.match(markup, /<details class="start-release-notes"><summary>/);
  assert.doesNotMatch(markup, /<details class="start-release-notes" open/);
  assert.match(markup, new RegExp(LATEST_GAME_RELEASE.buildId.replaceAll(".", "\\.")));
});

test("the start screen links to the canonical player Wiki through the Toy top frame", () => {
  const markup = renderStartScreen(false);

  assert.match(markup, new RegExp(`href="${CANONICAL_PLAYER_WIKI_URL.replaceAll(".", "\\.")}"`));
  assert.match(markup, /target="_top"/);
  assert.match(markup, /玩家 Wiki/);
});

test("release disclosure stays touch-sized and its history is bounded on every start layout", () => {
  assert.match(
    css,
    /\.start-release-notes > summary, \.start-wiki-link \{[^}]*min-height:\s*44px/,
  );
  assert.match(
    css,
    /\.start-release-panel \{[^}]*max-height:\s*min\(48dvh, 430px\)[^}]*overflow-y:\s*auto/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*720px\)[\s\S]*?\.start-release-panel \{[^}]*position:\s*static[^}]*max-height:\s*min\(40dvh, 320px\)/,
  );
  assert.match(
    css,
    /@media \(max-height:\s*500px\)[\s\S]*?\.start-release-panel \{[^}]*position:\s*static[^}]*max-height:\s*min\(42dvh, 180px\)/,
  );
  assert.match(
    css,
    /@media \(max-width:\s*420px\)[\s\S]*?\.start-utility-actions \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
});
