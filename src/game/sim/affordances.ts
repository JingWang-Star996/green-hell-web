import { ITEMS } from "./content";
import type { EcologyRenderProjection } from "../ecology";
import {
  getAvailableWaterContainerCount,
  hasInspectedLandmark,
  isPointShelteredByCampStructures,
} from "./selectors";
import {
  campfireStateForStructure,
  nearestLitCampfire,
} from "./campStructures";
import { STRUCTURE_USE_RADII } from "./structureGeometry";
import { MAXIMUM_FIRE_FUEL_SECONDS, gameHoursToTicks } from "./time";
import {
  CAMPFIRE_RAIN_EXPOSED_GUIDANCE,
  resolveCampfireIgnitionAtPoint,
} from "./campfireIgnitionRules";
import {
  BIOME_PROFILES,
  generateChunkDescriptor,
  worldToChunkCoordinate,
} from "../world/generation";
import {
  resolveSmokingRackEnvironment,
  SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
} from "./smokingRackRules";
import type {
  GameState,
  ItemId,
  PlacedStructureState,
  WorldEntity,
} from "./types";
import {
  isTreeEntity,
  treeHarvestPhase,
  treeIsDepleted,
  treeStandingWorkSeconds,
  treeWorkMultiplier,
} from "./treeHarvest";
import { effectiveTreeGrowthStage, treeRegrowthNextTick } from "./treeRegrowthRuntime";
import { rockMiningProfile } from "./rockHarvest";
import {
  RAIN_COLLECTOR_CAPACITY,
  rainCollectorEnvironmentForStructure,
} from "./rainCollectorRules";
import { RIVER_USE_RANGE } from "../world/terrain";
import { RIVER_WATER_CONTAMINATION } from "../world/riverWater";
import { TORCH_MAX_BURN_SECONDS } from "./lifecycle";
import {
  CAMPAIGN_FACTS,
  canopyReportReady,
  riverReportReady,
} from "./campaignContent";
import { hasObjectiveFact } from "./objectiveFacts";
import {
  CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD,
  CANOPY_JUNCTION_ID,
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  CANOPY_JUNCTION_POSITION,
  CANOPY_JUNCTION_TENSION_VINE_IDS,
  CANOPY_SAMPLE_STABLE_TICKS,
  normalizeCanopyJunctionState,
  type CanopyJunctionPhase,
} from "./canopyJunction";
import {
  WIND_FIELD_FIXED_HZ,
  createWindFieldState,
  normalizeWindFieldState,
  windFieldStrength,
} from "../world/windField";
import {
  TORCH_WAYMARK_MAX_FUEL_SLOTS,
  classifyTorchWaymarkUseOperation,
  normalizeTorchWaymarkFuelQueue,
  torchWaymarkOperationSeconds,
  torchWaymarkTotalFuelSeconds,
} from "./torchWaymarkRules";

export type AffordanceState =
  | "ready"
  | "blocked"
  | "depleted"
  | "ambient"
  | "danger";

export type AffordanceInteractionMode =
  | "execute"
  | "inspect"
  | "movement"
  | "unavailable";

export type AffordanceActionId =
  | "pickup"
  | "cut"
  | "chop"
  | "mine"
  | "dismantle"
  | "collect-water"
  | "attack"
  | "avoid"
  | "collect-wildlife-loot"
  | "inspect"
  | "observe"
  | "add-fuel"
  | "rest"
  | "transmit"
  | "repair"
  | "load-smoking-rack"
  | "collect-smoking-rack"
  | "clear-smoking-rack"
  | "collect-rain-collector"
  | "insert-torch-waymark"
  | "relight-torch-waymark"
  | "top-up-torch-waymark"
  | "none";

export type AffordanceSemanticKind =
  | "tree"
  | "mineable-rock"
  | "harvestable-plant"
  | "pickup-resource"
  | "battery"
  | "water-source"
  | "snake"
  | "wildlife"
  | "hazard"
  | "landmark"
  | "radio"
  | "campfire"
  | "bed"
  | "shelter"
  | "radio-beacon"
  | "smoking-rack"
  | "rain-collector"
  | "torch-waymark"
  | "unknown";

export type AffordanceBlocker =
  | "resource-depleted"
  | "inventory-full"
  | "missing-required-tool"
  | "required-tool-not-equipped"
  | "tool-tier-insufficient"
  | "missing-mining-tool"
  | "missing-container"
  | "reservoir-empty"
  | "camp-not-established"
  | "missing-prerequisite"
  | "access-obstructed"
  | "missing-fuel"
  | "fire-unlit"
  | "fuel-full"
  | "missing-raw-meat"
  | "process-active"
  | "fire-too-far"
  | "missing-tinder"
  | "missing-torch"
  | "fuel-slots-full"
  | "rain-exposed"
  | "structure-not-operational"
  | "objective-not-ready"
  | "unsupported-object";

export type AffordanceRequiredItem = ItemId;

export type AffordanceHighlightTone =
  | "interactable"
  | "restricted"
  | "spent"
  | "context"
  | "threat";

export interface AffordanceAlternative {
  actionId: AffordanceActionId;
  verb: string;
  available: boolean;
  requiredItem: AffordanceRequiredItem | null;
  feedbackKey: string;
}

export interface AffordancePreview {
  label: string;
  detail: string;
  quantity?: number;
  itemId?: ItemId;
  remainingCapacity?: number;
  contamination?: number;
  contaminationBand?: "clear" | "questionable" | "unsafe";
  fuelSeconds?: number;
  fuelCapacitySeconds?: number;
  health?: number;
  maxHealth?: number;
  behavior?: EcologyRenderProjection["behavior"];
  lit?: boolean;
  sheltered?: boolean;
  missingPrerequisiteIds?: readonly string[];
  missingItemIds?: readonly AffordanceRequiredItem[];
  progressSeconds?: number;
  progressCapacitySeconds?: number;
  biome?: string;
  rateMultiplier?: number;
  environmentBlocker?: string;
  alternatives?: readonly AffordanceAlternative[];
  toolClass?: string;
  minimumToolTier?: number;
  primaryMaterial?: string;
  yieldTableId?: string;
  yieldMinimum?: number;
  yieldMaximum?: number;
  remainingBranches?: number;
  remainingTrunkSegments?: number;
  looseLog?: boolean;
  storedUnits?: number;
  storageCapacity?: number;
  exposure?: number;
  siteEfficiencyBand?: "high" | "low";
  fuelSlots?: number;
  fuelSlotCapacity?: number;
  /** Current authoritative forest-wind sector, never the broken panel value. */
  windDirectionSector?: string;
  /** Current authoritative forest-wind strength in the inclusive range 0..1. */
  windStrength?: number;
  /** Value shown by C-17; remains 0 while the connector is broken/open. */
  panelWindStrength?: number;
  sampleDirectionSector?: string;
  sampleWindStrength?: number;
  signalQuality?: number;
  sampleCapturedAtTick?: number;
}

export interface ResolvedAffordance {
  objectId: string;
  semanticKind: AffordanceSemanticKind;
  state: AffordanceState;
  /** Input truth consumed by desktop HUD, touch controls, and command routing. */
  interactionMode: AffordanceInteractionMode;
  actionId: AffordanceActionId;
  verb: string;
  blocker: AffordanceBlocker | null;
  requiredItem: AffordanceRequiredItem | null;
  /** Maximum use distance. Spatial focus/line-of-sight remains an S4 concern. */
  range: number;
  highlightTone: AffordanceHighlightTone;
  animationKey: string;
  feedbackKey: string;
  preview: AffordancePreview;
  estimatedSeconds: number | null;
}

/**
 * Temporary structural seam for the semantic entity work landing beside S3.
 * It deliberately avoids adding another shared-type dependency: a future
 * WorldEntity.semantic field is discovered through this narrow shape.
 */
export interface AffordanceEntitySemantic {
  category?: string;
  interactive?: boolean;
  material?: string;
  species?: string;
  growthStage?: string;
  size?: string;
  visualVariant?: string;
  yaw?: number;
  scale?: number;
  action?: string;
  toolClass?: string;
  toolTier?: number;
  yieldTableId?: string;
  primaryMaterial?: string;
  yieldMinimum?: number;
  yieldMaximum?: number;
  toolRequirement?: {
    action?: string;
    toolClass?: string;
    minimumTier?: number;
  };
  yieldIntent?: {
    tableId?: string;
    primaryMaterial?: string;
    baseUnits?: readonly [number, number];
  };
}

export type AffordanceTarget = WorldEntity | PlacedStructureState;

interface ToolIntent {
  actionId: "pickup" | "cut" | "chop" | "mine";
  requiredItem: AffordanceRequiredItem | null;
  toolClass: string;
  minimumTier: number;
}

function requiredItemLabel(item: AffordanceRequiredItem): string {
  return ITEMS[item].label;
}

function semanticOf(entity: WorldEntity): AffordanceEntitySemantic | undefined {
  return (entity as WorldEntity & { semantic?: AffordanceEntitySemantic })
    .semantic;
}

function semanticCategory(entity: WorldEntity): string | undefined {
  return semanticOf(entity)?.category;
}

function isPlacedStructure(
  target: AffordanceTarget,
): target is PlacedStructureState {
  return "builtAtTick" in target;
}

function toneFor(state: AffordanceState): AffordanceHighlightTone {
  switch (state) {
    case "ready":
      return "interactable";
    case "blocked":
      return "restricted";
    case "depleted":
      return "spent";
    case "ambient":
      return "context";
    case "danger":
      return "threat";
  }
}

