import {
  ITEMS,
  RECIPES,
  TASKS,
  TASK_SEQUENCE,
} from "../sim/content";
import {
  BIOME_PROFILES,
  WORLD_CHUNK_SIZE,
  generateChunkDescriptor,
  worldToChunkCoordinate,
} from "../world/generation";
import {
  canCraft,
  getAvailableWaterContainerCount,
  getCampStructureTransform,
  getNearestLitCampfireTransform,
  getDiscoveredRecipeIds,
  getSurvivalScore,
  hasCollectedWater,
  hasCompletedRest,
  hasInspectedLandmark,
  isAtCamp,
  isNearCampStructure,
  isNearLitCampfire,
} from "../sim/selectors";
import {
  campfireStateForStructure,
  nearestPlacedStructure,
} from "../sim/campStructures";
import {
  resolveAffordance,
  resolveRiverWaterAffordance,
  resolveWildlifeAffordance,
  type ResolvedAffordance,
} from "../sim/affordances";
import {
  STRUCTURE_KINDS,
  rainCollectorInteractionAnchor,
  torchWaymarkInteractionAnchor,
} from "../sim/structureGeometry";
import {
  normalizeTorchWaymarkFuelQueue,
  torchWaymarkTotalFuelSeconds,
} from "../sim/torchWaymarkRules";
import { isAuthoredSnakeEntity } from "../sim/authoredSnakes";
import { projectActiveWildlife } from "../sim/wildlifeProjection";
import { SMOKING_RACK_REQUIRED_PROGRESS_SECONDS } from "../sim/smokingRackRules";
import {
  getPerishableInventoryStatus,
  isDurableTool,
  isPerishableItem,
} from "../sim/lifecycle";
import {
  MAXIMUM_FIRE_FUEL_SECONDS,
  START_MINUTE_OF_DAY,
  gameMinuteForDisplay,
  simulationSecondsToGameMinutes,
} from "../sim/time";
import {
  CAMPFIRE_RAIN_EXPOSED_GUIDANCE,
  resolveCurrentCampfireIgnition,
} from "../sim/campfireIgnitionRules";
import {
  clauseSatisfied,
  firstUnsatisfiedGuidanceStep,
  hasObjectiveFact,
} from "../sim/objectiveFacts";
import {
  CAMPAIGN_FACTS,
  RIVER_GAUGE_POSITION,
} from "../sim/campaignContent";
import { CANOPY_JUNCTION_POSITION } from "../sim/canopyJunction";
import type {
  GameEvent,
  GameState,
  ItemId,
  PlacedStructureKind,
  PlacedStructureState,
  RecipeId,
} from "../sim/types";
import type { RenderEntity, RenderEntityKind, RenderSnapshot } from "../render/types";
import { authoredInteractionAnchor } from "../world/interactionGeometry";
import {
  normalizeRiverHydrologyState,
  riverLevelTrend,
} from "../world/riverHydrology";
import { normalizeWindFieldState } from "../world/windField";
import { treeInteractionAnchor } from "../sim/treeHarvest";
import {
  cloneTreeRegrowthState,
  treeRegrowthNextTick,
} from "../sim/treeRegrowthRuntime";
import { rockInteractionGeometry } from "../sim/rockHarvest";
import type {
  BodyView,
  EventView,
  InventoryItemView,
  MapChunkView,
  MapLandmark,
  MeterView,
  ObjectiveView,
  RecipeRequirementView,
  RecipeView,
  WatchView,
} from "./types";
import {
  createDurableToolUnitViews,
  createWaterContainerLifecycleView,
} from "./inventoryLifecycleView";
import { acquisitionHintForItem } from "./recipeRequirements";

const ITEM_DESCRIPTIONS: Record<ItemId, string> = {
  stone: "可直接使用，也可敲击加工出锋利边缘。",
  stick: "干燥、笔直，既能做燃料，也适合成为支架。",
  log: "刚分段的整根木料；可继续劈成木棍，也将用于更大型建造。",
  vine: "拉扯后不易断，像一束天然绳索。",
  "broad-leaf": "叶面宽阔，雨水会沿着表面迅速滑落。",
  "medicinal-leaf": "揉碎后渗出黏性树液，气味清苦。",
  "dry-leaf": "即使暴雨前也能点着的宝贵引火物。",
  coconut: "内部仍有液体；坚硬外壳需要切割工具才能处理。",
  "coconut-shell": "可收集溪水和雨水。",
  "dirty-water": "直接饮用可能带来寄生虫。",
  "clean-water": "安全饮水；可能来自煮沸溪水，也可能来自雨水收集。",
  "stone-blade": "基础切割工具，也是多个配方的前置。",
  axe: "采集木棍、藤条和棕榈叶时能一次处理更多材料。",
  "stone-pick": "沿岩体裂隙开采石材的基础工具。",
  torch: "短距远征光源；手持时持续燃烧，暴雨会加快消耗并压低亮度。",
  bandage: "可处理左臂开放伤口。",
  spear: "让远征更有底气的简易防身工具。",
  battery: "气象站的备用电池，求救信标缺少的部件。",
  "antiparasitic-herb": "苦味强烈，可清除一层水源寄生虫。",
  "palm-fruit": "富含碳水并补充少量水分。",
  "brazil-nuts": "高脂肪、少量蛋白，适合长途准备。",
  grubs: "能补充蛋白质，但生吃令人不安。",
  "raw-meat": "刚处理下来的猎物肉；直接吃有明显寄生虫风险。",
  "cooked-meat": "在燃烧中的营火上彻底烤熟，适合远征补给。",
  "smoked-meat": "在烟熏架上慢制的耐储肉食；营火、雨势与群系湿度都会影响加工。",
  hide: "处理猎物留下的结实兽皮，可用于后续防具与建筑升级。",
};

