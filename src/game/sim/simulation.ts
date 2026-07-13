import { ITEMS, RECIPES, TASKS, TASK_SEQUENCE } from "./content";
import { drawRandom } from "./rng";
import {
  canCraft,
  distanceBetween,
  getDiscoveredRecipeIds,
  getTimeOfDayHours,
  hasInspectedLandmark,
  isAtCamp,
} from "./selectors";
import { cloneGameState } from "./state";
import { ITEM_IDS } from "./types";
import type {
  EventDetailValue,
  GameCommand,
  GameEvent,
  GameEventCause,
  GameEventType,
  GameState,
  ItemId,
  MovementInput,
  NutritionDelta,
  SimulationInput,
  Vec3,
} from "./types";

export const FIXED_HZ = 30;
export const FIXED_DT_SECONDS = 1 / FIXED_HZ;
export const MAX_EVENT_LOG = 256;

const WALK_SPEED = 2.7;
const SPRINT_SPEED = 4.8;
const STREAM_PARASITE_CHANCE = 0.56;
const FIRE_RAIN_EXPOSURE_LIMIT = 4.5;
const DAY_LENGTH_SECONDS = 20 * 60;

interface EventInput {
  type: GameEventType;
  message: string;
  cause: GameEventCause;
  details?: Record<string, EventDetailValue>;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function moveTowards(current: number, target: number, maximumDelta: number): number {
  if (Math.abs(target - current) <= maximumDelta) return target;
  return current + Math.sign(target - current) * maximumDelta;
}

function appendEvent(state: GameState, event: EventInput): GameEvent {
  const entry: GameEvent = {
    id: state.nextEventId,
    tick: state.clock.tick,
    elapsedSeconds: state.clock.elapsedSeconds,
    ...event,
  };
  state.nextEventId += 1;
  state.eventLog.push(entry);
  if (state.eventLog.length > MAX_EVENT_LOG) {
    state.eventLog.splice(0, state.eventLog.length - MAX_EVENT_LOG);
  }
  return entry;
}

function rejectCommand(
  state: GameState,
  command: GameCommand,
  message: string,
  details?: Record<string, EventDetailValue>,
): void {
  appendEvent(state, {
    type: "command-rejected",
    message,
    cause: { source: "command", code: command.type },
    details,
  });
}

function addInventory(state: GameState, itemId: ItemId, amount: number): number {
  const accepted = Math.max(
    0,
    Math.min(amount, ITEMS[itemId].stackLimit - state.inventory[itemId]),
  );
  state.inventory[itemId] += accepted;
  return accepted;
}

function isPositionValid(position: Vec3): boolean {
  return [position.x, position.y, position.z].every(Number.isFinite);
}

function setPlayerPosition(state: GameState, position: Vec3): void {
  state.player.position = {
    x: clamp(position.x, state.world.bounds.minX, state.world.bounds.maxX),
    y: clamp(position.y, -20, 50),
    z: clamp(position.z, state.world.bounds.minZ, state.world.bounds.maxZ),
  };
}

function applyNutritionDelta(state: GameState, delta: NutritionDelta): void {
  const nutrition = state.player.nutrition;
  nutrition.carbohydrates += delta.carbohydrates ?? 0;
  nutrition.protein += delta.protein ?? 0;
  nutrition.fat += delta.fat ?? 0;
  nutrition.hydration += delta.hydration ?? 0;
}

function effectAlreadyBuilt(state: GameState, effect: string): boolean {
  if (effect === "build-fire") return state.camp.fire.built;
  if (effect === "build-shelter") return state.camp.shelterBuilt;
  if (effect === "build-bed") return state.camp.bedBuilt;
  if (effect === "build-beacon") return state.camp.beaconBuilt;
  return false;
}

function applyRecipeEffect(state: GameState, effect: string | undefined): void {
  if (!effect || effectAlreadyBuilt(state, effect)) return;
  if (effect === "build-fire") {
    state.camp.fire.built = true;
    state.camp.fire.lit = true;
    state.camp.fire.fuelSeconds = 180;
    state.camp.fire.rainExposure = 0;
    state.camp.fire.sheltered = state.camp.shelterBuilt;
    appendEvent(state, {
      type: "fire-lit",
      message: "干叶接住火星，营火开始燃烧。",
      cause: { source: "command", code: "craft:campfire" },
    });
  } else if (effect === "build-shelter") {
    state.camp.shelterBuilt = true;
    state.camp.fire.sheltered = state.camp.fire.built;
  } else if (effect === "build-bed") {
    state.camp.bedBuilt = true;
  } else if (effect === "build-beacon") {
    state.camp.beaconBuilt = true;
  }
}

function refreshCampObjective(state: GameState): void {
  if (
    state.camp.fire.built &&
    state.camp.fire.lit &&
    state.camp.shelterBuilt &&
    state.camp.bedBuilt &&
    state.eventLog.some((event) => event.type === "rest-completed")
  ) {
    state.objectives.flags.campEstablished = true;
  }
}

/**
 * Resolves useful field work immediately for the player while allowing weather,
 * fire, wounds and metabolism to react to the time the work represents.
 */
function advanceWorkTime(state: GameState, seconds: number): void {
  const ticks = Math.max(0, Math.round(seconds * FIXED_HZ));
  for (let index = 0; index < ticks && state.status === "playing"; index += 1) {
    runFixedTick(state, undefined);
  }
}

function harvestLimit(state: GameState, itemId: ItemId): number {
  const axeHarvest = new Set<ItemId>(["stick", "vine", "broad-leaf", "dry-leaf"]);
  return axeHarvest.has(itemId) && state.inventory.axe > 0 ? 3 : 1;
}

function harvestWorkSeconds(state: GameState, itemId: ItemId, amount: number): number {
  if (itemId === "battery") return 12;
  if (itemId === "stone") return 8 * amount;
  if (["stick", "vine", "broad-leaf", "dry-leaf"].includes(itemId)) {
    return state.inventory.axe > 0 ? 5 + amount * 2 : 7 * amount;
  }
  return 5 * amount;
}

function completeAvailableTasks(state: GameState, causeCode: string): void {
  let currentTaskId = state.objectives.currentTaskId;
  while (currentTaskId) {
    const task = TASKS[currentTaskId];
    if (!state.objectives.flags[task.flag]) break;

    if (!state.objectives.completedTaskIds.includes(currentTaskId)) {
      state.objectives.completedTaskIds.push(currentTaskId);
      appendEvent(state, {
        type: "task-completed",
        message: `任务完成：${task.label}`,
        cause: { source: "system", code: `objective:${causeCode}` },
        details: { taskId: currentTaskId },
      });
    }

    const currentIndex = TASK_SEQUENCE.indexOf(currentTaskId);
    currentTaskId = TASK_SEQUENCE[currentIndex + 1] ?? null;
    state.objectives.currentTaskId = currentTaskId;
  }

  if (
    state.objectives.currentTaskId === null &&
    state.objectives.flags.transmitted &&
    state.status === "playing"
  ) {
    state.status = "won";
    appendEvent(state, {
      type: "game-won",
      message: "求救信号穿过暴雨。远处传来了应答。",
      cause: { source: "system", code: "objective-chain-complete" },
      details: { elapsedSeconds: state.clock.elapsedSeconds },
    });
  }
}

function announceRecipeDiscoveries(state: GameState): void {
  const announced = new Set(
    state.eventLog
      .filter((event) => event.type === "recipe-discovered")
      .map((event) => event.details?.recipeId)
      .filter((recipeId): recipeId is string => typeof recipeId === "string"),
  );
  for (const recipeId of getDiscoveredRecipeIds(state)) {
    if (recipeId === "stone-blade" || announced.has(recipeId)) continue;
    announced.add(recipeId);
    appendEvent(state, {
      type: "recipe-discovered",
      message: `观察材料后，你在笔记里记下了新配方：${RECIPES[recipeId].label}。`,
      cause: { source: "system", code: `knowledge:${recipeId}` },
      details: { recipeId },
    });
  }
}

function handlePickUp(
  state: GameState,
  command: Extract<GameCommand, { type: "pick-up" }>,
): void {
  const entity = state.world.entities[command.entityId];
  if (!entity || entity.depleted || !entity.itemId || entity.kind !== "resource") {
    rejectCommand(state, command, "这里已经没有可拾取的资源。", {
      entityId: command.entityId,
    });
    return;
  }
  if (
    distanceBetween(state.player.position, entity.position) > entity.interactRadius
  ) {
    rejectCommand(state, command, "距离资源太远。", { entityId: entity.id });
    return;
  }

  if (entity.itemId === "battery") {
    const missingClue = [
      "landmark.camp-radio",
      "landmark.survey-cache",
      "landmark.weather-station",
    ].find((entityId) => !hasInspectedLandmark(state, entityId));
    if (!state.objectives.flags.campEstablished) {
      rejectCommand(state, command, "先证明营地能安全度过一次休息，再拆下远征唯一电源。", {
        entityId: entity.id,
      });
      return;
    }
    if (missingClue) {
      rejectCommand(state, command, "线路与固定结构还没有调查清楚，直接拆卸可能毁掉电池。", {
        entityId: entity.id,
        missingClue,
      });
      return;
    }
    if (state.inventory.axe <= 0) {
      rejectCommand(state, command, "锈死的电池托架需要石斧撬开。", {
        entityId: entity.id,
        requiredItem: "axe",
      });
      return;
    }
  }

  const requestedAmount = Math.floor(command.amount ?? 1);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    rejectCommand(state, command, "拾取数量无效。", { entityId: entity.id });
    return;
  }

