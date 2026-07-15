import assert from "node:assert/strict";
import test from "node:test";

import {
  commandForInteraction,
  synchronizeInteractionPlayerFrame,
} from "../../src/game/GameClient";
import {
  RainforestRenderer,
  isLineOfSightBlocked,
  selectFocusedTarget,
  type FocusCandidate,
} from "../../src/game/render/RainforestRenderer";
import type {
  InteractionTarget,
  RenderEntity,
  RenderSnapshot,
} from "../../src/game/render/types";
import { createInitialState } from "../../src/game/sim/state";
import { applyCommand } from "../../src/game/sim/simulation";
import type { GameState } from "../../src/game/sim/types";
import { createRenderSnapshot } from "../../src/game/ui/viewModel";

function renderEntity(snapshot: RenderSnapshot, id: string): RenderEntity {
  const result = snapshot.entities.find((entity) => entity.id === id);
  assert.ok(result, `missing render entity ${id}`);
  return result;
}

function interactionTarget(entity: RenderEntity, distance = 1): InteractionTarget {
  return {
    id: entity.id,
    kind: entity.kind,
    label: entity.label,
    distance,
    affordance: entity.affordance,
  };
}

function projectedTargets(snapshot: RenderSnapshot): InteractionTarget[] {
  return [
    ...snapshot.entities
      .filter((entity) => entity.interactive)
      .map((entity) => interactionTarget(entity)),
    ...snapshot.wildlife
      .filter((wildlife) => wildlife.visible)
      .map((wildlife) => ({
        id: `wildlife:${wildlife.individualId}`,
        kind: "animal" as const,
        label: wildlife.label,
        distance: 1,
        affordance: wildlife.affordance,
      })),
  ];
}

function firstSemanticEntity(
  state: GameState,
  category: "tree" | "mineable-rock" | "harvestable-plant",
) {
  const result = Object.values(state.world.entities).find(
    (entity) => entity.semantic?.category === category,
  );
  assert.ok(result, `missing semantic ${category}`);
  return result;
}

test("render snapshot carries selector truth for resources and structure focus proxies", () => {
  const state = createInitialState("s4-render-affordance");
  const tree = firstSemanticEntity(state, "tree");
  const blockedTree = renderEntity(createRenderSnapshot(state), tree.id);
  assert.equal(blockedTree.interactive, true);
  assert.equal(blockedTree.affordance.state, "blocked");
  assert.equal(blockedTree.affordance.actionId, "chop");
  assert.equal(blockedTree.interactRadius, blockedTree.affordance.range);

  state.camp.fire.built = true;
  state.camp.bedBuilt = true;
  state.camp.shelterBuilt = true;
  state.inventory.stick = 1;
  state.camp.fire.lit = true;
  const withStructures = createRenderSnapshot(state);
  const campfire = withStructures.entities.find(
    (entity) => entity.kind === "campfire",
  );
  const bed = withStructures.entities.find((entity) => entity.kind === "bed");
  const shelter = withStructures.entities.find(
    (entity) => entity.kind === "shelter",
  );
  assert.ok(campfire);
  assert.ok(bed);
  assert.ok(shelter);
  assert.equal(campfire.affordance.actionId, "add-fuel");
  assert.equal(bed.affordance.actionId, "rest");
  assert.equal(
    shelter.interactive,
    true,
    "built shelter remains inspectable without advertising a mutating action",
  );
  assert.equal(shelter.affordance.interactionMode, "inspect");
  assert.equal(
    withStructures.entities.filter((entity) => entity.kind === "campfire").length,
    1,
    "one placed structure must project one focus proxy",
  );
});

