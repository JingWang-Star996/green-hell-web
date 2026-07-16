import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import {
  RainforestRenderer,
  focusCandidatePassesCheapGate,
  selectFocusedTarget,
  type FocusCandidate,
} from "../../src/game/render/RainforestRenderer";
import type { ResolvedAffordance } from "../../src/game/sim/affordances";
import { isPhysicalActionId } from "../../src/game/world/hitGeometry";
import type {
  InteractionTarget,
  RenderEntity,
} from "../../src/game/render/types";
import type { WorldCollider } from "../../src/game/world/interactionGeometry";

function affordance(
  actionId: ResolvedAffordance["actionId"] = "chop",
  range = 3.2,
): ResolvedAffordance {
  return {
    objectId: "focus-query-test",
    semanticKind: "tree",
    state: "ready",
    interactionMode: "execute",
    actionId,
    verb: "测试",
    blocker: null,
    requiredItem: null,
    range,
    highlightTone: "interactable",
    animationKey: actionId === "inspect" ? "hand.inspect" : "tool.chop",
    feedbackKey: "focus-query-test",
    preview: {
      label: "测试",
      detail: "测试",
    },
    estimatedSeconds: 1,
  };
}

function target(
  id: string,
  distance: number,
  actionId: ResolvedAffordance["actionId"] = "chop",
): InteractionTarget {
  return {
    id,
    kind: "tree",
    label: id,
    distance,
    affordance: { ...affordance(actionId), objectId: id },
  };
}

/** Frozen copy of the pre-deferred renderer policy for equivalence checks. */
function legacySelect(
  candidates: readonly FocusCandidate[],
): InteractionTarget | null {
  let best: InteractionTarget | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!candidate.visible || candidate.occluded) continue;
    if (candidate.target.distance > candidate.target.affordance.range) continue;
    const physical = isPhysicalActionId(candidate.target.affordance.actionId);
    if (candidate.alignment < (physical ? 0.92 : 0.44)) continue;
    const score = candidate.target.distance + (1 - candidate.alignment) * 1.4;
    if (score >= bestScore) continue;
    best = candidate.target;
    bestScore = score;
  }
  return best;
}

function rendererEntity(
  id: string,
  x: number,
  z: number,
): { definition: RenderEntity; object: THREE.Object3D } {
  const object = new THREE.Object3D();
  object.position.set(x, 0, z);
  return {
    definition: {
      id,
      source: "authored",
      kind: "stick",
      label: id,
      x,
      z,
      interactRadius: 3.2,
      interactive: true,
      available: true,
      affordance: { ...affordance("chop"), objectId: id },
    },
    object,
  };
}

type MockRenderer = {
  entityViews: Map<string, ReturnType<typeof rendererEntity>>;
  focusQueryDiagnostics: {
    candidateCount: number;
    lineOfSightChecks: number;
    colliderSnapshotBuilds: number;
  };
  getFocusQueryDiagnostics: RainforestRenderer["getFocusQueryDiagnostics"];
};

function mockRenderer(
  entities: readonly ReturnType<typeof rendererEntity>[],
  semanticGetColliders: (excludingId?: string) => WorldCollider[] = () => [],
): MockRenderer {
  const receiver = Object.create(
    RainforestRenderer.prototype,
  ) as unknown as MockRenderer;
  Object.assign(receiver, {
    camera: new THREE.PerspectiveCamera(72, 1, 0.08, 180),
    entityViews: new Map(entities.map((entry) => [entry.definition.id, entry])),
    wildlifeViews: new Map(),
    chunkViews: new Map(),
    colliders: [],
    semanticInstances: { getColliders: semanticGetColliders },
    snapshot: {
      structures: [],
      fireBuilt: false,
      shelterBuilt: false,
      bedBuilt: false,
      beaconBuilt: false,
    },
    player: new THREE.Vector3(0, 0, 0),
    currentTarget: null,
    currentTargetSignature: "",
    focusQueryDiagnostics: {
      candidateCount: 0,
      lineOfSightChecks: 0,
      colliderSnapshotBuilds: 0,
    },
    applyFocusHighlight: () => undefined,
    callbacks: { onTargetChange: () => undefined },
  });
  return receiver;
}