export function interactionModeForAffordance(
  value: Pick<ResolvedAffordance, "state" | "actionId">,
): AffordanceInteractionMode {
  if (value.state === "blocked" || value.state === "depleted") {
    return "unavailable";
  }
  if (value.actionId === "avoid") return "movement";
  if (value.actionId === "inspect" || value.actionId === "observe") {
    return "inspect";
  }
  if (
    value.state === "ready" ||
    (value.state === "danger" && value.actionId === "attack")
  ) {
    return "execute";
  }
  return "unavailable";
}

export function affordanceAcceptsInput(
  value: Pick<ResolvedAffordance, "interactionMode">,
): boolean {
  return value.interactionMode === "execute" || value.interactionMode === "inspect";
}

function resolved(
  value: Omit<ResolvedAffordance, "highlightTone" | "interactionMode">,
): ResolvedAffordance {
  return {
    ...value,
    interactionMode: interactionModeForAffordance(value),
    highlightTone: toneFor(value.state),
  };
}

function isEntityDepleted(entity: WorldEntity): boolean {
  return isTreeEntity(entity)
    ? treeIsDepleted(entity)
    : entity.depleted || entity.quantity <= 0;
}

function remainingCapacity(state: GameState, itemId: ItemId): number {
  return Math.max(0, ITEMS[itemId].stackLimit - state.inventory[itemId]);
}

function contaminationBand(
  contamination: number,
): "clear" | "questionable" | "unsafe" {
  if (contamination < 0.2) return "clear";
  if (contamination < 0.5) return "questionable";
  return "unsafe";
}

function toolIntentFor(entity: WorldEntity): ToolIntent {
  const semantic = semanticOf(entity);
  const requirement = semantic?.toolRequirement;
  const category = semantic?.category;
  const toolClass = semantic?.toolClass ?? requirement?.toolClass;
  const action = semantic?.action ?? requirement?.action;
  const minimumTier = semantic?.toolTier ?? requirement?.minimumTier;

  if (category === "mineable-rock") {
    return {
      actionId: "mine",
      requiredItem: "stone-pick",
      toolClass: "pick",
      minimumTier: 1,
    };
  }

  if (category === "tree" || entity.tags.includes("standing-tree")) {
    const usesBlade = toolClass === "blade" || action === "cut";
    return {
      actionId: usesBlade ? "cut" : "chop",
      requiredItem: usesBlade ? "stone-blade" : "axe",
      toolClass: usesBlade ? "blade" : "axe",
      minimumTier: minimumTier ?? 1,
    };
  }

  if (category === "harvestable-plant") {
    if (toolClass === "blade") {
      return {
        actionId: "cut",
        requiredItem: "stone-blade",
        toolClass: "blade",
        minimumTier: minimumTier ?? 1,
      };
    }
    return {
      actionId: action === "pickup" ? "pickup" : "cut",
      requiredItem: null,
      toolClass: "hand",
      minimumTier: 0,
    };
  }

  return {
    actionId: "pickup",
    requiredItem: null,
    toolClass: "hand",
    minimumTier: 0,
  };
}

function hasAndEquippedTool(
  state: GameState,
  requiredItem: AffordanceRequiredItem,
): { owned: boolean; equipped: boolean; tier: number } {
  const inventory = state.inventory as Readonly<Record<string, number>>;
  const equipped = state.player.equippedItem as string | null | undefined;
  const owned = (inventory[requiredItem] ?? 0) > 0;
  return {
    owned,
    equipped: owned && equipped === requiredItem,
    tier: owned ? 1 : 0,
  };
}

function resourcePreview(
  entity: WorldEntity,
  detail: string,
): AffordancePreview {
  const semantic = semanticOf(entity);
  const isRock = semantic?.category === "mineable-rock";
  const treeStage = isTreeEntity(entity)
    ? effectiveTreeGrowthStage(entity)
    : undefined;
  const stageSuffix =
    treeStage === "sapling"
      ? "（树苗）"
      : treeStage === "young"
        ? "（幼树）"
        : "";
  return {
    label: `${entity.label}${stageSuffix}`,
    detail,
    quantity: entity.quantity,
    itemId: isRock ? "stone" : entity.itemId,
    toolClass: semantic?.toolClass ?? semantic?.toolRequirement?.toolClass,
    minimumToolTier:
      isRock
        ? 1
        : semantic?.toolTier ?? semantic?.toolRequirement?.minimumTier,
    primaryMaterial:
      isRock
        ? "stone"
        : semantic?.primaryMaterial ??
          semantic?.yieldIntent?.primaryMaterial ??
          entity.itemId,
    yieldTableId:
      semantic?.yieldTableId ?? semantic?.yieldIntent?.tableId,
    yieldMinimum:
      semantic?.yieldMinimum ?? semantic?.yieldIntent?.baseUnits?.[0],
    yieldMaximum:
      semantic?.yieldMaximum ?? semantic?.yieldIntent?.baseUnits?.[1],
  };
}

function resolveDepletedResource(
  entity: WorldEntity,
  semanticKind: AffordanceSemanticKind,
  actionId: AffordanceActionId,
): ResolvedAffordance {
  return resolved({
    objectId: entity.id,
    semanticKind,
    state: "depleted",
    actionId,
    verb: "查看",
    blocker: "resource-depleted",
    requiredItem: null,
    range: entity.interactRadius,
    animationKey: "none",
    feedbackKey: "affordance.resource.depleted",
    preview: resourcePreview(entity, "这里暂时没有可取得的资源。"),
    estimatedSeconds: null,
  });
}

function resolveSemanticResource(
  state: GameState,
  entity: WorldEntity,
  semanticKind: "tree" | "mineable-rock" | "harvestable-plant",
): ResolvedAffordance {
  if (semanticKind === "tree" && treeHarvestPhase(entity) !== "standing") {
    return resolveFelledTree(state, entity);
  }
  const intent = toolIntentFor(entity);
  const estimatedWorkSeconds =
    semanticKind === "tree"
      ? treeStandingWorkSeconds(entity)
      : semanticKind === "mineable-rock"
        ? rockMiningProfile(entity).workSeconds
        : null;
  if (isEntityDepleted(entity)) {
    return resolveDepletedResource(entity, semanticKind, intent.actionId);
  }

  if (intent.requiredItem) {
    const status = hasAndEquippedTool(state, intent.requiredItem);
    const toolLabel = requiredItemLabel(intent.requiredItem);
    let blocker: AffordanceBlocker | null = null;
    let detail = "工具与目标匹配，可以开始处理。";
    if (!status.owned) {
      blocker =
        intent.requiredItem === "stone-pick"
          ? "missing-mining-tool"
          : "missing-required-tool";
      detail =
        intent.requiredItem === "stone-pick"
          ? "需要采矿工具；这块离散岩体不能当作地面石块直接拾取。"
          : `需要先取得${toolLabel}。`;
    } else if (!status.equipped) {
      blocker = "required-tool-not-equipped";
      detail = `需要从快捷栏装备${toolLabel}。`;
    } else if (status.tier < intent.minimumTier) {
      blocker = "tool-tier-insufficient";
      detail = `${toolLabel}等级不足，需要 ${intent.minimumTier} 级${toolLabel}。`;
    }

    if (blocker) {
      return resolved({
        objectId: entity.id,
        semanticKind,
        state: "blocked",
        actionId: intent.actionId,
        verb:
          intent.actionId === "mine"
            ? "开采"
            : intent.actionId === "cut"
              ? "切割"
              : "砍伐",
        blocker,
        requiredItem: intent.requiredItem,
        range: entity.interactRadius,
        animationKey:
          intent.actionId === "mine"
            ? "tool.pick.swing"
            : intent.actionId === "cut"
              ? "tool.blade.cut"
              : "tool.axe.chop",
        feedbackKey:
          intent.requiredItem === "stone-pick"
            ? "affordance.rock.mining-tool-required"
            : "affordance.resource.tool-required",
        preview: resourcePreview(entity, detail),
        estimatedSeconds: estimatedWorkSeconds,
      });
    }
  }

  if (
    semanticKind !== "tree" &&
    entity.itemId &&
    remainingCapacity(state, entity.itemId) <= 0
  ) {
    return resolved({
      objectId: entity.id,
      semanticKind,
      state: "blocked",
      actionId: intent.actionId,
      verb: intent.actionId === "mine" ? "开采" : "采集",
      blocker: "inventory-full",
      requiredItem: intent.requiredItem,
      range: entity.interactRadius,
      animationKey: "none",
      feedbackKey: "affordance.resource.inventory-full",
      preview: {
        ...resourcePreview(entity, `背包装不下更多${ITEMS[entity.itemId].label}。`),
        remainingCapacity: 0,
      },
      estimatedSeconds: estimatedWorkSeconds,
    });
  }

  const actionLabel =
    intent.actionId === "mine"
      ? "开采"
      : intent.actionId === "chop"
        ? "砍伐"
        : intent.actionId === "cut"
          ? "切割"
          : "拾取";
  return resolved({
    objectId: entity.id,
    semanticKind,
    state: "ready",
    actionId: intent.actionId,
    verb: actionLabel,
    blocker: null,
    requiredItem: intent.requiredItem,
    range: entity.interactRadius,
    animationKey:
      intent.actionId === "mine"
        ? "tool.pick.swing"
        : intent.actionId === "chop"
          ? "tool.axe.chop"
          : intent.actionId === "cut"
            ? intent.requiredItem === "stone-blade"
              ? "tool.blade.cut"
              : "hand.gather"
            : "hand.pickup",
    feedbackKey: `affordance.${semanticKind}.${intent.actionId}.ready`,
    preview: {
      ...resourcePreview(entity, `${actionLabel}${entity.label}。`),
      remainingCapacity: entity.itemId
        ? remainingCapacity(state, entity.itemId)
        : undefined,
    },
    estimatedSeconds: estimatedWorkSeconds,
  });
}

