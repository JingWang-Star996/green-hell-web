import assert from "node:assert/strict";
import test from "node:test";

import { commandForInteraction } from "../../src/game/GameClient";
import {
  affordanceAcceptsInput,
  resolveAffordance,
} from "../../src/game/sim/affordances";
import {
  CAMPAIGN_FACTS,
} from "../../src/game/sim/campaignContent";
import {
  CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD,
  CANOPY_JUNCTION_ID,
  CANOPY_JUNCTION_OBSTRUCTION_TREE_ID,
  CANOPY_JUNCTION_POSITION,
  CANOPY_JUNCTION_TENSION_VINE_IDS,
  CANOPY_SAMPLE_STABLE_TICKS,
  createCanopyJunctionState,
  type CanopyJunctionPhase,
  type CanopyWindSample,
} from "../../src/game/sim/canopyJunction";
import {
  recordObjectiveFact,
  type ObjectiveFactRecord,
  type ObjectiveFactReference,
} from "../../src/game/sim/objectiveFacts";
import { createInitialState } from "../../src/game/sim/state";
import type {
  GameState,
  PlacedStructureState,
  WorldEntity,
} from "../../src/game/sim/types";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";
import {
  WIND_FIELD_FIXED_HZ,
  createWindFieldState,
  windFieldStrength,
} from "../../src/game/world/windField";

function entity(state: GameState, id: string): WorldEntity {
  const value = state.world.entities[id];
  assert.ok(value, `missing authored entity ${id}`);
  return value;
}

function c17(state: GameState): WorldEntity {
  return entity(state, CANOPY_JUNCTION_ID);
}

function depleteTreeRoute(state: GameState): void {
  const tree = entity(state, CANOPY_JUNCTION_OBSTRUCTION_TREE_ID);
  tree.quantity = 0;
  tree.depleted = true;
  delete tree.treeHarvest;
}

function depleteVine(state: GameState, index: 0 | 1): void {
  const vine = entity(state, CANOPY_JUNCTION_TENSION_VINE_IDS[index]);
  vine.quantity = 0;
  vine.depleted = true;
}

function sampleAt(tick: number): CanopyWindSample {
  return {
    directionRadians: Math.PI / 2,
    strength: 0.83,
    signalQuality: 0.94,
    capturedAtTick: tick,
    stableTicks: CANOPY_SAMPLE_STABLE_TICKS,
  };
}

function setCanopyPhase(
  state: GameState,
  phase: CanopyJunctionPhase,
  options: {
    readableTicks?: number;
    sample?: CanopyWindSample | null;
  } = {},
): void {
  depleteTreeRoute(state);
  const tick = state.clock.tick;
  const base = createCanopyJunctionState(tick);
  const isSamplingPhase =
    phase === "sampling" || phase === "sample-ready" || phase === "reported";
  const sample = options.sample ??
    (phase === "sample-ready" || phase === "reported" ? sampleAt(tick) : null);
  state.world.canopyJunction = {
    ...base,
    phase,
    clearedObstructionIds: [CANOPY_JUNCTION_OBSTRUCTION_TREE_ID],
    phaseEnteredTick: tick,
    samplingStartedTick: isSamplingPhase ? tick : null,
    consecutiveReadableTicks: options.readableTicks ?? 0,
    lastAdvancedTick: tick,
    sample,
    reportedAtTick: phase === "reported" ? tick : null,
  };
}

function shelterAtC17(state: GameState): PlacedStructureState {
  const shelter: PlacedStructureState = {
    id: "structure.shelter.c17-affordance-test",
    kind: "shelter",
    position: { ...CANOPY_JUNCTION_POSITION },
    yaw: 0,
    builtAtTick: state.clock.tick,
  };
  state.camp.structures = [...(state.camp.structures ?? []), shelter];
  state.camp.shelterBuilt = true;
  return shelter;
}

function radioBeacon(state: GameState): PlacedStructureState {
  const beacon: PlacedStructureState = {
    id: "structure.radio-beacon.canopy-affordance-test",
    kind: "radio-beacon",
    position: { ...state.camp.position },
    yaw: 0,
    builtAtTick: state.clock.tick,
  };
  state.camp.beaconBuilt = true;
  state.camp.structures = [...(state.camp.structures ?? []), beacon];
  return beacon;
}

function factsFrom(
  references: readonly ObjectiveFactReference[],
): ObjectiveFactRecord[] {
  return references.reduce<ObjectiveFactRecord[]>(
    (facts, reference, index) =>
      recordObjectiveFact(facts, reference, index + 1),
    [],
  );
}