function updateTarget(receiver: MockRenderer): void {
  const update = Reflect.get(
    RainforestRenderer.prototype,
    "updateTarget",
  ) as (this: unknown) => void;
  update.call(receiver);
}

test("deferred cheap gate preserves the legacy winner across physical and inspect candidates", () => {
  for (let scenario = 0; scenario < 96; scenario += 1) {
    const candidates = Array.from({ length: 18 }, (_, index) => {
      const actionId = (scenario + index) % 3 === 0 ? "inspect" : "chop";
      const distance = 0.4 + ((scenario * 5 + index * 3) % 11) * 0.42;
      const alignment = ((scenario * 7 + index * 11) % 21) / 20;
      return {
        target: target(`${scenario}:${index}`, distance, actionId),
        alignment,
        visible: (scenario + index) % 7 !== 0,
        occluded: (scenario * 3 + index) % 8 === 0,
      } satisfies FocusCandidate;
    });
    const deferred = candidates.filter(focusCandidatePassesCheapGate);
    assert.equal(
      selectFocusedTarget(deferred)?.id ?? null,
      legacySelect(candidates)?.id ?? null,
      `winner drifted in deterministic scenario ${scenario}`,
    );
  }
});

test("cheap focus alignment uses the physical and non-physical thresholds for legal actions", () => {
  const cases: ReadonlyArray<{
    actionId: ResolvedAffordance["actionId"];
    threshold: number;
    family: "physical" | "non-physical";
  }> = [
    { actionId: "cut", threshold: 0.92, family: "physical" },
    { actionId: "chop", threshold: 0.92, family: "physical" },
    { actionId: "mine", threshold: 0.92, family: "physical" },
    { actionId: "attack", threshold: 0.92, family: "physical" },
    { actionId: "pickup", threshold: 0.44, family: "non-physical" },
    { actionId: "collect-water", threshold: 0.44, family: "non-physical" },
    {
      actionId: "collect-rain-collector",
      threshold: 0.44,
      family: "non-physical",
    },
    { actionId: "inspect", threshold: 0.44, family: "non-physical" },
    { actionId: "add-fuel", threshold: 0.44, family: "non-physical" },
  ];

  for (const entry of cases) {
    assert.equal(
      isPhysicalActionId(entry.actionId),
      entry.family === "physical",
      `${entry.actionId} family drifted`,
    );
    const atThreshold: FocusCandidate = {
      target: target(`at:${entry.actionId}`, 1, entry.actionId),
      alignment: entry.threshold,
      visible: true,
      occluded: false,
    };
    const belowThreshold: FocusCandidate = {
      ...atThreshold,
      target: { ...atThreshold.target, id: `below:${entry.actionId}` },
      alignment: entry.threshold - 0.0001,
    };
    assert.equal(
      focusCandidatePassesCheapGate(atThreshold),
      true,
      `${entry.actionId} must pass at its inclusive threshold`,
    );
    assert.equal(
      focusCandidatePassesCheapGate(belowThreshold),
      false,
      `${entry.actionId} must fail immediately below its threshold`,
    );
  }
});

