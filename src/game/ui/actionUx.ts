import {
  affordanceAcceptsInput,
  type AffordanceInteractionMode,
} from "../sim/affordances";
import type { RecipeView } from "./types";

export type InteractionCue = {
  acceptsInput: boolean;
  keyboardKey: "E" | null;
  label: string;
};

export function interactionCueFor(
  interactionMode: AffordanceInteractionMode,
): InteractionCue {
  const acceptsInput = affordanceAcceptsInput({ interactionMode });
  const labels: Record<AffordanceInteractionMode, string> = {
    execute: "操作",
    inspect: "查看",
    movement: "行动建议",
    unavailable: "条件未满足",
  };
  return {
    acceptsInput,
    keyboardKey: acceptsInput ? "E" : null,
    label: labels[interactionMode],
  };
}

export type CraftingSectionId = "crafting" | "camp" | "building" | "rest";

export type CraftingActionPolicy = {
  section: CraftingSectionId;
  closePanel: boolean;
};

const WORLD_BUILD_ACTIONS = new Set([
  "campfire",
  "shelter",
  "bed",
  "radio-beacon",
  "smoking-rack",
  "rain-collector",
  "torch-waymark",
]);
const CAMP_ACTIONS = new Set(["boil-water", "add-fuel", "collect-rainwater"]);

export const CRAFTING_SECTION_LABELS: Record<CraftingSectionId, { title: string; description: string }> = {
  crafting: {
    title: "随身制作",
    description: "工具、药品与容器。操作后留在面板，便于连续整理物资。",
  },
  camp: {
    title: "营地维护",
    description: "添柴、煮水和接雨会留在面板，直接显示物资或燃料的前后变化。",
  },
  building: {
    title: "建造",
    description: "结构完成后自动返回世界，立即确认模型、位置与可用状态。",
  },
  rest: {
    title: "休息",
    description: "休息完成后自动收起界面，让玩家立即确认天色、时间与身体状态。",
  },
};

export function craftingActionPolicy(recipeId: string): CraftingActionPolicy {
  if (recipeId === "rest") return { section: "rest", closePanel: true };
  if (WORLD_BUILD_ACTIONS.has(recipeId)) return { section: "building", closePanel: true };
  if (CAMP_ACTIONS.has(recipeId)) return { section: "camp", closePanel: false };
  return { section: "crafting", closePanel: false };
}

export function groupCraftingRecipes(recipes: readonly RecipeView[]): Array<{
  id: CraftingSectionId;
  recipes: RecipeView[];
}> {
  const grouped: Record<CraftingSectionId, RecipeView[]> = {
    crafting: [],
    camp: [],
    building: [],
    rest: [],
  };
  for (const recipe of recipes) grouped[craftingActionPolicy(recipe.id).section].push(recipe);
  return (["crafting", "camp", "building", "rest"] as const)
    .filter((id) => grouped[id].length > 0)
    .map((id) => ({ id, recipes: grouped[id] }));
}

export function formatFuelChange(before: number, after: number): string {
  return `营火燃料 ${formatFuel(before)} → ${formatFuel(after)}`;
}

function formatFuel(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.round(seconds));
  if (wholeSeconds < 60) return `${wholeSeconds} 秒`;
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}
