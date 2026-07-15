import {
  hasObjectiveFact,
  objectiveFactTick,
  taskRequirementsSatisfied,
  type ObjectiveFactClause,
  type ObjectiveFactRecord,
  type ObjectiveFactReference,
} from "./objectiveFacts";
import type { TaskDefinition } from "./types";
import { riverCenter } from "../world/terrain";
import type { CanopyJunctionPhase } from "./canopyJunction";

export const RIVER_GAUGE_ID = "landmark.river-gauge";
export const RIVER_GAUGE_OBSTRUCTION_ID =
  "resource.tree.river-gauge-obstruction";
export const RIVER_GAUGE_POSITION = {
  x: 180,
  y: 0,
  // The staff itself stands in the flowing channel. Its interaction radius
  // still reaches the bank, so the player reads a physical waterline instead
  // of a dry prop beside the river.
  z: riverCenter(180),
} as const;

export const CAMPAIGN_FACTS = {
  distressReported: {
    verb: "reported",
    subjectId: "radio.distress-signal",
  },
  riverRequestHeard: {
    verb: "heard",
    subjectId: "radio.emergency-river-request",
  },
  riverLightKitPrepared: {
    verb: "prepared",
    subjectId: "river-expedition.light-kit",
  },
  riverDefenseKitPrepared: {
    verb: "prepared",
    subjectId: "river-expedition.defense-kit",
  },
  riverFieldKitPrepared: {
    verb: "prepared",
    subjectId: "river-expedition.field-kit",
  },
  riverGaugeCleared: {
    verb: "changedWorld",
    subjectId: "river-gauge.access-cleared",
  },
  riverTrendObserved: {
    verb: "observed",
    subjectId: "river-gauge.level-trend",
  },
  riverTrendReported: {
    verb: "reported",
    subjectId: "river-gauge.level-trend",
  },
  canopyRequestHeard: {
    verb: "heard",
    subjectId: "radio.emergency-canopy-zero",
  },
  canopyRepairKitPrepared: {
    verb: "prepared",
    subjectId: "canopy-expedition.repair-kit",
  },
  canopyProvisioned: {
    verb: "prepared",
    subjectId: "canopy-expedition.provisioned",
  },
  canopyForwardOutpostPrepared: {
    verb: "prepared",
    subjectId: "canopy-expedition.forward-outpost",
  },
  canopyContradictionObserved: {
    verb: "observed",
    subjectId: "canopy.wind-present-feed-zero",
  },
  canopyLinkRestored: {
    verb: "changedWorld",
    subjectId: "canopy-junction.link-restored",
  },
  canopyLiveSampleObserved: {
    verb: "observed",
    subjectId: "canopy-junction.live-sample",
  },
  canopyWindSampleReported: {
    verb: "reported",
    subjectId: "canopy.wind-sample",
  },
} as const satisfies Readonly<Record<string, ObjectiveFactReference>>;

const riverPreparationClause: ObjectiveFactClause = {
  anyOf: [
    CAMPAIGN_FACTS.riverLightKitPrepared,
    CAMPAIGN_FACTS.riverDefenseKitPrepared,
    CAMPAIGN_FACTS.riverFieldKitPrepared,
  ],
};

/** Facts that must already be true before the radio may accept an A1 report. */
export const RIVER_REPORT_PREREQUISITES = [
  { anyOf: [CAMPAIGN_FACTS.riverRequestHeard] },
  riverPreparationClause,
  { anyOf: [CAMPAIGN_FACTS.riverGaugeCleared] },
  { anyOf: [CAMPAIGN_FACTS.riverTrendObserved] },
] as const satisfies readonly ObjectiveFactClause[];

export const RIVER_RISING_TASK: TaskDefinition = {
  id: "river-rising",
  actId: "a1-river-rising",
  label: "河流正在上升",
  description:
    "应急频道要求读取下游旧水尺。选择一套远征准备，清开遮挡，记录真实水位趋势并回到电台上报。",
  completion: [
    ...RIVER_REPORT_PREREQUISITES,
    { anyOf: [CAMPAIGN_FACTS.riverTrendReported] },
  ],
  guidance: [
    {
      id: "receive-river-request",
      title: "等待应急回执",
      instruction: "保持电台供电；应急网络会通过同一频道返回下游任务。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.riverRequestHeard] }],
    },
    {
      id: "prepare-river-expedition",
      title: "选择远征准备",
      instruction: "照明、防卫或野外保障三套方案任选其一，不提交、不没收物资。",
      requirements: [riverPreparationClause],
    },
    {
      id: "clear-river-gauge",
      title: "清开水尺入口",
      instruction: "沿河向东寻找橙色测绘帽；用斧头处理遮挡下部刻度的倒木。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.riverGaugeCleared] }],
    },
    {
      id: "observe-river-trend",
      title: "读取水位趋势",
      instruction: "重新调查水尺，记录水位、安全线差值和上涨或回落趋势。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.riverTrendObserved] }],
    },
    {
      id: "report-river-trend",
      title: "返回电台上报",
      instruction: "回到已修复的求救信标，通过应急频道上报水尺数据。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.riverTrendReported] }],
    },
  ],
  supportRecipeIds: ["torch", "spear", "bandage", "torch-waymark"],
  milestoneId: "a1-river-rising-complete",
};