  const perActionLimit = harvestLimit(state, entity.itemId);
  const availableAmount = Math.min(requestedAmount, entity.quantity, perActionLimit);
  const acceptedAmount = Math.max(
    0,
    Math.min(availableAmount, ITEMS[entity.itemId].stackLimit - state.inventory[entity.itemId]),
  );
  if (acceptedAmount <= 0) {
    rejectCommand(state, command, "背包中没有足够空间。", {
      itemId: entity.itemId,
    });
    return;
  }


  const workSeconds = harvestWorkSeconds(state, entity.itemId, acceptedAmount);
  advanceWorkTime(state, workSeconds);
  if (state.status !== "playing") return;
  addInventory(state, entity.itemId, acceptedAmount);

  entity.quantity -= acceptedAmount;
  entity.depleted = entity.quantity <= 0;
  if (entity.depleted) entity.quantity = 0;

  appendEvent(state, {
    type: "resource-picked",
    message: `拾取 ${ITEMS[entity.itemId].label} ×${acceptedAmount}。`,
    cause: { source: "command", code: "pick-up" },
    details: {
      entityId: entity.id,
      itemId: entity.itemId,
      amount: acceptedAmount,
      remaining: entity.quantity,
      depleted: entity.depleted,
      harvestLimit: perActionLimit,
      workSeconds,
    },
  });

