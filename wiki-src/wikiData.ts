import {
  FOOD_SPOILAGE,
  ITEMS,
  RECIPES,
  RESOURCE_REGENERATION,
  TASK_SEQUENCE,
  TASKS,
  TOOL_DURABILITY,
  TORCH_BURN_SEGMENT_GAME_HOURS,
  TORCH_BURN_SEGMENTS,
} from "../src/game/sim/content";
import {
  GAME_DAY_SIMULATION_SECONDS,
  REST_GAME_HOURS,
  START_MINUTE_OF_DAY,
} from "../src/game/sim/time";
import {
  BIOME_SEMANTIC_PROFILES,
  PLANT_SPECIES_CATALOG,
  ROCK_MATERIAL_CATALOG,
  SEMANTIC_DENSITY_BUDGET,
  TREE_SPECIES_CATALOG,
} from "../src/game/world/semanticGeneration";
import {
  BIOME_PROFILES,
  WORLD_CHUNK_SIZE,
} from "../src/game/world/generation";
import { ECOLOGY_SPECIES } from "../src/game/ecology/species";
import {
  AUTO_CHECKPOINT_SLOTS,
  MANUAL_CHECKPOINT_SLOTS,
} from "../src/game/persistence/checkpointTimeline";
import {
  TREE_REGROWTH_SAPLING_HOURS,
  TREE_REGROWTH_STUMP_HOURS,
  TREE_REGROWTH_TOTAL_HOURS,
  TREE_REGROWTH_YOUNG_HOURS,
} from "../src/game/sim/treeRegrowth";
import { ROCK_MINING_PROFILES } from "../src/game/sim/rockHarvest";
import {
  RAIN_COLLECTOR_BIOME_MULTIPLIERS,
  RAIN_COLLECTOR_CAPACITY,
  RAIN_COLLECTOR_FULL_RAIN_SECONDS_PER_UNIT,
} from "../src/game/sim/rainCollectorRules";
import {
  SMOKING_RACK_BASE_GAME_HOURS,
  SMOKING_RACK_BIOME_RULES,
  SMOKING_RACK_FIRE_RADIUS,
} from "../src/game/sim/smokingRackRules";
import {
  TORCH_WAYMARK_MAX_FUEL_SLOTS,
  TORCH_WAYMARK_RELIGHT_SECONDS,
  TORCH_WAYMARK_TOP_UP_SECONDS,
} from "../src/game/sim/torchWaymarkRules";
import { STRUCTURE_DISMANTLE_RULES } from "../src/game/sim/structureDismantle";

const WILDLIFE_LOOT: Readonly<
  Record<string, { meat: number; hide: number }>
> = {
  "reedtail-scuttler": { meat: 1, hide: 0 },
  "mossback-grazer": { meat: 3, hide: 2 },
  "glassfang-stalker": { meat: 2, hide: 1 },
  "coiled-viper": { meat: 1, hide: 0 },
};

const ROCK_YIELD_BY_SIZE = {
  small: [1, 2],
  medium: [3, 5],
  large: [6, 9],
} as const;

type ItemCategory = "tool" | "food" | "medicine" | "material" | "container" | "mission";

const ITEM_CATEGORY: Record<string, ItemCategory> = {
  stone: "material",
  stick: "material",
  log: "material",
  vine: "material",
  "broad-leaf": "material",
  "medicinal-leaf": "medicine",
  "dry-leaf": "material",
  coconut: "food",
  "coconut-shell": "container",
  "dirty-water": "food",
  "clean-water": "food",
  "stone-blade": "tool",
  axe: "tool",
  "stone-pick": "tool",
  torch: "tool",
  bandage: "medicine",
  spear: "tool",
  battery: "mission",
  "antiparasitic-herb": "medicine",
  "palm-fruit": "food",
  "brazil-nuts": "food",
  grubs: "food",
  "raw-meat": "food",
  "cooked-meat": "food",
  "smoked-meat": "food",
  hide: "material",
};

