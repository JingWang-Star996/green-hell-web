import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANT_GROWTH_STAGES,
  PLANT_RENDER_LIFECYCLES,
  resolvePlantVisualSemantics,
} from "../../src/game/render/plantVisualSemantics";
import type { PlantVisualSemanticSource } from "../../src/game/render/plantVisualSemantics";
import {
  PLANT_SPECIES_CATALOG,
  generateSemanticChunkPlan,
} from "../../src/game/world/semanticGeneration";
import type { HarvestablePlantSpecies } from "../../src/game/world/semanticGeneration";
import { buildSemanticChunkRenderPlan } from "../../src/game/world/semanticRenderPlan";

const SPECIES = Object.keys(
  PLANT_SPECIES_CATALOG,
) as HarvestablePlantSpecies[];

function source(
  species: HarvestablePlantSpecies,
  visualVariant: string,
  growthStage: (typeof PLANT_GROWTH_STAGES)[number],
  lifecycle: (typeof PLANT_RENDER_LIFECYCLES)[number],
): PlantVisualSemanticSource {
  return {
    category: "harvestable-plant",
    lifecycle,
    morphology: { species, visualVariant, growthStage },
  };
}

test("every generated plant variant, growth stage, and valid lifecycle has semantics", () => {
  const expectedVariants = SPECIES.flatMap((species) =>
    PLANT_SPECIES_CATALOG[species].visualVariants.map(
      (visualVariant) => `${species}:${visualVariant}`,
    ),
  ).sort();
  const resolvedVariants = new Set<string>();
  let resolvedCombinations = 0;

  for (const species of SPECIES) {
    const catalog = PLANT_SPECIES_CATALOG[species];
    for (const visualVariant of catalog.visualVariants) {
      for (const growthStage of PLANT_GROWTH_STAGES) {
        for (const lifecycle of PLANT_RENDER_LIFECYCLES) {
          const semantics = resolvePlantVisualSemantics(
            source(species, visualVariant, growthStage, lifecycle),
          );
          assert.ok(
            semantics,
            `${species}/${visualVariant}/${growthStage}/${lifecycle}`,
          );
          assert.equal(semantics.baseVerb, catalog.toolRequirement.action);
          assert.equal(semantics.toolClass, catalog.toolRequirement.toolClass);
          assert.equal(
            semantics.minimumTier,
            catalog.toolRequirement.minimumTier,
          );
          assert.ok(semantics.readabilityCue.landmark.length > 0);
          assert.ok(semantics.readabilityCue.strength >= 0);
          assert.ok(semantics.readabilityCue.strength <= 1);
          assert.ok(semantics.readabilityCue.growthScale > 0);
          resolvedVariants.add(`${species}:${visualVariant}`);
          resolvedCombinations += 1;
        }
      }
    }
  }

  assert.deepEqual([...resolvedVariants].sort(), expectedVariants);
  assert.equal(
    resolvedCombinations,
    expectedVariants.length *
      PLANT_GROWTH_STAGES.length *
      PLANT_RENDER_LIFECYCLES.length,
  );
});

test("one silhouette family can never imply multiple base verbs or tools", () => {
  const rulesByFamily = new Map<string, Set<string>>();
  for (const species of SPECIES) {
    const catalog = PLANT_SPECIES_CATALOG[species];
    for (const visualVariant of catalog.visualVariants) {
      const semantics = resolvePlantVisualSemantics(
        source(species, visualVariant, "mature", "full"),
      );
      assert.ok(semantics);
      const rules = rulesByFamily.get(semantics.silhouetteFamily) ?? new Set();
      rules.add(
        `${semantics.baseVerb}:${semantics.toolClass}:${semantics.minimumTier}`,
      );
      rulesByFamily.set(semantics.silhouetteFamily, rules);
    }
  }

  assert.ok(rulesByFamily.size > 0);
  for (const [family, rules] of rulesByFamily) {
    assert.equal(
      rules.size,
      1,
      `${family} must communicate one interaction rule`,
    );
  }
});

test("lifecycle changes resource readability without changing interaction language", () => {
  const visualVariant =
    PLANT_SPECIES_CATALOG["palm-fruit-shrub"].visualVariants[0];
  const byLifecycle = PLANT_RENDER_LIFECYCLES.map((lifecycle) =>
    resolvePlantVisualSemantics(
      source("palm-fruit-shrub", visualVariant, "mature", lifecycle),
    ),
  );
  assert.ok(byLifecycle.every((semantics) => semantics !== null));
  assert.deepEqual(
    byLifecycle.map((semantics) => semantics?.readabilityCue.resourceState),
    ["ready", "reduced", "absent", "emerging"],
  );
  assert.deepEqual(
    new Set(
      byLifecycle.map(
        (semantics) =>
          `${semantics?.baseVerb}:${semantics?.toolClass}:${semantics?.minimumTier}`,
      ),
    ).size,
    1,
  );
});

test("wild plantain owns a distinct leaf-crown and hanging-fruit pickup language", () => {
  const visualVariant =
    PLANT_SPECIES_CATALOG["wild-plantain"].visualVariants[1];
  const semantics = resolvePlantVisualSemantics(
    source("wild-plantain", visualVariant, "mature", "full"),
  );
  assert.ok(semantics);
  assert.equal(semantics.silhouetteFamily, "plantain-leaf-crown");
  assert.equal(semantics.readabilityCue.landmark, "hanging-plantain-hand");
  assert.equal(semantics.baseVerb, "pickup");
  assert.equal(semantics.toolClass, "hand");
});

test("micro-clutter and invalid plant morphology fail closed", () => {
  const plan = buildSemanticChunkRenderPlan(
    generateSemanticChunkPlan("plant-clutter-contract", { x: 0, z: 0 }),
  );
  const clutter = plan.objects.filter(
    (object) => object.category === "micro-clutter",
  );
  assert.ok(clutter.length > 0);
  assert.ok(
    clutter.every((object) => resolvePlantVisualSemantics(object) === null),
  );

  const disguisedClutter: PlantVisualSemanticSource = {
    category: "micro-clutter",
    lifecycle: "ambient",
    morphology: {
      species: "palm-fruit-shrub",
      visualVariant: "palm-fruit-ripe",
      growthStage: "mature",
    },
  };
  assert.equal(resolvePlantVisualSemantics(disguisedClutter), null);
  assert.equal(
    resolvePlantVisualSemantics({
      ...source(
        "medicinal-broadleaf",
        "unknown-plant-variant",
        "mature",
        "full",
      ),
    }),
    null,
  );
  for (const lifecycle of ["ambient", "felled"] as const) {
    assert.equal(
      resolvePlantVisualSemantics({
        ...source(
          "medicinal-broadleaf",
          "medicinal-broadleaf-open",
          "mature",
          "full",
        ),
        lifecycle,
      }),
      null,
    );
  }
});
