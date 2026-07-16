import type { InventoryItemView } from "./types";

export type InventorySectionId = "tools" | "sustenance" | "medicine" | "materials" | "mission";
export type InventoryFilterId = "all" | "urgent" | InventorySectionId;

export type InventorySection = {
  id: InventorySectionId;
  items: InventoryItemView[];
};

export type InventoryFilterOption = {
  id: InventoryFilterId;
  label: string;
  count: number;
};

export const INVENTORY_SECTION_LABELS: Record<InventorySectionId, {
  title: string;
  description: string;
}> = {
  tools: {
    title: "工具与装备",
    description: "手持工具、武器和野外容器。",
  },
  sustenance: {
    title: "食物与水",
    description: "补给品按临期与风险优先显示。",
  },
  medicine: {
    title: "医疗",
    description: "处理伤口、感染与寄生虫的物资。",
  },
  materials: {
    title: "材料",
    description: "制作、燃料与建造所需的野外资源。",
  },
  mission: {
    title: "任务物品",
    description: "与远征线索和关键进度直接相关。",
  },
};

const SECTION_ORDER: readonly InventorySectionId[] = [
  "tools",
  "sustenance",
  "medicine",
  "materials",
  "mission",
];

const SECTION_BY_CATEGORY: Record<InventoryItemView["category"], InventorySectionId> = {
  tool: "tools",
  food: "sustenance",
  water: "sustenance",
  medicine: "medicine",
  material: "materials",
  mission: "mission",
};

export function inventorySectionForItem(item: InventoryItemView): InventorySectionId {
  return SECTION_BY_CATEGORY[item.category];
}

/**
 * "紧急相关"不猜测当前生命值：面板没有这项语义。
 * 它只依据物品自身可见的临期/风险信息，以及能立即处理生存需求的动作。
 */
export function isUrgentInventoryItem(item: InventoryItemView): boolean {
  return urgencyRank(item) < 5;
}

export function groupInventoryItems(
  items: readonly InventoryItemView[],
  filter: InventoryFilterId = "all",
): InventorySection[] {
  const carried = items.filter((item) => item.count > 0);
  const eligible = carried.filter((item) => {
    if (filter === "all") return true;
    if (filter === "urgent") return isUrgentInventoryItem(item);
    return inventorySectionForItem(item) === filter;
  });

  return SECTION_ORDER
    .map((id) => ({
      id,
      items: eligible
        .filter((item) => inventorySectionForItem(item) === id)
        .sort(compareInventoryItems),
    }))
    .filter((section) => section.items.length > 0);
}

export function createInventoryFilterOptions(
  items: readonly InventoryItemView[],
): InventoryFilterOption[] {
  const carried = items.filter((item) => item.count > 0);
  const options: InventoryFilterOption[] = [{ id: "all", label: "全部", count: carried.length }];
  const urgentCount = carried.filter(isUrgentInventoryItem).length;
  if (urgentCount > 0) options.push({ id: "urgent", label: "紧急相关", count: urgentCount });

  for (const id of SECTION_ORDER) {
    const count = carried.filter((item) => inventorySectionForItem(item) === id).length;
    if (count > 0) options.push({ id, label: INVENTORY_SECTION_LABELS[id].title, count });
  }
  return options;
}

function compareInventoryItems(left: InventoryItemView, right: InventoryItemView): number {
  return urgencyRank(left) - urgencyRank(right)
    || left.label.localeCompare(right.label, "zh-CN")
    || left.id.localeCompare(right.id);
}

function urgencyRank(item: InventoryItemView): number {
  if (item.statusTone === "danger") return 0;
  if (item.statusTone === "warning") return 1;
  if (item.category === "medicine" && item.action === "use") return 2;
  if (item.category === "water" && item.action === "drink") return 3;
  if (item.category === "food" && item.action === "eat") return 4;
  return 5;
}
