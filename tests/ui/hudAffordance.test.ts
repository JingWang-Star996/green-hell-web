import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { InteractionTarget } from "../../src/game/render/types";
import { resolveAffordance } from "../../src/game/sim/affordances";
import { createInitialState } from "../../src/game/sim/state";
import { Hud } from "../../src/game/ui/Hud";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import { commandForInteraction } from "../../src/game/GameClient";

test("HUD renders selector verb, preview, blocker, and required tool", () => {
  const state = createInitialState("s4-hud-affordance");
  const tree = Object.values(state.world.entities).find(
    (entity) =>
      entity.semantic?.category === "tree" &&
      entity.semantic.toolClass === "axe",
  );
  assert.ok(tree);
  const entity = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === tree.id,
  );
  assert.ok(entity);
  const target: InteractionTarget = {
    id: entity.id,
    kind: entity.kind,
    label: entity.label,
    distance: 1,
    affordance: entity.affordance,
  };

  const markup = renderToStaticMarkup(
    createElement(Hud, {
      watch: {
        day: 1,
        time: "12:00",
        coordinates: "0 / 0",
        weather: "clear",
        biome: "forest",
        rain: 0,
        meters: [],
      },
      meters: [],
      objective: null,
      target,
      pointerLocked: true,
      ready: true,
      events: [],
      compassDegrees: 0,
      onFocusGame: () => undefined,
      onOpenWatch: () => undefined,
      onOpenBody: () => undefined,
    }),
  );

  assert.match(markup, /data-affordance-state="blocked"/);
  assert.match(markup, /data-interaction-mode="unavailable"/);
  assert.doesNotMatch(markup, /<kbd[^>]*>E<\/kbd>/);
  assert.ok(markup.includes(target.affordance.verb));
  assert.ok(markup.includes(target.affordance.preview.detail));
  assert.ok(markup.includes("\u7f3a\u5c11\u6240\u9700\u5de5\u5177"));
  assert.ok(markup.includes("\u9700\u8981\u77f3\u65a7"));
});

test("HUD shows E for inspect but never for movement advice", () => {
  const state = createInitialState("honest-hud-input");
  const radio = state.world.entities["landmark.camp-radio"];
  const inspectTarget: InteractionTarget = {
    id: radio.id,
    kind: "wreck",
    label: radio.label,
    distance: 1,
    affordance: resolveAffordance(state, radio),
  };
  assert.equal(inspectTarget.affordance.interactionMode, "inspect");

  const props = {
    watch: {
      day: 1,
      time: "12:00",
      coordinates: "0 / 0",
      weather: "clear",
      biome: "forest",
      rain: 0,
      meters: [],
    },
    meters: [],
    objective: null,
    pointerLocked: true,
    ready: true,
    events: [],
    compassDegrees: 0,
    onFocusGame: () => undefined,
    onOpenWatch: () => undefined,
    onOpenBody: () => undefined,
  };
  const inspectMarkup = renderToStaticMarkup(
    createElement(Hud, { ...props, target: inspectTarget }),
  );
  assert.match(inspectMarkup, /data-interaction-mode="inspect"/);
  assert.match(inspectMarkup, /<kbd[^>]*>E<\/kbd>/);

  const snake = state.world.entities["hazard.snake.stream-ridge"];
  const movementTarget: InteractionTarget = {
    id: snake.id,
    kind: "snake",
    label: snake.label,
    distance: 1,
    affordance: resolveAffordance(state, snake),
  };
  assert.equal(movementTarget.affordance.interactionMode, "movement");
  const movementMarkup = renderToStaticMarkup(
    createElement(Hud, { ...props, target: movementTarget }),
  );
  assert.match(movementMarkup, /data-interaction-mode="movement"/);
  assert.match(movementMarkup, /class="interaction-mode-badge">行动建议/);
  assert.doesNotMatch(movementMarkup, /<kbd[^>]*>E<\/kbd>/);
});

test("HUD exposes wildlife health before an embodied attack", () => {
  const state = createInitialState("wildlife-check");
  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  const wildlife = createRenderSnapshot(state).wildlife.find(
    (candidate) => candidate.visible,
  );
  assert.ok(wildlife);
  const target: InteractionTarget = {
    id: `wildlife:${wildlife.individualId}`,
    kind: "animal",
    label: wildlife.label,
    distance: 1,
    affordance: wildlife.affordance,
  };

  const markup = renderToStaticMarkup(
    createElement(Hud, {
      watch: {
        day: 1,
        time: "12:00",
        coordinates: "0 / 0",
        weather: "clear",
        biome: "forest",
        rain: 0,
        meters: [],
      },
      meters: [],
      objective: null,
      target,
      pointerLocked: true,
      ready: true,
      events: [],
      compassDegrees: 0,
      onFocusGame: () => undefined,
      onOpenWatch: () => undefined,
      onOpenBody: () => undefined,
    }),
  );

  assert.match(markup, /class="interaction-health"/);
  assert.match(markup, new RegExp(`${wildlife.health} / ${wildlife.maxHealth}`));
});