const ITEM_NOTES: Record<string, { summary: string; obtain: string; use: string }> = {
  stone: { summary: "基础矿物与打制工具核心材料。", obtain: "河岸散石、岩区资源节点，或装备石镐开采岩体。", use: "石刃、石斧、石镐与火把路标。" },
  stick: { summary: "最常用的结构与工具骨架。", obtain: "地面木棍、砍树加工、劈分原木。", use: "火、工具、床、棚、加工设施与路标。" },
  log: { summary: "树干分段后的重型木料。", obtain: "砍倒树木，清理枝条并截段后搬取。", use: "可用石斧劈成 3 根木棍。" },
  vine: { summary: "捆扎与编织用纤维。", obtain: "识别并用石刃割取纤维藤。", use: "工具、建筑、绷带与远征设施。" },
  "broad-leaf": { summary: "大面积防雨与铺垫材料。", obtain: "地面的宽叶资源节点；植物目录中的次级材料目前不会在采集结算中额外掉落。", use: "叶棚、棕榈床和雨水收集架。" },
  "medicinal-leaf": { summary: "处理开放伤口的药用叶。", obtain: "徒手采集药用阔叶草。", use: "与藤条制作草药绷带。" },
  "dry-leaf": { summary: "第一夜生火所需的引火物。", obtain: "坠落点、棕榈林和岩地的离散资源；离开后可按导演规则再生。", use: "营火与简易火把。" },
  coconut: { summary: "热带硬壳果，可加工为容器。", obtain: "棕榈林与部分生成资源节点。", use: "用石刃剖开，得到两个椰壳容器。" },
  "coconut-shell": { summary: "装水、煮水和集雨的基础容器。", obtain: "用石刃剖开椰子。", use: "取水、净水与搭建雨水收集架。" },
  "dirty-water": { summary: "未经处理的溪水，有寄生虫风险。", obtain: "持有空椰壳后从可达水边取水。", use: "在点燃的营火旁煮沸，或冒险直接饮用。" },
  "clean-water": { summary: "可以安全饮用的基础补水资源。", obtain: "煮沸浑浊溪水、收集雨水。", use: "饮用与远征准备。" },
  "stone-blade": { summary: "最早解锁的切割工具。", obtain: "用 2 块石头打制。", use: "割藤、加工椰子、制作多种工具与设施。" },
  axe: { summary: "砍树、清障和木材加工工具。", obtain: "石块、木棍、藤条并持有石刃后制作。", use: "处理树木、劈原木和部分任务障碍。" },
  "stone-pick": { summary: "所有离散岩体的开采工具。", obtain: "3 石块、木棍、藤条并持有石刃后制作。", use: "开采小、中、大岩体；体积越大耗时、体力和耐久越高。" },
  torch: { summary: "可装备的基础光源。", obtain: "木棍、3 干叶与藤条制作。", use: "夜行、装备照明，也可作为火把路标燃料。" },
  bandage: { summary: "关闭开放伤口并压低感染。", obtain: "药草叶与藤条制作。", use: "在身体检查界面治疗伤口。" },
  spear: { summary: "预防蛇袭和狩猎的主要武器。", obtain: "2 木棍、藤条并持有石刃后制作。", use: "近战攻击蛇、猎物与捕食者。" },
  battery: { summary: "废弃气象站的任务电池。", obtain: "完成气象站调查与拆取条件。", use: "修复营地求救信标；不可再生。" },
  "antiparasitic-herb": { summary: "针对肠道寄生虫的专用草药。", obtain: "徒手采集带花冠的驱虫草。", use: "每次减少 1 层寄生虫；无寄生虫时不能浪费。" },
  "palm-fruit": { summary: "补充碳水和少量水分的常见热带果实。", obtain: "棕榈果灌木和野芭蕉果串。", use: "直接食用，也可作为 A2 远征补给。" },
  "brazil-nuts": { summary: "高脂肪、少量蛋白的耐储食物。", obtain: "棕榈坚果林和岩地资源节点。", use: "直接食用以补充脂肪与少量蛋白。" },
  grubs: { summary: "蛋白来源，但会降低理智。", obtain: "潮湿地表和腐殖资源节点。", use: "可直接食用；注意保质期与理智代价。" },
  "raw-meat": { summary: "猎物尸体取得的易腐肉。", obtain: "击杀并搜集动物尸体。", use: "营火烤制或装入烟熏架。" },
  "cooked-meat": { summary: "营火快速加工的高蛋白食物。", obtain: "点燃营火旁烤制生肉。", use: "直接食用；保质期长于生肉。" },
  "smoked-meat": { summary: "适合远征的长保质肉食。", obtain: "烟熏架在合适火源、雨势和群系效率下加工。", use: "直接食用与 A2 补给方案。" },
  hide: { summary: "大型动物战利品。", obtain: "部分可狩猎动物尸体。", use: "当前版本保留为材料，尚无正式配方消耗。" },
};