  if (entity.itemId === "battery") {
    state.objectives.flags.batteryRecovered = true;
  }
  announceRecipeDiscoveries(state);
}

function handleInspectLandmark(
  state: GameState,
  command: Extract<GameCommand, { type: "inspect-landmark" }>,
): void {
  const entity = state.world.entities[command.entityId];
  if (!entity || (entity.kind !== "landmark" && entity.kind !== "radio")) {
    rejectCommand(state, command, "这里没有可调查的地标。", { entityId: command.entityId });
    return;
  }
  if (distanceBetween(state.player.position, entity.position) > entity.interactRadius) {
    rejectCommand(state, command, "需要靠近后才能仔细调查。", { entityId: entity.id });
    return;
  }
  if (hasInspectedLandmark(state, entity.id)) {
    rejectCommand(state, command, "这处线索已经记录在笔记里。", { entityId: entity.id });
    return;
  }
  if (
    entity.id === "landmark.weather-station" &&
    (!hasInspectedLandmark(state, "landmark.camp-radio") ||
      !hasInspectedLandmark(state, "landmark.survey-cache"))
  ) {
    rejectCommand(state, command, "缺少电台故障记录与勘测坐标，无法判断该从哪组设备入手。", {
      entityId: entity.id,
    });
    return;
  }

  const workSeconds = 12;
  advanceWorkTime(state, workSeconds);
  if (state.status !== "playing") return;
  const message =
    entity.id === "landmark.camp-radio"
      ? "拆开电台后确认：发射机仍能工作，缺少的是气象站制式电池；旧航线指向西北岩棚。"
      : entity.id === "landmark.survey-cache"
        ? "勘测箱里的防水图标出了气象站坐标，以及一条避开沼地的山脊路线。"
        : "气象站控制柜仍有余电。电池托架已经锈死，可以用石斧从侧面撬开。";
  appendEvent(state, {
    type: "landmark-inspected",
    message,
    cause: { source: "command", code: `inspect:${entity.id}` },
    details: { entityId: entity.id, workSeconds },
  });
}

function handleCraft(
  state: GameState,
  command: Extract<GameCommand, { type: "craft" }>,
): void {
  const check = canCraft(state, command.recipeId);
  const recipe = RECIPES[command.recipeId];
  if (!check.ok) {
    const missingItems = Object.entries(check.missingItems)
      .map(([itemId, amount]) => `${itemId}:${amount}`)
      .join(",");
    appendEvent(state, {
      type: "craft-failed",
      message: `无法制作${recipe?.label ?? command.recipeId}。`,
      cause: { source: "command", code: `craft:${command.recipeId}` },
      details: {
        recipeId: command.recipeId,
        reason: check.reason ?? "missing-materials",
        missingItems,
        missingTools: check.missingTools.join(","),
      },
    });
    return;
  }

  for (const [itemId, amount] of Object.entries(recipe.ingredients) as [
    ItemId,
    number,
  ][]) {
    state.inventory[itemId] -= amount;
  }
  advanceWorkTime(state, recipe.workSeconds);
  if (state.status !== "playing") return;
  for (const [itemId, amount] of Object.entries(recipe.results ?? {}) as [
    ItemId,
    number,
  ][]) {
    state.inventory[itemId] += amount;
  }
  applyRecipeEffect(state, recipe.effect);

  appendEvent(state, {
    type: "craft-succeeded",
    message: `完成制作：${recipe.label}。`,
    cause: { source: "command", code: `craft:${recipe.id}` },
    details: { recipeId: recipe.id, workSeconds: recipe.workSeconds },
  });
  announceRecipeDiscoveries(state);
  refreshCampObjective(state);
}

