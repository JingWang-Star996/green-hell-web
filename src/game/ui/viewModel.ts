import { ITEMS, RECIPES, TASKS, TASK_SEQUENCE } from "../sim/content";
import { canCraft, getDiscoveredRecipeIds, getSurvivalScore, hasInspectedLandmark, isAtCamp } from "../sim/selectors";
import type { GameEvent, GameState, ItemId, RecipeId } from "../sim/types";
import type { RenderEntity, RenderEntityKind, RenderSnapshot } from "../render/types";
import type {
  BodyView,
  EventView,
  InventoryItemView,
  MapLandmark,
  MeterView,
  ObjectiveView,
  RecipeView,
  WatchView,
} from "./types";

const ITEM_DESCRIPTIONS: Record<ItemId, string> = {
  stone: "断面坚硬，互相敲击也许能得到更锋利的边缘。",
  stick: "干燥、笔直，既能做燃料，也适合成为支架。",
  vine: "拉扯后不易断，像一束天然绳索。",
  "broad-leaf": "叶面宽阔，雨水会沿着表面迅速滑落。",
  "medicinal-leaf": "揉碎后渗出黏性树液，气味清苦。",
  "dry-leaf": "即使暴雨前也能点着的宝贵引火物。",
  coconut: "内部仍有液体；坚硬外壳需要切割工具才能处理。",
  "coconut-shell": "可收集溪水和雨水。",
  "dirty-water": "直接饮用可能带来寄生虫。",
  "clean-water": "已经煮沸，可安全恢复水分。",
  "stone-blade": "基础切割工具，也是多个配方的前置。",
  axe: "采集木棍、藤条和棕榈叶时能一次处理更多材料。",
  bandage: "可处理左臂开放伤口。",
  spear: "让远征更有底气的简易防身工具。",
  battery: "气象站的备用电池，求救信标缺少的部件。",
  "antiparasitic-herb": "苦味强烈，可清除一层水源寄生虫。",
  "palm-fruit": "富含碳水并补充少量水分。",
  "brazil-nuts": "高脂肪、少量蛋白，适合长途准备。",
  grubs: "能补充蛋白质，但生吃令人不安。",
};

const RECIPE_DESCRIPTIONS: Record<RecipeId, string> = {
  "stone-blade": "两块石头互相敲击，得到锋利切面。",
  axe: "石头、木柄和藤条构成的基础采集工具。",
  bandage: "药草纤维与藤条可以先止住开放伤口。",
  "coconut-shell": "用石刃剖开椰子，得到两个盛水容器。",
  campfire: "提供净水、热量与理智；露天会被暴雨熄灭。",
  shelter: "让营火和身体避开持续降雨。",
  bed: "离开湿地睡眠，避免额外的身体风险。",
  spear: "轻量防身工具，危险靠近前仍应优先绕行。",
  "radio-beacon": "把气象站电池装入坠落点的求救机。",
};

const CATEGORY_BY_ITEM: Record<ItemId, InventoryItemView["category"]> = {
  stone: "material", stick: "material", vine: "material", "broad-leaf": "material", "medicinal-leaf": "medicine", "dry-leaf": "material",
  coconut: "food", "coconut-shell": "tool", "dirty-water": "water", "clean-water": "water", "stone-blade": "tool", axe: "tool", bandage: "medicine", spear: "tool", battery: "mission", "antiparasitic-herb": "medicine", "palm-fruit": "food", "brazil-nuts": "food", grubs: "food",
};

export type GameViewModel = {
  render: RenderSnapshot;
  watch: WatchView;
  hudMeters: MeterView[];
  objectives: ObjectiveView[];
  currentObjective: ObjectiveView | null;
  inventory: InventoryItemView[];
  recipes: RecipeView[];
  body: BodyView;
  events: EventView[];
  landmarks: MapLandmark[];
  score: number;
};