test("blocked and danger affordances remain focusable when spatial checks pass", () => {
  const cases: ReadonlyArray<{
    id: string;
    candidate: FocusCandidate;
  }> = [
    {
      id: "blocked-tree",
      candidate: {
        target: {
          ...target("blocked-tree", 1.4, "chop"),
          affordance: {
            ...affordance("chop"),
            objectId: "blocked-tree",
            state: "blocked",
            interactionMode: "unavailable",
            blocker: "missing-required-tool",
          },
        },
        alignment: 0.97,
        visible: true,
        occluded: false,
      },
    },
    {
      id: "danger-snake",
      candidate: {
        target: {
          ...target("danger-snake", 1.2, "avoid"),
          affordance: {
            ...affordance("avoid"),
            objectId: "danger-snake",
            semanticKind: "hazard",
            state: "danger",
            interactionMode: "movement",
          },
        },
        alignment: 0.7,
        visible: true,
        occluded: false,
      },
    },
  ];

  for (const entry of cases) {
    assert.equal(focusCandidatePassesCheapGate(entry.candidate), true);
    assert.equal(selectFocusedTarget([entry.candidate])?.id, entry.id);
  }
});

test("far and rear-facing projections perform zero LOS checks and build no collider snapshot", () => {
  const entities = [
    ...Array.from({ length: 80 }, (_, index) =>
      rendererEntity(`far:${index}`, index % 2, -40 - index),
    ),
    ...Array.from({ length: 80 }, (_, index) =>
      rendererEntity(`rear:${index}`, index % 2, 1 + index * 0.02),
    ),
  ];
  let semanticSnapshots = 0;
  const receiver = mockRenderer(entities, () => {
    semanticSnapshots += 1;
    return [];
  });

  updateTarget(receiver);

  assert.deepEqual(receiver.getFocusQueryDiagnostics(), {
    candidateCount: 160,
    lineOfSightChecks: 0,
    colliderSnapshotBuilds: 0,
  });
  assert.equal(semanticSnapshots, 0);
  assert.equal(Reflect.get(receiver, "currentTarget"), null);
});

test("one eligible projection builds one shared snapshot and performs one LOS check", () => {
  const entities = [
    rendererEntity("eligible", 0, -1.5),
    ...Array.from({ length: 120 }, (_, index) =>
      rendererEntity(`rejected:${index}`, 0, -20 - index),
    ),
  ];
  let semanticSnapshots = 0;
  let structureSnapshots = 0;
  const receiver = mockRenderer(entities, () => {
    semanticSnapshots += 1;
    return [];
  });
  Object.assign(receiver, {
    resolvedStructures: () => {
      structureSnapshots += 1;
      return [];
    },
  });

  updateTarget(receiver);

  assert.deepEqual(receiver.getFocusQueryDiagnostics(), {
    candidateCount: 121,
    lineOfSightChecks: 1,
    colliderSnapshotBuilds: 1,
  });
  assert.equal(semanticSnapshots, 1);
  assert.equal(structureSnapshots, 1, "resolvedStructures is shared by the query");
  assert.equal(
    (Reflect.get(receiver, "currentTarget") as InteractionTarget | null)?.id,
    "eligible",
  );
});