function handleUseItem(
  state: GameState,
  command: Extract<GameCommand, { type: "use-item" }>,
): void {
  if (state.inventory[command.itemId] <= 0) {
    rejectCommand(state, command, `没有可用的${ITEMS[command.itemId].label}。`, {
      itemId: command.itemId,
    });
    return;
  }

  if (command.itemId === "bandage" && !state.player.conditions.wound.open) {
    rejectCommand(state, command, "当前没有需要包扎的开放伤口。");
    return;
  }
  if (command.itemId === "antiparasitic-herb" && state.player.conditions.parasites <= 0) {
    rejectCommand(state, command, "目前没有检测到寄生虫。");
    return;
  }
  advanceWorkTime(state, 8);
  if (state.status !== "playing") return;

  if (command.itemId === "bandage") {
    const wound = state.player.conditions.wound;
    state.inventory.bandage -= 1;
    wound.open = false;
    wound.treated = true;
    wound.severity = Math.max(0, wound.severity - 16);
    wound.infection = Math.max(0, wound.infection - 6);
    state.player.vitals.health += 6;
    state.player.vitals.sanity += 4;
    state.objectives.flags.woundTreated = true;
    appendEvent(state, {
      type: "wound-treated",
      message: "草药绷带压住伤口，出血终于停止。",
      cause: { source: "command", code: "use-item:bandage" },
    });
  } else {
    state.inventory["antiparasitic-herb"] -= 1;
    state.player.conditions.parasites -= 1;
    appendEvent(state, {
      type: "parasite-cleared",
      message: "苦味草药缓解了腹部绞痛。",
      cause: { source: "command", code: "use-item:antiparasitic-herb" },
      details: { remaining: state.player.conditions.parasites },
    });
  }

  appendEvent(state, {
    type: "item-used",
    message: `使用了${ITEMS[command.itemId].label}。`,
    cause: { source: "command", code: command.type },
    details: { itemId: command.itemId },
  });
}

function handleEat(
  state: GameState,
  command: Extract<GameCommand, { type: "eat" }>,
): void {
  const definition = ITEMS[command.itemId];
  if (state.inventory[command.itemId] <= 0 || !definition.edible) {
    rejectCommand(state, command, "该物品不能食用或数量不足。", {
      itemId: command.itemId,
    });
    return;
  }
  advanceWorkTime(state, 5);
  if (state.status !== "playing") return;
  state.inventory[command.itemId] -= 1;
  applyNutritionDelta(state, definition.edible);
  state.player.vitals.energy += definition.edible.energy ?? 0;
  state.player.vitals.sanity += definition.edible.sanity ?? 0;
  appendEvent(state, {
    type: "item-used",
    message: `食用了${definition.label}。`,
    cause: { source: "command", code: "eat" },
    details: { itemId: command.itemId },
  });
}

function availableWaterContainerCount(state: GameState): number {
  return Math.max(
    0,
    state.inventory["coconut-shell"] -
      state.inventory["dirty-water"] -
      state.inventory["clean-water"],
  );
}

function handleCollectWater(
  state: GameState,
  command: Extract<GameCommand, { type: "collect-water" }>,
): void {
  const source = state.world.entities[command.sourceEntityId];
  if (!source || source.kind !== "water") {
    rejectCommand(state, command, "没有找到可取水的水源。", {
      entityId: command.sourceEntityId,
    });
    return;
  }
  if (distanceBetween(state.player.position, source.position) > source.interactRadius) {
    rejectCommand(state, command, "距离水源太远。", { entityId: source.id });
    return;
  }
  if (availableWaterContainerCount(state) <= 0) {
    rejectCommand(state, command, "需要一个空椰壳容器。", {
      requiredItem: "coconut-shell",
    });
    return;
  }
  advanceWorkTime(state, 10);
  if (state.status !== "playing") return;
  state.inventory["dirty-water"] += 1;
  appendEvent(state, {
    type: "water-collected",
    message: "椰壳里盛满了浑浊溪水。",
    cause: { source: "command", code: "collect-water" },
    details: { sourceEntityId: source.id, contamination: source.contamination ?? 0.5 },
  });
}

function handleCollectRainwater(
  state: GameState,
  command: Extract<GameCommand, { type: "collect-rainwater" }>,
): void {
  if (state.weather.rainIntensity < 0.35) {
    rejectCommand(state, command, "雨势太小，暂时接不到足量雨水。");
    return;
  }
  if (availableWaterContainerCount(state) <= 0) {
    rejectCommand(state, command, "需要一个空椰壳容器。", {
      requiredItem: "coconut-shell",
    });
    return;
  }
  advanceWorkTime(state, 12);
  if (state.status !== "playing") return;
  state.inventory["clean-water"] += 1;
  appendEvent(state, {
    type: "water-collected",
    message: "椰壳接到了一份干净雨水。",
    cause: { source: "command", code: "collect-rainwater" },
    details: { clean: true },
  });
}

function handleBoilWater(
  state: GameState,
  command: Extract<GameCommand, { type: "boil-water" }>,
): void {
  if (!state.camp.fire.lit) {
    rejectCommand(state, command, "需要燃烧中的营火才能煮水。");
    return;
  }
  if (state.inventory["dirty-water"] <= 0) {
    rejectCommand(state, command, "没有需要煮沸的溪水。");
    return;
  }
  advanceWorkTime(state, 45);
  if (state.status !== "playing") return;
  if (!state.camp.fire.lit) {
    rejectCommand(state, command, "煮水途中营火熄灭了；补充燃料后再试。", {
      interrupted: true,
    });
    return;
  }
  state.inventory["dirty-water"] -= 1;
  state.inventory["clean-water"] += 1;
  appendEvent(state, {
    type: "water-purified",
    message: "水面持续翻滚，寄生虫风险被消除。",
    cause: { source: "command", code: "boil-water" },
  });
}