function resolveFelledTree(
  state: GameState,
  entity: WorldEntity,
): ResolvedAffordance {
  const phase = treeHarvestPhase(entity);
  const harvest = entity.treeHarvest;
  if (phase === "stump" || !harvest) {
    if (entity.treeRegrowth?.stage === "stump") {
      const nextTick = treeRegrowthNextTick(entity.treeRegrowth);
      const remainingDays = nextTick === null
        ? null
        : Math.max(
            1,
            Math.ceil(
              Math.max(0, nextTick - state.clock.tick) /
                gameHoursToTicks(24),
            ),
          );
      return resolved({
        objectId: entity.id,
        semanticKind: "tree",
        state: "depleted",
        actionId: "chop",
        verb: "查看树桩",
        blocker: "resource-depleted",
        requiredItem: null,
        range: entity.interactRadius,
        animationKey: "none",
        feedbackKey: "affordance.tree.regrowing-stump",
        preview: {
          ...resourcePreview(
            entity,
            remainingDays === null
              ? "树桩保持在世界中；生长日程暂不可用。"
              : `树桩会先保留，约 ${remainingDays} 个游戏日后萌发树苗。`,
          ),
          label: `${entity.label}（再生树桩）`,
          quantity: 0,
        },
        estimatedSeconds: null,
      });
    }
    return resolveDepletedResource(entity, "tree", "chop");
  }

  const previewBase: AffordancePreview = {
    label: `${entity.label}（倒木）`,
    detail: "",
    remainingBranches: harvest.branches,
    remainingTrunkSegments: harvest.trunkSegments,
    looseLog: harvest.looseLog,
    primaryMaterial: entity.semantic?.primaryMaterial ?? "wood",
  };
  if (phase === "branches" || phase === "loose-log") {
    const itemId: ItemId = phase === "branches" ? "stick" : "log";
    const capacity = remainingCapacity(state, itemId);
    const blocked = capacity <= 0;
    const noun = phase === "branches" ? "枝条" : "分段原木";
    return resolved({
      objectId: entity.id,
      semanticKind: "tree",
      state: blocked ? "blocked" : "ready",
      actionId: "pickup",
      verb: phase === "branches" ? "拾取枝条" : "搬取原木",
      blocker: blocked ? "inventory-full" : null,
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.pickup",
      feedbackKey: blocked
        ? "affordance.tree.inventory-full"
        : `affordance.tree.${phase}.ready`,
      preview: {
        ...previewBase,
        itemId,
        quantity: phase === "branches" ? harvest.branches : 1,
        remainingCapacity: capacity,
        detail: blocked
          ? `背包装不下更多${ITEMS[itemId].label}；${noun}仍留在倒木旁。`
          : phase === "branches"
            ? `树冠端还有 ${harvest.branches} 根可徒手取下的枝条。`
            : "切下的原木仍在地上，搬取后才能用于制作。",
      },
      estimatedSeconds: 2,
    });
  }

  const axe = hasAndEquippedTool(state, "axe");
  const blocker = !axe.owned
    ? "missing-required-tool"
    : !axe.equipped
      ? "required-tool-not-equipped"
      : axe.tier < 1
        ? "tool-tier-insufficient"
        : null;
  const estimatedSeconds = Math.max(
    5,
    Math.round(6 * treeWorkMultiplier(entity)),
  );
  return resolved({
    objectId: entity.id,
    semanticKind: "tree",
    state: blocker ? "blocked" : "ready",
    actionId: "chop",
    verb: "分段倒木",
    blocker,
    requiredItem: "axe",
    range: entity.interactRadius,
    animationKey: "tool.axe.chop",
    feedbackKey: blocker
      ? "affordance.resource.tool-required"
      : "affordance.tree.buck.ready",
    preview: {
      ...previewBase,
      quantity: harvest.trunkSegments,
      detail: blocker
        ? "倒下的树干需要装备石斧后才能逐段切开。"
        : `下一处切口已标出；还可分出 ${harvest.trunkSegments} 根原木。`,
      toolClass: "axe",
      minimumToolTier: 1,
    },
    estimatedSeconds,
  });
}

function resolveBattery(
  state: GameState,
  entity: WorldEntity,
): ResolvedAffordance {
  if (isEntityDepleted(entity)) {
    return resolveDepletedResource(entity, "battery", "dismantle");
  }

  const missingPrerequisiteIds = [
    "landmark.camp-radio",
    "landmark.survey-cache",
    "landmark.weather-station",
  ].filter((id) => !hasInspectedLandmark(state, id));
  let blocker: AffordanceBlocker | null = null;
  let requiredItem: AffordanceRequiredItem | null = null;
  let detail = "线路已经确认，可以用石斧从侧面撬开托架。";
  if (!state.objectives.flags.campEstablished) {
    blocker = "camp-not-established";
    detail = "先完成一次安全过夜，才能拆下远征唯一电源。";
  } else if (missingPrerequisiteIds.length > 0) {
    blocker = "missing-prerequisite";
    detail = "先调查电台、勘测箱与气象站，避免拆坏电池。";
  } else {
    const axe = hasAndEquippedTool(state, "axe");
    requiredItem = "axe";
    if (!axe.owned) {
      blocker = "missing-required-tool";
      detail = "锈死的托架需要石斧撬开。";
    } else if (!axe.equipped) {
      blocker = "required-tool-not-equipped";
      detail = "从快捷栏装备石斧，再撬开托架。";
    } else if (remainingCapacity(state, "battery") <= 0) {
      blocker = "inventory-full";
      detail = "背包中的电池位置已经占满。";
    }
  }

  return resolved({
    objectId: entity.id,
    semanticKind: "battery",
    state: blocker ? "blocked" : "ready",
    actionId: "dismantle",
    verb: "拆取电池",
    blocker,
    requiredItem,
    range: entity.interactRadius,
    animationKey: "tool.axe.pry",
    feedbackKey: blocker
      ? `affordance.battery.blocked.${blocker}`
      : "affordance.battery.dismantle.ready",
    preview: {
      ...resourcePreview(entity, detail),
      missingPrerequisiteIds,
      remainingCapacity: remainingCapacity(state, "battery"),
    },
    estimatedSeconds: 12,
  });
}

function resolvePickupResource(
  state: GameState,
  entity: WorldEntity,
): ResolvedAffordance {
  if (isEntityDepleted(entity)) {
    return resolveDepletedResource(entity, "pickup-resource", "pickup");
  }
  if (!entity.itemId) {
    return resolved({
      objectId: entity.id,
      semanticKind: "unknown",
      state: "ambient",
      actionId: "observe",
      verb: "观察",
      blocker: "unsupported-object",
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "none",
      feedbackKey: "affordance.resource.unsupported",
      preview: resourcePreview(entity, "目前没有可执行的资源动作。"),
      estimatedSeconds: null,
    });
  }
  const capacity = remainingCapacity(state, entity.itemId);
  if (capacity <= 0) {
    return resolved({
      objectId: entity.id,
      semanticKind: "pickup-resource",
      state: "blocked",
      actionId: "pickup",
      verb: "拾取",
      blocker: "inventory-full",
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.pickup",
      feedbackKey: "affordance.resource.inventory-full",
      preview: {
        ...resourcePreview(entity, `背包装不下更多${ITEMS[entity.itemId].label}。`),
        remainingCapacity: 0,
      },
      estimatedSeconds: null,
    });
  }
  return resolved({
    objectId: entity.id,
    semanticKind: "pickup-resource",
    state: "ready",
    actionId: "pickup",
    verb: "拾取",
    blocker: null,
    requiredItem: null,
    range: entity.interactRadius,
    animationKey: "hand.pickup",
    feedbackKey: "affordance.resource.pickup.ready",
    preview: {
      ...resourcePreview(entity, `可以拾取${ITEMS[entity.itemId].label}。`),
      remainingCapacity: capacity,
    },
    estimatedSeconds: null,
  });
}

interface WaterAffordanceSource {
  id: string;
  label: string;
  range: number;
  contamination: number;
}

function resolveWaterSource(
  state: GameState,
  source: WaterAffordanceSource,
): ResolvedAffordance {
  const containers = getAvailableWaterContainerCount(state);
  const blocked = containers <= 0;
  return resolved({
    objectId: source.id,
    semanticKind: "water-source",
    state: blocked ? "blocked" : "ready",
    actionId: "collect-water",
    verb: "取水",
    blocker: blocked ? "missing-container" : null,
    requiredItem: blocked ? "coconut-shell" : null,
    range: source.range,
    animationKey: "hand.fill-container",
    feedbackKey: blocked
      ? "affordance.water.container-required"
      : "affordance.water.collect.ready",
    preview: {
      label: source.label,
      detail: blocked
        ? "需要一个没有装水的椰壳容器。"
        : source.contamination >= 0.5
          ? "水体明显浑浊；装取后应煮沸再饮用。"
          : "水质仍需确认，直接饮用存在风险。",
      contamination: source.contamination,
      contaminationBand: contaminationBand(source.contamination),
      missingItemIds: blocked ? ["coconut-shell"] : [],
    },
    estimatedSeconds: 10,
  });
}

function resolveWater(
  state: GameState,
  entity: WorldEntity,
): ResolvedAffordance {
  return resolveWaterSource(state, {
    id: entity.id,
    label: entity.label,
    range: entity.interactRadius,
    contamination: entity.contamination ?? 0.5,
  });
}

/** Ephemeral continuous-river capability; no WorldEntity is materialized. */
export function resolveRiverWaterAffordance(
  state: GameState,
  objectId: string,
): ResolvedAffordance {
  return resolveWaterSource(state, {
    id: objectId,
    label: "流动溪水",
    range: RIVER_USE_RANGE,
    contamination: RIVER_WATER_CONTAMINATION,
  });
}

function isSnake(entity: WorldEntity): boolean {
  return (
    entity.id.includes("snake") ||
    entity.label.includes("蛇") ||
    (entity.tags.includes("animal") && entity.tags.includes("threat"))
  );
}

