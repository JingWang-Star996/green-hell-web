import { WORLD_ENTITY_TEMPLATES } from "./content";
import type {
  GameState,
  Seed,
  WorldEntity,
  WorldEntitySemanticMetadata,
} from "./types";
import {
  advanceTreeRegrowthState,
  createTreeRegrowthState,
  treeRegrowthDurabilityRatio,
  treeRegrowthEffectiveGrowthStage,
  type EffectiveTreeGrowthStage,
  type TreeRegrowthStage,
  type TreeRegrowthState,
} from "./treeRegrowth";

const AUTHORED_TREE_BASELINES = new Map(
  WORLD_ENTITY_TEMPLATES.filter(
    (entity) =>
      entity.semantic?.category === "tree" ||
      entity.tags.includes("standing-tree"),
  ).map((entity) => [entity.id, Math.max(1, Math.floor(entity.quantity))]),
);

export function treeRegrowthEligible(
  entity: Pick<WorldEntity, "kind" | "semantic" | "tags">,
): boolean {
  const tree =
    entity.semantic?.category === "tree" ||
    entity.tags.includes("standing-tree");
  return Boolean(
    tree &&
      entity.kind === "resource" &&
      !entity.tags.includes("nonrenewable") &&
      !entity.tags.includes("objective") &&
      !entity.tags.includes("rare"),
  );
}

export function treeRegrowthBaselineQuantity(
  entity: {
    id: string;
    quantity: number;
    semantic?: Partial<Pick<WorldEntitySemanticMetadata, "baselineQuantity">>;
  },
): number {
  const semantic = entity.semantic?.baselineQuantity;
  const authored = AUTHORED_TREE_BASELINES.get(entity.id);
  const source =
    typeof semantic === "number" && Number.isFinite(semantic)
      ? semantic
      : authored ?? entity.quantity;
  return Math.max(1, Math.min(999, Math.floor(source || 1)));
}

export function cloneTreeRegrowthState(
  state: TreeRegrowthState | undefined,
): TreeRegrowthState | undefined {
  return state
    ? {
        ...state,
        schedule: { ...state.schedule },
      }
    : undefined;
}

export function beginTreeRegrowth(
  seed: Seed,
  clockTick: number,
  entity: WorldEntity,
): boolean {
  if (
    !treeRegrowthEligible(entity) ||
    entity.quantity > 0 ||
    entity.treeHarvest
  ) {
    return false;
  }
  const cycle = Math.max(0, Math.floor((entity.treeRegrowth?.cycle ?? -1) + 1));
  const next = createTreeRegrowthState(seed, entity.id, cycle, clockTick);
  if (!next) return false;
  entity.treeRegrowth = next;
  entity.quantity = 0;
  entity.depleted = true;
  return true;
}

export interface TreeRegrowthAdvanceResult {
  changed: boolean;
  previousStage: TreeRegrowthStage;
  stage: TreeRegrowthStage;
  matured: boolean;
}

/**
 * Advances one active tree without healing player damage inside the same
 * growth stage. A stage boundary establishes the new stage's maximum
 * durability; normal chopping may then reduce it until the next boundary.
 */
export function advanceTreeRegrowthEntity(
  clockTick: number,
  entity: WorldEntity,
): TreeRegrowthAdvanceResult | null {
  const current = entity.treeRegrowth;
  if (!current || entity.treeHarvest) return null;
  if (current.stage === "mature") {
    return {
      changed: false,
      previousStage: "mature",
      stage: "mature",
      matured: false,
    };
  }
  const nextBoundary = treeRegrowthNextTick(current);
  if (nextBoundary !== null && clockTick < nextBoundary) {
    return {
      changed: false,
      previousStage: current.stage,
      stage: current.stage,
      matured: false,
    };
  }
  const next = advanceTreeRegrowthState(current, clockTick);
  if (!next) {
    // Corrupt schedules may never invent a living tree. Preserve a truthful
    // stump and require a new player-authored harvest cycle to create a fresh
    // schedule.
    delete entity.treeRegrowth;
    entity.quantity = 0;
    entity.depleted = true;
    return null;
  }
  const previousStage = current.stage;
  const stageChanged = next.stage !== previousStage;
  const baseline = treeRegrowthBaselineQuantity(entity);
  if (next.stage === "stump") {
    entity.quantity = 0;
    entity.depleted = true;
  } else if (next.stage === "mature") {
    entity.quantity = baseline;
    entity.depleted = false;
    // Keep the terminal state as sparse authority. It preserves the visible
    // mature morphology for nodes whose generated baseline was a sapling or
    // young tree, and carries the cycle number into the next felling.
    entity.treeRegrowth = next;
    return {
      changed: stageChanged,
      previousStage,
      stage: "mature",
      matured: true,
    };
  } else {
    if (stageChanged) {
      entity.quantity = Math.max(
        1,
        Math.round(baseline * treeRegrowthDurabilityRatio(next.stage)),
      );
    }
    entity.depleted = false;
    entity.treeRegrowth = next;
  }
  return {
    changed: stageChanged,
    previousStage,
    stage: next.stage,
    matured: false,
  };
}

export function advanceActiveTreeRegrowth(state: GameState): number {
  let transitions = 0;
  for (const entity of Object.values(state.world.entities)) {
    const result = advanceTreeRegrowthEntity(state.clock.tick, entity);
    if (result?.changed) transitions += 1;
  }
  return transitions;
}

export function effectiveTreeGrowthStage(
  entity: {
    semantic?: Partial<Pick<WorldEntitySemanticMetadata, "growthStage">>;
    treeRegrowth?: TreeRegrowthState;
  },
): EffectiveTreeGrowthStage | "old-growth" | null {
  if (entity.treeRegrowth) {
    return treeRegrowthEffectiveGrowthStage(entity.treeRegrowth.stage);
  }
  const baseline = entity.semantic?.growthStage;
  return baseline === "sapling" ||
    baseline === "young" ||
    baseline === "mature" ||
    baseline === "old-growth"
    ? baseline
    : null;
}

export function effectiveTreeSize(
  entity: {
    semantic?: Partial<
      Pick<WorldEntitySemanticMetadata, "growthStage" | "size">
    >;
    treeRegrowth?: TreeRegrowthState;
  },
): "small" | "medium" | "large" {
  const stage = effectiveTreeGrowthStage(entity);
  if (stage === "sapling") return "small";
  if (stage === "young") return "medium";
  if (entity.treeRegrowth?.stage === "mature") return "large";
  return entity.semantic?.size === "small" ||
    entity.semantic?.size === "medium" ||
    entity.semantic?.size === "large"
    ? entity.semantic.size
    : "small";
}

export function treeRegrowthNextTick(
  state: TreeRegrowthState | undefined,
): number | null {
  if (!state) return null;
  if (state.stage === "stump") return state.schedule.saplingAtTick;
  if (state.stage === "sapling") return state.schedule.youngAtTick;
  if (state.stage === "young") return state.schedule.matureAtTick;
  return null;
}