function handleDrinkWater(
  state: GameState,
  command: Extract<GameCommand, { type: "drink-water" }>,
): void {
  if (state.inventory[command.itemId] <= 0) {
    rejectCommand(state, command, "没有可饮用的水。", {
      itemId: command.itemId,
    });
    return;
  }
  advanceWorkTime(state, 4);
  if (state.status !== "playing") return;
  state.inventory[command.itemId] -= 1;
  state.player.nutrition.hydration += command.itemId === "clean-water" ? 34 : 28;
  if (command.itemId === "clean-water") state.objectives.flags.waterPurified = true;

  let contractedParasite = false;
  if (command.itemId === "dirty-water") {
    const riskRoll = drawRandom(state.rng, "conditions");
    if (
      riskRoll < STREAM_PARASITE_CHANCE &&
      state.player.conditions.parasites < 3
    ) {
      state.player.conditions.parasites += 1;
      contractedParasite = true;
      appendEvent(state, {
        type: "parasite-contracted",
        message: "腹部突然绞痛，浑水带来了寄生虫。",
        cause: { source: "command", code: "drink-water:dirty" },
        details: { parasites: state.player.conditions.parasites, riskRoll },
      });
    }
  }

  appendEvent(state, {
    type: "water-drunk",
    message:
      command.itemId === "clean-water"
        ? "煮沸后的水恢复了体力。"
        : "浑水暂时缓解了口渴。",
    cause: { source: "command", code: `drink-water:${command.itemId}` },
    details: { itemId: command.itemId, contractedParasite },
  });
}

function handleAddFuel(
  state: GameState,
  command: Extract<GameCommand, { type: "add-fuel" }>,
): void {
  if (!state.camp.fire.built) {
    rejectCommand(state, command, "营地里还没有火堆。");
    return;
  }
  if (state.inventory.stick <= 0) {
    rejectCommand(state, command, "需要一根木棍添火。");
    return;
  }
  const relighting = !state.camp.fire.lit;
  if (relighting && state.inventory["dry-leaf"] <= 0) {
    rejectCommand(state, command, "熄灭的火堆需要干叶引火。");
    return;
  }
  if (
    relighting &&
    state.weather.rainIntensity >= 0.8 &&
    !state.camp.fire.sheltered
  ) {
    rejectCommand(state, command, "暴雨中无法重新点燃露天火堆。");
    return;
  }

  advanceWorkTime(state, 6);
  if (state.status !== "playing") return;

  state.inventory.stick -= 1;
  if (relighting) state.inventory["dry-leaf"] -= 1;
  state.camp.fire.fuelSeconds = Math.min(300, state.camp.fire.fuelSeconds + 55);
  state.camp.fire.rainExposure = 0;
  state.camp.fire.lit = true;
  appendEvent(state, {
    type: "fuel-added",
    message: relighting ? "火堆重新燃烧起来。" : "营火又添了一根木柴。",
    cause: { source: "command", code: "add-fuel" },
    details: { relit: relighting, fuelSeconds: state.camp.fire.fuelSeconds },
  });
  if (relighting) {
    appendEvent(state, {
      type: "fire-lit",
      message: "余烬重新接住了火苗。",
      cause: { source: "command", code: "add-fuel" },
    });
  }
  refreshCampObjective(state);
}

function handleTransmit(
  state: GameState,
  command: Extract<GameCommand, { type: "transmit" }>,
): void {
  if (!isAtCamp(state)) {
    rejectCommand(state, command, "必须回到营地电台旁才能发报。");
    return;
  }
  if (!state.camp.beaconBuilt) {
    rejectCommand(state, command, "求救信标还没有修复。");
    return;
  }
  if (state.objectives.currentTaskId !== "transmit-signal") {
    rejectCommand(state, command, "还没有完成发送信号前的生存任务。");
    return;
  }
  advanceWorkTime(state, 18);
  if (state.status !== "playing") return;
  state.objectives.flags.transmitted = true;
}

function handleHazardEncounter(
  state: GameState,
  command: Extract<GameCommand, { type: "encounter-hazard" }>,
): void {
  const entity = state.world.entities[command.entityId];
  if (!entity || entity.kind !== "hazard" || entity.depleted) {
    rejectCommand(state, command, "危险已经离开。", { entityId: command.entityId });
    return;
  }
  if (distanceBetween(state.player.position, entity.position) > entity.interactRadius) {
    rejectCommand(state, command, "危险仍在远处。", { entityId: entity.id });
    return;
  }

  advanceWorkTime(state, 3);
  if (state.status !== "playing") return;

  entity.depleted = true;
  entity.quantity = 0;
  if (state.inventory.spear > 0) {
    state.player.vitals.stamina = clamp(state.player.vitals.stamina - 5);
    state.player.vitals.sanity = clamp(state.player.vitals.sanity + 2);
    appendEvent(state, {
      type: "threat-avoided",
      message: "嘶声从脚边炸开。石矛逼退了眼镜蛇。",
      cause: { source: "command", code: "hazard:snake:spear" },
      details: { entityId: entity.id },
    });
    return;
  }

  const wound = state.player.conditions.wound;
  wound.open = true;
  wound.treated = false;
  wound.severity = clamp(wound.severity + 20);
  wound.infection = clamp(wound.infection + 4);
  state.player.vitals.health = clamp(state.player.vitals.health - 12);
  state.player.vitals.sanity = clamp(state.player.vitals.sanity - 8);
  appendEvent(state, {
    type: "snake-bite",
    message: "眼镜蛇咬中你伸出的左臂。没有长矛，伤口重新成为最高优先级。",
    cause: { source: "command", code: "hazard:snake:bite" },
    details: { entityId: entity.id, healthLost: 12 },
  });
}