function resolveHazard(
  state: GameState,
  entity: WorldEntity,
): ResolvedAffordance {
  const snake = isSnake(entity);
  if (isEntityDepleted(entity)) {
    return resolved({
      objectId: entity.id,
      semanticKind: snake ? "snake" : "hazard",
      state: "depleted",
      actionId: "observe",
      verb: "观察",
      blocker: "resource-depleted",
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "none",
      feedbackKey: "affordance.hazard.gone",
      preview: {
        label: entity.label,
        detail: "危险已经离开当前活动范围。",
      },
      estimatedSeconds: null,
    });
  }

  const spearReady =
    state.inventory.spear > 0 && state.player.equippedItem === "spear";
  return resolved({
    objectId: entity.id,
    semanticKind: snake ? "snake" : "hazard",
    state: "danger",
    actionId: spearReady ? "attack" : "avoid",
    verb: spearReady ? "主动刺击" : "绕行",
    blocker: null,
    requiredItem: spearReady ? "spear" : null,
    range: entity.interactRadius,
    animationKey: spearReady ? "weapon.spear.thrust" : "movement.evade",
    feedbackKey: spearReady
      ? "affordance.snake.attack.ready"
      : "affordance.snake.avoid.recommended",
    preview: {
      label: entity.label,
      detail: spearReady
        ? "蛇尚未扑咬；可以抢先刺击，也可以保持距离绕行。"
        : "不要踏入扑咬范围。绕行，或装备石矛后主动刺击。",
      alternatives: [
        {
          actionId: "attack",
          verb: "主动刺击",
          available: spearReady,
          requiredItem: "spear",
          feedbackKey: "affordance.snake.attack",
        },
        {
          actionId: "avoid",
          verb: "绕行",
          available: true,
          requiredItem: null,
          feedbackKey: "affordance.snake.avoid",
        },
      ],
    },
    estimatedSeconds: spearReady ? 3 : null,
  });
}

function canopyDirectionSector(directionRadians: number): string {
  const labels = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  const degrees =
    (((directionRadians * 180) / Math.PI) % 360 + 360) % 360;
  return labels[Math.round(degrees / 45) % labels.length];
}

function currentCanopyWind(state: GameState) {
  const currentTick = state.clock.tick;
  if (!state.world.windField) {
    return createWindFieldState(state.seed, currentTick);
  }
  const normalized = normalizeWindFieldState(
    state.world.windField,
    state.seed,
    currentTick,
  );
  return normalized.lastAdvancedTick === currentTick
    ? normalized
    : createWindFieldState(state.seed, currentTick);
}

interface CanopyObstructionProjection {
  phase: CanopyJunctionPhase;
  treeCleared: boolean;
  clearedVineCount: number;
  missingObstructionIds: string[];
}

function projectCanopyObstructions(
  state: GameState,
): CanopyObstructionProjection {
  const tree = state.world.entities[CANOPY_JUNCTION_OBSTRUCTION_TREE_ID];
  const treeCleared = Boolean(tree && treeIsDepleted(tree));
  const clearedVineIds = CANOPY_JUNCTION_TENSION_VINE_IDS.filter((id) => {
    const vine = state.world.entities[id];
    return Boolean(vine && isEntityDepleted(vine));
  });
  const vinesCleared =
    clearedVineIds.length === CANOPY_JUNCTION_TENSION_VINE_IDS.length;
  const accessCleared = treeCleared || vinesCleared;
  const junction = normalizeCanopyJunctionState(
    state.world.canopyJunction,
    state.clock.tick,
  );
  const phase = !accessCleared
    ? "obstructed"
    : junction.phase === "obstructed"
      ? "exposed"
      : junction.phase;

  return {
    phase,
    treeCleared,
    clearedVineCount: clearedVineIds.length,
    missingObstructionIds: accessCleared
      ? []
      : [
          ...(treeCleared ? [] : [CANOPY_JUNCTION_OBSTRUCTION_TREE_ID]),
          ...CANOPY_JUNCTION_TENSION_VINE_IDS.filter(
            (id) => !clearedVineIds.includes(id),
          ),
        ],
  };
}

/**
 * C-17 is deliberately phase-driven instead of inheriting the generic
 * landmark `recorded` shortcut. Early discovery, repair, sampling and report
 * remain available without a hidden task-stage gate.
 */
function resolveCanopyJunction(
  state: GameState,
  entity: WorldEntity,
): ResolvedAffordance {
  const junction = normalizeCanopyJunctionState(
    state.world.canopyJunction,
    state.clock.tick,
  );
  const obstruction = projectCanopyObstructions(state);
  const wind = currentCanopyWind(state);
  const currentWindStrength = windFieldStrength(wind);
  const currentWindSector = canopyDirectionSector(wind.directionRadians);
  const sample = junction.sample;
  const sampleSector = sample
    ? canopyDirectionSector(sample.directionRadians)
    : undefined;
  const connectorBroken =
    obstruction.phase === "obstructed" ||
    obstruction.phase === "exposed" ||
    obstruction.phase === "connector-open";
  const sheltered = isPointShelteredByCampStructures(
    state,
    CANOPY_JUNCTION_POSITION,
  );
  const rainBlocked =
    (obstruction.phase === "exposed" ||
      obstruction.phase === "connector-open") &&
    state.weather.rainIntensity >= CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD &&
    !sheltered;
  const previewBase: AffordancePreview = {
    label: entity.label,
    detail: "",
    windDirectionSector: currentWindSector,
    windStrength: currentWindStrength,
    panelWindStrength: connectorBroken
      ? 0
      : sample?.strength ?? currentWindStrength,
    sampleDirectionSector: sampleSector,
    sampleWindStrength: sample?.strength,
    signalQuality: sample?.signalQuality,
    sampleCapturedAtTick: sample?.capturedAtTick,
    sheltered,
  };

  if (obstruction.phase === "obstructed") {
    const axe = hasAndEquippedTool(state, "axe");
    const blade = hasAndEquippedTool(state, "stone-blade");
    return resolved({
      objectId: entity.id,
      semanticKind: "landmark",
      state: "blocked",
      actionId: "inspect",
      verb: "检查清障路径",
      blocker: "access-obstructed",
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.inspect",
      feedbackKey: "affordance.canopy-junction.access-obstructed",
      preview: {
        ...previewBase,
        detail:
          `箱门仍受倒木与藤本牵拉。两条路线任选其一：完整分段并搬空倒木，` +
          `或用石刃切断两根受力藤本（${obstruction.clearedVineCount}/2）。` +
          `现场是${currentWindSector}向风、强度 ${currentWindStrength.toFixed(2)}，故障面板仍固定在 0.0。`,
        missingPrerequisiteIds: obstruction.missingObstructionIds,
        alternatives: [
          {
            actionId: "chop",
            verb: "分段搬离倒木",
            available: !obstruction.treeCleared && axe.equipped,
            requiredItem: "axe",
            feedbackKey: "affordance.canopy-junction.clear-tree",
          },
          {
            actionId: "cut",
            verb: "切断两根受力藤本",
            available:
              obstruction.clearedVineCount <
                CANOPY_JUNCTION_TENSION_VINE_IDS.length && blade.equipped,
            requiredItem: "stone-blade",
            feedbackKey: "affordance.canopy-junction.cut-vines",
          },
        ],
      },
      estimatedSeconds: null,
    });
  }

  if (obstruction.phase === "exposed") {
    return resolved({
      objectId: entity.id,
      semanticKind: "landmark",
      state: rainBlocked ? "blocked" : "ready",
      actionId: "inspect",
      verb: rainBlocked ? "检查防水盖" : "打开防水接头",
      blocker: rainBlocked ? "rain-exposed" : null,
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.inspect",
      feedbackKey: rainBlocked
        ? "affordance.canopy-junction.open.rain-exposed"
        : "affordance.canopy-junction.open.ready",
      preview: {
        ...previewBase,
        detail: rainBlocked
          ? `现场有${currentWindSector}向风、强度 ${currentWindStrength.toFixed(2)}，面板仍为 0.0。强雨中开盖会进水；在 C-17 上方搭叶棚，或等待雨势减弱。`
          : `清障已完成。现场有${currentWindSector}向风、强度 ${currentWindStrength.toFixed(2)}，面板仍为 0.0；可以打开防水盖核对接头。`,
        environmentBlocker: rainBlocked ? "rain-exposed" : undefined,
      },
      estimatedSeconds: rainBlocked ? null : 6,
    });
  }

  if (obstruction.phase === "connector-open") {
    return resolved({
      objectId: entity.id,
      semanticKind: "landmark",
      state: rainBlocked ? "blocked" : "ready",
      actionId: "inspect",
      verb: rainBlocked ? "保护开放接头" : "复位并锁紧接头",
      blocker: rainBlocked ? "rain-exposed" : null,
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.repair",
      feedbackKey: rainBlocked
        ? "affordance.canopy-junction.restore.rain-exposed"
        : "affordance.canopy-junction.restore.ready",
      preview: {
        ...previewBase,
        detail: rainBlocked
          ? "防水接头已经开放，强雨会灌入接口；先搭叶棚或等待雨势减弱，再完成复位。"
          : "插头退出了半圈。对齐标记、压入插头并锁紧防水环即可恢复传感链路。",
        environmentBlocker: rainBlocked ? "rain-exposed" : undefined,
      },
      estimatedSeconds: rainBlocked ? null : 25,
    });
  }

  if (obstruction.phase === "link-restored") {
    return resolved({
      objectId: entity.id,
      semanticKind: "landmark",
      state: "ambient",
      actionId: "inspect",
      verb: "查看采样状态",
      blocker: null,
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.inspect",
      feedbackKey: "affordance.canopy-junction.sampling.pending",
      preview: {
        ...previewBase,
        detail: `链路已经恢复，设备正等待连续 10 秒的有效阵风。当前${currentWindSector}向风，强度 ${currentWindStrength.toFixed(2)}；离开后采样仍会继续。`,
        progressSeconds: 0,
        progressCapacitySeconds:
          CANOPY_SAMPLE_STABLE_TICKS / WIND_FIELD_FIXED_HZ,
      },
      estimatedSeconds: null,
    });
  }

  if (obstruction.phase === "sampling") {
    const progressSeconds =
      junction.consecutiveReadableTicks / WIND_FIELD_FIXED_HZ;
    return resolved({
      objectId: entity.id,
      semanticKind: "landmark",
      state: "ambient",
      actionId: "inspect",
      verb: "查看采样进度",
      blocker: null,
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.inspect",
      feedbackKey: "affordance.canopy-junction.sampling.progress",
      preview: {
        ...previewBase,
        detail: `正在捕捉稳定阵风：${progressSeconds.toFixed(1)}/10.0 秒。当前${currentWindSector}向风，强度 ${currentWindStrength.toFixed(2)}；进度不足时会按真实风场重新累计。`,
        progressSeconds,
        progressCapacitySeconds:
          CANOPY_SAMPLE_STABLE_TICKS / WIND_FIELD_FIXED_HZ,
      },
      estimatedSeconds: null,
    });
  }

  if (obstruction.phase === "sample-ready" && sample && sampleSector) {
    return resolved({
      objectId: entity.id,
      semanticKind: "landmark",
      state: "ready",
      actionId: "inspect",
      verb: "查看阵风样本",
      blocker: null,
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.inspect",
      feedbackKey: "affordance.canopy-junction.sample.ready",
      preview: {
        ...previewBase,
        detail: `有效样本已锁定：${sampleSector}向，强度 ${sample.strength.toFixed(2)}，信号质量 ${Math.round(sample.signalQuality * 100)}%。查看后可通过求救信标上报。`,
        progressSeconds:
          CANOPY_SAMPLE_STABLE_TICKS / WIND_FIELD_FIXED_HZ,
        progressCapacitySeconds:
          CANOPY_SAMPLE_STABLE_TICKS / WIND_FIELD_FIXED_HZ,
      },
      estimatedSeconds: 2,
    });
  }

  return resolved({
    objectId: entity.id,
    semanticKind: "landmark",
    state: "ambient",
    actionId: "observe",
    verb: "查看已上报样本",
    blocker: null,
    requiredItem: null,
    range: entity.interactRadius,
    animationKey: "hand.inspect",
    feedbackKey: "affordance.canopy-junction.reported",
    preview: {
      ...previewBase,
      detail: sample && sampleSector
        ? `已上报样本：${sampleSector}向，强度 ${sample.strength.toFixed(2)}，信号质量 ${Math.round(sample.signalQuality * 100)}%；现场链路继续提供真实风数据。`
        : "C-17 样本已经上报；现场链路继续提供真实林冠风数据。",
    },
    estimatedSeconds: null,
  });
}