test("focus policy enforces affordance range, visibility, occlusion, and one winner", () => {
  const state = createInitialState("s4-focus-policy");
  const tree = firstSemanticEntity(state, "tree");
  const base = interactionTarget(renderEntity(createRenderSnapshot(state), tree.id));
  const blockedNear: FocusCandidate = {
    target: { ...base, id: "near", distance: 1.1 },
    alignment: 0.98,
    visible: true,
    occluded: true,
  };
  const visibleFarther: FocusCandidate = {
    target: { ...base, id: "visible", distance: 1.8 },
    alignment: 0.95,
    visible: true,
    occluded: false,
  };

  assert.equal(
    selectFocusedTarget([blockedNear, visibleFarther])?.id,
    "visible",
  );
  assert.equal(
    selectFocusedTarget([
      {
        ...visibleFarther,
        target: {
          ...visibleFarther.target,
          distance: visibleFarther.target.affordance.range + 0.01,
        },
      },
    ]),
    null,
  );
  assert.equal(
    isLineOfSightBlocked(
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      [{ kind: "circle", x: 5, z: 0, radius: 0.8 }],
    ),
    true,
  );
  const waterEndpointTree = {
    kind: "circle" as const,
    x: 10,
    z: 0,
    radius: 2,
  };
  assert.equal(
    isLineOfSightBlocked(
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      [waterEndpointTree],
    ),
    false,
    "authored controls retain the target-contained exception",
  );
  assert.equal(
    isLineOfSightBlocked(
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      [waterEndpointTree],
      { ignoreBlockersContainingTarget: false },
    ),
    true,
    "continuous water focus uses strict first-entry occlusion",
  );
  assert.equal(
    selectFocusedTarget([{ ...visibleFarther, alignment: 0.7 }]),
    null,
    "physical actions require a tight crosshair alignment",
  );
  assert.equal(
    selectFocusedTarget([
      {
        ...visibleFarther,
        alignment: 0.7,
        target: {
          ...visibleFarther.target,
          affordance: {
            ...visibleFarther.target.affordance,
            actionId: "inspect",
            animationKey: "hand.inspect",
          },
        },
      },
    ])?.id,
    "visible",
    "hand/inspect focus keeps the wider usability cone",
  );
  assert.equal(
    isLineOfSightBlocked(
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      [{ kind: "box", x: 5, z: 0, halfWidth: 0.5, halfDepth: 0.5 }],
    ),
    true,
  );
});

test("interaction mapping executes semantic harvests and never fakes blocked actions", () => {
  const state = createInitialState("s4-command-contract");
  const tree = firstSemanticEntity(state, "tree");
  let snapshot = createRenderSnapshot(state);
  assert.equal(commandForInteraction(state, interactionTarget(renderEntity(snapshot, tree.id))), null);

  state.inventory.axe = 1;
  state.player.equippedItem = "axe";
  snapshot = createRenderSnapshot(state);
  assert.deepEqual(
    commandForInteraction(state, interactionTarget(renderEntity(snapshot, tree.id))),
    {
      type: "physical-action",
      targetId: tree.id,
      actionId: "chop",
      poseRevision: 0,
    },
  );

  const rock = Object.values(state.world.entities).find(
    (entity) =>
      entity.semantic?.category === "mineable-rock" &&
      entity.semantic.toolTier === 1,
  );
  assert.ok(rock, "missing tier-one semantic rock");
  assert.equal(
    commandForInteraction(state, interactionTarget(renderEntity(snapshot, rock.id))),
    null,
    "a rock without the equipped pick cannot execute",
  );
  state.inventory["stone-pick"] = 1;
  state.player.equippedItem = "stone-pick";
  snapshot = createRenderSnapshot(state);
  const rockTarget = interactionTarget(renderEntity(snapshot, rock.id));
  assert.equal(rockTarget.affordance.actionId, "mine");
  assert.deepEqual(commandForInteraction(state, rockTarget), {
    type: "physical-action",
    targetId: rock.id,
    actionId: "mine",
    poseRevision: 0,
  });

  const snake = state.world.entities["hazard.snake.stream-ridge"];
  assert.ok(snake);
  assert.equal(
    snapshot.entities.some((entity) => entity.id === snake.id),
    false,
    "authored snake anchors must not create a second static hazard view",
  );
  let snakeProjection = snapshot.wildlife.find(
    (candidate) => candidate.individualId.endsWith(snake.id),
  );
  assert.ok(snakeProjection);
  let snakeTarget: InteractionTarget = {
    id: `wildlife:${snakeProjection.individualId}`,
    kind: "animal",
    label: snakeProjection.label,
    distance: 1,
    affordance: snakeProjection.affordance,
  };
  assert.equal(snakeTarget.affordance.actionId, "avoid");
  assert.equal(commandForInteraction(state, snakeTarget), null);

  state.inventory.spear = 1;
  state.player.equippedItem = "spear";
  snapshot = createRenderSnapshot(state);
  snakeProjection = snapshot.wildlife.find(
    (candidate) => candidate.individualId.endsWith(snake.id),
  );
  assert.ok(snakeProjection);
  snakeTarget = {
    id: `wildlife:${snakeProjection.individualId}`,
    kind: "animal",
    label: snakeProjection.label,
    distance: 1,
    affordance: snakeProjection.affordance,
  };
  assert.equal(snakeTarget.affordance.actionId, "attack");
  assert.deepEqual(commandForInteraction(state, snakeTarget), {
    type: "physical-action",
    targetId: `wildlife:${snakeProjection.individualId}`,
    actionId: "attack",
    poseRevision: 0,
  });
});