function handleRest(
  state: GameState,
  command: Extract<GameCommand, { type: "rest" }>,
): void {
  if (!isAtCamp(state) || !state.camp.bedBuilt) {
    rejectCommand(state, command, "需要回到营地的棕榈床才能休息。");
    return;
  }

  const restSeconds = 25;
  state.player.nutrition.hydration -= 8;
  state.player.nutrition.carbohydrates -= 5;
  state.player.nutrition.protein -= 2;
  state.player.nutrition.fat -= 3;
  state.player.vitals.energy += 30;
  state.player.vitals.stamina = 100;
  state.player.vitals.sanity += state.camp.fire.lit ? 12 : 6;
  state.player.conditions.wetness -= state.camp.shelterBuilt ? 24 : 8;
  if (state.player.conditions.wound.open) state.player.conditions.wound.infection += 2;
  updateFire(state, restSeconds);
  state.clock.tick += restSeconds * FIXED_HZ;
  state.clock.remainderSeconds = 0;
  state.clock.elapsedSeconds = state.clock.tick * FIXED_DT_SECONDS;
  const totalMinutes = 14 * 60 + (state.clock.elapsedSeconds / DAY_LENGTH_SECONDS) * 1440;
  state.clock.day = Math.floor(totalMinutes / 1440) + 1;
  state.clock.minuteOfDay = totalMinutes % 1440;
  normalizeState(state);
  appendEvent(state, {
    type: "rest-completed",
    message: "离开湿地休息了片刻。能量恢复，但饥渴继续累积。",
    cause: { source: "command", code: "rest:leaf-bed" },
    details: { restSeconds },
  });
}

function applyCommandMutable(state: GameState, command: GameCommand): void {
  if (state.status !== "playing") return;

  switch (command.type) {
    case "move-player":
      if (!isPositionValid(command.position)) {
        rejectCommand(state, command, "玩家坐标无效。");
      } else {
        setPlayerPosition(state, command.position);
      }
      break;
    case "pick-up":
      handlePickUp(state, command);
      break;
    case "inspect-landmark":
      handleInspectLandmark(state, command);
      break;
    case "craft":
      handleCraft(state, command);
      break;
    case "use-item":
      handleUseItem(state, command);
      break;
    case "eat":
      handleEat(state, command);
      break;
    case "collect-water":
      handleCollectWater(state, command);
      break;
    case "collect-rainwater":
      handleCollectRainwater(state, command);
      break;
    case "boil-water":
      handleBoilWater(state, command);
      break;
    case "drink-water":
      handleDrinkWater(state, command);
      break;
    case "add-fuel":
      handleAddFuel(state, command);
      break;
    case "encounter-hazard":
      handleHazardEncounter(state, command);
      break;
    case "rest":
      handleRest(state, command);
      break;
    case "transmit":
      handleTransmit(state, command);
      break;
  }

  normalizeState(state);
  refreshCampObjective(state);
  completeAvailableTasks(state, command.type);
  checkTerminalState(state);
}

/** Applies one discrete action without mutating the supplied state. */
export function applyCommand(state: GameState, command: GameCommand): GameState {
  const nextState = cloneGameState(state);
  applyCommandMutable(nextState, command);
  return nextState;
}

function updateClock(state: GameState): void {
  state.clock.tick += 1;
  state.clock.elapsedSeconds = state.clock.tick * FIXED_DT_SECONDS;
  const totalMinutes = 14 * 60 + (state.clock.elapsedSeconds / DAY_LENGTH_SECONDS) * 1440;
  state.clock.day = Math.floor(totalMinutes / 1440) + 1;
  state.clock.minuteOfDay = totalMinutes % 1440;
}