const RECIPE_DESCRIPTIONS: Record<RecipeId, string> = {
  "stone-blade": "两块石头互相敲击，得到锋利切面。",
  axe: "石头、木柄和藤条构成的基础采集工具。",
  "stone-pick": "石镐头、木柄和藤条构成的基础采矿工具。",
  torch: "把干叶紧扎在木棍上；范围强于手表夜光，但会燃尽并占用双手。",
  bandage: "药草纤维与藤条可以先止住开放伤口。",
  "coconut-shell": "用石刃剖开椰子，得到两个盛水容器。",
  campfire: "提供净水、热量与理智；露天会被暴雨熄灭。",
  shelter: "让营火和身体避开持续降雨。",
  bed: "离开湿地睡眠，避免额外的身体风险。",
  spear: "轻量防身工具，危险靠近前仍应优先绕行。",
  "radio-beacon": "把气象站电池装入坠落点的求救机。",
  "cooked-meat": "必须靠近燃烧中的营火，把生肉彻底烤熟。",
  "smoking-rack": "可重复放置。把狩猎所得生肉转化为适合长途远征的烟熏肉。",
  "rain-collector": "可在任意已探索区域重复放置；林隙比密冠下集水更快，储水需用额外空椰壳带走。",
  "torch-waymark": "把一支实体火把固定在石基木杆上；可沿远征路线重复放置、补入备用火把，并在暴雨后重新点亮。",
  "split-log": "用石斧把一根原木劈成三根可直接制作和添火的木棍。",
};

