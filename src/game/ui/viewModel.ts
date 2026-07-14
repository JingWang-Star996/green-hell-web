import { ITEMS, RECIPES, TASKS, TASK_SEQUENCE } from "../sim/content";
import { createEcologyState, projectEcologyForRender } from "../ecology";
import {
  BIOME_PROFILES,
  WORLD_CHUNK_SIZE,
  activeChunkCoordinates,
  generateChunkDescriptor,
  worldToChunkCoordinate,
} from "../world/generation";
import { canCraft, getDiscoveredRecipeIds, getSurvivalScore, hasInspectedLandmark, isAtCamp } from "../sim/selectors";
import {
  getDurableToolInventoryStatus,
  getPerishableInventoryStatus,
  isDurableTool,
  isPerishableItem,
} from "../sim/lifecycle";
import type { GameEvent, GameState, ItemId, RecipeId } from "../sim/types";
import type { RenderEntity, RenderEntityKind, RenderSnapshot } from "../render/types";
import type {
  BodyView,
  EventView,
  InventoryItemView,
  MapChunkView,
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
  mapChunks: MapChunkView[];
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
  const objectives: ObjectiveView[] = TASK_SEQUENCE.map((id, index) => {
    const completed = state.objectives.completedTaskIds.includes(id);
    const current = state.objectives.currentTaskId === id;
    const presentation = objectivePresentation(state, id, completed || current);
    return {
      id,
      label: presentation.label ?? `未确认线索 ${String(index + 1).padStart(2, "0")}`,
      description: presentation.description,
      progressLabel: presentation.progressLabel,
      blocker: presentation.blocker,
      completed,
      current,
    };
  });
  const currentChunk = generateChunkDescriptor(
    String(state.seed),
    worldToChunkCoordinate(state.player.position.x, state.player.position.z),
  );
  if (state.objectives.flags.sandboxContinued) {
    const lowWater = state.player.nutrition.hydration < 35;
    const noFood = state.inventory["palm-fruit"] + state.inventory["brazil-nuts"] + state.inventory.grubs === 0;
    objectives.push({
      id: "living-forest",
      label: `调查${BIOME_PROFILES[currentChunk.biome].label}`,
      description: "观察天气和动物活动，完成一次采集—返营—加工—维修循环；跨过区块边界会生成新的地形与生态。",
      progressLabel: `持续远征 · DAY ${String(state.clock.day).padStart(2, "0")}`,
      blocker: lowWater
        ? "水分低于 35；先寻找水源或返回营地补水。"
        : noFood
          ? "背包没有食物；注意腐败时间，优先寻找可持续补给。"
          : undefined,
      completed: false,
      current: true,
    });
  }
  return {
    render: toRenderSnapshot(state),
    watch: {
      day: state.clock.day,
      time: formatClock(state.clock.minuteOfDay),
      coordinates: formatCoordinates(state.player.position.x, state.player.position.z),
      weather: state.weather.storm ? "强暴雨" : state.weather.rainIntensity > 0.55 ? "降雨" : state.weather.rainIntensity > 0.15 ? "阵雨" : "闷热",
      biome: BIOME_PROFILES[currentChunk.biome].label,
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
    mapChunks: createMapChunkViews(state),
    score: getSurvivalScore(state),
  };
}

function toRenderSnapshot(state: GameState): RenderSnapshot {
  const activeChunks = activeChunkCoordinates(
    state.player.position.x,
    state.player.position.z,
    1,
  ).map((coordinate) => generateChunkDescriptor(String(state.seed), coordinate));
  const ecology = state.ecology ?? createEcologyState(state.seed, {
    tick: state.clock.tick,
    rainIntensity: state.weather.rainIntensity,
    activeChunks,
  });
  return {
    worldSeed: String(state.seed),
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
    entities: Object.values(state.world.entities)
      .filter((entity) =>
        Math.hypot(
          entity.position.x - state.player.position.x,
          entity.position.z - state.player.position.z,
        ) <= WORLD_CHUNK_SIZE * 3,
      )
      .map((entity) => toRenderEntity(state, entity)),
    wildlife: projectEcologyForRender(ecology, {
      tick: state.clock.tick,
      rainIntensity: state.weather.rainIntensity,
      activeChunks,
    }),
  };
}

function toRenderEntity(state: GameState, entity: GameState["world"]["entities"][string]): RenderEntity {
  let kind: RenderEntityKind;
  if (entity.kind === "water") kind = "water";
  else if (entity.kind === "radio") kind = "wreck";
  else if (entity.kind === "landmark") kind = entity.tags.includes("cache") ? "cache" : "station";
  else if (entity.kind === "hazard") kind = "snake";
  else kind = itemToRenderKind(entity.itemId);
  const batteryCanBeRemoved =
    entity.itemId !== "battery" ||
    hasInspectedLandmark(state, "landmark.weather-station");
  return {
    id: entity.id,
    kind,
    label: entity.label,
    x: entity.position.x,
    z: entity.position.z,
    interactRadius: entity.interactRadius,
    interactive:
      (entity.kind === "resource" && batteryCanBeRemoved) ||
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
    let statusLabel: string | undefined;
    let statusTone: InventoryItemView["statusTone"];
    if (isPerishableItem(id) && count > 0) {
      const status = getPerishableInventoryStatus(state, id);
      const seconds = status.secondsUntilNextSpoilage ?? 0;
      statusLabel =
        seconds <= 0
          ? "已经腐坏"
          : seconds < 60
            ? `约 ${Math.max(1, Math.ceil(seconds))} 秒后腐坏`
            : `约 ${Math.ceil(seconds / 60)} 分钟后腐坏`;
      const freshness = seconds / status.shelfLifeSeconds;
      statusTone = freshness <= 0.15 ? "danger" : freshness <= 0.4 ? "warning" : "stable";
    } else if (isDurableTool(id) && count > 0) {
      const status = getDurableToolInventoryStatus(state, id);
      statusLabel = `耐久 ${status.activeDurability}/${status.maxDurability}`;
      const durability = status.activeDurability / status.maxDurability;
      statusTone = durability <= 0.2 ? "danger" : durability <= 0.5 ? "warning" : "stable";
    }
    return { id, label: ITEMS[id].label, count, description: ITEM_DESCRIPTIONS[id], category: CATEGORY_BY_ITEM[id], action, actionLabel, statusLabel, statusTone };
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

function createMapChunkViews(state: GameState): MapChunkView[] {
  const current = worldToChunkCoordinate(
    state.player.position.x,
    state.player.position.z,
  );
  const currentKey = `${current.x}:${current.z}`;
  const keys = [...new Set([...(state.world.exploredChunks ?? []), currentKey])].slice(-121);
  const colors: Record<keyof typeof BIOME_PROFILES, string> = {
    "evergreen-rainforest": "#3f6742",
    "river-wetland": "#5d806f",
    "palm-grove": "#8a8a52",
    swamp: "#354e43",
    "rocky-highland": "#7d7869",
  };
  return keys.flatMap((key) => {
    const [xText, zText] = key.split(":");
    const x = Number(xText);
    const z = Number(zText);
    if (!Number.isInteger(x) || !Number.isInteger(z)) return [];
    const descriptor = generateChunkDescriptor(String(state.seed), { x, z });
    return [{
      key,
      x,
      z,
      biome: BIOME_PROFILES[descriptor.biome].label,
      color: colors[descriptor.biome],
      current: key === currentKey,
    }];
  });
}

function toEventView(event: GameEvent): EventView {
  const danger = ["game-lost", "parasite-contracted", "snake-bite", "food-spoiled", "tool-broken"].includes(event.type);
  const warning = ["fire-extinguished", "craft-failed", "command-rejected", "weather-changed", "tool-damaged"].includes(event.type);
  const good = ["craft-succeeded", "recipe-discovered", "landmark-inspected", "wound-treated", "water-purified", "rest-completed", "task-completed", "game-won", "sandbox-continued", "threat-avoided"].includes(event.type);
  return {
    id: event.id,
    time: formatClock(14 * 60 + event.elapsedSeconds * 1.2),
    message: event.message,
    tone: danger ? "danger" : warning ? "warning" : good ? "good" : "neutral",
  };
}

type ObjectivePresentation = Pick<ObjectiveView, "description"> &
  Partial<Pick<ObjectiveView, "label" | "progressLabel" | "blocker">>;

function objectivePresentation(
  state: GameState,
  taskId: (typeof TASK_SEQUENCE)[number],
  revealed: boolean,
): ObjectivePresentation {
  if (!revealed) {
    return { description: "先解决当前生存问题，新的线索才会写入笔记。" };
  }
  if (taskId === "treat-wound") {
    if (state.inventory.bandage > 0) {
      return {
        label: "包扎左臂伤口",
        description: "按 B 检查身体，或按 Tab 打开背包，对草药绷带选择“使用”。",
        progressLabel: "首日生存 1/3",
      };
    }
    if (state.inventory["medicinal-leaf"] > 0 && state.inventory.vine > 0) {
      return {
        label: "制作草药绷带",
        description: "材料已经齐全。按 C 打开制作界面，制作一份草药绷带。",
        progressLabel: "首日生存 1/3",
        blocker: "绷带尚未制作。",
      };
    }
    return {
      label: "寻找止血材料",
      description: "在坠落点附近寻找船子草和垂落藤蔓，分别靠近并按 E 采集至少一份。",
      progressLabel: "首日生存 1/3",
      blocker: `还需船子草 ${Math.max(0, 1 - state.inventory["medicinal-leaf"])}、藤条 ${Math.max(0, 1 - state.inventory.vine)}。`,
    };
  }
  if (taskId === "purify-water") {
    if (state.inventory["clean-water"] > 0) {
      return {
        label: "饮用煮沸净水",
        description: "按 Tab 打开背包，对煮沸净水选择“饮用”，完成安全补水验证。",
        progressLabel: "首日生存 2/3",
      };
    }
    if (state.inventory["dirty-water"] > 0) {
      return {
        label: state.camp.fire.lit ? "煮沸浑浊溪水" : "点燃营火",
        description: state.camp.fire.lit
          ? "水和火已经准备好。按 C 打开制作界面，选择“煮沸净水”。"
          : "浑浊溪水不能直接喝。回到坠落点搭建并点燃营火，再进行煮沸。",
        progressLabel: "首日生存 2/3",
        blocker: state.camp.fire.lit ? "溪水尚未煮沸。" : "缺少正在燃烧的营火。",
      };
    }
    if (state.inventory["coconut-shell"] > 0) {
      return {
        label: "用椰壳收集溪水",
        description: "按 M 查看地图，前往南侧溪流；靠近水边并按 E，用空椰壳取水。",
        progressLabel: "首日生存 2/3",
      };
    }
    if (state.inventory.coconut > 0 && state.inventory["stone-blade"] > 0) {
      return {
        label: "制作椰壳容器",
        description: "按 C 打开制作界面，用石刃剖开椰子，得到两个盛水容器。",
        progressLabel: "首日生存 2/3",
        blocker: "还没有可盛水的空椰壳。",
      };
    }
    return {
      label: "准备取水容器",
      description: "在溪流附近寻找落地椰子；采集两块石头制作石刃，再剖开椰子。",
      progressLabel: "首日生存 2/3",
      blocker: state.inventory.coconut <= 0 ? "缺少椰子。" : "缺少石刃；先采集两块石头。",
    };
  }
  if (taskId === "establish-camp" && !state.camp.fire.built) {
    return {
      label: "搭建过夜营火",
      description: "回到坠落点，准备 4 根木棍和 2 份干叶；按 C 搭建营火并补充燃料。",
      progressLabel: "首日生存 3/3 · 营火",
      blocker: "营火尚未搭建。",
    };
  }
  if (taskId === "establish-camp" && !state.camp.shelterBuilt) {
    return {
      label: "搭建挡雨叶棚",
      description: "准备石斧、6 根木棍、4 条藤和 4 片宽叶；回到坠落点按 C 搭建叶棚。",
      progressLabel: "首日生存 3/3 · 遮蔽",
      blocker: state.inventory.axe <= 0 ? "缺少石斧。" : "叶棚材料尚未备齐。",
    };
  }
  if (taskId === "establish-camp" && !state.camp.bedBuilt) {
    return {
      label: "铺设离地棕榈床",
      description: "准备 4 根木棍、2 条藤和 6 片宽叶；回到坠落点按 C 铺设棕榈床。",
      progressLabel: "首日生存 3/3 · 睡眠",
      blocker: "棕榈床尚未完成。",
    };
  }
  if (taskId === "establish-camp" && state.camp.fire.built && state.camp.shelterBuilt && state.camp.bedBuilt) {
    return {
      label: "验证过夜营地",
      description: state.eventLog.some((event) => event.type === "rest-completed")
        ? "休息验证完成；确认营火仍在燃烧。"
        : "结构已经齐全。确保营火正在燃烧，再打开制作界面选择“休息”。",
      progressLabel: "首日生存 3/3 · 验证",
      blocker: state.camp.fire.lit ? "还需要在棕榈床完成一次休息。" : "营火尚未点燃或已经熄灭。",
    };
  }
  if (taskId !== "recover-battery") {
    return { label: TASKS[taskId].label, description: TASKS[taskId].description };
  }
  if (!hasInspectedLandmark(state, "landmark.camp-radio")) {
    return {
      label: "调查损坏电台",
      description: "回到坠落点，对准损坏电台按 E 调查，确认远征所需部件与旧航线。",
      progressLabel: "远征线索 1/5",
      blocker: "尚未调查坠落点的损坏电台。",
    };
  }
  if (!hasInspectedLandmark(state, "landmark.survey-cache")) {
    return {
      label: "寻找西北勘测岩棚",
      description: "按 M 打开地图，前往坠落点西北侧的勘测岩棚，调查里面的勘测箱。",
      progressLabel: "远征线索 2/5",
      blocker: "尚未取得勘测箱里的气象站坐标图。",
    };
  }
  if (!hasInspectedLandmark(state, "landmark.weather-station")) {
    return {
      label: "调查气象站控制柜",
      description: "气象站已标在地图东北侧。抵达后先对准控制柜按 E 调查，不要直接拆电池。",
      progressLabel: "远征线索 3/5",
      blocker: "尚未调查气象站控制柜；此时电池不可拆卸。",
    };
  }
  if (state.inventory.axe <= 0) {
    return {
      label: "准备拆卸工具",
      description: "电池托架已经锈死。按 C 打开制作界面，制作并携带一把石斧。",
      progressLabel: "远征线索 4/5",
      blocker: "背包中缺少石斧。",
    };
  }
  return {
    label: "拆取气象站电池",
    description: "控制柜与工具都已就绪。对准电池按 E 拆下，再安全带回坠落点。",
    progressLabel: "远征线索 5/5",
  };
}

function formatClock(totalMinutes: number): string {
  const normalized = ((Math.floor(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function formatCoordinates(x: number, z: number): string {
  // The paper map uses +X as east and +Z as north. Moving in either positive
  // direction therefore reduces the displayed west/south coordinate.
  const southMinutes = Math.abs(7 - z * 0.018).toFixed(2).padStart(5, "0");
  const westMinutes = Math.abs(18 - x * 0.021).toFixed(2).padStart(5, "0");
  return `03° ${southMinutes}' S / 61° ${westMinutes}' W`;
}

function meter(id: string, label: string, shortLabel: string, value: number, tone: MeterView["tone"]): MeterView {
  return { id, label, shortLabel, value: Math.max(0, Math.min(100, value)), tone };
}