export const CANOPY_PREPARATION_CLAUSE: ObjectiveFactClause = {
  anyOf: [
    CAMPAIGN_FACTS.canopyRepairKitPrepared,
    CAMPAIGN_FACTS.canopyProvisioned,
    CAMPAIGN_FACTS.canopyForwardOutpostPrepared,
  ],
};

/** Facts that must exist before a C-17 sample may be accepted by the beacon. */
export const CANOPY_REPORT_PREREQUISITES = [
  { anyOf: [CAMPAIGN_FACTS.canopyRequestHeard] },
  CANOPY_PREPARATION_CLAUSE,
  { anyOf: [CAMPAIGN_FACTS.canopyContradictionObserved] },
  { anyOf: [CAMPAIGN_FACTS.canopyLinkRestored] },
  { anyOf: [CAMPAIGN_FACTS.canopyLiveSampleObserved] },
] as const satisfies readonly ObjectiveFactClause[];

export const CANOPY_WIND_TASK: TaskDefinition = {
  id: "canopy-wind",
  actId: "a2-canopy-wind",
  label: "林冠没有风",
  description:
    "应急网络的林冠通道持续报告零值。比较真实风与记录，找到 C-17 接线盒，恢复链路并上报一次有效阵风样本。",
  completion: [
    ...CANOPY_REPORT_PREREQUISITES,
    { anyOf: [CAMPAIGN_FACTS.canopyWindSampleReported] },
  ],
  guidance: [
    {
      id: "receive-canopy-request",
      title: "核对矛盾回执",
      instruction:
        "保持求救信标供电；应急网络会解释为何林冠零值与推进中的雨带矛盾。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.canopyRequestHeard] }],
    },
    {
      id: "prepare-canopy-expedition",
      title: "选择远征方案",
      instruction:
        "携带清障工具、准备补给，或沿路线建立叶棚前哨，三种方案任选其一。",
      requirements: [CANOPY_PREPARATION_CLAUSE],
    },
    {
      id: "compare-canopy-wind",
      title: "证明零值不是真实天气",
      instruction:
        "向东北密林寻找橙色 C-17 标记；比较受风叶片、雨线与面板的 0.0 读数。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.canopyContradictionObserved] }],
    },
    {
      id: "restore-canopy-link",
      title: "恢复传感链路",
      instruction:
        "按普通树木与藤本规则清开箱门，再安全复位并锁紧防水接头。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.canopyLinkRestored] }],
    },
    {
      id: "read-canopy-sample",
      title: "查看真实阵风样本",
      instruction:
        "等待设备取得稳定阵风窗，查看方向、强度与信号质量。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.canopyLiveSampleObserved] }],
    },
    {
      id: "report-canopy-sample",
      title: "通过信标上报",
      instruction: "在已供电的求救信标上发送 C-17 的有效样本。",
      requirements: [{ anyOf: [CAMPAIGN_FACTS.canopyWindSampleReported] }],
    },
  ],
  supportRecipeIds: [
    "axe",
    "stone-blade",
    "bandage",
    "torch",
    "shelter",
    "rain-collector",
    "smoking-rack",
  ],
  milestoneId: "a2-canopy-wind-complete",
};

export interface RadioResponseDefinition {
  id: string;
  trigger: ObjectiveFactReference;
  delayTicks: number;
  produces: ObjectiveFactReference;
}

/** Two game minutes at the current 48-minute real-time day and 30 Hz. */
export const EMERGENCY_RIVER_RESPONSE: RadioResponseDefinition = {
  id: "emergency-river-request",
  trigger: CAMPAIGN_FACTS.distressReported,
  delayTicks: 120,
  produces: CAMPAIGN_FACTS.riverRequestHeard,
};

/** Five game minutes after A1's report; handled by a later simulation slice. */
export const EMERGENCY_CANOPY_RESPONSE: RadioResponseDefinition = {
  id: "emergency-canopy-zero",
  trigger: CAMPAIGN_FACTS.riverTrendReported,
  delayTicks: 300,
  produces: CAMPAIGN_FACTS.canopyRequestHeard,
};