const CATEGORY_BY_ITEM: Record<ItemId, InventoryItemView["category"]> = {
  stone: "material", stick: "material", log: "material", vine: "material", "broad-leaf": "material", "medicinal-leaf": "medicine", "dry-leaf": "material",
  coconut: "food", "coconut-shell": "tool", "dirty-water": "water", "clean-water": "water", "stone-blade": "tool", axe: "tool", "stone-pick": "tool", torch: "tool", bandage: "medicine", spear: "tool", battery: "mission", "antiparasitic-herb": "medicine", "palm-fruit": "food", "brazil-nuts": "food", grubs: "food", "raw-meat": "food", "cooked-meat": "food", "smoked-meat": "food", hide: "material",
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
      steps: presentation.steps,
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
  } else if (
    state.objectives.currentTaskId === null &&
    state.objectives.completedTaskIds.includes("river-rising")
  ) {
    objectives.push({
      id: "campaign-interlude",
      label: "保持应急频道畅通",
      description:
        "下游水位报告已经送达。利用自由建造在远征路线上补充遮雨、净水与火源，观察林冠和雨带变化，等待下一次现场指令。",
      progressLabel: `第一幕间奏 · DAY ${String(state.clock.day).padStart(2, "0")}`,
      completed: false,
      current: true,
    });
  }
  return {
    render: createRenderSnapshot(state),
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

export function createRenderSnapshot(state: GameState): RenderSnapshot {
  const streamCenter = worldToChunkCoordinate(
    state.player.position.x,
    state.player.position.z,
  );
  const activeWildlife = projectActiveWildlife(state);
  const hydrology = normalizeRiverHydrologyState(
    state.world.riverHydrology,
    state.clock.tick,
  );
  const wind = normalizeWindFieldState(
    state.world.windField,
    state.seed,
    state.clock.tick,
  );
  const activeChunkKeys = new Set(
    activeWildlife.frame.activeChunks.map((chunk) => chunk.key),
  );
  const activeStructures = structureTargets(state).filter((structure) => {
    if (
      structure.kind !== "smoking-rack" &&
      structure.kind !== "rain-collector" &&
      structure.kind !== "torch-waymark"
    ) {
      return true;
    }
    const coordinate = worldToChunkCoordinate(
      structure.position.x,
      structure.position.z,
    );
    return activeChunkKeys.has(`${coordinate.x}:${coordinate.z}`);
  });
  const semanticStates = new Map<
    string,
    RenderSnapshot["semanticStates"][number]
  >();
  for (const entity of Object.values(state.world.entities)) {
    if (!entity.semantic) continue;
    semanticStates.set(entity.id, {
      id: entity.id,
      chunkKey:
        entity.tags
          .find((tag) => tag.startsWith("chunk:"))
          ?.slice("chunk:".length) ?? "",
      quantity: entity.quantity,
      nextRegenerationTick:
        entity.regeneration?.nextTick ?? treeRegrowthNextTick(entity.treeRegrowth),
      ...(entity.treeHarvest
        ? { treeHarvest: { ...entity.treeHarvest } }
        : {}),
      ...(entity.treeRegrowth
        ? { treeRegrowth: cloneTreeRegrowthState(entity.treeRegrowth) }
        : {}),
    });
  }
  for (const [id, delta] of Object.entries(state.world.entityDeltas ?? {})) {
    if (!delta.chunk || semanticStates.has(id)) continue;
    semanticStates.set(id, {
      id,
      chunkKey: delta.chunk,
      quantity: delta.quantity,
      nextRegenerationTick:
        delta.regeneration?.nextTick ?? treeRegrowthNextTick(delta.treeRegrowth),
      ...(delta.treeHarvest
        ? { treeHarvest: { ...delta.treeHarvest } }
        : {}),
      ...(delta.treeRegrowth
        ? { treeRegrowth: cloneTreeRegrowthState(delta.treeRegrowth) }
        : {}),
    });
  }
  return {
    worldSeed: String(state.seed),
    streamCenter,
    riverWaterAffordance: resolveRiverWaterAffordance(
      state,
      "water:river:v1:0:0",
    ),
    day: state.clock.day,
    minuteOfDay: state.clock.minuteOfDay,
    rain: state.weather.rainIntensity,
    storm: state.weather.storm,
    wind,
    canopyJunctionPhase: state.world.canopyJunction?.phase ?? "obstructed",
    riverLevelMeters: hydrology.levelMeters,
    riverTrend: riverLevelTrend(hydrology),
    fireBuilt: state.camp.fire.built,
    fireLit: state.camp.fire.lit,
    shelterBuilt: state.camp.shelterBuilt,
    bedBuilt: state.camp.bedBuilt,
    beaconBuilt: state.camp.beaconBuilt,
    signalActive: state.objectives.flags.transmitted,
    canSprint: state.player.vitals.stamina > 1,
    heldItem: state.player.equippedItem ?? null,
    campX: state.camp.position.x,
    campZ: state.camp.position.z,
    structures: activeStructures.map((structure) => {
      const process = structure.process;
      const affordance = resolveAffordance(state, structure);
      const torchFuelQueue =
        structure.kind === "torch-waymark"
          ? normalizeTorchWaymarkFuelQueue(structure.torchFuelQueueSeconds)
          : [];
      const campfire =
        structure.kind === "campfire"
          ? campfireStateForStructure(state, structure)
          : null;
      return {
        id: structure.id,
        kind: structure.kind,
        x: structure.position.x,
        y: structure.position.y,
        z: structure.position.z,
        yaw: structure.yaw,
        ...(campfire
          ? {
              lit: campfire.lit,
              totalFuelSeconds: campfire.fuelSeconds,
              sheltered: campfire.sheltered,
            }
          : {}),
        ...(structure.kind === "rain-collector"
          ? {
              storedUnits: structure.storedUnits ?? 0,
              storageCapacity: structure.capacity ?? 4,
              siteMultiplier: affordance.preview.rateMultiplier ?? 0,
            }
          : {}),
        ...(structure.kind === "torch-waymark"
          ? {
              lit: structure.lit === true && torchFuelQueue.length > 0,
              totalFuelSeconds: torchWaymarkTotalFuelSeconds({
                torchFuelQueueSeconds: torchFuelQueue,
              }),
              slotCount: torchFuelQueue.length,
            }
          : {}),
        ...(process
          ? {
              processStatus: process.status,
              processProgress: Math.max(
                0,
                Math.min(
                  1,
                  process.progressSeconds /
                    SMOKING_RACK_REQUIRED_PROGRESS_SECONDS,
                ),
              ),
              processActive:
                process.status === "processing" &&
                !affordance.preview.environmentBlocker,
            }
          : {}),
      };
    }),
    semanticStates: [...semanticStates.values()],
    entities: [
      ...Object.values(state.world.entities)
        .filter(
          (entity) =>
            entity.id !== "landmark.stream" &&
            !isAuthoredSnakeEntity(entity) &&
            Math.hypot(
              entity.position.x - state.player.position.x,
              entity.position.z - state.player.position.z,
            ) <= WORLD_CHUNK_SIZE * 3,
        )
        .map((entity) => toRenderEntity(state, entity)),
      ...createStructureRenderEntities(state, activeStructures),
    ],
    wildlife: activeWildlife.wildlife.map((wildlife) => ({
      ...wildlife,
      affordance: resolveWildlifeAffordance(state, wildlife),
    })),
  };
}

function toRenderEntity(state: GameState, entity: GameState["world"]["entities"][string]): RenderEntity {
  let kind: RenderEntityKind;
  if (entity.kind === "water") kind = "water";
  else if (entity.kind === "radio") kind = "wreck";
  else if (entity.kind === "landmark") {
    kind = entity.tags.includes("canopy-junction")
      ? "canopy-junction"
      : entity.tags.includes("river-gauge")
      ? "river-gauge"
      : entity.tags.includes("cache")
        ? "cache"
        : "station";
  }
  else if (entity.kind === "hazard") kind = "snake";
  else if (
    entity.tags.includes("standing-tree") ||
    entity.semantic?.category === "tree"
  ) kind = "tree";
  else kind = itemToRenderKind(entity.itemId);
  const affordance = resolveAffordance(state, entity);
  const interactionAnchor =
    kind === "tree"
      ? treeInteractionAnchor(entity)
      : entity.semantic?.category === "mineable-rock"
        ? rockInteractionGeometry(entity).anchor
      : authoredInteractionAnchor(entity.id, {
          x: entity.position.x,
          z: entity.position.z,
          height: 0,
        });
  const renderedPosition =
    kind === "cache"
      ? { x: interactionAnchor.x, z: interactionAnchor.z }
      : entity.position;
  return {
    id: entity.id,
    source: entity.semantic
      ? "semantic"
      : entity.tags.includes("legacy-generated")
        ? "legacy"
        : "authored",
    kind,
    label: entity.label,
    x: renderedPosition.x,
    z: renderedPosition.z,
    quantity: entity.quantity,
    interactionAnchor,
    interactRadius: affordance.range,
    interactive: isFocusableAffordance(affordance),
    available: !entity.depleted,
    affordance,
    ...(entity.treeHarvest
      ? { treeHarvest: { ...entity.treeHarvest } }
      : {}),
    ...(entity.treeRegrowth
      ? { treeRegrowth: cloneTreeRegrowthState(entity.treeRegrowth) }
      : {}),
  };
}

const STRUCTURE_LABELS: Readonly<Record<PlacedStructureKind, string>> = {
  campfire: "营火",
  shelter: "挡雨叶棚",
  bed: "棕榈床",
  "radio-beacon": "求救信标",
  "smoking-rack": "烟熏架",
  "rain-collector": "雨水收集架",
  "torch-waymark": "火把路标",
};

function structureIsBuilt(
  state: GameState,
  kind: PlacedStructureKind,
): boolean {
  if (state.camp.structures?.some((structure) => structure.kind === kind)) {
    return true;
  }
  if (kind === "campfire") return state.camp.fire.built;
  if (kind === "shelter") return state.camp.shelterBuilt;
  if (kind === "bed") return state.camp.bedBuilt;
  if (kind === "radio-beacon") return state.camp.beaconBuilt;
  return (
    state.camp.structures?.some((structure) => structure.kind === kind) ?? false
  );
}

function structureTargets(state: GameState): PlacedStructureState[] {
  const explicit = state.camp.structures ?? [];
  const targets = explicit.map((structure) => ({
    ...structure,
    position: { ...structure.position },
  }));
  for (const kind of STRUCTURE_KINDS) {
    if (!structureIsBuilt(state, kind)) continue;
    if (targets.some((structure) => structure.kind === kind)) continue;
    const fallback = getCampStructureTransform(state, kind);
    if (!fallback) continue;
    targets.push({
      id: fallback.id,
      kind,
      position: { x: fallback.x, y: 0, z: fallback.z },
      yaw: fallback.yaw,
      builtAtTick: 0,
    });
  }
  return targets;
}

function structureInteractionAnchor(
  structure: PlacedStructureState,
): { x: number; z: number; height: number } {
  const height: Readonly<Record<PlacedStructureKind, number>> = {
    campfire: 0.45,
    bed: 0.28,
    shelter: 1.35,
    "radio-beacon": 1.22,
    "smoking-rack": 1.05,
    "rain-collector": 0.92,
    "torch-waymark": 1,
  };
  if (structure.kind === "rain-collector") {
    return rainCollectorInteractionAnchor(structure);
  }
  if (structure.kind === "torch-waymark") {
    return torchWaymarkInteractionAnchor(structure);
  }
  return {
    x: structure.position.x,
    z: structure.position.z,
    height: height[structure.kind],
  };
}

function createStructureRenderEntities(
  state: GameState,
  structures: readonly PlacedStructureState[] = structureTargets(state),
): RenderEntity[] {
  return structures.map((structure) => {
    const affordance = resolveAffordance(state, structure);
    return {
      id: structure.id,
      source: "structure",
      kind: structure.kind,
      label:
        structure.kind === "torch-waymark"
          ? affordance.preview.label
          : STRUCTURE_LABELS[structure.kind],
      x: structure.position.x,
      z: structure.position.z,
      interactionAnchor: structureInteractionAnchor(structure),
      interactRadius: affordance.range,
      interactive: isFocusableAffordance(affordance),
      available: structureIsBuilt(state, structure.kind),
      affordance,
    };
  });
}

function isFocusableAffordance(affordance: ResolvedAffordance): boolean {
  return (
    affordance.interactionMode !== "unavailable" ||
    affordance.state === "blocked"
  );
}

function itemToRenderKind(itemId?: ItemId): RenderEntityKind {
  const map: Partial<Record<ItemId, RenderEntityKind>> = {
    stone: "stone", stick: "stick", log: "stick", vine: "vine", "broad-leaf": "palm", "medicinal-leaf": "herb", "dry-leaf": "tinder",
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
    if (id === "stone-blade" || id === "axe" || id === "stone-pick" || id === "spear" || id === "torch") {
      action = "equip";
      actionLabel = state.player.equippedItem === id ? "收起" : "装备";
    }
    let statusLabel: string | undefined;
    let statusTone: InventoryItemView["statusTone"];
    let durableUnits: InventoryItemView["durableUnits"];
    let waterContainer: InventoryItemView["waterContainer"];
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
      durableUnits = createDurableToolUnitViews(state, id);
      statusLabel = durableUnits[0]?.statusLabel;
      statusTone = durableUnits[0]?.statusTone;
    }
    if (id === "coconut-shell" || id === "dirty-water" || id === "clean-water") {
      waterContainer = createWaterContainerLifecycleView(
        state,
        id === "coconut-shell" ? "container" : id,
      );
      if (count > 0) {
        statusLabel =
          id === "coconut-shell"
            ? `${waterContainer.total} 个容器：${waterContainer.empty} 空 · ${waterContainer.dirtyWater} 浑浊 · ${waterContainer.cleanWater} 干净`
            : `占用椰壳 ${count}/${waterContainer.total}；饮用后释放空壳`;
        statusTone = "stable";
      }
    }
    return {
      id,
      label: ITEMS[id].label,
      count,
      description: ITEM_DESCRIPTIONS[id],
      category: CATEGORY_BY_ITEM[id],
      action,
      actionLabel,
      statusLabel,
      statusTone,
      waterContainer,
      durableUnits,
    };
  });
}