export function createGameViewModel(state: GameState, retainedRecipes: readonly RecipeId[] = []): GameViewModel {
  const nutritionMeters: MeterView[] = [
    meter("hydration", "水分", "H₂O", state.player.nutrition.hydration, "water"),
    meter("carbohydrates", "碳水化合物", "CARB", state.player.nutrition.carbohydrates, "carbs"),
    meter("fat", "脂肪", "FAT", state.player.nutrition.fat, "fat"),
    meter("protein", "蛋白质", "PRO", state.player.nutrition.protein, "protein"),
  ];
  const hudMeters: MeterView[] = [
    meter("health", "生命", "HP", state.player.vitals.health, "health"),
    meter("stamina", "体力", "STA", state.player.vitals.stamina, "stamina"),
    meter("energy", "能量", "NRG", state.player.vitals.energy, "energy"),
    meter("sanity", "理智", "SAN", state.player.vitals.sanity, "sanity"),
  ];
  const objectives = TASK_SEQUENCE.map((id, index) => {
    const completed = state.objectives.completedTaskIds.includes(id);
    const current = state.objectives.currentTaskId === id;
    return {
      id,
      label: completed || current ? TASKS[id].label : `未确认线索 ${String(index + 1).padStart(2, "0")}`,
      description: completed || current ? objectiveDescription(state, id) : "先解决当前生存问题，新的线索才会写入笔记。",
      completed,
      current,
    };
  });
  return {
    render: toRenderSnapshot(state),
    watch: {
      day: state.clock.day,
      time: formatClock(state.clock.minuteOfDay),
      coordinates: formatCoordinates(state.player.position.x, state.player.position.z),
      weather: state.weather.storm ? "强暴雨" : state.weather.rainIntensity > 0.55 ? "降雨" : state.weather.rainIntensity > 0.15 ? "阵雨" : "闷热",
      rain: state.weather.rainIntensity,
      meters: nutritionMeters,
    },
    hudMeters,
    objectives,
    currentObjective: objectives.find((objective) => objective.current) ?? null,
    inventory: createInventoryViews(state),
    recipes: createRecipeViews(state, retainedRecipes),
    body: {
      woundOpen: state.player.conditions.wound.open,
      woundTreated: state.player.conditions.wound.treated,
      infection: state.player.conditions.wound.infection,
      parasites: state.player.conditions.parasites,
      wetness: state.player.conditions.wetness,
      dirty: state.player.conditions.wetness > 85,
      bandages: state.inventory.bandage,
      antiparasiticHerbs: state.inventory["antiparasitic-herb"],
    },
    events: state.eventLog.slice(-30).reverse().map(toEventView),
    landmarks: createLandmarkViews(state),
    score: getSurvivalScore(state),
  };
}

function toRenderSnapshot(state: GameState): RenderSnapshot {
  return {
    day: state.clock.day,
    minuteOfDay: state.clock.minuteOfDay,
    rain: state.weather.rainIntensity,
    storm: state.weather.storm,
    fireBuilt: state.camp.fire.built,
    fireLit: state.camp.fire.lit,
    shelterBuilt: state.camp.shelterBuilt,
    bedBuilt: state.camp.bedBuilt,
    beaconBuilt: state.camp.beaconBuilt,
    signalActive: state.objectives.flags.transmitted,
    canSprint: state.player.vitals.stamina > 1,
    entities: Object.values(state.world.entities).map((entity) => toRenderEntity(state, entity)),
  };
}

function toRenderEntity(state: GameState, entity: GameState["world"]["entities"][string]): RenderEntity {
  let kind: RenderEntityKind;
  if (entity.kind === "water") kind = "water";
  else if (entity.kind === "radio") kind = "wreck";
  else if (entity.kind === "landmark") kind = entity.tags.includes("cache") ? "cache" : "station";
  else if (entity.kind === "hazard") kind = "snake";
  else kind = itemToRenderKind(entity.itemId);
  return {
    id: entity.id,
    kind,
    label: entity.label,
    x: entity.position.x,
    z: entity.position.z,
    interactRadius: entity.interactRadius,
    interactive:
      entity.kind === "resource" ||
      entity.kind === "water" ||
      ((entity.kind === "landmark" || entity.kind === "radio") &&
        (!hasInspectedLandmark(state, entity.id) ||
          (entity.kind === "radio" && state.camp.beaconBuilt && state.objectives.currentTaskId === "transmit-signal"))),
    available: !entity.depleted,
  };
}