export const CANOPY_RADIO_MESSAGES = {
  undiscovered:
    "河谷水位包已收到。林冠通道仍报告静风，但上行雨带不可能在绝对静风中推进。请核验 C-17；不要把零值当成天气。",
  discovered:
    "你找到的 C-17 正是失联林冠通道。请比较现场受风迹象与面板零值，并恢复传感链路。",
  restored:
    "C-17 链路已经恢复。等待一次稳定阵风样本，确认方向、强度与信号质量。",
  reported:
    "C-17 主动样本已收到；零值来自失联通道，不是静风天气。",
} as const;

export function canopyRadioMessageForPhase(
  phase: CanopyJunctionPhase | null | undefined,
): string {
  if (phase === "reported") return CANOPY_RADIO_MESSAGES.reported;
  if (
    phase === "link-restored" ||
    phase === "sampling" ||
    phase === "sample-ready"
  ) {
    return CANOPY_RADIO_MESSAGES.restored;
  }
  if (phase && phase !== "obstructed") return CANOPY_RADIO_MESSAGES.discovered;
  return CANOPY_RADIO_MESSAGES.undiscovered;
}

export function radioResponseDue(
  facts: readonly ObjectiveFactRecord[],
  currentTick: number,
  response: RadioResponseDefinition = EMERGENCY_RIVER_RESPONSE,
): boolean {
  if (hasObjectiveFact(facts, response.produces)) return false;
  const triggerTick = objectiveFactTick(facts, response.trigger);
  return triggerTick !== null &&
    Number.isSafeInteger(currentTick) &&
    currentTick >= triggerTick + response.delayTicks;
}

export type CampaignInventory = Readonly<Record<string, number | undefined>>;

function has(inventory: CampaignInventory, itemId: string, count = 1): boolean {
  const quantity = inventory[itemId];
  return typeof quantity === "number" && Number.isFinite(quantity) && quantity >= count;
}

/** Returns all valid alternatives; callers record them only on real camp departure. */
export function preparedRiverExpeditionFacts(
  inventory: CampaignInventory,
): ObjectiveFactReference[] {
  const prepared: ObjectiveFactReference[] = [];
  if (has(inventory, "torch") && has(inventory, "clean-water")) {
    prepared.push(CAMPAIGN_FACTS.riverLightKitPrepared);
  }
  if (has(inventory, "spear") && has(inventory, "bandage")) {
    prepared.push(CAMPAIGN_FACTS.riverDefenseKitPrepared);
  }
  if (
    has(inventory, "clean-water") &&
    has(inventory, "bandage") &&
    has(inventory, "stick", 4) &&
    has(inventory, "stone", 3) &&
    has(inventory, "vine") &&
    has(inventory, "torch")
  ) {
    prepared.push(CAMPAIGN_FACTS.riverFieldKitPrepared);
  }
  return prepared;
}

/**
 * Inventory-qualified A2 alternatives. Callers still record a fact only after
 * the corresponding real departure/repair route is used; this helper never
 * consumes or mutates inventory and a forward outpost is evaluated spatially.
 */
export function preparedCanopyExpeditionFacts(
  inventory: CampaignInventory,
): ObjectiveFactReference[] {
  const prepared: ObjectiveFactReference[] = [];
  if (
    has(inventory, "axe") ||
    (has(inventory, "stone-blade") &&
      has(inventory, "stick", 4) &&
      has(inventory, "vine", 2))
  ) {
    prepared.push(CAMPAIGN_FACTS.canopyRepairKitPrepared);
  }
  if (
    has(inventory, "torch") &&
    has(inventory, "clean-water", 2) &&
    (has(inventory, "smoked-meat") ||
      has(inventory, "cooked-meat") ||
      has(inventory, "palm-fruit", 2))
  ) {
    prepared.push(CAMPAIGN_FACTS.canopyProvisioned);
  }
  return prepared;
}

export function campaignTaskSatisfied(
  facts: readonly ObjectiveFactRecord[],
  task: TaskDefinition,
): boolean {
  return taskRequirementsSatisfied(facts, task.completion ?? []);
}

/** Shared authority for both radio affordance and command settlement. */
export function riverReportReady(
  facts: readonly ObjectiveFactRecord[],
): boolean {
  return taskRequirementsSatisfied(facts, RIVER_REPORT_PREREQUISITES);
}

/** Shared pure authority for a later A2 beacon command integration. */
export function canopyReportReady(
  facts: readonly ObjectiveFactRecord[],
): boolean {
  return taskRequirementsSatisfied(facts, CANOPY_REPORT_PREREQUISITES);
}