test("semantic self-exclusion is target-specific and cached for duplicate target projections", () => {
  const selfCollider: WorldCollider = {
    kind: "circle",
    x: 0,
    z: -1,
    radius: 0.3,
  };
  const semanticQueries: Array<string | undefined> = [];
  const receiver = mockRenderer([], (excludingId) => {
    semanticQueries.push(excludingId);
    return excludingId === "semantic.target" ? [] : [selfCollider];
  });
  const consider = Reflect.get(
    RainforestRenderer.prototype,
    "considerFocusCandidate",
  ) as (
    this: unknown,
    context: {
      candidates: FocusCandidate[];
      diagnostics: {
        candidateCount: number;
        lineOfSightChecks: number;
        colliderSnapshotBuilds: number;
      };
      occluders: unknown;
    },
    candidate: Omit<FocusCandidate, "occluded">,
    endpoint: { x: number; z: number },
    exclusion: "semantic" | "none",
  ) => void;
  const semanticContext = {
    candidates: [] as FocusCandidate[],
    diagnostics: {
      candidateCount: 0,
      lineOfSightChecks: 0,
      colliderSnapshotBuilds: 0,
    },
    occluders: null,
  };
  const semanticCandidate = {
    target: target("semantic.target", 2, "inspect"),
    alignment: 1,
    visible: true,
  };

  consider.call(
    receiver,
    semanticContext,
    semanticCandidate,
    { x: 0, z: -2 },
    "semantic",
  );
  consider.call(
    receiver,
    semanticContext,
    semanticCandidate,
    { x: 0, z: -2 },
    "semantic",
  );

  assert.deepEqual(semanticContext.diagnostics, {
    candidateCount: 2,
    lineOfSightChecks: 2,
    colliderSnapshotBuilds: 1,
  });
  assert.deepEqual(
    semanticQueries,
    ["semantic.target"],
    "the same target exclusion snapshot is queried only once",
  );
  assert.deepEqual(
    semanticContext.candidates.map((candidate) => candidate.occluded),
    [false, false],
  );

  const ordinaryContext = {
    candidates: [] as FocusCandidate[],
    diagnostics: {
      candidateCount: 0,
      lineOfSightChecks: 0,
      colliderSnapshotBuilds: 0,
    },
    occluders: null,
  };
  consider.call(
    receiver,
    ordinaryContext,
    {
      target: target("authored.target", 2, "inspect"),
      alignment: 1,
      visible: true,
    },
    { x: 0, z: -2 },
    "none",
  );
  assert.deepEqual(semanticQueries, ["semantic.target", undefined]);
  assert.equal(
    ordinaryContext.candidates[0]?.occluded,
    true,
    "the collider still blocks a target that does not own it",
  );
});

test("target structure colliders are excluded while other structures still occlude", () => {
  const receiver = mockRenderer([]);
  const blocker: WorldCollider = {
    kind: "circle",
    x: 0,
    z: -1,
    radius: 0.3,
  };
  const snapshot = {
    fixed: [],
    semantic: [],
    semanticExcludingTarget: new Map(),
    legacyTrees: [],
    allLegacyTrees: [],
    structures: [{ id: "structure.target", colliders: [blocker] }],
    allStructures: [blocker],
  };
  const blocked = Reflect.get(
    RainforestRenderer.prototype,
    "isFocusLineOfSightBlocked",
  ) as (
    this: MockRenderer,
    endpoint: { x: number; z: number },
    targetId: string,
    exclusion: string,
    occluders: typeof snapshot,
    strict: boolean,
  ) => boolean;

  assert.equal(
    blocked.call(
      receiver,
      { x: 0, z: -2 },
      "structure.target",
      "structure",
      snapshot,
      false,
    ),
    false,
  );
  assert.equal(
    blocked.call(
      receiver,
      { x: 0, z: -2 },
      "structure.other",
      "structure",
      snapshot,
      false,
    ),
    true,
  );
});

test("river strict endpoint mode remains distinct from authored-control LOS", () => {
  const receiver = mockRenderer([]);
  const endpointCollider: WorldCollider = {
    kind: "circle",
    x: 0,
    z: -2,
    radius: 0.8,
  };
  const snapshot = {
    fixed: [endpointCollider],
    semantic: [],
    semanticExcludingTarget: new Map(),
    legacyTrees: [],
    allLegacyTrees: [],
    structures: [],
    allStructures: [],
  };
  const blocked = Reflect.get(
    RainforestRenderer.prototype,
    "isFocusLineOfSightBlocked",
  ) as (
    this: MockRenderer,
    endpoint: { x: number; z: number },
    targetId: string,
    exclusion: string,
    occluders: typeof snapshot,
    strict: boolean,
  ) => boolean;

  assert.equal(
    blocked.call(receiver, { x: 0, z: -2 }, "control", "none", snapshot, false),
    false,
  );
  assert.equal(
    blocked.call(receiver, { x: 0, z: -2 }, "river", "none", snapshot, true),
    true,
  );
});