function resolveLandmark(
  state: GameState,
  entity: WorldEntity,
): ResolvedAffordance {
  if (entity.id === CANOPY_JUNCTION_ID) {
    return resolveCanopyJunction(state, entity);
  }
  const recorded = hasInspectedLandmark(state, entity.id);
  const blockingEntityId = entity.tags
    .find((tag) => tag.startsWith("blocked-by:"))
    ?.slice("blocked-by:".length);
  const blockingEntity = blockingEntityId
    ? state.world.entities[blockingEntityId]
    : undefined;
  const accessObstructed = Boolean(
    blockingEntity &&
      (isTreeEntity(blockingEntity)
        ? !treeIsDepleted(blockingEntity)
        : !blockingEntity.depleted),
  );
  const missingPrerequisiteIds =
    entity.id === "landmark.weather-station"
      ? ["landmark.camp-radio", "landmark.survey-cache"].filter(
          (id) => !hasInspectedLandmark(state, id),
        )
      : [];
  const semanticKind = entity.kind === "radio" ? "radio" : "landmark";

  if (entity.tags.includes("river-gauge")) {
    return resolved({
      objectId: entity.id,
      semanticKind: "landmark",
      state: accessObstructed ? "blocked" : "ready",
      actionId: "inspect",
      verb: accessObstructed ? "检查阻挡" : recorded ? "复读水尺" : "读取水尺",
      blocker: accessObstructed ? "access-obstructed" : null,
      requiredItem: accessObstructed ? "axe" : null,
      range: entity.interactRadius,
      animationKey: "hand.inspect",
      feedbackKey: accessObstructed
        ? "affordance.river-gauge.access-obstructed"
        : "affordance.river-gauge.read.ready",
      preview: {
        label: entity.label,
        detail: accessObstructed
          ? "一截倒木挡住了下部刻度。装备石斧分段，再把原木搬离。"
          : recorded
            ? "水尺会随集水区变化；可以重复读取最新水位与趋势。"
            : "黑白刻度与橙色安全线清晰可见，可以记录当前水位趋势。",
        missingItemIds: accessObstructed ? ["axe"] : [],
        missingPrerequisiteIds: accessObstructed && blockingEntityId
          ? [blockingEntityId]
          : [],
      },
      estimatedSeconds: accessObstructed ? null : 6,
    });
  }

  if (recorded) {
    return resolved({
      objectId: entity.id,
      semanticKind,
      state: "ambient",
      actionId: "observe",
      verb: "查看记录",
      blocker: null,
      requiredItem: null,
      range: entity.interactRadius,
      animationKey: "hand.inspect",
      feedbackKey: "affordance.landmark.recorded",
      preview: {
        label: entity.label,
        detail: "线索已经写入笔记；仍可观察现场，不会重复结算进度。",
        missingPrerequisiteIds: [],
      },
      estimatedSeconds: null,
    });
  }

  const blocked = missingPrerequisiteIds.length > 0 || accessObstructed;
  return resolved({
    objectId: entity.id,
    semanticKind,
    state: blocked ? "blocked" : "ready",
    actionId: "inspect",
    verb: "调查",
    blocker: accessObstructed
      ? "access-obstructed"
      : blocked
        ? "missing-prerequisite"
        : null,
    requiredItem: null,
    range: entity.interactRadius,
    animationKey: "hand.inspect",
    feedbackKey: blocked
      ? "affordance.landmark.prerequisite-required"
      : "affordance.landmark.inspect.ready",
    preview: {
      label: entity.label,
      detail: blocked
        ? "缺少电台故障记录与勘测坐标，先补齐前置调查。"
        : "可以花时间仔细调查并记录线索。",
      missingPrerequisiteIds,
    },
    estimatedSeconds: blocked ? null : 12,
  });
}

function structureOperational(state: GameState, target: PlacedStructureState): boolean {
  if (state.camp.structures?.some((structure) => structure.id === target.id)) {
    return true;
  }
  switch (target.kind) {
    case "campfire":
      return state.camp.fire.built;
    case "bed":
      return state.camp.bedBuilt;
    case "shelter":
      return state.camp.shelterBuilt;
    case "radio-beacon":
      return state.camp.beaconBuilt;
    case "smoking-rack":
    case "rain-collector":
    case "torch-waymark":
      return false;
  }
}

function resolveUnbuiltStructure(
  state: GameState,
  target: PlacedStructureState,
): ResolvedAffordance {
  const missingItemIds: AffordanceRequiredItem[] =
    target.kind === "radio-beacon"
      ? (["battery", "stick", "vine"] as const).filter(
          (itemId) => state.inventory[itemId] <= 0,
        )
      : [];
  return resolved({
    objectId: target.id,
    semanticKind: target.kind,
    state: "blocked",
    actionId: "repair",
    verb: "检查结构",
    blocker: "structure-not-operational",
    requiredItem: missingItemIds[0] ?? null,
    range: STRUCTURE_USE_RADII[target.kind],
    animationKey: "hand.repair",
    feedbackKey: `affordance.structure.${target.kind}.not-operational`,
    preview: {
      label: target.kind,
      detail: "结构尚未完成或当前不可用，需要先完成建造/修复。",
      missingItemIds,
    },
    estimatedSeconds: null,
  });
}

function resolveCampfire(
  state: GameState,
  target: PlacedStructureState,
): ResolvedAffordance {
  if (!structureOperational(state, target)) {
    return resolveUnbuiltStructure(state, target);
  }
  const fire = campfireStateForStructure(state, target);
  const relighting = !fire.lit;
  const ignition = resolveCampfireIgnitionAtPoint(state, target.position);
  const fuelFull =
    fire.fuelSeconds >= MAXIMUM_FIRE_FUEL_SECONDS - 1e-6;
  const needsStick = relighting
    ? fire.fuelSeconds <= 1e-6
    : true;
  const missingItemIds: AffordanceRequiredItem[] = [];
  if (needsStick && state.inventory.stick <= 0) missingItemIds.push("stick");
  if (relighting && state.inventory["dry-leaf"] <= 0) {
    missingItemIds.push("dry-leaf");
  }

  let blocker: AffordanceBlocker | null = null;
  let requiredItem: AffordanceRequiredItem | null = null;
  let detail = relighting
    ? needsStick
      ? "加入木棍和干叶重新引火。"
      : "余燃料仍在；用一片干叶重新引火，不消耗木棍。"
    : "快速加入一根木棍，延长燃烧时间。";
  if (!relighting && fuelFull) {
    blocker = "fuel-full";
    detail = "燃料已到上限，无需再消耗木棍。";
  } else if (needsStick && state.inventory.stick <= 0) {
    blocker = "missing-fuel";
    requiredItem = "stick";
    detail = "需要一根木棍添火。";
  } else if (relighting && state.inventory["dry-leaf"] <= 0) {
    blocker = "missing-tinder";
    requiredItem = "dry-leaf";
    detail = "熄灭的火堆需要干叶引火。";
  } else if (relighting && !ignition.canIgnite) {
    blocker = "rain-exposed";
    detail = CAMPFIRE_RAIN_EXPOSED_GUIDANCE;
  }

  return resolved({
    objectId: target.id,
    semanticKind: "campfire",
    state: blocker ? "blocked" : "ready",
    actionId: "add-fuel",
    verb: relighting ? "重新点火" : "添柴",
    blocker,
    requiredItem,
    range: STRUCTURE_USE_RADII.campfire,
    animationKey: "hand.add-fuel",
    feedbackKey: blocker
      ? `affordance.campfire.blocked.${blocker}`
      : relighting
        ? "affordance.campfire.relight.ready"
        : "affordance.campfire.add-fuel.ready",
    preview: {
      label: "营火",
      detail,
      fuelSeconds: fire.fuelSeconds,
      fuelCapacitySeconds: MAXIMUM_FIRE_FUEL_SECONDS,
      lit: fire.lit,
      sheltered: ignition.sheltered,
      missingItemIds,
    },
    estimatedSeconds: 6,
  });
}

