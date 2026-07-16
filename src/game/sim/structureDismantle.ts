import { ITEMS } from "./content";
import type {
  GameState,
  ItemId,
  PlacedStructureKind,
  PlacedStructureState,
} from "./types";

export const STRUCTURE_DISMANTLE_RULES = {
  "smoking-rack": {
    workSeconds: 16,
    refund: { stick: 2, vine: 1 },
  },
  "rain-collector": {
    workSeconds: 23,
    refund: {
      stick: 3,
      vine: 2,
      "broad-leaf": 3,
      "coconut-shell": 1,
    },
  },
} as const satisfies Partial<
  Record<
    PlacedStructureKind,
    {
      workSeconds: number;
      refund: Partial<Record<ItemId, number>>;
    }
  >
>;

export type DismantleableStructureKind = keyof typeof STRUCTURE_DISMANTLE_RULES;
export type StructureDismantleBlocker =
  | "missing"
  | "legacy-fallback"
  | "unsupported"
  | "out-of-range"
  | "rack-processing"
  | "rack-ready"
  | "rack-spoiled"
  | "collector-not-empty"
  | "inventory-full";

export type StructureDismantlePlan = {
  ok: boolean;
  structureId: string;
  kind?: PlacedStructureKind;
  label: string;
  refund: Partial<Record<ItemId, number>>;
  workSeconds: number;
  blocker?: StructureDismantleBlocker;
  message: string;
};

const STRUCTURE_LABELS: Readonly<Record<PlacedStructureKind, string>> = {
  campfire: "营火",
  shelter: "挡雨叶棚",
  bed: "棕榈床",
  "radio-beacon": "求救信标",
  "smoking-rack": "烟熏架",
  "rain-collector": "雨水收集架",
  "torch-waymark": "火把路标",
};

export function isDismantleableStructureKind(
  kind: PlacedStructureKind | string,
): kind is DismantleableStructureKind {
  return Object.prototype.hasOwnProperty.call(STRUCTURE_DISMANTLE_RULES, kind);
}

export function structureDismantleLabel(kind: PlacedStructureKind): string {
  return STRUCTURE_LABELS[kind];
}

export function formatStructureRefund(
  refund: Partial<Record<ItemId, number>>,
): string {
  return Object.entries(refund)
    .filter((entry): entry is [ItemId, number] => (entry[1] ?? 0) > 0)
    .map(([itemId, amount]) => `${ITEMS[itemId].label}×${amount}`)
    .join("、");
}

function blockedPlan(
  structureId: string,
  blocker: StructureDismantleBlocker,
  message: string,
  structure?: PlacedStructureState,
): StructureDismantlePlan {
  return {
    ok: false,
    structureId,
    ...(structure ? { kind: structure.kind } : {}),
    label: structure ? STRUCTURE_LABELS[structure.kind] : "建筑",
    refund: {},
    workSeconds: 0,
    blocker,
    message,
  };
}

/**
 * Pure preflight shared by UI and simulation. Only concrete persisted instances
 * can be dismantled; legacy facades, previews and story-critical structures
 * remain outside this first migration-safe slice.
 */
export function getStructureDismantlePlan(
  state: GameState,
  structureId: string,
): StructureDismantlePlan {
  if (structureId.endsWith(".legacy-fallback")) {
    return blockedPlan(
      structureId,
      "legacy-fallback",
      "这座旧式营地设施尚未迁移为独立实例，暂时不能拆除。",
    );
  }

  const structure = state.camp.structures?.find(
    (candidate) => candidate.id === structureId,
  );
  if (!structure) {
    return blockedPlan(
      structureId,
      "missing",
      "没有找到这座可管理的建筑。",
    );
  }
  if (!isDismantleableStructureKind(structure.kind)) {
    return blockedPlan(
      structureId,
      "unsupported",
      "这类设施关联火源、休息或任务状态，本轮暂不允许拆除。",
      structure,
    );
  }

  const range = 3.2;
  const distance = Math.hypot(
    state.player.position.x - structure.position.x,
    state.player.position.z - structure.position.z,
  );
  if (distance > range) {
    return blockedPlan(
      structureId,
      "out-of-range",
      `需要靠近${STRUCTURE_LABELS[structure.kind]}后才能拆除。`,
      structure,
    );
  }

  if (structure.kind === "smoking-rack" && structure.process) {
    const status = structure.process.status;
    const copy =
      status === "processing"
        ? "肉仍在加工；等待完成后先收取，或等待腐坏后清理。"
        : status === "ready"
          ? "架上还有烟熏肉；请先收取成品。"
          : "架上有腐坏物；请先互动清理。";
    return blockedPlan(
      structureId,
      status === "processing"
        ? "rack-processing"
        : status === "ready"
          ? "rack-ready"
          : "rack-spoiled",
      copy,
      structure,
    );
  }

  if (
    structure.kind === "rain-collector" &&
    Math.max(0, structure.storedUnits ?? 0) > 1e-9
  ) {
    return blockedPlan(
      structureId,
      "collector-not-empty",
      `收集架里还有 ${Math.max(0, structure.storedUnits ?? 0).toFixed(2)} 份雨水；不足一份的余量会保留，请等它集满后一次收完，并在无雨时拆除。`,
      structure,
    );
  }

  const rule = STRUCTURE_DISMANTLE_RULES[structure.kind];
  const refundEntries = Object.entries(rule.refund) as Array<[ItemId, number]>;
  const lackingCapacity = refundEntries.find(
    ([itemId, amount]) => {
      return state.inventory[itemId] + amount > ITEMS[itemId].stackLimit;
    },
  );
  if (lackingCapacity) {
    const [itemId, amount] = lackingCapacity;
    return blockedPlan(
      structureId,
      "inventory-full",
      `背包装不下返还的${ITEMS[itemId].label}×${amount}；请先腾出空间。`,
      structure,
    );
  }

  const refund = { ...rule.refund };
  return {
    ok: true,
    structureId,
    kind: structure.kind,
    label: STRUCTURE_LABELS[structure.kind],
    refund,
    workSeconds: rule.workSeconds,
    message: `返还 ${formatStructureRefund(refund)}。`,
  };
}
