import assert from "node:assert/strict";
import test from "node:test";

import { yawToCompassDegrees } from "../../src/game/GameClient";
import { applyCommand } from "../../src/game/sim/simulation";
import { createInitialState } from "../../src/game/sim/state";
import type { GameState } from "../../src/game/sim/types";
import { createGameViewModel } from "../../src/game/ui/viewModel";

function beginBatteryObjective(): GameState {
  const state = createInitialState("battery-guidance");
  state.objectives.currentTaskId = "recover-battery";
  state.objectives.completedTaskIds = ["treat-wound", "purify-water", "establish-camp"];
  state.objectives.flags.woundTreated = true;
  state.objectives.flags.waterPurified = true;
  state.objectives.flags.campEstablished = true;
  return state;
}

function inspect(state: GameState, entityId: string): GameState {
  const entity = state.world.entities[entityId];
  const nearby = applyCommand(state, { type: "move-player", position: entity.position });
  return applyCommand(nearby, { type: "inspect-landmark", entityId });
}

test("compass headings use the same +X east, +Z north convention as the paper map", () => {
  assert.equal(yawToCompassDegrees(Math.PI), 0, "+Z must display north");
  assert.equal(yawToCompassDegrees(-Math.PI / 2), 90, "+X must display east");
  assert.equal(yawToCompassDegrees(0), 180, "-Z must display south");
  assert.equal(yawToCompassDegrees(Math.PI / 2), 270, "-X must display west");
});

test("watch coordinates decrease west/south minutes when moving east/north", () => {
  const origin = createInitialState("coordinate-origin");
  origin.player.position = { x: 0, y: 0, z: 0 };
  const northeast = createInitialState("coordinate-northeast");
  northeast.player.position = { x: 10, y: 0, z: 10 };

  assert.equal(createGameViewModel(origin).watch.coordinates, "03° 07.00' S / 61° 18.00' W");
  assert.equal(createGameViewModel(northeast).watch.coordinates, "03° 06.82' S / 61° 17.79' W");
});

test("battery objective exposes a five-stage title, progress and explicit blocker", () => {
  let state = beginBatteryObjective();
  let view = createGameViewModel(state);
  assert.equal(view.currentObjective?.label, "调查损坏电台");
  assert.equal(view.currentObjective?.progressLabel, "远征线索 1/5");
  assert.match(view.currentObjective?.blocker ?? "", /损坏电台/);

  state = inspect(state, "landmark.camp-radio");
  view = createGameViewModel(state);
  assert.equal(view.currentObjective?.label, "寻找西北勘测岩棚");
  assert.equal(view.currentObjective?.progressLabel, "远征线索 2/5");
  assert.match(view.currentObjective?.description ?? "", /按 M 打开地图/);

  state = inspect(state, "landmark.survey-cache");
  view = createGameViewModel(state);
  assert.equal(view.currentObjective?.label, "调查气象站控制柜");
  assert.equal(view.currentObjective?.progressLabel, "远征线索 3/5");
  assert.match(view.currentObjective?.blocker ?? "", /电池不可拆卸/);

  const batteryBeforeInspection = view.render.entities.find(
    (entity) => entity.id === "resource.battery.weather-station",
  );
  assert.equal(batteryBeforeInspection?.interactive, false);

  state = inspect(state, "landmark.weather-station");
  view = createGameViewModel(state);
  assert.equal(view.currentObjective?.label, "准备拆卸工具");
  assert.equal(view.currentObjective?.progressLabel, "远征线索 4/5");
  assert.match(view.currentObjective?.blocker ?? "", /缺少石斧/);
  assert.equal(
    view.render.entities.find((entity) => entity.id === "resource.battery.weather-station")?.interactive,
    true,
  );

  state.inventory.axe = 1;
  view = createGameViewModel(state);
  assert.equal(view.currentObjective?.label, "拆取气象站电池");
  assert.equal(view.currentObjective?.progressLabel, "远征线索 5/5");
  assert.equal(view.currentObjective?.blocker, undefined);
});

test("first-night objectives expose the next concrete action instead of a generic goal", () => {
  const state = createInitialState("first-night-guide");
  let objective = createGameViewModel(state).currentObjective;
  assert.equal(objective?.label, "寻找止血材料");
  assert.match(objective?.blocker ?? "", /船子草/);

  state.inventory["medicinal-leaf"] = 1;
  state.inventory.vine = 1;
  objective = createGameViewModel(state).currentObjective;
  assert.equal(objective?.label, "制作草药绷带");

  state.objectives.flags.woundTreated = true;
  state.objectives.completedTaskIds = ["treat-wound"];
  state.objectives.currentTaskId = "purify-water";
  state.inventory["coconut-shell"] = 1;
  objective = createGameViewModel(state).currentObjective;
  assert.equal(objective?.label, "用椰壳收集溪水");

  state.objectives.flags.waterPurified = true;
  state.objectives.completedTaskIds.push("purify-water");
  state.objectives.currentTaskId = "establish-camp";
  objective = createGameViewModel(state).currentObjective;
  assert.equal(objective?.label, "搭建过夜营火");
});