const STRUCTURE_COPY: Record<string, { purpose: string; operation: string; warning: string }> = {
  campfire: { purpose: "提供火、烹饪、净水、照明、舒适与烘干。", operation: "靠近可点燃或添加木棍；每根木棍增加 2 游戏小时，最多存 12 游戏小时燃料。", warning: "强雨会阻止点火或熄灭露天火；叶棚覆盖范围内更可靠。" },
  shelter: { purpose: "给营火、烟熏架和玩家提供局部遮雨。", operation: "自由放置；覆盖是空间化范围，不是全营地开关。", warning: "会阻挡雨水收集架的开阔天空，因此不要把收集架放在棚下。" },
  bed: { purpose: `执行 ${REST_GAME_HOURS} 游戏小时休息并推进完整世界模拟。`, operation: "休息前后分别建立自动恢复点；存活且保存成功后才关闭界面。", warning: "休息仍会消耗水分、营养并推进腐坏、天气、火和伤势。" },
  "radio-beacon": { purpose: "修复求救通信并承接序章、A1、A2 报告。", operation: "营地唯一剧情设施，需要气象站电池、木棍、藤条和石刃。", warning: "这是唯一设施；普通生存建筑均可重复建造。" },
  "smoking-rack": { purpose: "把一份真实保质期的生肉加工为长保质烟熏肉。", operation: `需在 ${SMOKING_RACK_FIRE_RADIUS} 米内有点燃营火；基础进度 ${SMOKING_RACK_BASE_GAME_HOURS} 游戏小时。空架瞄准后按 R/触控“拆除”，耗时 ${STRUCTURE_DISMANTLE_RULES["smoking-rack"].workSeconds} 秒，返还木棍×${STRUCTURE_DISMANTLE_RULES["smoking-rack"].refund.stick}、藤条×${STRUCTURE_DISMANTLE_RULES["smoking-rack"].refund.vine}。`, warning: "露天大雨会暂停加工；加工中、待收取或待清理的架子不能拆除。" },
  "rain-collector": { purpose: `收集最多 ${RAIN_COLLECTOR_CAPACITY} 单位净水。`, operation: `满强度雨、无遮挡基准约每 ${RAIN_COLLECTOR_FULL_RAIN_SECONDS_PER_UNIT} 模拟秒 1 单位。空架瞄准后按 R/触控“拆除”，耗时 ${STRUCTURE_DISMANTLE_RULES["rain-collector"].workSeconds} 秒并返还部分材料。`, warning: "棚顶是硬遮挡；满容器、干旱或上方有棚都会停止。只要仍有储水就不能拆除，请先互动收取干净水。" },
  "torch-waymark": { purpose: "为重复路线建立可维护夜间导航光源。", operation: `最多装入 ${TORCH_WAYMARK_MAX_FUEL_SLOTS} 支真实火把；重燃 ${TORCH_WAYMARK_RELIGHT_SECONDS} 秒，加燃料 ${TORCH_WAYMARK_TOP_UP_SECONDS} 秒。`, warning: "雨会提高耗油，强雨可使露天路标熄灭。" },
};