function updateMovement(
  state: GameState,
  movement: MovementInput | undefined,
  dt: number,
): void {
  const x = movement?.x ?? 0;
  const z = movement?.z ?? 0;
  const magnitude = Math.hypot(x, z);
  const moving = magnitude > 0.0001;
  const sprinting = Boolean(
    moving && movement?.sprint && state.player.vitals.stamina > 1,
  );

  if (moving) {
    const speed = sprinting ? SPRINT_SPEED : WALK_SPEED;
    const scale = speed * dt / Math.max(1, magnitude);
    setPlayerPosition(state, {
      x: state.player.position.x + x * scale,
      y: state.player.position.y,
      z: state.player.position.z + z * scale,
    });
    state.player.vitals.stamina -= (sprinting ? 10 : 1.2) * dt;
    state.player.vitals.energy -= (sprinting ? 0.035 : 0.012) * dt;
  } else {
    const carbohydrateFactor = 0.3 + state.player.nutrition.carbohydrates / 140;
    const recovery = 7 * (0.25 + state.player.vitals.energy / 150) * carbohydrateFactor;
    state.player.vitals.stamina += recovery * dt;
  }
}

function updateWeather(state: GameState, dt: number): void {
  state.weather.secondsUntilChange -= dt;
  if (state.weather.secondsUntilChange <= 0) {
    const weatherRoll = drawRandom(state.rng, "weather");
    const durationRoll = drawRandom(state.rng, "weather");
    state.weather.targetRainIntensity =
      weatherRoll < 0.28 ? 0.05 : weatherRoll < 0.64 ? 0.46 : 0.9;
    state.weather.secondsUntilChange = 45 + Math.floor(durationRoll * 61);
    appendEvent(state, {
      type: "weather-changed",
      message:
        state.weather.targetRainIntensity >= 0.72
          ? "树冠上方传来雷声，暴雨正在逼近。"
          : state.weather.targetRainIntensity >= 0.3
            ? "雨势重新变得密集。"
            : "雨声逐渐减弱。",
      cause: { source: "system", code: "weather-front" },
      details: {
        targetRainIntensity: state.weather.targetRainIntensity,
        durationSeconds: state.weather.secondsUntilChange,
      },
    });
  }

  state.weather.rainIntensity = moveTowards(
    state.weather.rainIntensity,
    state.weather.targetRainIntensity,
    0.055 * dt,
  );
  state.weather.storm = state.weather.rainIntensity >= 0.72;
}

function extinguishFire(state: GameState, code: string, message: string): void {
  if (!state.camp.fire.lit) return;
  state.camp.fire.lit = false;
  state.camp.fire.rainExposure = 0;
  appendEvent(state, {
    type: "fire-extinguished",
    message,
    cause: { source: "system", code },
  });
}

function updateFire(state: GameState, dt: number): void {
  const fire = state.camp.fire;
  fire.sheltered = fire.built && state.camp.shelterBuilt;
  if (!fire.lit) return;

  fire.fuelSeconds -= dt * (1 + state.weather.rainIntensity * 0.15);
  if (!fire.sheltered && state.weather.rainIntensity > 0.5) {
    fire.rainExposure +=
      (state.weather.rainIntensity - 0.5) * 1.4 * dt;
  } else {
    fire.rainExposure = Math.max(0, fire.rainExposure - 0.8 * dt);
  }

  if (fire.fuelSeconds <= 0) {
    fire.fuelSeconds = 0;
    extinguishFire(state, "fuel-exhausted", "最后一截木柴化成了灰，营火熄灭。");
  } else if (fire.rainExposure >= FIRE_RAIN_EXPOSURE_LIMIT) {
    extinguishFire(state, "rain-exposure", "暴雨浇灭了没有遮蔽的营火。");
  }
}

function updateWetness(state: GameState, movement: MovementInput | undefined, dt: number): void {
  const shelteredAtCamp = (state.camp.shelterBuilt && isAtCamp(state)) || Boolean(movement?.sheltered);
  const nearFire = state.camp.fire.lit && isAtCamp(state);
  if (!shelteredAtCamp) {
    state.player.conditions.wetness += state.weather.rainIntensity * 0.12 * dt;
  } else {
    state.player.conditions.wetness -= 0.055 * dt;
  }
  if (movement?.inWater) state.player.conditions.wetness += 1.8 * dt;
  if (state.weather.rainIntensity < 0.1) {
    state.player.conditions.wetness -= 0.02 * dt;
  }
  if (nearFire) state.player.conditions.wetness -= 0.14 * dt;
}