function resolveSmokingRack(
  state: GameState,
  target: PlacedStructureState,
): ResolvedAffordance {
  const descriptor = generateChunkDescriptor(
    String(state.seed),
    worldToChunkCoordinate(target.position.x, target.position.z),
  );
  const fire = nearestLitCampfire(state, target.position);
  const environment = resolveSmokingRackEnvironment({
    biome: descriptor.biome,
    rainIntensity: state.weather.rainIntensity,
    sheltered: isPointShelteredByCampStructures(state, target.position),
    fireLit: fire !== null,
    distanceToFire: fire
      ? Math.hypot(
          target.position.x - fire.position.x,
          target.position.z - fire.position.z,
        )
      : null,
  });
  const process = target.process;
  const commonPreview = {
    label: "烟熏架",
    detail: "",
    biome: descriptor.biome,
    rateMultiplier: environment.rateMultiplier,
    environmentBlocker: environment.blocker ?? undefined,
    progressCapacitySeconds: SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
    sheltered: isPointShelteredByCampStructures(state, target.position),
    lit: fire !== null,
  } satisfies AffordancePreview;

  if (!process) {
    const hasMeat = state.inventory["raw-meat"] > 0;
    return resolved({
      objectId: target.id,
      semanticKind: "smoking-rack",
      state: hasMeat ? "ready" : "blocked",
      actionId: "load-smoking-rack",
      verb: "放入生肉",
      blocker: hasMeat ? null : "missing-raw-meat",
      requiredItem: "raw-meat",
      range: STRUCTURE_USE_RADII["smoking-rack"],
      animationKey: "hand.load-rack",
      feedbackKey: hasMeat
        ? "affordance.smoking-rack.load.ready"
        : "affordance.smoking-rack.raw-meat-required",
      preview: {
        ...commonPreview,
        detail: hasMeat
          ? `放入一份生肉；${BIOME_PROFILES[descriptor.biome].label}环境速率 ×${environment.rateMultiplier.toFixed(2)}。`
          : "需要先猎取一份生肉。",
        missingItemIds: hasMeat ? [] : ["raw-meat"],
        progressSeconds: 0,
      },
      estimatedSeconds: environment.estimatedSimulationSeconds,
    });
  }

  if (process.status === "ready") {
    const full = remainingCapacity(state, "smoked-meat") <= 0;
    return resolved({
      objectId: target.id,
      semanticKind: "smoking-rack",
      state: full ? "blocked" : "ready",
      actionId: "collect-smoking-rack",
      verb: "收取烟熏肉",
      blocker: full ? "inventory-full" : null,
      requiredItem: null,
      range: STRUCTURE_USE_RADII["smoking-rack"],
      animationKey: "hand.collect-rack",
      feedbackKey: full
        ? "affordance.smoking-rack.output-full"
        : "affordance.smoking-rack.collect.ready",
      preview: {
        ...commonPreview,
        detail: full
          ? "背包装不下；成品会安全留在架上。"
          : "烟熏已经完成，可以收取一份长保质期肉食。",
        progressSeconds: SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
        itemId: "smoked-meat",
      },
      estimatedSeconds: 2,
    });
  }

  if (process.status === "spoiled") {
    return resolved({
      objectId: target.id,
      semanticKind: "smoking-rack",
      state: "ready",
      actionId: "clear-smoking-rack",
      verb: "清理腐坏肉",
      blocker: null,
      requiredItem: null,
      range: STRUCTURE_USE_RADII["smoking-rack"],
      animationKey: "hand.clear-rack",
      feedbackKey: "affordance.smoking-rack.clear.ready",
      preview: {
        ...commonPreview,
        detail: "加工中断过久，原料已经腐坏；清理后可再次使用。",
        progressSeconds: process.progressSeconds,
      },
      estimatedSeconds: 2,
    });
  }

  const blocker: AffordanceBlocker =
    environment.blocker === "fire-unlit"
      ? "fire-unlit"
      : environment.blocker === "fire-too-far"
        ? "fire-too-far"
        : environment.blocker === "rain-exposed"
          ? "rain-exposed"
          : "process-active";
  const remaining = Math.max(
    0,
    SMOKING_RACK_REQUIRED_PROGRESS_SECONDS - process.progressSeconds,
  );
  return resolved({
    objectId: target.id,
    semanticKind: "smoking-rack",
    state: "blocked",
    actionId: "observe",
    verb: environment.active ? "查看烟熏" : "烟熏暂停",
    blocker,
    requiredItem: null,
    range: STRUCTURE_USE_RADII["smoking-rack"],
    animationKey: "none",
    feedbackKey: `affordance.smoking-rack.${environment.blocker ?? "processing"}`,
    preview: {
      ...commonPreview,
      detail: environment.active
        ? `烟熏 ${Math.round((process.progressSeconds / SMOKING_RACK_REQUIRED_PROGRESS_SECONDS) * 100)}% · ${BIOME_PROFILES[descriptor.biome].label} ×${environment.rateMultiplier.toFixed(2)}。`
        : environment.blocker === "fire-unlit"
          ? "邻近营火已经熄灭，进度暂停。"
          : environment.blocker === "fire-too-far"
            ? "烟熏架必须位于燃烧营火 4.5 米内。"
            : "这座烟熏架未被叶棚覆盖；雨势减弱后恢复，或在叶棚下另建一座。",
      progressSeconds: process.progressSeconds,
    },
    estimatedSeconds: environment.active
      ? remaining / environment.rateMultiplier
      : null,
  });
}

function resolveRainCollector(
  state: GameState,
  target: PlacedStructureState,
): ResolvedAffordance {
  if (!structureOperational(state, target)) {
    return resolveUnbuiltStructure(state, target);
  }
  const capacity = target.capacity ?? RAIN_COLLECTOR_CAPACITY;
  const storedUnits = Math.max(0, Math.min(capacity, target.storedUnits ?? 0));
  const wholeStoredUnits = Math.floor(storedUnits + 1e-9);
  const emptyContainers = getAvailableWaterContainerCount(state);
  const cleanWaterCapacity = remainingCapacity(state, "clean-water");
  const collectable = Math.min(
    wholeStoredUnits,
    emptyContainers,
    cleanWaterCapacity,
  );
  const environment = rainCollectorEnvironmentForStructure(state, target);
  const blocker: AffordanceBlocker | null =
    cleanWaterCapacity <= 0
      ? "inventory-full"
      : emptyContainers <= 0
        ? "missing-container"
        : wholeStoredUnits <= 0
          ? "reservoir-empty"
          : null;
  const siteNote =
    environment.siteBand === "low"
      ? "冠层遮挡明显，换到林隙或河岸会更快"
      : "上方开阔，集水效率良好";
  const weatherNote =
    environment.blocker === "capacity-full"
      ? "容量已满"
      : environment.blocker === "overhead-cover"
        ? "叶棚顶挡住了集水口"
      : environment.blocker === "drought"
        ? "当前无有效降雨"
        : `当前流入 ${(environment.ratePerSecond * 60).toFixed(2)} 份/分钟`;
  let detail = `${storedUnits.toFixed(2)}/${capacity} 份 · 效率 ×${environment.siteMultiplier.toFixed(2)}；${siteNote}；${weatherNote}。`;
  if (blocker === "inventory-full") {
    detail += " 背包中的安全饮水已达上限，架内储水不会被清空。";
  } else if (blocker === "missing-container") {
    detail += " 建架用掉的椰壳属于结构；还需携带额外空椰壳来装水。";
  } else if (blocker === "reservoir-empty") {
    detail += " 储量可以小数累积，集满 1 份后才能收取，余量会保留。";
  } else {
    detail += ` 现在可一次装走 ${collectable} 份，建筑会继续留在原地集水。`;
  }
  return resolved({
    objectId: target.id,
    semanticKind: "rain-collector",
    state: blocker ? "blocked" : "ready",
    actionId: "collect-rain-collector",
    verb: "收取雨水",
    blocker,
    requiredItem: blocker === "missing-container" ? "coconut-shell" : null,
    range: STRUCTURE_USE_RADII["rain-collector"],
    animationKey: "hand.fill-container",
    feedbackKey: blocker
      ? `affordance.rain-collector.blocked.${blocker}`
      : "affordance.rain-collector.collect.ready",
    preview: {
      label: "雨水收集架",
      detail,
      itemId: "clean-water",
      quantity: collectable,
      storedUnits,
      storageCapacity: capacity,
      remainingCapacity: cleanWaterCapacity,
      exposure: environment.exposure,
      siteEfficiencyBand: environment.siteBand,
      biome: environment.biome,
      rateMultiplier: environment.siteMultiplier,
      environmentBlocker: environment.blocker ?? undefined,
      missingItemIds: blocker === "missing-container" ? ["coconut-shell"] : [],
    },
    estimatedSeconds:
      wholeStoredUnits <= 0 && environment.ratePerSecond > 0
        ? Math.max(0, 1 - storedUnits) / environment.ratePerSecond
        : 2,
  });
}

