import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { applyCommand } from "../../src/game/sim/simulation";
import { createInitialState, migrateGameState } from "../../src/game/sim/state";
import { getDiscoveredRecipeIds } from "../../src/game/sim/selectors";
import { groupCraftingRecipes } from "../../src/game/ui/actionUx";
import { Panels } from "../../src/game/ui/Panels";
import { createGameViewModel } from "../../src/game/ui/viewModel";

const noop = () => undefined;

test("fresh mobile progress always exposes the task-critical bandage recipe", () => {
  const state = createInitialState("mobile-bandage-visible");
  const view = createGameViewModel(state);
  const bandage = view.recipes.find((recipe) => recipe.id === "bandage");

  assert.ok(bandage);
  assert.equal(bandage.taskRelevant, true);
  assert.equal(bandage.available, false);
  assert.equal(
    groupCraftingRecipes(view.recipes)[0]?.recipes[0]?.id,
    "bandage",
    "the current task recipe must be first instead of buried below tool cards",
  );
});

test("mobile crafting journey gathers, renders and crafts a bandage end to end", () => {
  let state = createInitialState("mobile-bandage-journey");
  for (const entityId of ["resource.medicinal.camp-01", "resource.vine.camp-01"]) {
    state = applyCommand(state, {
      type: "move-player",
      position: state.world.entities[entityId].position,
    });
    state = applyCommand(state, { type: "pick-up", entityId });
  }

  const view = createGameViewModel(state);
  const bandage = view.recipes.find((recipe) => recipe.id === "bandage");
  assert.ok(bandage);
  assert.equal(bandage.available, true);

  const markup = renderToStaticMarkup(
    createElement(Panels, {
      active: "crafting",
      feedback: null,
      watch: view.watch,
      inventory: view.inventory,
      recipes: view.recipes,
      body: view.body,
      objectives: view.objectives,
      events: view.events,
      landmarks: view.landmarks,
      mapChunks: view.mapChunks,
      score: view.score,
      audioEnabled: true,
      reducedMotion: false,
      saveStatus: {} as never,
      onClose: noop,
      onOpenPanel: noop,
      onCraft: () => true,
      onItemAction: noop,
      onTreatWound: noop,
      onTreatParasites: noop,
      onResume: noop,
      onRestart: noop,
      onManualSave: noop,
      onToggleAudio: noop,
      onToggleReducedMotion: noop,
    }),
  );
  assert.match(markup, /role="tablist" aria-label="制作分类"/);
  for (const sectionLabel of ["随身制作", "营地维护", "建造", "休息"]) {
    assert.match(markup, new RegExp(`>${sectionLabel}<`));
  }
  assert.match(markup, /data-recipe-id="bandage"/);
  assert.match(markup, /当前任务/);
  assert.match(markup, /现在可做/);
  assert.match(markup, /<button>制作<\/button>/);
  assert.equal((markup.match(/class="panel-system-nav"/g) ?? []).length, 1);
  for (const panelLabel of [
    "生物手表",
    "野外背包",
    "手工制作",
    "身体检查",
    "生存笔记",
    "防水纸图",
    "远征暂停",
  ]) {
    assert.match(markup, new RegExp(`>${panelLabel}<`));
  }

  const beforeLeaf = state.inventory["medicinal-leaf"];
  const beforeVine = state.inventory.vine;
  state = applyCommand(state, { type: "craft", recipeId: "bandage" });
  assert.equal(state.inventory["medicinal-leaf"], beforeLeaf - 1);
  assert.equal(state.inventory.vine, beforeVine - 1);
  assert.equal(state.inventory.bandage, 1);
  assert.equal(state.eventLog.at(-1)?.type, "craft-succeeded");
});

test("announced recipe knowledge survives a cloud-style JSON round trip", () => {
  const desktop = createInitialState("mobile-cloud-knowledge");
  desktop.knowledge!.announcedRecipeIds.push("torch", "axe");
  const mobile = migrateGameState(
    JSON.parse(JSON.stringify(desktop)) as typeof desktop,
  );

  assert.ok(getDiscoveredRecipeIds(mobile).includes("torch"));
  assert.ok(getDiscoveredRecipeIds(mobile).includes("axe"));
  assert.ok(createGameViewModel(mobile).recipes.some((recipe) => recipe.id === "torch"));
  assert.ok(createGameViewModel(mobile).recipes.some((recipe) => recipe.id === "axe"));
});