function itemRecipeRequirement(
  state: GameState,
  itemId: ItemId,
  required: number,
  options: {
    current?: number;
    kind?: "material" | "tool";
    label?: string;
    consumed?: boolean;
  } = {},
): RecipeRequirementView {
  const current = Math.max(0, Math.floor(options.current ?? state.inventory[itemId]));
  const kind = options.kind ?? "material";
  return {
    id: `${kind}:${itemId}`,
    label: options.label ?? ITEMS[itemId].label,
    kind,
    current,
    required,
    satisfied: current >= required,
    consumed: options.consumed ?? kind !== "tool",
    acquisitionHint: acquisitionHintForItem(itemId),
  };
}

function conditionRecipeRequirement(
  id: string,
  label: string,
  satisfied: boolean,
  statusLabel: string,
): RecipeRequirementView {
  return {
    id: `condition:${id}`,
    label,
    kind: "condition",
    satisfied,
    statusLabel,
  };
}

function workTimeRecipeRequirement(workSeconds: number): RecipeRequirementView {
  return {
    id: "time:work",
    label: "现场投入",
    kind: "time",
    satisfied: true,
    statusLabel: `${workSeconds} 秒`,
  };
}

function createRecipeViews(state: GameState, retainedRecipes: readonly RecipeId[]): RecipeView[] {
  const known = new Set<RecipeId>([...getDiscoveredRecipeIds(state), ...retainedRecipes]);
  const taskRecipes = new Set<RecipeId>(
    state.objectives.currentTaskId
      ? TASKS[state.objectives.currentTaskId].supportRecipeIds ?? []
      : [],
  );
  const recipes: RecipeView[] = (Object.entries(RECIPES) as [RecipeId, (typeof RECIPES)[RecipeId]][]).filter(([id]) => known.has(id)).map(([id, recipe]) => {
    const check = canCraft(state, id);
    const requirements: RecipeRequirementView[] = [
      ...Object.entries(recipe.ingredients).map(([rawItemId, required]) => {
        const itemId = rawItemId as ItemId;
        return itemRecipeRequirement(state, itemId, required, {
          current:
            id === "rain-collector" && itemId === "coconut-shell"
              ? getAvailableWaterContainerCount(state)
              : undefined,
          label:
            id === "rain-collector" && itemId === "coconut-shell"
              ? "空椰壳"
              : undefined,
        });
      }),
      ...(recipe.tools ?? []).map((tool) =>
        itemRecipeRequirement(state, tool, 1, {
          kind: "tool",
          consumed: false,
        }),
      ),
    ];
    if (recipe.requiresCamp) {
      const atCamp = isAtCamp(state);
      requirements.push(
        conditionRecipeRequirement(
          "camp",
          "营地作业位置",
          atCamp,
          atCamp ? "已在营地范围" : "需回到营地范围",
        ),
      );
    }
    if (recipe.requiresLitFire) {
      const nearLitFire = isNearLitCampfire(state);
      requirements.push(
        conditionRecipeRequirement(
          "lit-fire",
          "燃烧中的营火",
          nearLitFire,
          nearLitFire ? "已靠近可用火源" : "需靠近实际放置且正在燃烧的营火",
        ),
      );
    }
    if (id === "campfire" || id === "torch-waymark") {
      const ignitionSafe = check.reason !== "rain-exposed";
      requirements.push(
        conditionRecipeRequirement(
          "ignition",
          "点火环境",
          ignitionSafe,
          ignitionSafe ? "当前环境可点火" : CAMPFIRE_RAIN_EXPOSED_GUIDANCE,
        ),
      );
    }
    if (check.reason === "inventory-full") {
      requirements.push(
        conditionRecipeRequirement(
          "inventory-space",
          "背包空间",
          false,
          "先腾出产物所需的背包空间",
        ),
      );
    }
    requirements.push(workTimeRecipeRequirement(recipe.workSeconds));
    const ingredients = [
      ...Object.entries(recipe.ingredients).map(([itemId, count]) => `${ITEMS[itemId as ItemId].label} ×${count}`),
      ...(recipe.tools ?? []).map((tool) => `工具：${ITEMS[tool].label}`),
      `现场投入 ${recipe.workSeconds} 秒`,
    ];
    const reason = check.reason === "not-at-camp" ? "需回到营地" : check.reason === "fire-not-lit" ? "需靠近燃烧中的营火" : check.reason === "rain-exposed" ? CAMPFIRE_RAIN_EXPOSED_GUIDANCE : check.reason === "already-built" ? "已建造" : check.reason === "missing-empty-containers" ? "需要 2 个未装水的空椰壳；建成后取水还需额外空壳" : check.reason === "inventory-full" ? "背包空间不足" : check.missingTools.length ? `需要 ${check.missingTools.map((tool) => ITEMS[tool].label).join("、")}` : "缺少材料";
    const completed = check.reason === "already-built";
    return {
      id,
      label: recipe.label,
      description: RECIPE_DESCRIPTIONS[id],
      ingredients,
      requirements,
      available: check.ok,
      reason,
      completed,
      taskRelevant: taskRecipes.has(id),
    };
  });
  const freeContainers = getAvailableWaterContainerCount(state);
  const selectedFire = nearestPlacedStructure(state, "campfire");
  const selectedFireState = selectedFire
    ? campfireStateForStructure(state, selectedFire)
    : state.camp.fire;
  const nearFire = isNearCampStructure(state, "campfire");
  const nearLitFire = isNearLitCampfire(state);
  const nearBed = isNearCampStructure(state, "bed");
  if (state.inventory["dirty-water"] > 0 || hasCollectedWater(state)) recipes.push({
      id: "boil-water" as RecipeId,
      label: "煮沸溪水",
      description: "让水持续沸腾，消除寄生虫风险。",
      ingredients: ["浑浊溪水 ×1", "燃烧中的营火"],
      requirements: [
        itemRecipeRequirement(state, "dirty-water", 1),
        conditionRecipeRequirement(
          "lit-fire",
          "燃烧中的营火",
          nearLitFire,
          nearLitFire ? "已靠近可用火源" : "需靠近实际放置且正在燃烧的营火",
        ),
      ],
      available: state.inventory["dirty-water"] > 0 && nearLitFire,
      reason:
        state.inventory["dirty-water"] <= 0
          ? "缺少浑浊溪水"
          : !getNearestLitCampfireTransform(state)
            ? "需要燃烧中的营火"
            : "需要靠近实际放置的营火",
    });
  if (known.has("campfire") || state.camp.fire.built) {
    const relighting = !selectedFireState.lit;
    const ignition = resolveCurrentCampfireIgnition(
      state,
      selectedFire?.id,
    );
    const needsStick = relighting
      ? selectedFireState.fuelSeconds <= 1e-6
      : true;
    const fuelFull =
      !relighting &&
      selectedFireState.fuelSeconds >= MAXIMUM_FIRE_FUEL_SECONDS - 1e-6;
    const exposedRelightBlocked =
      relighting &&
      !ignition.canIgnite;
    const hasMaterials =
      (!needsStick || state.inventory.stick > 0) &&
      (!relighting || state.inventory["dry-leaf"] > 0);
    recipes.push({
      id: "add-fuel" as RecipeId,
      label: selectedFireState.lit ? "为营火添柴" : "重新引燃营火",
      description: selectedFireState.lit
        ? "延长营火燃烧时间，避免关键时刻熄灭。"
        : needsStick
          ? "余烬已经耗尽，需要干叶和一根木棍重新起火。"
          : "燃料仍有余温，只需干叶就能让余烬重新接住火苗。",
      ingredients: selectedFireState.lit
        ? ["木棍 ×1"]
        : [
            ...(needsStick ? ["木棍 ×1"] : []),
            "干叶 ×1",
          ],
      requirements: [
        ...(needsStick ? [itemRecipeRequirement(state, "stick", 1)] : []),
        ...(relighting ? [itemRecipeRequirement(state, "dry-leaf", 1)] : []),
        conditionRecipeRequirement(
          "placed-fire",
          "已放置的营火",
          state.camp.fire.built && nearFire,
          !state.camp.fire.built
            ? "尚未搭建营火"
            : nearFire
              ? "已靠近可维护的营火"
              : "需靠近实际放置的营火",
        ),
        ...(relighting
          ? [
              conditionRecipeRequirement(
                "ignition",
                "重新点火环境",
                ignition.canIgnite,
                ignition.canIgnite ? "当前环境可重新点火" : CAMPFIRE_RAIN_EXPOSED_GUIDANCE,
              ),
            ]
          : []),
      ],
      available:
        state.camp.fire.built &&
        nearFire &&
        !fuelFull &&
        !exposedRelightBlocked &&
        hasMaterials,
      reason: !state.camp.fire.built
        ? "尚未搭建营火"
        : !nearFire
          ? "需要靠近实际放置的营火"
          : fuelFull
            ? "燃料已满；无需浪费木棍"
            : exposedRelightBlocked
              ? CAMPFIRE_RAIN_EXPOSED_GUIDANCE
              : relighting && state.inventory["dry-leaf"] <= 0
                ? "缺少干叶引火"
                : needsStick && state.inventory.stick <= 0
                  ? "缺少木棍"
                  : undefined,
      statusLabel: selectedFireState.lit
        ? `当前燃料 ${Math.max(0, Math.round(selectedFireState.fuelSeconds))} 秒`
        : selectedFireState.fuelSeconds > 0
          ? `余烬中仍有 ${Math.max(1, Math.round(selectedFireState.fuelSeconds))} 秒燃料`
          : "营火已经熄灭，余烬也已耗尽",
      statusValue: selectedFireState.fuelSeconds,
    });
  }
  if (known.has("coconut-shell") || state.inventory["coconut-shell"] > 0) recipes.push({
      id: "collect-rainwater" as RecipeId,
      label: "应急手接雨水",
      description: "短期在雨中手持椰壳接水；长期供水应在林隙放置雨水收集架。",
      ingredients: ["空椰壳 ×1", "降雨强度 ≥35%"],
      requirements: [
        itemRecipeRequirement(state, "coconut-shell", 1, {
          current: freeContainers,
          label: "空椰壳",
        }),
        conditionRecipeRequirement(
          "rain",
          "降雨强度",
          state.weather.rainIntensity >= 0.35,
          `当前 ${Math.round(state.weather.rainIntensity * 100)}% / 所需 35%`,
        ),
      ],
      available: freeContainers > 0 && state.weather.rainIntensity >= 0.35,
      reason: freeContainers <= 0 ? "需要空椰壳" : "雨势太小",
    });
  if (state.camp.bedBuilt) recipes.push({
    id: "rest",
    label: "在棕榈床休息",
    description: "恢复体力、能量与理智，但时间流逝，饥渴仍会累积。",
    ingredients: ["棕榈床"],
    requirements: [
      conditionRecipeRequirement(
        "placed-bed",
        "已放置的棕榈床",
        nearBed,
        nearBed ? "已靠近可休息的棕榈床" : "需靠近实际放置的棕榈床",
      ),
    ],
    available: nearBed,
    reason: "需要靠近实际放置的棕榈床",
  });
  return recipes;
}