function resolveTorchWaymark(
  state: GameState,
  target: PlacedStructureState,
): ResolvedAffordance {
  if (!structureOperational(state, target)) {
    return resolveUnbuiltStructure(state, target);
  }
  const queue = normalizeTorchWaymarkFuelQueue(
    target.torchFuelQueueSeconds,
  );
  const lit = queue.length > 0 && target.lit === true;
  const operation = classifyTorchWaymarkUseOperation({
    torchFuelQueueSeconds: queue,
    lit,
  });
  const needsTorch =
    operation === "insert-torch-waymark" ||
    operation === "top-up-torch-waymark";
  const needsIgnition =
    operation === "insert-torch-waymark" ||
    operation === "relight-torch-waymark";
  const ignition = resolveCampfireIgnitionAtPoint(state, target.position);
  let blocker: AffordanceBlocker | null = null;
  if (operation === "fuel-slots-full") blocker = "fuel-slots-full";
  else if (needsTorch && state.inventory.torch <= 0) blocker = "missing-torch";
  else if (needsIgnition && !ignition.canIgnite) blocker = "rain-exposed";

  const totalFuelSeconds = torchWaymarkTotalFuelSeconds({
    torchFuelQueueSeconds: queue,
  });
  const fuelSummary = `燃料 ${Math.ceil(totalFuelSeconds)} 秒 · 槽位 ${queue.length}/${TORCH_WAYMARK_MAX_FUEL_SLOTS}`;
  const detail =
    blocker === "fuel-slots-full"
      ? `${fuelSummary}；两支实体火把都已装入，当前不能继续添加。`
      : blocker === "missing-torch"
        ? `${fuelSummary}；背包里需要一支仍有燃料的实体火把。`
        : blocker === "rain-exposed"
          ? `${fuelSummary}；${CAMPFIRE_RAIN_EXPOSED_GUIDANCE}`
          : operation === "insert-torch-waymark"
            ? `${fuelSummary}；插入一支实体火把并立即点亮。`
            : operation === "relight-torch-waymark"
              ? `${fuelSummary}；燃料仍在，不消耗新火把即可重新点亮。`
              : `${fuelSummary}；加入一支备用火把，当前燃尽后按 FIFO 顺序接续。`;
  const actionId =
    operation === "fuel-slots-full"
      ? ("top-up-torch-waymark" as const)
      : operation;
  const verb =
    operation === "insert-torch-waymark"
      ? "插入并点亮火把"
      : operation === "relight-torch-waymark"
        ? "重新点亮"
        : operation === "top-up-torch-waymark"
          ? "补充备用火把"
          : "燃料已满";
  return resolved({
    objectId: target.id,
    semanticKind: "torch-waymark",
    state: blocker ? "blocked" : "ready",
    actionId,
    verb,
    blocker,
    requiredItem: blocker === "missing-torch" ? "torch" : null,
    range: STRUCTURE_USE_RADII["torch-waymark"],
    animationKey: "hand.add-fuel",
    feedbackKey: blocker
      ? `affordance.torch-waymark.blocked.${blocker}`
      : `affordance.torch-waymark.${operation}.ready`,
    preview: {
      label: "火把路标",
      detail,
      fuelSeconds: totalFuelSeconds,
      fuelCapacitySeconds:
        TORCH_MAX_BURN_SECONDS * TORCH_WAYMARK_MAX_FUEL_SLOTS,
      fuelSlots: queue.length,
      fuelSlotCapacity: TORCH_WAYMARK_MAX_FUEL_SLOTS,
      lit,
      sheltered: ignition.sheltered,
      missingItemIds: blocker === "missing-torch" ? ["torch"] : [],
    },
    estimatedSeconds:
      operation === "fuel-slots-full"
        ? null
        : torchWaymarkOperationSeconds(operation),
  });
}

interface MissingCanopyReportPrerequisite {
  id: string;
  label: string;
}

function missingCanopyReportPrerequisites(
  state: GameState,
): MissingCanopyReportPrerequisite[] {
  const facts = state.knowledge?.objectiveFacts ?? [];
  const missing: MissingCanopyReportPrerequisite[] = [];
  if (!hasObjectiveFact(facts, CAMPAIGN_FACTS.canopyRequestHeard)) {
    missing.push({
      id: CAMPAIGN_FACTS.canopyRequestHeard.subjectId,
      label: "林冠零值应急回执",
    });
  }
  const preparationFacts = [
    CAMPAIGN_FACTS.canopyRepairKitPrepared,
    CAMPAIGN_FACTS.canopyProvisioned,
    CAMPAIGN_FACTS.canopyForwardOutpostPrepared,
  ] as const;
  if (!preparationFacts.some((fact) => hasObjectiveFact(facts, fact))) {
    missing.push({
      id: "canopy-expedition.one-valid-plan",
      label: "任一真实远征方案（清障工具、补给或前哨）",
    });
  }
  if (!hasObjectiveFact(facts, CAMPAIGN_FACTS.canopyContradictionObserved)) {
    missing.push({
      id: CAMPAIGN_FACTS.canopyContradictionObserved.subjectId,
      label: "现场有风而面板为零的矛盾记录",
    });
  }
  if (!hasObjectiveFact(facts, CAMPAIGN_FACTS.canopyLinkRestored)) {
    missing.push({
      id: CAMPAIGN_FACTS.canopyLinkRestored.subjectId,
      label: "C-17 链路复位记录",
    });
  }
  if (!hasObjectiveFact(facts, CAMPAIGN_FACTS.canopyLiveSampleObserved)) {
    missing.push({
      id: CAMPAIGN_FACTS.canopyLiveSampleObserved.subjectId,
      label: "亲自查看的有效阵风样本",
    });
  }
  return missing;
}

function resolvePlacedStructure(
  state: GameState,
  target: PlacedStructureState,
): ResolvedAffordance {
  if (target.kind === "campfire") return resolveCampfire(state, target);
  if (target.kind === "smoking-rack") return resolveSmokingRack(state, target);
  if (target.kind === "rain-collector") return resolveRainCollector(state, target);
  if (target.kind === "torch-waymark") return resolveTorchWaymark(state, target);
  if (!structureOperational(state, target)) {
    return resolveUnbuiltStructure(state, target);
  }

  if (target.kind === "bed") {
    return resolved({
      objectId: target.id,
      semanticKind: "bed",
      state: "ready",
      actionId: "rest",
      verb: "休息",
      blocker: null,
      requiredItem: null,
      range: STRUCTURE_USE_RADII.bed,
      animationKey: "player.rest",
      feedbackKey: "affordance.bed.rest.ready",
      preview: {
        label: "棕榈床",
        detail: "休息会推进八个游戏小时；饥渴、天气、火与腐败照常结算。",
      },
      estimatedSeconds: null,
    });
  }

  if (target.kind === "shelter") {
    return resolved({
      objectId: target.id,
      semanticKind: "shelter",
      state: "ambient",
      actionId: "observe",
      verb: "查看遮蔽",
      blocker: null,
      requiredItem: null,
      range: STRUCTURE_USE_RADII.shelter,
      animationKey: "none",
      feedbackKey: "affordance.shelter.coverage",
      preview: {
        label: "叶棚",
        detail: "棚下可减少雨淋，并能保护邻近营火。",
        sheltered: true,
      },
      estimatedSeconds: null,
    });
  }

  const facts = state.knowledge?.objectiveFacts ?? [];
  if (hasObjectiveFact(facts, CAMPAIGN_FACTS.canopyWindSampleReported)) {
    return resolved({
      objectId: target.id,
      semanticKind: "radio-beacon",
      state: "ambient",
      actionId: "observe",
      verb: "监听林冠回执",
      blocker: null,
      requiredItem: null,
      range: STRUCTURE_USE_RADII["radio-beacon"],
      animationKey: "hand.inspect",
      feedbackKey: "affordance.radio-beacon.canopy-report.reported",
      preview: {
        label: "求救信标 · 林冠频道",
        detail: "C-17 有效阵风样本已经发送；应急网络确认零值来自失联链路。",
        missingPrerequisiteIds: [],
      },
      estimatedSeconds: null,
    });
  }

  if (state.objectives.currentTaskId === "canopy-wind") {
    const junction = normalizeCanopyJunctionState(
      state.world.canopyJunction,
      state.clock.tick,
    );
    const sampleStateReady =
      junction.phase === "sample-ready" && junction.sample !== null;

    const missing = missingCanopyReportPrerequisites(state);
    if (!sampleStateReady) {
      missing.push({
        id: "canopy-junction.valid-sample-state",
        label: "C-17 中仍可发送的有效样本状态",
      });
    }
    const reportReady = canopyReportReady(facts) && sampleStateReady;
    return resolved({
      objectId: target.id,
      semanticKind: "radio-beacon",
      state: reportReady ? "ready" : "blocked",
      actionId: "transmit",
      verb: "上报林冠风样本",
      blocker: reportReady ? null : "objective-not-ready",
      requiredItem: null,
      range: STRUCTURE_USE_RADII["radio-beacon"],
      animationKey: "hand.radio-transmit",
      feedbackKey: reportReady
        ? "affordance.radio-beacon.canopy-report.ready"
        : "affordance.radio-beacon.canopy-prerequisites-required",
      preview: {
        label: "求救信标 · 林冠频道",
        detail: reportReady
          ? "应急回执、远征方案、零值矛盾、链路复位和有效样本均已核实，可以发送 C-17 数据。"
          : `上报仍缺少：${missing.map((entry) => entry.label).join("；")}。不能用任务阶段或猜测代替现场事实。`,
        missingPrerequisiteIds: missing.map((entry) => entry.id),
      },
      estimatedSeconds: reportReady ? 18 : null,
    });
  }

  if (state.objectives.currentTaskId === "river-rising") {
    const hasReading = hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverTrendObserved,
    );
    const reportReady = riverReportReady(
      state.knowledge?.objectiveFacts ?? [],
    );
    return resolved({
      objectId: target.id,
      semanticKind: "radio-beacon",
      state: reportReady ? "ready" : "blocked",
      actionId: "transmit",
      verb: "上报水尺读数",
      blocker: reportReady ? null : "objective-not-ready",
      requiredItem: null,
      range: STRUCTURE_USE_RADII["radio-beacon"],
      animationKey: "hand.radio-transmit",
      feedbackKey: reportReady
        ? "affordance.radio-beacon.river-report.ready"
        : hasReading
          ? "affordance.radio-beacon.river-prerequisites-required"
          : "affordance.radio-beacon.river-reading-required",
      preview: {
        label: "求救信标 · 应急频道",
        detail: reportReady
          ? "水尺实测记录已就绪，可以向下游警戒站上报。"
          : hasReading
            ? "已有水尺读数，但应急回执、远征准备或清障记录仍不完整。"
            : "频道正在等待真实水尺读数；不能用猜测代替现场观测。",
      },
      estimatedSeconds: reportReady ? 18 : null,
    });
  }

  if (state.objectives.flags.transmitted) {
    return resolved({
      objectId: target.id,
      semanticKind: "radio-beacon",
      state: "ambient",
      actionId: "observe",
      verb: "监听信号",
      blocker: null,
      requiredItem: null,
      range: STRUCTURE_USE_RADII["radio-beacon"],
      animationKey: "hand.inspect",
      feedbackKey: "affordance.radio-beacon.transmitted",
      preview: {
        label: "求救信标",
        detail: "求救信号已经发出；设备仍在重复播发。",
      },
      estimatedSeconds: null,
    });
  }

  const blocked = state.objectives.currentTaskId !== "transmit-signal";
  return resolved({
    objectId: target.id,
    semanticKind: "radio-beacon",
    state: blocked ? "blocked" : "ready",
    actionId: "transmit",
    verb: "发送求救信号",
    blocker: blocked ? "objective-not-ready" : null,
    requiredItem: null,
    range: STRUCTURE_USE_RADII["radio-beacon"],
    animationKey: "hand.radio-transmit",
    feedbackKey: blocked
      ? "affordance.radio-beacon.objective-not-ready"
      : "affordance.radio-beacon.transmit.ready",
    preview: {
      label: "求救信标",
      detail: blocked
        ? "还没有完成发报前的生存与调查任务。"
        : "信标已经修复，可以发送求救信号。",
    },
    estimatedSeconds: blocked ? null : 18,
  });
}

