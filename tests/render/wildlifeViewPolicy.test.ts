import assert from "node:assert/strict";
import test from "node:test";

import { ECOLOGY_SPECIES } from "../../src/game/ecology";
import type { EcologyRenderProjection } from "../../src/game/ecology";
import {
  WILDLIFE_VIEW_LIMITS,
  selectWildlifeViews,
} from "../../src/game/render/wildlifeViewPolicy";

function wildlife(
  individualId: string,
  distance: number,
  overrides: Partial<EcologyRenderProjection> = {},
): EcologyRenderProjection {
  const species = ECOLOGY_SPECIES["reedtail-scuttler"];
  return {
    individualId,
    populationKey: "0:0|reedtail-scuttler",
    speciesId: species.id,
    label: species.label,
    role: species.role,
    chunkKey: "0:0",
    position: { x: distance, y: 0, z: 0 },
    headingRadians: 0,
    scale: 1,
    activity: 1,
    visibility: 1,
    visible: true,
    behavior: "forage",
    awareness: 0,
    health: species.combat.maxHealth,
    maxHealth: species.combat.maxHealth,
    encounter: species.encounter,
    ...overrides,
  };
}

test("view selection preserves gameplay continuity before nearby ambience", () => {
  const candidates = [
    wildlife("ambient", 1),
    wildlife("alert", 6),
    wildlife("telegraph", 7),
    wildlife("injured", 8, { health: 4 }),
    wildlife("focused", 10),
    wildlife("action", 9),
    wildlife("corpse", 100, { health: 0, behavior: "dead" }),
  ];
  const result = selectWildlifeViews(candidates, {
    maxViews: 7,
    observerPosition: { x: 0, z: 0 },
    focusedIndividualId: "focused",
    actionBoundIndividualIds: ["action"],
    telegraphIndividualIds: ["telegraph"],
    alertIndividualIds: ["alert"],
  });

  assert.deepEqual(
    result.selected.map((projection) => projection.individualId),
    [
      "action",
      "focused",
      "alert",
      "telegraph",
      "corpse",
      "injured",
      "ambient",
    ],
  );
  assert.equal(result.protectedCount, 6);
  assert.equal(result.ambientCount, 1);
  assert.equal(result.overflowCount, 0);
});

test("low and standard budgets deterministically cap nearest ambient wildlife", () => {
  const candidates = Array.from({ length: 30 }, (_, index) =>
    wildlife(`ambient-${String(index).padStart(2, "0")}`, index + 1),
  );
  const low = selectWildlifeViews(candidates, {
    maxViews: WILDLIFE_VIEW_LIMITS.low,
    observerPosition: { x: 0, z: 0 },
  });
  const standard = selectWildlifeViews(candidates, {
    maxViews: WILDLIFE_VIEW_LIMITS.standard,
    observerPosition: { x: 0, z: 0 },
  });

  assert.equal(low.selected.length, 10);
  assert.equal(low.ambientCount, 10);
  assert.deepEqual(
    low.selected.map((projection) => projection.individualId),
    candidates.slice(0, 10).map((projection) => projection.individualId),
  );
  assert.equal(standard.selected.length, 24);
  assert.equal(standard.ambientCount, 24);
  assert.deepEqual(
    standard.selected.map((projection) => projection.individualId),
    candidates.slice(0, 24).map((projection) => projection.individualId),
  );
});

test("protected wildlife may overflow the view budget without admitting ambience", () => {
  const injured = Array.from({ length: 12 }, (_, index) =>
    wildlife(`injured-${index}`, 20 - index, { health: 1 }),
  );
  const result = selectWildlifeViews(
    [wildlife("ambient-near", 0.5), ...injured],
    {
      maxViews: WILDLIFE_VIEW_LIMITS.low,
      observerPosition: { x: 0, z: 0 },
    },
  );

  assert.equal(result.selected.length, 12);
  assert.equal(result.protectedCount, 12);
  assert.equal(result.ambientCount, 0);
  assert.equal(result.overflowCount, 2);
  assert.equal(result.protectedCandidateCount, 12);
  assert.equal(result.protectedDroppedCount, 0);
  assert.ok(
    result.selected.every((projection) =>
      projection.individualId.startsWith("injured-"),
    ),
  );
});

test("emergency protection is hard-capped while interaction and nearest threats win", () => {
  const focused = wildlife("focused", 80);
  const awarePredators = Array.from({ length: 500 }, (_, index) =>
    wildlife(`predator-${String(index).padStart(3, "0")}`, index + 1, {
      role: "predator",
      awareness: 0.2,
      encounter: {
        kind: "danger",
        awarenessRadius: 16,
        dangerLevel: 0.8,
      },
    }),
  );
  const corpses = Array.from({ length: 500 }, (_, index) =>
    wildlife(`corpse-${String(index).padStart(3, "0")}`, index + 1, {
      health: 0,
      behavior: "dead",
    }),
  );
  const result = selectWildlifeViews(
    [...corpses, ...awarePredators, focused, wildlife("ambient", 0.1)],
    {
      maxViews: WILDLIFE_VIEW_LIMITS.low,
      observerPosition: { x: 0, z: 0 },
      focusedIndividualId: focused.individualId,
    },
  );

  assert.equal(result.hardViewLimit, 18);
  assert.equal(result.selected.length, result.hardViewLimit);
  assert.equal(result.selected[0].individualId, focused.individualId);
  assert.deepEqual(
    result.selected.slice(1).map((projection) => projection.individualId),
    awarePredators
      .slice(0, result.hardViewLimit - 1)
      .map((projection) => projection.individualId),
  );
  assert.equal(result.ambientCount, 0);
  assert.equal(result.overflowCount, 8);
  assert.equal(result.protectedCandidateCount, 1001);
  assert.equal(result.protectedDroppedCount, 983);
});

test("an aware predator is protected before it has a renderer alert or view", () => {
  const ambient = Array.from({ length: 12 }, (_, index) =>
    wildlife(`ambient-${index}`, index + 1),
  );
  const predator = wildlife("unseen-aware-predator", 100, {
    role: "predator",
    awareness: 0.15,
    encounter: {
      kind: "danger",
      awarenessRadius: 16,
      dangerLevel: 0.8,
    },
  });
  const result = selectWildlifeViews([...ambient, predator], {
    maxViews: WILDLIFE_VIEW_LIMITS.low,
    observerPosition: { x: 0, z: 0 },
  });

  assert.ok(
    result.selected.some(
      (projection) => projection.individualId === predator.individualId,
    ),
  );
  assert.equal(result.protectedCount, 1);
  assert.equal(result.ambientCount, 9);
  assert.equal(result.selected.length, 10);
});

test("selection ignores absent candidates and de-duplicates by stable identity", () => {
  const result = selectWildlifeViews(
    [
      wildlife("absent", 0.1, { visible: false }),
      wildlife("same", 10),
      wildlife("same", 11, { health: 2 }),
      wildlife("ambient", 2),
    ],
    {
      maxViews: 2,
      observerPosition: { x: 0, z: 0 },
    },
  );

  assert.deepEqual(
    result.selected.map((projection) => projection.individualId),
    ["same", "ambient"],
  );
  assert.equal(result.selected[0].health, 2);
});
