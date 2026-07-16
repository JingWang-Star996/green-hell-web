import type {
  SemanticChunkPlan,
  SemanticWorldObject,
} from "./semanticGeneration";
import type { TreeHarvestState, TreeRegrowthState } from "../sim/types";
import { cloneTreeRegrowthState } from "../sim/treeRegrowthRuntime";

export type SemanticLifecycle =
  | "ambient"
  | "full"
  | "partial"
  | "depleted"
  | "regrowing"
  | "felled";

export interface SemanticRuntimeRenderState {
  quantity: number;
  nextRegenerationTick?: number | null;
  treeHarvest?: TreeHarvestState;
  treeRegrowth?: TreeRegrowthState;
}

export interface SemanticRenderObject {
  id: string;
  chunkKey: string;
  batchKey: string;
  category: SemanticWorldObject["category"];
  interactive: boolean;
  focusPolicy: "capability" | "never-focus";
  transform: Readonly<{
    x: number;
    y: number;
    z: number;
    yaw: number;
    scale: number;
  }>;
  morphology: Readonly<{
    species?: string;
    material?: string;
    growthStage?: string;
    size?: string;
    visualVariant: string;
  }>;
  baselineQuantity: number | null;
  quantity: number | null;
  nextRegenerationTick: number | null;
  lifecycle: SemanticLifecycle;
  treeHarvest?: TreeHarvestState;
  treeRegrowth?: TreeRegrowthState;
}

export interface SemanticChunkRenderPlan {
  generatorVersion: number;
  chunkKey: string;
  objects: readonly SemanticRenderObject[];
}

function lifecycleFor(
  baselineQuantity: number,
  state: SemanticRuntimeRenderState | undefined,
): Exclude<SemanticLifecycle, "ambient"> {
  const quantity = state
    ? Math.max(0, Math.floor(state.quantity))
    : baselineQuantity;
  const nextTick = state?.nextRegenerationTick ?? null;
  if (quantity >= baselineQuantity && nextTick === null) return "full";
  if (nextTick !== null) return "regrowing";
  return quantity <= 0 ? "depleted" : "partial";
}

function morphologyFor(
  object: SemanticWorldObject,
  state?: SemanticRuntimeRenderState,
): SemanticRenderObject["morphology"] {
  const regrowthStage =
    object.category === "tree" ? state?.treeRegrowth?.stage : undefined;
  return {
    ...("species" in object ? { species: object.species } : {}),
    ...("material" in object ? { material: object.material } : {}),
    ...("growthStage" in object
      ? { growthStage: regrowthStage ?? object.growthStage }
      : {}),
    ...("size" in object
      ? {
          size:
            regrowthStage === "stump" || regrowthStage === "sapling"
              ? "small"
              : regrowthStage === "young"
                ? "medium"
                : regrowthStage === "mature"
                  ? "large"
                  : object.size,
        }
      : {}),
    visualVariant: object.visualVariant,
  };
}

function batchKeyFor(
  object: SemanticWorldObject,
  state?: SemanticRuntimeRenderState,
): string {
  const morphology = morphologyFor(object, state);
  return [
    object.category,
    morphology.species ?? "-",
    morphology.material ?? "-",
    morphology.growthStage ?? "-",
    morphology.size ?? "-",
    morphology.visualVariant,
  ].join(":");
}

/**
 * Pure bridge between semantic generation and an instanced renderer. It does
 * not decide affordances or mutate simulation state; it only projects the one
 * authoritative object identity and its sparse lifecycle override.
 */
export function buildSemanticChunkRenderPlan(
  plan: SemanticChunkPlan,
  runtimeStates: Readonly<Record<string, SemanticRuntimeRenderState>> = {},
): SemanticChunkRenderPlan {
  return {
    generatorVersion: plan.generatorVersion,
    chunkKey: plan.chunkKey,
    objects: plan.objects.map((object) => {
      const state = runtimeStates[object.id];
      const morphology = morphologyFor(object, state);
      if (!object.interactive) {
        return {
          id: object.id,
          chunkKey: object.chunkKey,
          batchKey: batchKeyFor(object, state),
          category: object.category,
          interactive: false,
          focusPolicy: "never-focus",
          transform: { ...object.transform },
          morphology,
          baselineQuantity: null,
          quantity: null,
          nextRegenerationTick: null,
          lifecycle: "ambient",
        };
      }
      const quantity = state
        ? Math.max(0, Math.floor(state.quantity))
        : object.baselineQuantity;
      const lifecycle =
        object.category === "tree" && state?.treeHarvest
          ? "felled"
          : object.category === "tree" &&
              state?.treeRegrowth &&
              state.treeRegrowth.stage !== "mature"
            ? "regrowing"
            : lifecycleFor(object.baselineQuantity, state);
      const actionable = lifecycle !== "depleted";
      return {
        id: object.id,
        chunkKey: object.chunkKey,
        batchKey: batchKeyFor(object, state),
        category: object.category,
        interactive: actionable,
        focusPolicy: actionable ? "capability" : "never-focus",
        transform: { ...object.transform },
        morphology,
        baselineQuantity: object.baselineQuantity,
        quantity,
        nextRegenerationTick: state?.nextRegenerationTick ?? null,
        lifecycle,
        ...(state?.treeHarvest
          ? { treeHarvest: { ...state.treeHarvest } }
          : {}),
        ...(state?.treeRegrowth
          ? { treeRegrowth: cloneTreeRegrowthState(state.treeRegrowth) }
          : {}),
      };
    }),
  };
}