test("C-17 and its tension vines expose one shared desktop/mobile interaction truth", () => {
  const state = createInitialState("canopy-affordance-shared");
  state.player.position = { ...CANOPY_JUNCTION_POSITION };
  const direct = resolveAffordance(state, c17(state));
  const projected = createRenderSnapshot(state).entities.find(
    (candidate) => candidate.id === CANOPY_JUNCTION_ID,
  )?.affordance;

  assert.ok(projected);
  assert.deepEqual(projected, direct);
  assert.equal(direct.state, "blocked");
  assert.equal(direct.actionId, "inspect");
  assert.equal(direct.interactionMode, "unavailable");
  assert.equal(direct.blocker, "access-obstructed");
  assert.equal(direct.preview.panelWindStrength, 0);
  assert.equal(typeof direct.preview.windDirectionSector, "string");
  assert.equal(typeof direct.preview.windStrength, "number");

  for (const id of CANOPY_JUNCTION_TENSION_VINE_IDS) {
    const vine = entity(state, id);
    const missingBlade = resolveAffordance(state, vine);
    assert.equal(missingBlade.semanticKind, "harvestable-plant");
    assert.equal(missingBlade.actionId, "cut");
    assert.notEqual(missingBlade.actionId, "pickup");
    assert.equal(missingBlade.requiredItem, "stone-blade");
    assert.equal(missingBlade.blocker, "missing-required-tool");
  }

  state.inventory["stone-blade"] = 1;
  state.player.equippedItem = "stone-blade";
  const readyVine = resolveAffordance(
    state,
    entity(state, CANOPY_JUNCTION_TENSION_VINE_IDS[0]),
  );
  assert.equal(readyVine.state, "ready");
  assert.equal(readyVine.actionId, "cut");
  assert.equal(readyVine.animationKey, "tool.blade.cut");
  assert.deepEqual(
    commandForInteraction(state, {
      id: CANOPY_JUNCTION_TENSION_VINE_IDS[0],
      kind: "vine",
      label: entity(state, CANOPY_JUNCTION_TENSION_VINE_IDS[0]).label,
      distance: 1,
      affordance: readyVine,
    }),
    {
      type: "physical-action",
      targetId: CANOPY_JUNCTION_TENSION_VINE_IDS[0],
      actionId: "cut",
      poseRevision: Math.max(0, Math.floor(state.player.poseRevision ?? 0)),
    },
    "desktop and touch input must route the shared cut affordance to authority",
  );

  depleteVine(state, 0);
  const spentVine = resolveAffordance(
    state,
    entity(state, CANOPY_JUNCTION_TENSION_VINE_IDS[0]),
  );
  assert.equal(spentVine.state, "depleted");
  assert.equal(spentVine.actionId, "cut");
});

test("either a fully depleted tree or both depleted tension vines exposes C-17", () => {
  const treeRoute = createInitialState("canopy-affordance-tree-route");
  depleteTreeRoute(treeRoute);
  const afterTree = resolveAffordance(treeRoute, c17(treeRoute));
  assert.equal(afterTree.state, "ready");
  assert.equal(afterTree.actionId, "inspect");
  assert.equal(afterTree.verb, "打开防水接头");
  assert.equal(afterTree.blocker, null);

  const vineRoute = createInitialState("canopy-affordance-vine-route");
  depleteVine(vineRoute, 0);
  const afterOneVine = resolveAffordance(vineRoute, c17(vineRoute));
  assert.equal(afterOneVine.state, "blocked");
  assert.equal(afterOneVine.blocker, "access-obstructed");
  assert.match(afterOneVine.preview.detail, /1\/2/);

  depleteVine(vineRoute, 1);
  const afterBothVines = resolveAffordance(vineRoute, c17(vineRoute));
  assert.equal(afterBothVines.state, "ready");
  assert.equal(afterBothVines.verb, "打开防水接头");
  assert.equal(afterBothVines.blocker, null);
});

test("strong rain blocks open connector work until a real C-17 shelter covers it", () => {
  const state = createInitialState("canopy-affordance-rain-shelter");
  setCanopyPhase(state, "exposed");
  state.weather.rainIntensity = CANOPY_CONNECTOR_RAIN_BLOCK_THRESHOLD;
  state.camp.shelterBuilt = true;

  const legacyFlagOnly = resolveAffordance(state, c17(state));
  assert.equal(legacyFlagOnly.state, "blocked");
  assert.equal(legacyFlagOnly.blocker, "rain-exposed");
  assert.match(legacyFlagOnly.preview.detail, /开盖会进水/);

  shelterAtC17(state);
  const coveredOpening = resolveAffordance(state, c17(state));
  assert.equal(coveredOpening.state, "ready");
  assert.equal(coveredOpening.blocker, null);
  assert.equal(coveredOpening.preview.sheltered, true);

  setCanopyPhase(state, "connector-open");
  state.camp.structures = [];
  const exposedRestore = resolveAffordance(state, c17(state));
  assert.equal(exposedRestore.state, "blocked");
  assert.equal(exposedRestore.blocker, "rain-exposed");

  shelterAtC17(state);
  const coveredRestore = resolveAffordance(state, c17(state));
  assert.equal(coveredRestore.state, "ready");
  assert.equal(coveredRestore.verb, "复位并锁紧接头");
});