const BIOME_LABELS: Record<string, string> = {
  "evergreen-rainforest": "常绿密林",
  "river-wetland": "河谷湿地",
  "palm-grove": "棕榈坚果林",
  swamp: "黑水沼泽",
  "rocky-highland": "岩石高地",
};

const PLANT_LABELS: Record<string, string> = {
  "medicinal-broadleaf": "药用阔叶草",
  "antiparasitic-herb": "驱虫草",
  "fiber-vine": "纤维藤",
  "palm-fruit-shrub": "棕榈果丛",
  "wild-plantain": "野芭蕉",
};

const TREE_LABELS: Record<string, string> = {
  balsa: "轻木",
  ironwood: "铁木",
  "rain-palm": "雨棕榈",
};

const ROCK_LABELS: Record<string, string> = {
  granite: "花岗岩",
  limestone: "石灰岩",
  flint: "燧石岩体",
  "laterite-clay": "红土岩体",
};

const ACTIVITY_LABELS: Record<string, string> = {
  diurnal: "昼行",
  nocturnal: "夜行",
  crepuscular: "晨昏活动",
};

const ROLE_LABELS: Record<string, string> = {
  "small-prey": "小型猎物",
  "large-herbivore": "大型食草动物",
  predator: "捕食者",
};

function entries<T>(record: Record<string, T>): Array<[string, T]> {
  return Object.entries(record);
}

function itemLabel(itemId: string): string {
  return ITEMS[itemId as keyof typeof ITEMS]?.label ?? itemId;
}

function materialList(record: Readonly<Record<string, number>> | undefined) {
  return entries(record ?? {}).map(([id, amount]) => ({ id, label: itemLabel(id), amount }));
}

function weightedLabels(values: readonly { id: string; weight: number }[]) {
  return values.map((entry) => ({ id: entry.id, label: PLANT_LABELS[entry.id] ?? TREE_LABELS[entry.id] ?? ROCK_LABELS[entry.id] ?? entry.id, weight: entry.weight }));
}

