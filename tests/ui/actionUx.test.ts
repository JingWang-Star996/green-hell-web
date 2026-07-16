import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  craftingActionPolicy,
  formatFuelChange,
  groupCraftingRecipes,
} from "../../src/game/ui/actionUx";
import type { RecipeView } from "../../src/game/ui/types";
import { Panels } from "../../src/game/ui/Panels";

function recipe(id: string): RecipeView {
  return {
    id,
    label: id,
    description: id,
    ingredients: [],
    available: true,
  };
}

test("crafting actions use consistent panel completion rules", () => {
  assert.deepEqual(craftingActionPolicy("stone-blade"), { section: "crafting", closePanel: false });
  assert.deepEqual(craftingActionPolicy("add-fuel"), { section: "camp", closePanel: false });
  assert.deepEqual(craftingActionPolicy("campfire"), { section: "building", closePanel: true });
  assert.deepEqual(craftingActionPolicy("rain-collector"), { section: "building", closePanel: true });
  assert.deepEqual(craftingActionPolicy("torch-waymark"), { section: "building", closePanel: true });
  assert.deepEqual(craftingActionPolicy("rest"), { section: "rest", closePanel: true });
});

test("crafting menu is grouped by player intent instead of one flat recipe list", () => {
  const grouped = groupCraftingRecipes([
    recipe("rest"),
    recipe("campfire"),
    recipe("add-fuel"),
    recipe("axe"),
    recipe("boil-water"),
  ]);

  assert.deepEqual(grouped.map((group) => group.id), ["crafting", "camp", "building", "rest"]);
  assert.deepEqual(grouped[1].recipes.map((item) => item.id), ["add-fuel", "boil-water"]);
});

test("current-task and immediately available recipes are promoted without hiding sections", () => {
  const taskBandage = { ...recipe("bandage"), available: false, taskRelevant: true };
  const availableAxe = recipe("axe");
  const unavailableBlade = { ...recipe("stone-blade"), available: false };
  const grouped = groupCraftingRecipes([
    unavailableBlade,
    availableAxe,
    taskBandage,
    recipe("add-fuel"),
    recipe("campfire"),
    recipe("rest"),
  ]);

  assert.deepEqual(grouped.map((group) => group.id), ["crafting", "camp", "building", "rest"]);
  assert.deepEqual(
    grouped[0].recipes.map((item) => item.id),
    ["bandage", "axe", "stone-blade"],
  );
});

test("fuel maintenance feedback states the observable before and after values", () => {
  assert.equal(formatFuelChange(42, 162), "营火燃料 42 秒 → 2 分 42 秒");
});

test("torch waymark is presented as a world building action with immediate placement feedback", () => {
  const noop = () => undefined;
  const markup = renderToStaticMarkup(
    createElement(Panels, {
      active: "crafting",
      feedback: null,
      watch: {} as never,
      inventory: [],
      recipes: [recipe("torch-waymark")],
      body: {} as never,
      objectives: [],
      events: [],
      landmarks: [],
      mapChunks: [],
      score: 0,
      audioEnabled: true,
      reducedMotion: false,
      saveStatus: {} as never,
      onClose: noop,
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
  assert.match(markup, /recipe-section-building/);
  assert.match(markup, /<h3>torch-waymark<\/h3>/);
  assert.match(markup, /<button>搭建<\/button>/);
});
