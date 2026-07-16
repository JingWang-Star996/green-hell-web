import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

import { SaveTransferControls } from "../../src/game/ui/SaveTransferControls";

const noop = () => undefined;

test("save transfer UI exposes portable export, file input, durability, and destructive preview", () => {
  const markup = renderToStaticMarkup(createElement(SaveTransferControls, {
    localDurability: "ephemeral",
    state: {
      phase: "import-ready",
      preview: {
        sourceLabel: "field-save.canopy-save.json",
        day: 3,
        time: "09:19",
        completedObjectives: 4,
        statusLabel: "进行中",
      },
    },
    hasPreImport: true,
    onPrepareExport: noop,
    onSelectImport: noop,
    onConfirmImport: noop,
    onCancelImport: noop,
    onPreparePreImportRestore: noop,
  }));
  assert.match(markup, /仅本次页面/);
  assert.match(markup, /type="file"/);
  assert.match(markup, /type="file" tabindex="-1" aria-hidden="true"/);
  assert.match(markup, /\.canopy-save\.json/);
  assert.match(markup, /确认替换并同步/);
  assert.match(markup, /导入前恢复点/);
});

test("prepared exports require a real user download link", () => {
  const markup = renderToStaticMarkup(createElement(SaveTransferControls, {
    localDurability: "persistent",
    state: {
      phase: "export-ready",
      url: "blob:https://example.test/save",
      filename: "CANOPY-save.canopy-save.json",
    },
    hasPreImport: false,
    onPrepareExport: noop,
    onSelectImport: noop,
    onConfirmImport: noop,
    onCancelImport: noop,
    onPreparePreImportRestore: noop,
  }));
  assert.match(markup, /href="blob:https:\/\/example\.test\/save"/);
  assert.match(markup, /download="CANOPY-save\.canopy-save\.json"/);
});

test("desktop UI scale uses readable dimension tokens instead of root transform or zoom", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const root = css.match(/\.game-root\s*\{([^}]|\}(?!\s*\.))*\}/)?.[0] ?? "";
  assert.match(css, /--ui-scale:\s*1/);
  assert.match(
    css,
    /--ui-font-caption:\s*clamp\(11px,\s*calc\(10px \* var\(--ui-scale\)\),\s*14px\)/,
  );
  assert.match(
    css,
    /--ui-font-micro:\s*clamp\(11px,\s*calc\(11px \* var\(--ui-scale\)\),\s*16px\)/,
  );
  assert.match(
    css,
    /--ui-font-body:\s*clamp\(13px,\s*calc\(14px \* var\(--ui-scale\)\),\s*20px\)/,
  );
  assert.match(css, /--ui-control-min:\s*calc\(44px \* var\(--ui-scale\)\)/);
  assert.doesNotMatch(root, /transform\s*:/);
  assert.doesNotMatch(root, /zoom\s*:/);
});

test("desktop critical captions use the scaled readable-floor token", () => {
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  for (const selector of [
    "damage-direction-cue span",
    "start-header small",
    "start-footer",
    "save-reset-confirm p",
    "resolution-card > small",
    "resolution-stats small",
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      css,
      new RegExp(`\\.${escapedSelector}\\s*\\{[^}]*var\\(--ui-font-caption\\)`),
      `${selector} should follow the scaled caption floor`,
    );
  }
});
