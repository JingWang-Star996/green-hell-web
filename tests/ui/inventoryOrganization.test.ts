import assert from "node:assert/strict";
import test from "node:test";

import {
  createInventoryFilterOptions,
  groupInventoryItems,
  isUrgentInventoryItem,
} from "../../src/game/ui/inventoryOrganization";
import type { InventoryItemView } from "../../src/game/ui/types";

function item(
  id: string,
  category: InventoryItemView["category"],
  overrides: Partial<InventoryItemView> = {},
): InventoryItemView {
  return {
    id,
    label: id,
    count: 1,
    description: id,
    category,
    ...overrides,
  };
}

test("野外背包按玩家意图分区，并隐藏空分区", () => {
  const sections = groupInventoryItems([
    item("stone", "material"),
    item("clean-water", "water", { action: "drink" }),
    item("empty-tool", "tool", { count: 0 }),
    item("battery", "mission"),
  ]);

  assert.deepEqual(sections.map((section) => section.id), ["sustenance", "materials", "mission"]);
  assert.deepEqual(sections[0].items.map(({ id }) => id), ["clean-water"]);
});

test("分类筛选中合并食物与水，且不为空类别制造噪声", () => {
  const options = createInventoryFilterOptions([
    item("fruit", "food", { action: "eat" }),
    item("water", "water", { action: "drink" }),
    item("axe", "tool"),
    item("bandage", "medicine", { count: 0, action: "use" }),
  ]);

  assert.deepEqual(options.map(({ id, count }) => [id, count]), [
    ["all", 3],
    ["urgent", 2],
    ["tools", 1],
    ["sustenance", 2],
  ]);
  assert.deepEqual(
    groupInventoryItems([
      item("fruit", "food", { action: "eat" }),
      item("water", "water", { action: "drink" }),
      item("axe", "tool"),
    ], "sustenance")[0].items.map(({ id }) => id),
    ["water", "fruit"],
  );
});

test("紧急筛选优先显示危险、临期和可立即使用的生存物资", () => {
  const source = [
    item("stable-food", "food", { action: "eat", statusTone: "stable" }),
    item("warning-food", "food", { action: "eat", statusTone: "warning" }),
    item("danger-food", "food", { action: "eat", statusTone: "danger" }),
    item("bandage", "medicine", { action: "use" }),
    item("stick", "material"),
  ];
  const originalOrder = source.map(({ id }) => id);
  const urgent = groupInventoryItems(source, "urgent").flatMap((section) => section.items);

  assert.equal(isUrgentInventoryItem(source[4]), false);
  assert.deepEqual(urgent.map(({ id }) => id), ["danger-food", "warning-food", "stable-food", "bandage"]);
  assert.deepEqual(source.map(({ id }) => id), originalOrder, "grouping must not mutate the view model array");
});
