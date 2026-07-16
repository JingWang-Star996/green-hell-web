import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RainforestRenderer } from "../../src/game/render/RainforestRenderer";
import { HeldItemRig } from "../../src/game/render/HeldItemRig";
import type { ActionPhase, InteractionTarget } from "../../src/game/render/types";

function readyTarget(): InteractionTarget {
  return {
    id: "tree:contract",
    kind: "tree",
    label: "棕榈树",
    distance: 1,
    affordance: {
      objectId: "tree:contract",
      semanticKind: "tree",
      state: "ready",
      interactionMode: "execute",
      actionId: "chop",
      verb: "砍伐",
      blocker: null,
      requiredItem: "axe",
      range: 3,
      highlightTone: "interactable",
      animationKey: "tool.axe.chop",
      feedbackKey: "test.chop",
      preview: { label: "棕榈树", detail: "测试目标" },
      estimatedSeconds: 3,
    },
  };
}

test("renderer locks re-entry and commits once at the validated hit window", () => {
  let interactions = 0;
  let swings = 0;
  let cancels = 0;
  const phases: Array<ActionPhase | null> = [];
  const receiver = Object.assign(Object.create(RainforestRenderer.prototype), {
    placementPreview: { getKind: () => null },
    currentTarget: readyTarget(),
    actionTransaction: null,
    actionPhaseSignature: "",
    heldItemRig: {
      playUse: () => { swings += 1; },
      cancelUse: () => { cancels += 1; },
    },
    callbacks: {
      onInteract: () => { interactions += 1; },
      onActionPhaseChange: (phase: ActionPhase | null) => phases.push(phase),
    },
  }) as RainforestRenderer;

  RainforestRenderer.prototype.performCurrentAction.call(receiver);
  RainforestRenderer.prototype.performCurrentAction.call(receiver);
  assert.equal(swings, 1, "repeat input during windup must not restart the rig");
  assert.equal(interactions, 0, "input itself must not submit the command");

  const update = Reflect.get(
    RainforestRenderer.prototype,
    "updateActionTransaction",
  ) as (this: RainforestRenderer, deltaSeconds: number) => void;
  update.call(receiver, 0.17);
  update.call(receiver, 0.01);
  assert.equal(interactions, 1, "the hit-window entry submits exactly once");
  assert.equal(cancels, 0);
  assert.deepEqual(
    phases.slice(0, 2).map((phase) => phase?.phase),
    ["windup", "hit-window"],
  );
});

test("renderer keeps a physical binding when focus winner jitters away", () => {
  let interactions = 0;
  let cancels = 0;
  const phases: Array<ActionPhase | null> = [];
  const receiver = Object.assign(Object.create(RainforestRenderer.prototype), {
    placementPreview: { getKind: () => null },
    currentTarget: readyTarget(),
    actionTransaction: null,
    actionPhaseSignature: "",
    heldItemRig: {
      playUse: () => undefined,
      cancelUse: () => { cancels += 1; },
    },
    callbacks: {
      onInteract: () => { interactions += 1; },
      onActionPhaseChange: (phase: ActionPhase | null) => phases.push(phase),
    },
  }) as RainforestRenderer;
  RainforestRenderer.prototype.performCurrentAction.call(receiver);
  Object.assign(receiver, { currentTarget: null });

  const update = Reflect.get(
    RainforestRenderer.prototype,
    "updateActionTransaction",
  ) as (this: RainforestRenderer, deltaSeconds: number) => void;
  update.call(receiver, 0.016);
  assert.equal(interactions, 0);
  assert.equal(cancels, 0);
  assert.equal(phases.at(-1)?.phase, "windup");
  update.call(receiver, 0.17);
  assert.equal(interactions, 1);
});

test("placement remains the immediate, separate action path", () => {
  let placements = 0;
  let phases = 0;
  const receiver = {
    placementPreview: { getKind: () => "campfire" },
    confirmPlacement: () => { placements += 1; },
    actionTransaction: null,
    callbacks: { onActionPhaseChange: () => { phases += 1; } },
  } as unknown as RainforestRenderer;
  RainforestRenderer.prototype.performCurrentAction.call(receiver);
  assert.equal(placements, 1);
  assert.equal(phases, 0);
});

test("renderer source validates focus after target update and interrupts pause/visibility", () => {
  const source = readFileSync(
    new URL("../../src/game/render/RainforestRenderer.ts", import.meta.url),
    "utf8",
  );
  assert.ok(source.indexOf("this.updateTarget();") < source.indexOf("this.updateActionTransaction(delta);"));
  assert.match(source, /if \(paused\) this\.interruptActiveAction\("paused"\)/);
  assert.match(source, /this\.interruptActiveAction\("visibility-lost"\)/);
  assert.match(source, /if \(this\.actionTransaction\) return;/);
});

test("cancelling a held action immediately restores the idle pose before rendering pauses", () => {
  const rig = new HeldItemRig();
  rig.setKind("axe");
  rig.playUse();
  rig.update(0.1, false, false, false);
  assert.notEqual(rig.root.rotation.x, -0.08);

  rig.cancelUse();
  assert.equal(rig.root.position.x, 0.43);
  assert.equal(rig.root.position.y, -0.42);
  assert.equal(rig.root.position.z, -0.72);
  assert.equal(rig.root.rotation.x, -0.08);
  assert.equal(rig.root.rotation.y, -0.08);
  assert.equal(rig.root.rotation.z, -0.08);
  rig.dispose();
});