test("spatial interaction settles against the latest renderer frame, not the stale timer pose", () => {
  const state = createInitialState("interaction-frame-sync");
  const entity = state.world.entities["resource.stick.camp-01"];
  assert.ok(entity);
  state.player.position = {
    x: entity.position.x + entity.interactRadius + 0.5,
    y: 0,
    z: entity.position.z,
  };
  const snapshot = createRenderSnapshot(state);
  const target = interactionTarget(renderEntity(snapshot, entity.id), 1);
  const command = commandForInteraction(state, target);
  assert.ok(command);

  const stale = applyCommand(state, command);
  assert.equal(stale.eventLog.at(-1)?.type, "command-rejected");

  const synchronized = synchronizeInteractionPlayerFrame(state, {
    x: entity.position.x,
    z: entity.position.z,
    yaw: 0,
    pitch: 0,
  });
  const settled = applyCommand(synchronized, commandForInteraction(synchronized, target)!);
  assert.equal(settled.eventLog.at(-1)?.type, "resource-picked");
  assert.equal(settled.inventory.stick, state.inventory.stick + 1);
});

test("advertised interaction modes agree with authoritative command mapping", () => {
  const states = [
    createInitialState("command-invariant-base"),
    createInitialState("command-invariant-axe"),
    createInitialState("command-invariant-pick"),
    createInitialState("command-invariant-spear"),
  ];
  states[1].inventory.axe = 1;
  states[1].player.equippedItem = "axe";
  states[2].inventory["stone-pick"] = 1;
  states[2].player.equippedItem = "stone-pick";
  states[3].inventory.spear = 1;
  states[3].player.equippedItem = "spear";

  let executeCount = 0;
  let inspectCommandCount = 0;
  let rejectedCount = 0;
  for (const state of states) {
    for (const target of projectedTargets(createRenderSnapshot(state))) {
      const command = commandForInteraction(state, target);
      if (target.affordance.interactionMode === "execute") {
        executeCount += 1;
        assert.ok(
          command,
          `${target.id} advertises execute without an authoritative command`,
        );
      } else if (
        target.affordance.interactionMode === "movement" ||
        target.affordance.interactionMode === "unavailable"
      ) {
        rejectedCount += 1;
        assert.equal(
          command,
          null,
          `${target.id} must not map advice or a blocker to an action`,
        );
      } else if (target.affordance.actionId === "inspect") {
        inspectCommandCount += 1;
        assert.equal(command?.type, "inspect-landmark");
      }
    }
  }
  assert.ok(executeCount > 0);
  assert.ok(inspectCommandCount > 0);
  assert.ok(rejectedCount > 0);
});