function updateMetabolism(state: GameState, dt: number): void {
  const { nutrition, vitals, conditions } = state.player;
  nutrition.carbohydrates -= 0.015 * dt;
  nutrition.protein -= 0.0075 * dt;
  nutrition.fat -= 0.0065 * dt;
  nutrition.hydration -= (0.045 + conditions.parasites * 0.009) * dt;
  const fatEfficiency = 1.25 - nutrition.fat / 200;
  vitals.energy -= (0.008 + conditions.parasites * 0.006) * fatEfficiency * dt;

  if (conditions.wound.open) {
    const proteinPenalty = 1.35 - nutrition.protein / 200;
    conditions.wound.infection +=
      (0.006 + conditions.wetness * 0.00009) * proteinPenalty * dt;
    vitals.health -=
      (0.008 +
        conditions.wound.severity * 0.00016 +
        conditions.wound.infection * 0.00022) *
      dt;
  } else {
    const proteinRecovery = 0.35 + nutrition.protein / 100;
    conditions.wound.infection -= 0.004 * proteinRecovery * dt;
    conditions.wound.severity -= 0.006 * proteinRecovery * dt;
  }

  if (conditions.parasites > 0) {
    nutrition.protein -= conditions.parasites * 0.004 * dt;
    vitals.sanity -= conditions.parasites * 0.005 * dt;
  }
  if (nutrition.hydration <= 0) vitals.health -= 0.14 * dt;
  const emptyMacroCount = [
    nutrition.carbohydrates,
    nutrition.protein,
    nutrition.fat,
  ].filter((value) => value <= 0).length;
  vitals.health -= emptyMacroCount * 0.035 * dt;
  if (vitals.energy <= 0) vitals.health -= 0.04 * dt;
  if (conditions.wetness >= 75) {
    vitals.energy -= 0.012 * dt;
    vitals.sanity -= 0.004 * dt;
  }

  const hour = getTimeOfDayHours(state);
  const night = hour >= 19 || hour < 5;
  if (night && !(state.camp.fire.lit && isAtCamp(state))) {
    vitals.sanity -= 0.006 * dt;
  } else if (state.camp.fire.lit && isAtCamp(state)) {
    vitals.sanity += 0.009 * dt;
  }
}

function normalizeState(state: GameState): void {
  const { nutrition, vitals, conditions } = state.player;
  nutrition.carbohydrates = clamp(nutrition.carbohydrates);
  nutrition.protein = clamp(nutrition.protein);
  nutrition.fat = clamp(nutrition.fat);
  nutrition.hydration = clamp(nutrition.hydration);
  vitals.health = clamp(vitals.health);
  vitals.stamina = clamp(vitals.stamina);
  vitals.energy = clamp(vitals.energy);
  vitals.sanity = clamp(vitals.sanity);
  conditions.wetness = clamp(conditions.wetness);
  conditions.parasites = Math.round(clamp(conditions.parasites, 0, 3));
  conditions.wound.severity = clamp(conditions.wound.severity);
  conditions.wound.infection = clamp(conditions.wound.infection);
  state.weather.rainIntensity = clamp(state.weather.rainIntensity, 0, 1);
  state.weather.targetRainIntensity = clamp(
    state.weather.targetRainIntensity,
    0,
    1,
  );
  state.camp.fire.fuelSeconds = Math.max(0, state.camp.fire.fuelSeconds);
  state.camp.fire.rainExposure = Math.max(0, state.camp.fire.rainExposure);
  for (const itemId of ITEM_IDS) {
    const count = state.inventory[itemId];
    state.inventory[itemId] = Number.isFinite(count)
      ? Math.max(0, Math.min(999, Math.floor(count)))
      : 0;
  }
  if (!isPositionValid(state.player.position)) {
    state.player.position = { ...state.camp.position };
  } else {
    setPlayerPosition(state, state.player.position);
  }
}

function checkTerminalState(state: GameState): void {
  if (state.status !== "playing") return;
  const reason =
    state.player.vitals.health <= 0
      ? "health"
      : state.player.vitals.sanity <= 0
        ? "sanity"
        : null;
  if (!reason) return;
  state.status = "lost";
  state.lossReason = reason;
  appendEvent(state, {
    type: "game-lost",
    message:
      reason === "health"
        ? "伤病与匮乏夺走了最后的生命体征。"
        : "雨林的黑暗吞没了最后一点理智。",
    cause: { source: "system", code: `terminal:${reason}` },
    details: { reason },
  });
}

function runFixedTick(
  state: GameState,
  movement: MovementInput | undefined,
): void {
  updateClock(state);
  updateMovement(state, movement, FIXED_DT_SECONDS);
  updateWeather(state, FIXED_DT_SECONDS);
  updateFire(state, FIXED_DT_SECONDS);
  updateWetness(state, movement, FIXED_DT_SECONDS);
  updateMetabolism(state, FIXED_DT_SECONDS);
  normalizeState(state);
  refreshCampObjective(state);
  completeAvailableTasks(state, "simulation-tick");
  checkTerminalState(state);
}

/**
 * Advances the deterministic simulation. The caller may pass any positive dt;
 * it is accumulated and evaluated as fixed 30 Hz ticks. The input state is not
 * mutated. Render loops should cap catch-up work before calling this function.
 */
export function stepSimulation(
  state: GameState,
  input: SimulationInput = {},
  dtSeconds: number,
): GameState {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new RangeError("dtSeconds must be a finite, non-negative number");
  }

  const nextState = cloneGameState(state);
  for (const command of input.commands ?? []) {
    applyCommandMutable(nextState, command);
  }
  if (nextState.status !== "playing") return nextState;

  const accumulated = nextState.clock.remainderSeconds + dtSeconds;
  const stepCount = Math.floor(accumulated * FIXED_HZ + 1e-9);
  nextState.clock.remainderSeconds = Math.max(
    0,
    accumulated - stepCount * FIXED_DT_SECONDS,
  );

  for (
    let stepIndex = 0;
    stepIndex < stepCount && nextState.status === "playing";
    stepIndex += 1
  ) {
    runFixedTick(nextState, input.movement);
  }

  return nextState;
}
