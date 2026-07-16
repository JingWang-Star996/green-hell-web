import assert from "node:assert/strict";
import test from "node:test";

import { ITEMS, RECIPES, TASK_SEQUENCE } from "../../src/game/sim/content";
import { BIOME_PROFILES } from "../../src/game/world/generation";
import { ECOLOGY_SPECIES } from "../../src/game/ecology/species";
import { PLANT_SPECIES_CATALOG } from "../../src/game/world/semanticGeneration";
import { createWikiData } from "../../wiki-src/wikiData";

test("wiki covers every implemented item, recipe, task, biome, plant and fauna definition", () => {
  const wiki = createWikiData();
  assert.deepEqual(wiki.items.map((entry) => entry.id).sort(), Object.keys(ITEMS).sort());
  assert.deepEqual(wiki.recipes.map((entry) => entry.id).sort(), Object.keys(RECIPES).sort());
  assert.deepEqual(wiki.tasks.map((entry) => entry.id), [...TASK_SEQUENCE]);
  assert.deepEqual(wiki.biomes.map((entry) => entry.id).sort(), Object.keys(BIOME_PROFILES).sort());
  assert.deepEqual(wiki.plants.map((entry) => entry.id).sort(), Object.keys(PLANT_SPECIES_CATALOG).sort());
  assert.deepEqual(wiki.fauna.map((entry) => entry.id).sort(), Object.keys(ECOLOGY_SPECIES).sort());
});

test("wiki recipes reference only real items and expose every material edge", () => {
  const wiki = createWikiData();
  const itemIds = new Set(wiki.items.map((entry) => entry.id));
  for (const recipe of wiki.recipes) {
    assert.ok(recipe.title.length > 0);
    assert.ok(recipe.workSeconds > 0);
    for (const item of [...recipe.ingredients, ...recipe.tools, ...recipe.results]) {
      assert.ok(itemIds.has(item.id), `${recipe.id} references missing item ${item.id}`);
    }
    assert.ok(recipe.results.length > 0 || recipe.effect, `${recipe.id} has no result/effect`);
  }
});

test("wiki separates playable content from the future roadmap", () => {
  const wiki = createWikiData();
  assert.equal(wiki.tasks.every((task) => task.implemented), true);
  const notImplemented = wiki.roadmap.find((entry) => entry.tone === "planned");
  assert.ok(notImplemented);
  assert.ok(notImplemented.items.some((item) => item.includes("A3")));
  assert.ok(notImplemented.items.some((item) => item.includes("Valheim")));
  assert.equal(wiki.tasks.some((task) => /A3|A4|A5/.test(task.title)), false);
});

test("every player-facing item and task has explanation plus provenance", () => {
  const wiki = createWikiData();
  for (const item of wiki.items) {
    assert.ok(item.summary.length >= 8, item.id);
    assert.ok(item.obtain.length >= 8, item.id);
    assert.ok(item.use.length >= 8, item.id);
    assert.ok(item.source.every((path) => !path.startsWith("/")));
  }
  for (const task of wiki.tasks) {
    assert.ok(task.description.length >= 8, task.id);
    assert.ok(task.source.length > 0, task.id);
  }
});

test("wiki carries player-language aliases for known interaction confusion", () => {
  const wiki = createWikiData();
  const grassQuestion = wiki.faq.find((entry) => entry.question.includes("一株草"));
  assert.ok(grassQuestion);
  assert.ok(grassQuestion.keywords);
  assert.ok(grassQuestion.keywords.includes("为什么草不能采"));
});