test("legacy renderer entry points delegate to the single action path", () => {
  let actions = 0;
  const receiver = {
    performCurrentAction: () => {
      actions += 1;
    },
  } as unknown as RainforestRenderer;

  RainforestRenderer.prototype.interact.call(receiver);
  RainforestRenderer.prototype.primaryAction.call(receiver);
  assert.equal(actions, 2);
});

test("a snake can warn and strike again only after the player fully retreats", () => {
  const individualId = "authored-snake:hazard.snake.telegraph-test";
  let warnings = 0;
  let strikes = 0;
  let contactClear = false;
  const receiver = {
    wildlifeViews: new Map([
      [
        individualId,
        {
          projection: {
            individualId,
            speciesId: "coiled-viper",
            role: "predator",
            visible: true,
            health: 44,
            position: { x: 0, y: 0, z: 0 },
            encounter: { awarenessRadius: 7 },
          },
        },
      ],
    ]),
    player: { x: 6, z: 0 },
    hazardWarned: new Set<string>(),
    hazardTriggered: new Set<string>(),
    hazardTelegraphStarted: new Map<string, number>(),
    hazardBlockedUntil: new Map<string, number>(),
    predatorContactTransaction(warningId: string) {
      if (this.hazardTriggered.has(warningId)) return { phase: "triggered" as const };
      const retryAt = this.hazardBlockedUntil.get(warningId);
      if (retryAt !== undefined) return { phase: "blocked-recovery" as const, retryAt };
      const startedAt = this.hazardTelegraphStarted.get(warningId);
      return startedAt === undefined
        ? { phase: "idle" as const }
        : { phase: "windup" as const, startedAt };
    },
    applyPredatorContactTransaction(
      warningId: string,
      transaction:
        | { phase: "idle" }
        | { phase: "windup"; startedAt: number }
        | { phase: "blocked-recovery"; retryAt: number }
        | { phase: "triggered" },
    ) {
      if (transaction.phase === "triggered") this.hazardTriggered.add(warningId);
      else this.hazardTriggered.delete(warningId);
      if (transaction.phase === "windup") {
        this.hazardTelegraphStarted.set(warningId, transaction.startedAt);
      } else this.hazardTelegraphStarted.delete(warningId);
      if (transaction.phase === "blocked-recovery") {
        this.hazardBlockedUntil.set(warningId, transaction.retryAt);
      } else this.hazardBlockedUntil.delete(warningId);
    },
    isPredatorContactClear: () => contactClear,
    callbacks: {
      onHazardWarning: () => {
        warnings += 1;
      },
      onHazard: () => {
        strikes += 1;
        return true;
      },
    },
  };
  const checkHazards = Reflect.get(
    RainforestRenderer.prototype,
    "checkHazards",
  ) as (this: typeof receiver) => void;
  const warningId = `wildlife:${individualId}`;

  checkHazards.call(receiver);
  assert.equal(warnings, 1);
  receiver.player.x = 0;
  receiver.hazardTelegraphStarted.set(warningId, performance.now() - 1_000);
  checkHazards.call(receiver);
  assert.equal(strikes, 0, "warning may cross cover but contact may not");
  assert.equal(receiver.hazardTelegraphStarted.has(warningId), false);
  assert.equal(receiver.hazardTriggered.has(warningId), false);
  assert.equal(receiver.hazardBlockedUntil.has(warningId), true);

  contactClear = true;
  receiver.hazardBlockedUntil.set(warningId, performance.now() - 1);
  checkHazards.call(receiver);
  receiver.hazardTelegraphStarted.set(warningId, performance.now() - 1_000);
  checkHazards.call(receiver);
  assert.equal(strikes, 1);

  receiver.player.x = 9;
  checkHazards.call(receiver);
  receiver.player.x = 6;
  checkHazards.call(receiver);
  assert.equal(warnings, 2);
  receiver.player.x = 0;
  receiver.hazardTelegraphStarted.set(warningId, performance.now() - 1_000);
  checkHazards.call(receiver);
  assert.equal(strikes, 2);
});