test("HUD exposes local smoking progress and biome rate without opening a menu", () => {
  const state = createInitialState("smoking-rack-hud");
  state.camp.fire = {
    built: true,
    lit: true,
    fuelSeconds: 1_000,
    rainExposure: 0,
    sheltered: false,
  };
  state.camp.structures = [
    {
      id: "structure.campfire.hud",
      kind: "campfire",
      position: { x: 0, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 0,
    },
    {
      id: "structure.smoking-rack.hud",
      kind: "smoking-rack",
      position: { x: 2, y: 0, z: 0 },
      yaw: 0,
      builtAtTick: 0,
      process: {
        kind: "smoking-meat",
        inputExpiresAtTick: 100_000,
        progressSeconds: 120,
        status: "processing",
      },
    },
  ];
  const entity = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === "structure.smoking-rack.hud",
  );
  assert.ok(entity);
  const target: InteractionTarget = {
    id: entity.id,
    kind: entity.kind,
    label: entity.label,
    distance: 1,
    affordance: entity.affordance,
  };
  const markup = renderToStaticMarkup(
    createElement(Hud, {
      watch: {
        day: 1,
        time: "12:00",
        coordinates: "0 / 0",
        weather: "clear",
        biome: "forest",
        rain: 0,
        meters: [],
      },
      meters: [],
      objective: null,
      target,
      pointerLocked: true,
      ready: true,
      events: [],
      compassDegrees: 0,
      onFocusGame: () => undefined,
      onOpenWatch: () => undefined,
      onOpenBody: () => undefined,
    }),
  );

  assert.match(markup, /class="interaction-fuel interaction-progress"/);
  assert.match(markup, /烟熏 50%/);
  assert.match(markup, /· ×0\./);
});

test("HUD exposes rain collector storage, capacity, efficiency and canopy state", () => {
  const state = createInitialState("rain-collector-hud");
  state.inventory["coconut-shell"] = 2;
  state.camp.structures = [
    {
      id: "structure.rain-collector.hud",
      kind: "rain-collector",
      position: { x: 0, y: 0, z: -5 },
      yaw: 0,
      builtAtTick: 0,
      storedUnits: 2.35,
      capacity: 4,
      lastAdvancedTick: 0,
    },
  ];
  const entity = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === "structure.rain-collector.hud",
  );
  assert.ok(entity);
  const markup = renderToStaticMarkup(
    createElement(Hud, {
      watch: {
        day: 1,
        time: "12:00",
        coordinates: "0 / 0",
        weather: "rain",
        biome: "forest",
        rain: 0.5,
        meters: [],
      },
      meters: [],
      objective: null,
      target: {
        id: entity.id,
        kind: entity.kind,
        label: entity.label,
        distance: 1,
        affordance: entity.affordance,
      },
      pointerLocked: true,
      ready: true,
      events: [],
      compassDegrees: 0,
      onFocusGame: () => undefined,
      onOpenWatch: () => undefined,
      onOpenBody: () => undefined,
    }),
  );
  assert.match(markup, /class="interaction-fuel interaction-water"/);
  assert.match(markup, /储水 2\.35 \/ 4/);
  assert.match(markup, /效率 ×0\./);
});