function itemToRenderKind(itemId?: ItemId): RenderEntityKind {
  const map: Partial<Record<ItemId, RenderEntityKind>> = {
    stone: "stone", stick: "stick", vine: "vine", "broad-leaf": "palm", "medicinal-leaf": "herb", "dry-leaf": "herb",
    coconut: "coconut", battery: "beacon", "antiparasitic-herb": "tobacco", "palm-fruit": "banana", "brazil-nuts": "nut", grubs: "mushroom",
  };
  return (itemId && map[itemId]) || "stone";
}

function createInventoryViews(state: GameState): InventoryItemView[] {
  return (Object.entries(state.inventory) as [ItemId, number][]).map(([id, count]) => {
    let action: InventoryItemView["action"];
    let actionLabel: string | undefined;
    if (ITEMS[id].edible) { action = "eat"; actionLabel = "食用"; }
    if (id === "clean-water" || id === "dirty-water") { action = "drink"; actionLabel = id === "clean-water" ? "饮用" : "冒险饮用"; }
    if (id === "bandage" || id === "antiparasitic-herb") { action = "use"; actionLabel = "使用"; }
    return { id, label: ITEMS[id].label, count, description: ITEM_DESCRIPTIONS[id], category: CATEGORY_BY_ITEM[id], action, actionLabel };
  });
}

function createRecipeViews(state: GameState, retainedRecipes: readonly RecipeId[]): RecipeView[] {
  const known = new Set<RecipeId>([...getDiscoveredRecipeIds(state), ...retainedRecipes]);
  const recipes: RecipeView[] = (Object.entries(RECIPES) as [RecipeId, (typeof RECIPES)[RecipeId]][]).filter(([id]) => known.has(id)).map(([id, recipe]) => {
    const check = canCraft(state, id);
    const ingredients = [
      ...Object.entries(recipe.ingredients).map(([itemId, count]) => `${ITEMS[itemId as ItemId].label} ×${count}`),
      ...(recipe.tools ?? []).map((tool) => `工具：${ITEMS[tool].label}`),
      `现场投入 ${recipe.workSeconds} 秒`,
    ];
    const reason = check.reason === "not-at-camp" ? "需回到营地" : check.reason === "already-built" ? "已建造" : check.missingTools.length ? `需要 ${check.missingTools.map((tool) => ITEMS[tool].label).join("、")}` : "缺少材料";
    const completed = check.reason === "already-built";
    return { id, label: recipe.label, description: RECIPE_DESCRIPTIONS[id], ingredients, available: check.ok, reason, completed };
  });
  const freeContainers = Math.max(0, state.inventory["coconut-shell"] - state.inventory["dirty-water"] - state.inventory["clean-water"]);
  if (state.inventory["dirty-water"] > 0 || state.eventLog.some((event) => event.type === "water-collected")) recipes.push({
      id: "boil-water" as RecipeId,
      label: "煮沸溪水",
      description: "让水持续沸腾，消除寄生虫风险。",
      ingredients: ["浑浊溪水 ×1", "燃烧中的营火"],
      available: state.inventory["dirty-water"] > 0 && state.camp.fire.lit,
      reason: state.camp.fire.lit ? "缺少浑浊溪水" : "需要燃烧中的营火",
    });
  if (known.has("campfire") || state.camp.fire.built) recipes.push({
      id: "add-fuel" as RecipeId,
      label: state.camp.fire.lit ? "为营火添柴" : "重新引燃营火",
      description: state.camp.fire.lit ? "延长营火燃烧时间，避免关键时刻熄灭。" : "用干叶接住余烬，再加入木棍。",
      ingredients: state.camp.fire.lit ? ["木棍 ×1"] : ["木棍 ×1", "干叶 ×1"],
      available: state.camp.fire.built && state.inventory.stick > 0 && (state.camp.fire.lit || state.inventory["dry-leaf"] > 0),
      reason: state.camp.fire.built ? "缺少燃料" : "尚未搭建营火",
    });
  if (known.has("coconut-shell") || state.inventory["coconut-shell"] > 0) recipes.push({
      id: "collect-rainwater" as RecipeId,
      label: "收集雨水",
      description: "暴雨会熄灭火，也能提供不含寄生虫的安全水。",
      ingredients: ["空椰壳 ×1", "降雨强度 ≥35%"],
      available: freeContainers > 0 && state.weather.rainIntensity >= 0.35,
      reason: freeContainers <= 0 ? "需要空椰壳" : "雨势太小",
    });
  if (state.camp.bedBuilt) recipes.push({
    id: "rest",
    label: "在棕榈床休息",
    description: "恢复体力、能量与理智，但时间流逝，饥渴仍会累积。",
    ingredients: ["棕榈床", "安全的营地位置"],
    available: isAtCamp(state),
    reason: "需回到营地",
  });
  return recipes;
}