/**
 * Pure capability projection. It never dispatches a command or mutates state;
 * simulation handlers remain the final authority when an action is executed.
 */
export function resolveAffordance(
  state: GameState,
  target: AffordanceTarget,
): ResolvedAffordance {
  if (isPlacedStructure(target)) {
    return resolvePlacedStructure(state, target);
  }

  const category = semanticCategory(target);
  if (category === "tree" || target.tags.includes("standing-tree")) {
    return resolveSemanticResource(state, target, "tree");
  }
  if (category === "mineable-rock") {
    return resolveSemanticResource(state, target, "mineable-rock");
  }
  if (category === "harvestable-plant") {
    return resolveSemanticResource(state, target, "harvestable-plant");
  }
  if (target.kind === "resource" && target.itemId === "battery") {
    return resolveBattery(state, target);
  }
  if (target.kind === "resource") return resolvePickupResource(state, target);
  if (target.kind === "water") return resolveWater(state, target);
  if (target.kind === "hazard") return resolveHazard(state, target);
  if (target.kind === "landmark" || target.kind === "radio") {
    return resolveLandmark(state, target);
  }

  return resolved({
    objectId: target.id,
    semanticKind: "unknown",
    state: "ambient",
    actionId: "none",
    verb: "观察",
    blocker: "unsupported-object",
    requiredItem: null,
    range: target.interactRadius,
    animationKey: "none",
    feedbackKey: "affordance.object.unsupported",
    preview: {
      label: target.label,
      detail: "这个对象目前没有定义可执行动作。",
    },
    estimatedSeconds: null,
  });
}

/**
 * Projects a living ecology individual into the same interaction language as
 * authored world objects. The simulation still recomputes range and health.
 */
export function resolveWildlifeAffordance(
  state: GameState,
  wildlife: EcologyRenderProjection,
): ResolvedAffordance {
  const spearReady =
    state.inventory.spear > 0 && state.player.equippedItem === "spear";
  const defeated = wildlife.health <= 0;
  if (defeated) {
    const pendingMeat = Math.max(0, wildlife.pendingMeat ?? 0);
    const pendingHide = Math.max(0, wildlife.pendingHide ?? 0);
    const pendingQuantity = pendingMeat + pendingHide;
    if (pendingQuantity > 0) {
      const hasCapacity =
        (pendingMeat > 0 && remainingCapacity(state, "raw-meat") > 0) ||
        (pendingHide > 0 && remainingCapacity(state, "hide") > 0);
      return resolved({
        objectId: `wildlife:${wildlife.individualId}`,
        semanticKind: "wildlife",
        state: hasCapacity ? "ready" : "blocked",
        actionId: "collect-wildlife-loot",
        verb: "收取猎物",
        blocker: hasCapacity ? null : "inventory-full",
        requiredItem: null,
        range: 3.2,
        animationKey: "hand.pickup",
        feedbackKey: hasCapacity
          ? "affordance.wildlife.loot.ready"
          : "affordance.wildlife.loot.inventory-full",
        preview: {
          label: wildlife.label,
          detail: hasCapacity
            ? `尸体仍留有${pendingMeat > 0 ? `生肉 ×${pendingMeat}` : ""}${pendingMeat > 0 && pendingHide > 0 ? "、" : ""}${pendingHide > 0 ? `兽皮 ×${pendingHide}` : ""}；腾出的背包空间不会让掉落消失。`
            : "背包已满；猎物会留在原地，腾出空间后再回来收取。",
          quantity: pendingQuantity,
          itemId: pendingMeat > 0 ? "raw-meat" : "hide",
          health: 0,
          maxHealth: wildlife.maxHealth,
          behavior: wildlife.behavior,
        },
        estimatedSeconds: null,
      });
    }
    return resolved({
      objectId: `wildlife:${wildlife.individualId}`,
      semanticKind: "wildlife",
      state: "depleted",
      actionId: "none",
      verb: "已倒下",
      blocker: "resource-depleted",
      requiredItem: null,
      range: 3.2,
      animationKey: "none",
      feedbackKey: "affordance.wildlife.defeated",
      preview: {
        label: wildlife.label,
        detail: "这只动物已经倒下，生态种群需要一段时间才会恢复。",
        health: 0,
        maxHealth: wildlife.maxHealth,
        behavior: wildlife.behavior,
      },
      estimatedSeconds: null,
    });
  }

  const dangerous = wildlife.encounter.kind === "danger";
  const fireAvoidDetail =
    wildlife.behavior === "fire-avoid"
      ? "营火正在迫使它后退，但威慑会在火圈边缘快速衰减；那里仍可能完成扑击，不要把火当成绝对屏障。"
      : null;
  return resolved({
    objectId: `wildlife:${wildlife.individualId}`,
    semanticKind: "wildlife",
    state: spearReady
      ? dangerous
        ? "danger"
        : "ready"
      : dangerous
        ? "danger"
        : "blocked",
    actionId: spearReady ? "attack" : dangerous ? "avoid" : "attack",
    verb: spearReady
      ? "持矛刺击"
      : wildlife.behavior === "fire-avoid"
        ? "火光逼退"
        : dangerous
          ? "保持距离"
          : "需要猎具",
    blocker: spearReady || dangerous ? null : "missing-required-tool",
    requiredItem: spearReady || !dangerous ? "spear" : null,
    range: 3.2,
    animationKey: "weapon.spear.thrust",
    feedbackKey:
      wildlife.behavior === "fire-avoid"
        ? "affordance.wildlife.fire-avoid"
        : spearReady
          ? `affordance.wildlife.attack.${wildlife.speciesId}`
          : "affordance.wildlife.spear-required",
    preview: {
      label: wildlife.label,
      detail:
        fireAvoidDetail ??
        (spearReady
          ? dangerous
            ? "捕食者已注意到你；刺击后立即重新拉开距离。"
            : wildlife.behavior === "flee"
              ? "猎物正在逃离；进入矛距后才能命中。"
              : "进入矛距后可主动狩猎，攻击会消耗体力与武器耐久。"
          : dangerous
            ? "它具有攻击性。没有装备石矛时不要进入扑击范围。"
            : "需要先制作并装备石矛，空手点击不会自动捕获猎物。"),
      health: wildlife.health,
      maxHealth: wildlife.maxHealth,
      behavior: wildlife.behavior,
      alternatives: [
        {
          actionId: "attack",
          verb: "持矛刺击",
          available: spearReady,
          requiredItem: "spear",
          feedbackKey: "affordance.wildlife.attack",
        },
        {
          actionId: "avoid",
          verb: "保持距离",
          available: true,
          requiredItem: null,
          feedbackKey: "affordance.wildlife.avoid",
        },
      ],
    },
    estimatedSeconds: spearReady ? 2 : null,
  });
}