test("torch waymarks stay chunk-bounded while exposing exact fuel, slots, label and focus anchor", () => {
  const state = createInitialState("torch-waymark-hud");
  state.weather.rainIntensity = 0;
  state.weather.storm = false;
  state.inventory.torch = 1;
  state.camp.structures = [
    {
      id: "structure.torch-waymark.near",
      kind: "torch-waymark",
      position: { x: 2, y: 0, z: -4 },
      yaw: 0,
      builtAtTick: 0,
      torchFuelQueueSeconds: [125],
      lit: true,
      everLit: true,
      lastAdvancedTick: 0,
    },
    {
      id: "structure.torch-waymark.far",
      kind: "torch-waymark",
      position: { x: 2_000, y: 0, z: 2_000 },
      yaw: 0,
      builtAtTick: 0,
      torchFuelQueueSeconds: [80],
      lit: true,
      everLit: true,
      lastAdvancedTick: 0,
    },
  ];

  const snapshot = createRenderSnapshot(state);
  assert.deepEqual(
    snapshot.structures
      .filter((structure) => structure.kind === "torch-waymark")
      .map((structure) => structure.id),
    ["structure.torch-waymark.near"],
  );
  const renderStructure = snapshot.structures.find(
    (structure) => structure.id === "structure.torch-waymark.near",
  ) as
    | (typeof snapshot.structures)[number] & {
        lit?: boolean;
        totalFuelSeconds?: number;
        slotCount?: number;
      }
    | undefined;
  assert.ok(renderStructure);
  assert.deepEqual(
    {
      lit: renderStructure.lit,
      totalFuelSeconds: renderStructure.totalFuelSeconds,
      slotCount: renderStructure.slotCount,
    },
    { lit: true, totalFuelSeconds: 125, slotCount: 1 },
  );

  const entity = snapshot.entities.find(
    (candidate) => candidate.id === "structure.torch-waymark.near",
  );
  assert.ok(entity);
  assert.equal(entity.label, "火把路标");
  assert.equal(entity.interactive, true);
  assert.deepEqual(entity.interactionAnchor, { x: 2, z: -3.3, height: 1 });
  assert.deepEqual(
    commandForInteraction(state, {
      id: entity.id,
      kind: entity.kind,
      label: entity.label,
      distance: 1,
      affordance: entity.affordance,
    }),
    { type: "use-structure", structureId: "structure.torch-waymark.near" },
  );

  const waymark = state.camp.structures[0];
  assert.equal(entity.affordance.actionId, "top-up-torch-waymark");
  waymark.lit = false;
  const relightEntity = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === waymark.id,
  );
  assert.ok(relightEntity);
  assert.equal(relightEntity.affordance.actionId, "relight-torch-waymark");
  assert.deepEqual(
    commandForInteraction(state, {
      id: relightEntity.id,
      kind: relightEntity.kind,
      label: relightEntity.label,
      distance: 1,
      affordance: relightEntity.affordance,
    }),
    { type: "use-structure", structureId: waymark.id },
  );
  waymark.torchFuelQueueSeconds = [];
  const insertEntity = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === waymark.id,
  );
  assert.ok(insertEntity);
  assert.equal(insertEntity.affordance.actionId, "insert-torch-waymark");
  assert.deepEqual(
    commandForInteraction(state, {
      id: insertEntity.id,
      kind: insertEntity.kind,
      label: insertEntity.label,
      distance: 1,
      affordance: insertEntity.affordance,
    }),
    { type: "use-structure", structureId: waymark.id },
  );
  waymark.torchFuelQueueSeconds = [125];
  waymark.lit = true;

  const renderWaymarkHud = (candidate: NonNullable<typeof entity>) =>
    renderToStaticMarkup(
      createElement(Hud, {
        watch: {
          day: 1,
          time: "12:00",
          coordinates: "0 / 0",
          weather: "clear",
          biome: "forest",
          rain: 0,
          meters: [],
        },
        meters: [],
        objective: null,
        target: {
          id: candidate.id,
          kind: candidate.kind,
          label: candidate.label,
          distance: 1,
          affordance: candidate.affordance,
        },
        pointerLocked: true,
        ready: true,
        events: [],
        compassDegrees: 0,
        onFocusGame: () => undefined,
        onOpenWatch: () => undefined,
        onOpenBody: () => undefined,
      }),
    );
  const markup = renderWaymarkHud(entity);
  assert.match(markup, /aria-label="火把路标剩余燃料 125 秒，槽位 1\/2"/);
  assert.match(markup, /剩余 2 分 5 秒 · 槽位 1\/2/);
  assert.match(markup, /<strong>火把路标<\/strong>/);

  state.inventory.torch = 0;
  const missingTorchEntity = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === waymark.id,
  );
  assert.ok(missingTorchEntity);
  assert.equal(missingTorchEntity.affordance.blocker, "missing-torch");
  const missingTorchMarkup = renderWaymarkHud(missingTorchEntity);
  assert.match(missingTorchMarkup, /缺少实体火把 · 需要火把/);
  assert.doesNotMatch(missingTorchMarkup, />missing-torch</);

  state.inventory.torch = 1;
  waymark.torchFuelQueueSeconds = [125, 60];
  const fullSlotsEntity = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === waymark.id,
  );
  assert.ok(fullSlotsEntity);
  assert.equal(fullSlotsEntity.affordance.blocker, "fuel-slots-full");
  assert.equal(fullSlotsEntity.interactive, true, "a full waymark remains focusable for an honest blocker");
  const fullSlotsMarkup = renderWaymarkHud(fullSlotsEntity);
  assert.match(fullSlotsMarkup, /火把槽位已满/);
  assert.doesNotMatch(fullSlotsMarkup, />fuel-slots-full</);
});