function createLandmarkViews(state: GameState): MapLandmark[] {
  const distanceToStation = Math.hypot(state.player.position.x - 33, state.player.position.z - 27);
  const distanceToWater = Math.hypot(state.player.position.x - 12, state.player.position.z + 14);
  return [
    { id: "camp", label: "坠落点", x: 0, z: 0, discovered: true, kind: "camp" },
    { id: "stream", label: "溪流", x: 12, z: -14, discovered: distanceToWater < 18 || state.objectives.flags.waterPurified, kind: "water" },
    { id: "station", label: "气象站", x: 33, z: 27, discovered: hasInspectedLandmark(state, "landmark.survey-cache") || distanceToStation < 22 || state.objectives.flags.batteryRecovered, kind: "station" },
    { id: "cave", label: "勘测岩棚", x: -35, z: 31, discovered: hasInspectedLandmark(state, "landmark.camp-radio") || Math.hypot(state.player.position.x + 35, state.player.position.z - 31) < 18, kind: "cave" },
    { id: "food", label: "坚果坡", x: 20, z: 12, discovered: Math.hypot(state.player.position.x - 20, state.player.position.z - 12) < 14, kind: "food" },
  ];
}

function toEventView(event: GameEvent): EventView {
  const danger = ["game-lost", "parasite-contracted", "snake-bite"].includes(event.type);
  const warning = ["fire-extinguished", "craft-failed", "command-rejected", "weather-changed"].includes(event.type);
  const good = ["craft-succeeded", "recipe-discovered", "landmark-inspected", "wound-treated", "water-purified", "rest-completed", "task-completed", "game-won", "threat-avoided"].includes(event.type);
  return {
    id: event.id,
    time: formatClock(14 * 60 + event.elapsedSeconds * 1.2),
    message: event.message,
    tone: danger ? "danger" : warning ? "warning" : good ? "good" : "neutral",
  };
}

function objectiveDescription(state: GameState, taskId: (typeof TASK_SEQUENCE)[number]): string {
  if (taskId === "establish-camp" && state.camp.fire.built && state.camp.shelterBuilt && state.camp.bedBuilt) {
    return state.eventLog.some((event) => event.type === "rest-completed")
      ? "休息验证完成；确认营火仍在燃烧。"
      : "结构已经齐全。在棕榈床休息一次，验证遮蔽、火势与补给能否支撑过夜。";
  }
  if (taskId !== "recover-battery") return TASKS[taskId].description;
  if (!hasInspectedLandmark(state, "landmark.camp-radio")) {
    return "先回到坠落点拆检损坏电台，确认真正缺少的部件与旧航线。";
  }
  if (!hasInspectedLandmark(state, "landmark.survey-cache")) {
    return "电台记录指向西北岩棚。找到勘测箱，取回能避开沼地的坐标图。";
  }
  if (!hasInspectedLandmark(state, "landmark.weather-station")) {
    return "坐标已经标在地图上。沿山脊抵达气象站，先调查控制柜。";
  }
  if (state.inventory.axe <= 0) return "电池托架已锈死；带一把石斧回来撬开固定架。";
  return "控制柜与工具都已就绪，拆下气象站电池并安全带回营地。";
}

function formatClock(totalMinutes: number): string {
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function formatCoordinates(x: number, z: number): string {
  const southMinutes = Math.abs(7 + z * 0.018).toFixed(2).padStart(5, "0");
  const westMinutes = Math.abs(18 + x * 0.021).toFixed(2).padStart(5, "0");
  return `03° ${southMinutes}' S / 61° ${westMinutes}' W`;
}

function meter(id: string, label: string, shortLabel: string, value: number, tone: MeterView["tone"]): MeterView {
  return { id, label, shortLabel, value: Math.max(0, Math.min(100, value)), tone };
}