function createLandmarkViews(state: GameState): MapLandmark[] {
  const distanceToStation = Math.hypot(state.player.position.x - 33, state.player.position.z - 27);
  const distanceToWater = Math.hypot(state.player.position.x - 12, state.player.position.z + 14);
  const distanceToRiverGauge = Math.hypot(
    state.player.position.x - RIVER_GAUGE_POSITION.x,
    state.player.position.z - RIVER_GAUGE_POSITION.z,
  );
  const riverGaugeRecorded =
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverGaugeCleared,
    ) ||
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.riverTrendObserved,
    );
  const distanceToCanopyJunction = Math.hypot(
    state.player.position.x - CANOPY_JUNCTION_POSITION.x,
    state.player.position.z - CANOPY_JUNCTION_POSITION.z,
  );
  const canopyJunctionRecorded =
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyContradictionObserved,
    ) ||
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyLinkRestored,
    ) ||
    hasObjectiveFact(
      state.knowledge?.objectiveFacts,
      CAMPAIGN_FACTS.canopyLiveSampleObserved,
    );
  return [
    { id: "camp", label: "坠落点", x: 0, z: 0, discovered: true, kind: "camp" },
    { id: "stream", label: "溪流", x: 12, z: -14, discovered: distanceToWater < 18 || state.objectives.flags.waterPurified, kind: "water" },
    { id: "station", label: "气象站", x: 33, z: 27, discovered: hasInspectedLandmark(state, "landmark.survey-cache") || distanceToStation < 22 || state.objectives.flags.batteryRecovered, kind: "station" },
    { id: "cave", label: "勘测岩棚", x: -35, z: 31, discovered: hasInspectedLandmark(state, "landmark.camp-radio") || Math.hypot(state.player.position.x + 35, state.player.position.z - 31) < 18, kind: "cave" },
    { id: "food", label: "坚果坡", x: 20, z: 12, discovered: Math.hypot(state.player.position.x - 20, state.player.position.z - 12) < 14, kind: "food" },
    { id: "river-gauge", label: "下游旧水尺", x: RIVER_GAUGE_POSITION.x, z: RIVER_GAUGE_POSITION.z, discovered: distanceToRiverGauge < 30 || riverGaugeRecorded, kind: "station" },
    { id: "canopy-junction", label: "C-17 林下汇线箱", x: CANOPY_JUNCTION_POSITION.x, z: CANOPY_JUNCTION_POSITION.z, discovered: distanceToCanopyJunction < 30 || canopyJunctionRecorded, kind: "station" },
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
  const warning = ["fire-extinguished", "structure-extinguished", "craft-failed", "command-rejected", "weather-changed", "tool-damaged"].includes(event.type);
  const good = ["craft-succeeded", "recipe-discovered", "landmark-inspected", "wound-treated", "water-purified", "rest-completed", "structure-fuel-added", "structure-ignited", "task-completed", "game-won", "sandbox-continued", "threat-avoided"].includes(event.type);
  return {
    id: event.id,
    time: formatClock(START_MINUTE_OF_DAY + simulationSecondsToGameMinutes(event.elapsedSeconds)),
    message: event.message,
    tone: danger ? "danger" : warning ? "warning" : good ? "good" : "neutral",
  };
}