export function createWikiData() {
  const items = entries(ITEMS).map(([id, definition]) => {
    const notes = ITEM_NOTES[id];
    return {
      id,
      title: definition.label,
      category: ITEM_CATEGORY[id] ?? "material",
      stackLimit: definition.stackLimit,
      edible: definition.edible ?? null,
      shelfLifeGameHours: FOOD_SPOILAGE[id as keyof typeof FOOD_SPOILAGE]?.shelfLifeGameHours ?? null,
      durability: TOOL_DURABILITY[id as keyof typeof TOOL_DURABILITY]?.maxDurability ?? null,
      summary: notes?.summary ?? "当前版本物品。",
      obtain: notes?.obtain ?? "通过世界交互或制作取得。",
      use: notes?.use ?? "查看对应配方与交互。",
      source: ["src/game/sim/content.ts"],
    };
  });

  const recipes = entries(RECIPES).map(([id, recipe]) => ({
    id,
    title: recipe.label,
    ingredients: materialList(recipe.ingredients),
    tools: (recipe.tools ?? []).map((tool) => ({ id: tool, label: itemLabel(tool) })),
    results: materialList(recipe.results),
    effect: recipe.effect ?? null,
    requiresCamp: recipe.requiresCamp ?? false,
    requiresLitFire: recipe.requiresLitFire ?? false,
    workSeconds: recipe.workSeconds,
    structure: STRUCTURE_COPY[id] ?? null,
    source: ["src/game/sim/content.ts", ...(STRUCTURE_COPY[id] ? ["src/game/sim/structureGeometry.ts"] : [])],
  }));

  const tasks = TASK_SEQUENCE.map((id, index) => {
    const task = TASKS[id];
    return {
      id,
      order: index + 1,
      title: task.label,
      description: task.description,
      actId: task.actId ?? (index < 5 ? "prologue" : "campaign"),
      guidance: task.guidance ?? [],
      supportRecipeIds: task.supportRecipeIds ?? [],
      spoiler: index >= 3,
      implemented: true,
      source: id === "river-rising" || id === "canopy-wind"
        ? ["src/game/sim/campaignContent.ts", "src/game/sim/simulation.ts"]
        : ["src/game/sim/content.ts", "src/game/sim/simulation.ts"],
    };
  });

  const biomes = entries(BIOME_PROFILES).map(([id, profile]) => {
    const semantic = BIOME_SEMANTIC_PROFILES[id as keyof typeof BIOME_SEMANTIC_PROFILES];
    return {
      id,
      title: profile.label,
      moisture: profile.moisture,
      canopy: profile.canopy,
      resourceTags: profile.resourceTags,
      faunaTags: profile.faunaTags,
      counts: semantic.counts,
      trees: weightedLabels(semantic.trees),
      rocks: weightedLabels(semantic.rocks),
      plants: weightedLabels(semantic.plants),
      source: ["src/game/world/generation.ts", "src/game/world/semanticGeneration.ts"],
    };
  });

  const plants = entries(PLANT_SPECIES_CATALOG).map(([id, plant]) => ({
    id,
    title: PLANT_LABELS[id] ?? id,
    action: plant.toolRequirement.action,
    toolClass: plant.toolRequirement.toolClass,
    minimumTier: plant.toolRequirement.minimumTier,
    material: plant.material,
    primaryYield: itemLabel(plant.yieldIntent.primaryMaterial),
    yieldRange: plant.yieldIntent.baseUnits,
    settlementNote: "当前采集只结算主产物；目录中的 secondaryMaterials 是设计元数据，尚未成为实际掉落。",
    variants: plant.visualVariants,
    source: ["src/game/world/semanticGeneration.ts", "src/game/render/plantGeometryCatalog.ts"],
  }));

  const trees = entries(TREE_SPECIES_CATALOG).map(([id, tree]) => ({
    id,
    title: TREE_LABELS[id] ?? id,
    material: tree.material,
    variants: tree.visualVariants,
    stages: tree.stages,
    interaction: "所有离散树木均可处理：树苗用石刃割取，幼树、成树和老龄树用石斧砍伐；阶段越高，耗时、耐久消耗与产出越高。",
    regrowth: {
      stumpHours: TREE_REGROWTH_STUMP_HOURS,
      saplingHours: TREE_REGROWTH_SAPLING_HOURS,
      youngHours: TREE_REGROWTH_YOUNG_HOURS,
      totalHours: TREE_REGROWTH_TOTAL_HOURS,
    },
    source: ["src/game/world/semanticGeneration.ts", "src/game/sim/treeHarvest.ts", "src/game/sim/treeRegrowth.ts"],
  }));

  const rocks = entries(ROCK_MATERIAL_CATALOG).map(([id, rock]) => ({
    id,
    title: ROCK_LABELS[id] ?? id,
    variants: rock.visualVariants,
    sizes: rock.sizes,
    currentYield: "石块",
    yieldBySize: ROCK_YIELD_BY_SIZE,
    tool: "石镐",
    profiles: ROCK_MINING_PROFILES,
    note: "岩性目前影响外观与群系分布；当前正式产出统一为石块，不承诺黏土或燧石专属材料。",
    source: ["src/game/world/semanticGeneration.ts", "src/game/sim/rockHarvest.ts"],
  }));

  const fauna = entries(ECOLOGY_SPECIES).map(([id, species]) => ({
    id,
    title: species.label,
    role: ROLE_LABELS[species.role] ?? species.role,
    activity: ACTIVITY_LABELS[species.activityPattern] ?? species.activityPattern,
    biomes: entries(species.biomeAffinity)
      .sort((left, right) => right[1] - left[1])
      .map(([biomeId, affinity]) => ({ id: biomeId, label: BIOME_LABELS[biomeId] ?? biomeId, affinity })),
    movementRadius: species.movementRadius,
    awarenessRadius: species.encounter.awarenessRadius,
    dangerLevel: species.encounter.dangerLevel,
    combat: species.combat,
    loot: WILDLIFE_LOOT[id] ?? { meat: 0, hide: 0 },
    source: ["src/game/ecology/species.ts", "src/game/ecology/projection.ts", "src/game/sim/wildlifeProjection.ts"],
  }));

  const regeneration = entries(RESOURCE_REGENERATION).map(([id, rule]) => ({
    id,
    title: itemLabel(id),
    minimumIntervalGameHours: rule.minimumIntervalGameHours,
    maximumIntervalGameHours: rule.maximumIntervalGameHours,
    minimumAmount: rule.minimumAmount,
    maximumAmount: rule.maximumAmount,
    minimumPlayerDistance: rule.minimumPlayerDistance,
  }));

  return {
    meta: {
      title: "CANOPY 生存档案",
      subtitle: "《雨林第一夜》完整游戏 Wiki",
      accuracy: "以当前仓库可运行代码、测试和已接受决策为准；设计稿不会冒充已上线玩法。",
      counts: {
        items: items.length,
        recipes: recipes.length,
        tasks: tasks.length,
        biomes: biomes.length,
        plants: plants.length,
        fauna: fauna.length,
      },
      time: {
        realMinutesPerGameDay: GAME_DAY_SIMULATION_SECONDS / 60,
        startingHour: START_MINUTE_OF_DAY / 60,
        restGameHours: REST_GAME_HOURS,
        chunkSizeMeters: WORLD_CHUNK_SIZE,
      },
      densityBudget: SEMANTIC_DENSITY_BUDGET,
    },
    quickStart: [
      { title: "检查身体", text: "按 B 打开身体界面。先采药草叶与藤条制作绷带，避免开放伤口持续恶化。" },
      { title: "准备安全饮水", text: "找到椰子并用石刃剖成容器；从水边取浑浊溪水，再用点燃营火煮沸。" },
      { title: "建立第一夜营地", text: "营火、叶棚、棕榈床分别解决火、雨和休息；注意建筑是自由放置且可重复。" },
      { title: "做出工具闭环", text: "先打制石刃，再制作石斧、石镐、石矛与火把。装备必须显式切换。" },
      { title: "远征并留下退路", text: "携带水、食物、绷带和照明；沿路搭建火把路标或前哨，休息和任务进度会建立恢复点。" },
    ],
    controls: [
      { input: "W / A / S / D", action: "移动" },
      { input: "Shift", action: "冲刺（消耗更多耐力与水分）" },
      { input: "鼠标", action: "观察 / 瞄准" },
      { input: "E", action: "交互、采集、调查或执行当前动作" },
      { input: "F", action: "手表：时间、天气、营养" },
      { input: "Tab", action: "背包" },
      { input: "C", action: "制作与建造" },
      { input: "B", action: "身体检查与治疗" },
      { input: "N", action: "笔记、任务与日志" },
      { input: "M", action: "地图与地标" },
      { input: "1–5", action: "装备石斧、石矛、石刃、石镐或火把" },
      { input: "Q", action: "收起当前装备" },
      { input: "Esc", action: "逐层关闭界面、取消建造或暂停" },
      { input: "相同系统键", action: "再次按下会关闭当前系统面板" },
      { input: "移动端", action: "左侧移动、右侧观察、动作键交互；菜单可达全部 7 个系统和装备槽" },
    ],
    interactionRules: [
      { title: "看起来相同，基础动词就应相同", text: "离散树、岩体和资源植物由语义实体生成。工具不足时会显示缺失条件，而不是静默失效。" },
      { title: "装饰地被不会聚焦", text: "微型地被、远景和气氛对象属于 never-focus；如果大型独立植物看起来像资源却不可交互，应视为视觉语义缺陷。" },
      { title: "持有不等于装备", text: "工具必须在装备栏明确切换；交互提示会区分未拥有与未装备。" },
      { title: "世界会记住处理结果", text: "砍树、岩体耗尽、植物再生、动物尸体、建筑、营火与任务改变都进入存档或确定性差量。" },
    ],
    survivalSystems: [
      { id: "vitals", title: "生命、耐力、能量与理智", text: "移动和冲刺消耗体力；缺水、饥饿、感染、寄生虫、潮湿与伤害会形成分级警告。生命或理智归零都会失败。" },
      { id: "nutrition", title: "四类营养", text: "碳水、蛋白、脂肪和水分独立下降。食物只补充它声明的营养，寄生虫会加速水分与蛋白消耗。" },
      { id: "wound", title: "伤口与感染", text: "开放伤口会在潮湿与低蛋白时更难恢复；绷带关闭伤口并降低感染，长期感染会持续伤害。" },
      { id: "wetness", title: "雨、水与潮湿", text: "淋雨、涉水增加潮湿；棚、营火和干燥环境帮助恢复。严重潮湿会产生状态压力。" },
      { id: "parasites", title: "寄生虫", text: "直接饮用脏水存在感染概率，最多 3 层；驱虫草每次去除 1 层。" },
      { id: "time", title: "时间节奏", text: `一个游戏日对应 ${GAME_DAY_SIMULATION_SECONDS / 60} 个真实分钟，开局为 ${START_MINUTE_OF_DAY / 60}:00；一次休息推进 ${REST_GAME_HOURS} 个游戏小时。` },
    ],
    saveSystem: {
      manualSlots: MANUAL_CHECKPOINT_SLOTS.length,
      autoSlots: AUTO_CHECKPOINT_SLOTS.length,
      features: [
        "3 个手动槽与 10 个轮转自动恢复点互不覆盖。",
        "新周目、休息前、休息后、任务里程碑和导入前均可形成校验恢复点。",
        "本地保存先成功，再异步同步 Toy 云；云失败不会回滚本地档。",
        "支持导出文件、导入预览、校验与导入前回退点。",
        "死亡界面推荐最近安全恢复点，也允许选择更早时间线。",
      ],
      source: ["src/game/persistence/checkpointTimeline.ts", "src/game/persistence/saveRepository.ts", "src/game/persistence/saveFile.ts"],
    },
    director: {
      summary: "当前是生态与视野约束下的资源导演，不是完整的敌人/章节难度导演。",
      rules: [
        "每 0.5 个游戏小时评估一次；每个周期最多恢复 1 个已到期、可再生且生态合法的既有节点。",
        "优先恢复未载入区块；活动区节点必须距玩家至少 48 米并位于视线后方，不会当面凭空补给。",
        "以玩家周围 72 米的现有供给、当前任务配方缺口、群系适宜度和逾期时长共同评分。",
        "导演只恢复既有节点，不新建资源点、也不突破节点原容量；最多补算 48 个错过周期。",
        "任务物、稀有物、岩体与树木不走普通资源刷新。",
        "树木拥有独立的树桩→树苗→幼树→成树 7–10 游戏日恢复链。",
      ],
      regeneration,
      source: ["src/game/sim/resourceDirector.ts", "src/game/sim/content.ts", "src/game/sim/treeRegrowth.ts"],
    },
    structures: recipes.filter((recipe) => recipe.structure),
    items,
    recipes,
    tasks,
    biomes,
    plants,
    trees,
    rocks,
    fauna,
    processing: {
      smoking: {
        baseGameHours: SMOKING_RACK_BASE_GAME_HOURS,
        fireRadius: SMOKING_RACK_FIRE_RADIUS,
        biomeRules: entries(SMOKING_RACK_BIOME_RULES).map(([id, rule]) => ({ id, label: BIOME_LABELS[id], ...rule })),
      },
      rainCollector: {
        capacity: RAIN_COLLECTOR_CAPACITY,
        fullRainSecondsPerUnit: RAIN_COLLECTOR_FULL_RAIN_SECONDS_PER_UNIT,
        biomeMultipliers: entries(RAIN_COLLECTOR_BIOME_MULTIPLIERS).map(([id, multiplier]) => ({ id, label: BIOME_LABELS[id], multiplier })),
      },
      torch: {
        segments: TORCH_BURN_SEGMENTS,
        segmentGameHours: TORCH_BURN_SEGMENT_GAME_HOURS,
      },
    },
    faq: [
      { question: "为什么瞄准一株草却没有提示？", answer: "先判断它是否为大型独立资源植物。微型地被本来不交互；但如果轮廓、尺度和资源植物相同却 never-focus，这是视觉语义问题，不是你操作错误。", keywords: ["为什么草不能采", "草不能交互", "草不能收集"] },
      { question: "为什么我有工具却不能砍或挖？", answer: "工具必须明确装备。提示会区分“未拥有”和“未装备”；树通常需要石斧，岩体需要石镐，纤维藤需要石刃。" },
      { question: "为什么缺少干叶、石头或藤条？", answer: "先检查坠落点、河岸、棕榈林和岩石高地。普通资源会在离开视野和保护距离后按随机窗口再生；导演不会当面生成。" },
      { question: "为什么营火点不着？", answer: "需要引火条件和燃料；露天强雨会阻止点火。把营火放进叶棚有效覆盖范围，或等待雨势减弱。" },
      { question: "为什么烟熏停止？", answer: `检查 ${SMOKING_RACK_FIRE_RADIUS} 米内是否有点燃营火、是否暴露在超过群系阈值的雨中，以及肉是否已经腐坏。` },
      { question: "为什么雨水架不工作？", answer: "它必须有开阔天空。棚顶会完全阻挡收集；冠层只降低效率。干旱或容量已满也会停止。" },
      { question: "怎样拆除建错位置的设施？", answer: "瞄准真实放置的空烟熏架或空雨水收集架，PC 按 R、移动端点“拆除”，阅读返还后再次确认。烟熏架必须先收取或清理，雨水架必须先收取全部储水；背包装不下全部返还材料时操作不会开始。" },
      { question: "资源会不会刷新？", answer: "会，但不是整批定点刷新。每个普通资源有随机时间窗、数量和玩家距离约束；任务物不刷新，普通树木走独立慢速生长链。" },
      { question: "死亡以后能回到哪里？", answer: "死亡复盘会推荐最近安全恢复点，也能选择 3 个手动槽和最多 10 个自动恢复点中的更早记录。" },
      { question: "Toy 云失败会不会丢掉刚才的保存？", answer: "本地校验成功优先，云同步异步执行。云失败会显示本地保存状态，但不会撤销已经成功的本地存档。" },
      { question: "哪些章节当前真的能玩？", answer: "序章、A1“河流正在上升”和 A2“林冠没有风”存在代码与测试纵切。A3–A5 仍是规划，不应当作当前任务内容。" },
      { question: "完成 A2 以后算通关了吗？", answer: "不算。A2 完成后任务会清空并继续自由生存，当前没有胜利画面或正式结局；它是现有剧情纵切的终点，不是完整主线终章。" },
    ],
    roadmap: [
      { title: "当前已实现", tone: "ready", items: ["序章求救闭环", "A1 河流水位纵切", "A2 林冠风纵切", "自由重复建造", "空烟熏架与空雨水架拆除并部分返还", "资源导演纵切", "树木分阶段再生", "具身蛇与程序化动物", "本地/云分层存档"] },
      { title: "部分实现", tone: "partial", items: ["完整生态链", "跨资源/威胁/天气的综合导演", "连续三小时内容节奏", "雨林植物加工链", "全面视觉语义一致性"] },
      { title: "尚未实现", tone: "planned", items: ["A3 黑水", "A4 岩岭", "A5 信号选择", "最终 Valheim 启发画面升级", "绳索/高台/完整建筑网络", "多人模式"] },
    ],
    sources: [
      "src/game/sim/content.ts",
      "src/game/sim/simulation.ts",
      "src/game/sim/structureDismantle.ts",
      "src/game/sim/campaignContent.ts",
      "src/game/world/generation.ts",
      "src/game/world/semanticGeneration.ts",
      "src/game/ecology/species.ts",
      "src/game/persistence/checkpointTimeline.ts",
      "docs/PLAYER_FEEDBACK_REQUIREMENTS_MATRIX.md",
      "docs/RELEASE_REPORT.md",
    ],
  };
}

export type CanopyWikiData = ReturnType<typeof createWikiData>;
