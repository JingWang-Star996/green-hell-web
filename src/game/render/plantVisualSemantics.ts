import { PLANT_SPECIES_CATALOG } from "../world/semanticGeneration";
import type {
  HarvestablePlantSpecies,
  SemanticToolClass,
  SemanticToolTier,
  ToolRequirementIntent,
} from "../world/semanticGeneration";
import type {
  SemanticLifecycle,
  SemanticRenderObject,
} from "../world/semanticRenderPlan";

export const PLANT_GROWTH_STAGES = ["young", "mature"] as const;
export type PlantGrowthStage = (typeof PLANT_GROWTH_STAGES)[number];

/** Ambient belongs to clutter and felled belongs to trees, never plants. */
export const PLANT_RENDER_LIFECYCLES = [
  "full",
  "partial",
  "depleted",
  "regrowing",
] as const;
export type PlantRenderLifecycle =
  (typeof PLANT_RENDER_LIFECYCLES)[number];

export const PLANT_SILHOUETTE_BY_SPECIES = {
  "medicinal-broadleaf": "broadleaf-rosette",
  "antiparasitic-herb": "flowering-ground-herb",
  "fiber-vine": "suspended-fiber-vine",
  "palm-fruit-shrub": "fruiting-palm-shrub",
  "wild-plantain": "plantain-leaf-crown",
} as const satisfies Readonly<Record<HarvestablePlantSpecies, string>>;

export type PlantSilhouetteFamily =
  (typeof PLANT_SILHOUETTE_BY_SPECIES)[HarvestablePlantSpecies];

export type PlantReadabilityLandmark =
  | "pale-vein-cross"
  | "flower-crown"
  | "fiber-loop"
  | "fruit-cluster"
  | "hanging-plantain-hand";

export interface PlantVisualFamilyContract {
  baseVerb: ToolRequirementIntent["action"];
  toolClass: SemanticToolClass;
  minimumTier: SemanticToolTier;
  readabilityLandmark: PlantReadabilityLandmark;
}

/**
 * A silhouette family owns one base verb and one tool requirement. Variants
 * can alter posture inside that family, but never change how the player reads
 * or acts on it.
 */
export const PLANT_VISUAL_FAMILY_CONTRACTS = {
  "broadleaf-rosette": {
    baseVerb: "cut",
    toolClass: "hand",
    minimumTier: 0,
    readabilityLandmark: "pale-vein-cross",
  },
  "flowering-ground-herb": {
    baseVerb: "cut",
    toolClass: "hand",
    minimumTier: 0,
    readabilityLandmark: "flower-crown",
  },
  "suspended-fiber-vine": {
    baseVerb: "cut",
    toolClass: "blade",
    minimumTier: 1,
    readabilityLandmark: "fiber-loop",
  },
  "fruiting-palm-shrub": {
    baseVerb: "pickup",
    toolClass: "hand",
    minimumTier: 0,
    readabilityLandmark: "fruit-cluster",
  },
  "plantain-leaf-crown": {
    baseVerb: "pickup",
    toolClass: "hand",
    minimumTier: 0,
    readabilityLandmark: "hanging-plantain-hand",
  },
} as const satisfies Readonly<
  Record<PlantSilhouetteFamily, PlantVisualFamilyContract>
>;

export type PlantResourceReadability =
  | "ready"
  | "reduced"
  | "absent"
  | "emerging";

const GROWTH_READABILITY = {
  young: { growthScale: 0.76, cueStrength: 0.78 },
  mature: { growthScale: 1, cueStrength: 1 },
} as const satisfies Readonly<
  Record<
    PlantGrowthStage,
    Readonly<{ growthScale: number; cueStrength: number }>
  >
>;

const LIFECYCLE_READABILITY = {
  full: { resourceState: "ready", cueStrength: 1 },
  partial: { resourceState: "reduced", cueStrength: 0.68 },
  depleted: { resourceState: "absent", cueStrength: 0 },
  regrowing: { resourceState: "emerging", cueStrength: 0.36 },
} as const satisfies Readonly<
  Record<
    PlantRenderLifecycle,
    Readonly<{
      resourceState: PlantResourceReadability;
      cueStrength: number;
    }>
  >
>;

export type PlantVisualSemanticSource = Pick<
  SemanticRenderObject,
  "category" | "lifecycle" | "morphology"
>;

export interface PlantVisualSemantics {
  species: HarvestablePlantSpecies;
  visualVariant: string;
  growthStage: PlantGrowthStage;
  lifecycle: PlantRenderLifecycle;
  silhouetteFamily: PlantSilhouetteFamily;
  baseVerb: ToolRequirementIntent["action"];
  toolClass: SemanticToolClass;
  minimumTier: SemanticToolTier;
  readabilityCue: Readonly<{
    landmark: PlantReadabilityLandmark;
    resourceState: PlantResourceReadability;
    /** Renderer emphasis only; it never changes focus or resource truth. */
    strength: number;
    growthScale: number;
  }>;
}

function isHarvestablePlantSpecies(
  value: string | undefined,
): value is HarvestablePlantSpecies {
  return (
    value !== undefined &&
    Object.prototype.hasOwnProperty.call(PLANT_SPECIES_CATALOG, value)
  );
}

function isPlantGrowthStage(
  value: string | undefined,
): value is PlantGrowthStage {
  return (
    value !== undefined &&
    PLANT_GROWTH_STAGES.some((growthStage) => growthStage === value)
  );
}

function isPlantRenderLifecycle(
  value: SemanticLifecycle,
): value is PlantRenderLifecycle {
  return PLANT_RENDER_LIFECYCLES.some(
    (lifecycle) => lifecycle === value,
  );
}

/**
 * Pure, fail-closed bridge from semantic render records to code-native plant
 * construction. It cannot classify clutter as a resource and rejects content
 * drift until the generator and family contract agree again.
 */
export function resolvePlantVisualSemantics(
  source: PlantVisualSemanticSource,
): PlantVisualSemantics | null {
  if (source.category !== "harvestable-plant") return null;
  const species = source.morphology.species;
  const growthStage = source.morphology.growthStage;
  const visualVariant = source.morphology.visualVariant;
  if (
    !isHarvestablePlantSpecies(species) ||
    !isPlantGrowthStage(growthStage) ||
    !isPlantRenderLifecycle(source.lifecycle)
  ) {
    return null;
  }
  const catalog = PLANT_SPECIES_CATALOG[species];
  if (!catalog.visualVariants.includes(visualVariant)) return null;
  const silhouetteFamily = PLANT_SILHOUETTE_BY_SPECIES[species];
  const family = PLANT_VISUAL_FAMILY_CONTRACTS[silhouetteFamily];
  if (
    family.baseVerb !== catalog.toolRequirement.action ||
    family.toolClass !== catalog.toolRequirement.toolClass ||
    family.minimumTier !== catalog.toolRequirement.minimumTier
  ) {
    return null;
  }
  const growth = GROWTH_READABILITY[growthStage];
  const lifecycle = LIFECYCLE_READABILITY[source.lifecycle];
  return {
    species,
    visualVariant,
    growthStage,
    lifecycle: source.lifecycle,
    silhouetteFamily,
    baseVerb: family.baseVerb,
    toolClass: family.toolClass,
    minimumTier: family.minimumTier,
    readabilityCue: {
      landmark: family.readabilityLandmark,
      resourceState: lifecycle.resourceState,
      strength: growth.cueStrength * lifecycle.cueStrength,
      growthScale: growth.growthScale,
    },
  };
}