test("C-17 phase previews retain real wind, broken zero, progress, and sample quality", () => {
  const state = createInitialState("canopy-affordance-phase-preview");
  state.clock.tick = 1_234;
  state.world.windField = createWindFieldState(state.seed, state.clock.tick);
  const expectedStrength = windFieldStrength(state.world.windField);

  setCanopyPhase(state, "exposed");
  state.weather.rainIntensity = 0;
  const exposed = resolveAffordance(state, c17(state));
  assert.equal(exposed.preview.windStrength, expectedStrength);
  assert.equal(exposed.preview.panelWindStrength, 0);

  setCanopyPhase(state, "sampling", {
    readableTicks: 5 * WIND_FIELD_FIXED_HZ,
  });
  const sampling = resolveAffordance(state, c17(state));
  assert.equal(sampling.state, "ambient");
  assert.equal(sampling.actionId, "inspect");
  assert.equal(sampling.interactionMode, "inspect");
  assert.equal(affordanceAcceptsInput(sampling), true);
  assert.equal(sampling.preview.progressSeconds, 5);
  assert.equal(sampling.preview.progressCapacitySeconds, 10);
  assert.equal(sampling.preview.panelWindStrength, expectedStrength);

  const sample = sampleAt(state.clock.tick);
  setCanopyPhase(state, "sample-ready", { sample });
  const ready = resolveAffordance(state, c17(state));
  assert.equal(ready.state, "ready");
  assert.equal(ready.actionId, "inspect");
  assert.equal(ready.verb, "查看阵风样本");
  assert.equal(ready.preview.sampleDirectionSector, "东");
  assert.equal(ready.preview.sampleWindStrength, sample.strength);
  assert.equal(ready.preview.signalQuality, sample.signalQuality);
  assert.equal(ready.preview.sampleCapturedAtTick, sample.capturedAtTick);

  setCanopyPhase(state, "reported", { sample });
  const reported = resolveAffordance(state, c17(state));
  assert.equal(reported.state, "ambient");
  assert.equal(reported.actionId, "observe");
  assert.equal(reported.blocker, null);
});

test("canopy radio transmit is blocked by each missing fact and lists exactly what remains", () => {
  const state = createInitialState("canopy-affordance-radio");
  state.objectives.currentTaskId = "canopy-wind";
  setCanopyPhase(state, "sample-ready");
  const beacon = radioBeacon(state);
  const requiredFacts = [
    CAMPAIGN_FACTS.canopyRequestHeard,
    CAMPAIGN_FACTS.canopyRepairKitPrepared,
    CAMPAIGN_FACTS.canopyContradictionObserved,
    CAMPAIGN_FACTS.canopyLinkRestored,
    CAMPAIGN_FACTS.canopyLiveSampleObserved,
  ] as const;
  const expectedMissingIds = [
    CAMPAIGN_FACTS.canopyRequestHeard.subjectId,
    "canopy-expedition.one-valid-plan",
    CAMPAIGN_FACTS.canopyContradictionObserved.subjectId,
    CAMPAIGN_FACTS.canopyLinkRestored.subjectId,
    CAMPAIGN_FACTS.canopyLiveSampleObserved.subjectId,
  ] as const;

  for (let missingIndex = 0; missingIndex < requiredFacts.length; missingIndex += 1) {
    state.knowledge!.objectiveFacts = factsFrom(
      requiredFacts.filter((_, index) => index !== missingIndex),
    );
    const blocked = resolveAffordance(state, beacon);
    assert.equal(blocked.state, "blocked");
    assert.equal(blocked.actionId, "transmit");
    assert.equal(blocked.blocker, "objective-not-ready");
    assert.deepEqual(blocked.preview.missingPrerequisiteIds, [
      expectedMissingIds[missingIndex],
    ]);
    assert.match(blocked.preview.detail, /上报仍缺少/);
  }

  state.knowledge!.objectiveFacts = factsFrom(requiredFacts);
  const ready = resolveAffordance(state, beacon);
  assert.equal(ready.state, "ready");
  assert.equal(ready.actionId, "transmit");
  assert.equal(ready.interactionMode, "execute");
  assert.equal(ready.blocker, null);
  assert.deepEqual(ready.preview.missingPrerequisiteIds, []);

  state.world.canopyJunction = createCanopyJunctionState(state.clock.tick);
  const staleFactsWithoutSample = resolveAffordance(state, beacon);
  assert.equal(staleFactsWithoutSample.state, "blocked");
  assert.equal(staleFactsWithoutSample.blocker, "objective-not-ready");
  assert.deepEqual(staleFactsWithoutSample.preview.missingPrerequisiteIds, [
    "canopy-junction.valid-sample-state",
  ]);
  assert.match(staleFactsWithoutSample.preview.detail, /有效样本状态/);

  setCanopyPhase(state, "sample-ready");

  state.knowledge!.objectiveFacts = recordObjectiveFact(
    state.knowledge!.objectiveFacts,
    CAMPAIGN_FACTS.canopyWindSampleReported,
    state.clock.tick,
  );
  state.objectives.currentTaskId = null;
  const reported = resolveAffordance(state, beacon);
  assert.equal(reported.state, "ambient");
  assert.equal(reported.actionId, "observe");
  assert.match(reported.preview.detail, /已经发送/);
});