type ObjectivePresentation = Pick<ObjectiveView, "description"> &
  Partial<
    Pick<ObjectiveView, "label" | "progressLabel" | "blocker" | "steps">
  >;

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
        description: "打开身体检查，或从背包对草药绷带选择“使用”。",
        progressLabel: "首日生存 1/3",
      };
    }
    if (state.inventory["medicinal-leaf"] > 0 && state.inventory.vine > 0) {
      return {
        label: "制作草药绷带",
        description: "材料已经齐全。打开制作界面，制作一份草药绷带。",
        progressLabel: "首日生存 1/3",
        blocker: "绷带尚未制作。",
      };
    }
    return {
      label: "寻找止血材料",
      description: "在坠落点附近寻找船子草和垂落藤蔓，分别靠近、对准并互动采集至少一份。",
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
          ? "水和火已经准备好。打开制作界面，选择“煮沸净水”。"
          : "浑浊溪水不能直接喝。回到坠落点搭建并点燃营火；引火用的是贴地的浅褐色扇形干叶堆，不是绿色药草。坠落点西侧岩缝、东侧棕榈落叶和通往溪流的倒木背风面都有保底。",
        progressLabel: "首日生存 2/3",
        blocker: state.camp.fire.lit ? "溪水尚未煮沸。" : "缺少正在燃烧的营火。",
      };
    }
    if (state.inventory["coconut-shell"] > 0) {
      return {
        label: "用椰壳收集溪水",
        description: "打开地图并前往南侧溪流；靠近水边、对准后互动，用空椰壳取水。",
        progressLabel: "首日生存 2/3",
      };
    }
    if (state.inventory.coconut > 0 && state.inventory["stone-blade"] > 0) {
      return {
        label: "制作椰壳容器",
        description: "打开制作界面，用石刃剖开椰子，得到两个盛水容器。",
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
    const missingSticks = Math.max(0, 4 - state.inventory.stick);
    const missingTinder = Math.max(0, 2 - state.inventory["dry-leaf"]);
    return {
      label: "搭建过夜营火",
      description: "回到坠落点，准备 4 根木棍和 2 份干叶。干叶是贴地的浅褐色扇形叶堆，不是绿色药草；查看西侧岩缝、东侧棕榈落叶，或沿溪流方向寻找倒木背风面。材料齐全后打开制作界面搭建营火。",
      progressLabel: "首日生存 3/3 · 营火",
      blocker:
        missingSticks > 0 || missingTinder > 0
          ? `还需木棍 ${missingSticks}、干叶 ${missingTinder}。`
          : "材料已经齐全；营火尚未搭建。",
    };
  }
  if (taskId === "establish-camp" && !state.camp.shelterBuilt) {
    return {
      label: "搭建挡雨叶棚",
      description: "准备石斧、6 根木棍、4 条藤和 4 片宽叶；回到坠落点，从制作界面搭建叶棚。",
      progressLabel: "首日生存 3/3 · 遮蔽",
      blocker: state.inventory.axe <= 0 ? "缺少石斧。" : "叶棚材料尚未备齐。",
    };
  }
  if (taskId === "establish-camp" && !state.camp.bedBuilt) {
    return {
      label: "铺设离地棕榈床",
      description: "准备 4 根木棍、2 条藤和 6 片宽叶；回到坠落点，从制作界面铺设棕榈床。",
      progressLabel: "首日生存 3/3 · 睡眠",
      blocker: "棕榈床尚未完成。",
    };
  }
  if (taskId === "establish-camp" && state.camp.fire.built && state.camp.shelterBuilt && state.camp.bedBuilt) {
    return {
      label: "验证过夜营地",
      description: hasCompletedRest(state)
        ? "休息验证完成；确认营火仍在燃烧。"
        : "结构已经齐全。确保营火正在燃烧，再打开制作界面选择“休息”。",
      progressLabel: "首日生存 3/3 · 验证",
      blocker: state.camp.fire.lit ? "还需要在棕榈床完成一次休息。" : "营火尚未点燃或已经熄灭。",
    };
  }
  if (taskId === "river-rising") {
    const task = TASKS[taskId];
    const facts = state.knowledge?.objectiveFacts;
    const guidance = task.guidance ?? [];
    const next = firstUnsatisfiedGuidanceStep(facts, guidance);
    const completedSteps = guidance.filter((step) =>
      step.requirements.every((clause) => clauseSatisfied(facts, clause)),
    ).length;
    const gaugeDistance = Math.hypot(
      state.player.position.x - RIVER_GAUGE_POSITION.x,
      state.player.position.z - RIVER_GAUGE_POSITION.z,
    );
    const nextInstruction =
      next?.id === "clear-river-gauge"
        ? `旧水尺位于营地东侧沿河，距当前位置约 ${Math.max(0, Math.round(gaugeDistance))} 米。寻找橙色测绘帽，用斧头处理遮挡下部刻度的倒木。`
        : next?.instruction;
    return {
      label: next?.title ?? "下游水尺已完成上报",
      description:
        nextInstruction ??
        "应急网络已经收到水位趋势；本次河流调查结束，但远征仍会继续。",
      progressLabel: `第一幕 · 河流正在上升 ${completedSteps}/${guidance.length}`,
      steps: guidance.map((step) => ({
        id: step.id,
        label: step.title ?? step.instruction ?? step.id,
        completed: step.requirements.every((clause) =>
          clauseSatisfied(facts, clause),
        ),
      })),
    };
  }
  if (taskId === "canopy-wind") {
    const task = TASKS[taskId];
    const facts = state.knowledge?.objectiveFacts;
    const guidance = task.guidance ?? [];
    const next = firstUnsatisfiedGuidanceStep(facts, guidance);
    const completedSteps = guidance.filter((step) =>
      step.requirements.every((clause) => clauseSatisfied(facts, clause)),
    ).length;
    const junctionDistance = Math.hypot(
      state.player.position.x - CANOPY_JUNCTION_POSITION.x,
      state.player.position.z - CANOPY_JUNCTION_POSITION.z,
    );
    const junction = state.world.canopyJunction;
    const nextInstruction =
      next?.id === "compare-canopy-wind"
        ? `C-17 位于营地东北侧密林，距当前位置约 ${Math.max(0, Math.round(junctionDistance))} 米。寻找架高的黄色防水箱和橙色编号，比较面板 0.0 与受风叶片、斜雨。`
        : next?.id === "restore-canopy-link" && junction?.phase === "sampling"
          ? "链路已复位，设备正在等待连续 10 秒的可读阵风；可在附近经营前哨，无需一直盯着面板。"
          : next?.id === "restore-canopy-link" && junction?.phase === "connector-open"
            ? "箱门已经安全打开。再次互动，完成对齐、压入并锁紧防水接头。"
            : next?.id === "restore-canopy-link"
              ? "先处理压住箱门的倒木，或装备石刃切断两根受力藤本；清障后调查 C-17 并安全复位接头。"
              : next?.id === "read-canopy-sample" && junction?.phase === "sampling"
                ? "设备正在积累有效阵风窗；叶片、雨线和风声会提前显示真实方向，取得样本后面板会亮起。"
                : next?.instruction;
    const blocker =
      next?.id === "receive-canopy-request"
        ? "应急网络尚未返回林冠零值回执。"
        : next?.id === "prepare-canopy-expedition"
          ? "清障工具、实体补给或 C-17 附近的自由前哨，任选一种真实准备方案。"
          : next?.id === "report-canopy-sample"
            ? "需要靠近已供电的求救信标发送样本。"
            : undefined;
    return {
      label: next?.title ?? "C-17 阵风样本已完成上报",
      description:
        nextInstruction ??
        "应急网络已确认林冠零值来自断开的传感链路；雨林仍会继续变化。",
      progressLabel: `第二幕 · 林冠没有风 ${completedSteps}/${guidance.length}`,
      blocker,
      steps: guidance.map((step) => ({
        id: step.id,
        label: step.title ?? step.instruction ?? step.id,
        completed: step.requirements.every((clause) =>
          clauseSatisfied(facts, clause),
        ),
      })),
    };
  }
  if (taskId !== "recover-battery") {
    return { label: TASKS[taskId].label, description: TASKS[taskId].description };
  }
  if (!hasInspectedLandmark(state, "landmark.camp-radio")) {
    return {
      label: "调查损坏电台",
      description: "回到坠落点，对准损坏电台并互动调查，确认远征所需部件与旧航线。",
      progressLabel: "远征线索 1/5",
      blocker: "尚未调查坠落点的损坏电台。",
    };
  }
  if (!hasInspectedLandmark(state, "landmark.survey-cache")) {
    return {
      label: "寻找西北勘测岩棚",
      description: "打开地图，前往坠落点西北侧的勘测岩棚，调查里面的勘测箱。",
      progressLabel: "远征线索 2/5",
      blocker: "尚未取得勘测箱里的气象站坐标图。",
    };
  }
  if (!hasInspectedLandmark(state, "landmark.weather-station")) {
    return {
      label: "调查气象站控制柜",
      description: "气象站已标在地图东北侧。抵达后先对准控制柜并互动调查，不要直接拆电池。",
      progressLabel: "远征线索 3/5",
      blocker: "尚未调查气象站控制柜；此时电池不可拆卸。",
    };
  }
  if (state.inventory.axe <= 0) {
    return {
      label: "准备拆卸工具",
      description: "电池托架已经锈死。打开制作界面，制作并携带一把石斧。",
      progressLabel: "远征线索 4/5",
      blocker: "背包中缺少石斧。",
    };
  }
  if (state.player.equippedItem !== "axe") {
    return {
      label: "装备石斧",
      description: "石斧已经在背包里。从快捷装备栏或背包选择“装备”，让斧头真正出现在手中。",
      progressLabel: "远征线索 5/5 · 工具",
      blocker: "石斧尚未装备；仅携带在背包里无法撬开托架。",
    };
  }
  return {
    label: "拆取气象站电池",
    description: "控制柜与手中的石斧都已就绪。对准电池并互动拆下，再安全带回坠落点。",
    progressLabel: "远征线索 5/5 · 拆卸",
  };
}

function formatClock(totalMinutes: number): string {
  const normalized = ((gameMinuteForDisplay(totalMinutes) % 1440) + 1440) % 1440;
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
