import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_OBJECTIVE_FACTS,
  clauseSatisfied,
  dedupeObjectiveFacts,
  firstUnsatisfiedGuidanceStep,
  hasObjectiveFact,
  objectiveFactTick,
  recordObjectiveFact,
  sanitizeObjectiveFactSubjectId,
  taskRequirementsSatisfied,
} from "../../src/game/sim/objectiveFacts";
import type {
  ObjectiveFactClause,
  ObjectiveFactRecord,
  ObjectiveGuidanceStep,
} from "../../src/game/sim/objectiveFacts";

const VISITED_RIVER = { verb: "visit", subjectId: "biome.river" } as const;
const INSPECTED_GAUGE = {
  verb: "inspect",
  subjectId: "landmark.river-gauge",
} as const;
const COLLECTED_SAMPLE = {
  verb: "collect",
  subjectId: "sample.blackwater-soil",
} as const;

test("duplicate facts collapse to one record and preserve the earliest known tick", () => {
  const facts = dedupeObjectiveFacts([
    { ...VISITED_RIVER, firstKnownTick: 120 },
    { ...VISITED_RIVER, firstKnownTick: 30 },
    { ...VISITED_RIVER, firstKnownTick: 90 },
  ]);

  assert.deepEqual(facts, [{ ...VISITED_RIVER, firstKnownTick: 30 }]);
  assert.equal(objectiveFactTick(facts, VISITED_RIVER), 30);
  assert.equal(hasObjectiveFact(facts, VISITED_RIVER), true);
});

test("subject identifiers reject executable, path-like, oversized, and non-ASCII input", () => {
  assert.equal(sanitizeObjectiveFactSubjectId("biome.river:west_01"), "biome.river:west_01");
  assert.equal(sanitizeObjectiveFactSubjectId("<script>alert(1)</script>"), null);
  assert.equal(sanitizeObjectiveFactSubjectId("../../save-slot"), null);
  assert.equal(sanitizeObjectiveFactSubjectId("雨林"), null);
  assert.equal(sanitizeObjectiveFactSubjectId("x".repeat(96)), "x".repeat(96));
  assert.equal(sanitizeObjectiveFactSubjectId("x".repeat(97)), null);

  assert.deepEqual(
    dedupeObjectiveFacts([
      { verb: "visit", subjectId: "<img:onerror>", firstKnownTick: 1 },
      { verb: "visit", subjectId: "biome.river", firstKnownTick: -1 },
      { verb: "execute", subjectId: "biome.river", firstKnownTick: 1 },
    ]),
    [],
  );
});

test("fact storage is bounded while late duplicates can still lower an existing first tick", () => {
  const input: ObjectiveFactRecord[] = Array.from(
    { length: MAX_OBJECTIVE_FACTS + 40 },
    (_, index) => ({
      verb: "observe",
      subjectId: `evidence.${index}`,
      firstKnownTick: 100 + index,
    }),
  );
  input.push({ verb: "observe", subjectId: "evidence.3", firstKnownTick: 2 });

  const facts = dedupeObjectiveFacts(input);
  assert.equal(facts.length, MAX_OBJECTIVE_FACTS);
  assert.equal(objectiveFactTick(facts, { verb: "observe", subjectId: "evidence.3" }), 2);
  assert.equal(
    hasObjectiveFact(facts, {
      verb: "observe",
      subjectId: `evidence.${MAX_OBJECTIVE_FACTS}`,
    }),
    false,
  );
});

test("recording is immutable, idempotent, and never moves firstKnownTick later", () => {
  const source = [{ ...VISITED_RIVER, firstKnownTick: 20 }];
  const later = recordObjectiveFact(source, VISITED_RIVER, 50);
  const earlier = recordObjectiveFact(later, {
    ...VISITED_RIVER,
    firstKnownTick: 5,
  });

  assert.notEqual(later, source);
  assert.equal(source[0].firstKnownTick, 20);
  assert.equal(objectiveFactTick(later, VISITED_RIVER), 20);
  assert.equal(objectiveFactTick(earlier, VISITED_RIVER), 5);
});

test("a clause is OR while the task requirement list is AND", () => {
  const routeClause: ObjectiveFactClause = {
    anyOf: [VISITED_RIVER, INSPECTED_GAUGE],
  };
  const evidenceClause: ObjectiveFactClause = { anyOf: [COLLECTED_SAMPLE] };
  const facts = [{ ...INSPECTED_GAUGE, firstKnownTick: 8 }];

  assert.equal(clauseSatisfied(facts, routeClause), true);
  assert.equal(clauseSatisfied(facts, evidenceClause), false);
  assert.equal(taskRequirementsSatisfied(facts, [routeClause, evidenceClause]), false);
  assert.equal(taskRequirementsSatisfied(facts, []), true);

  const completed = recordObjectiveFact(facts, COLLECTED_SAMPLE, 12);
  assert.equal(taskRequirementsSatisfied(completed, [routeClause, evidenceClause]), true);
});

test("campaign facts support heard, prepared, changed-world, observed and reported gates", () => {
  const facts = [
    { verb: "heard", subjectId: "radio.emergency-river-request", firstKnownTick: 2 },
    { verb: "prepared", subjectId: "river-expedition.light-kit", firstKnownTick: 4 },
    { verb: "changedWorld", subjectId: "river-gauge.access-cleared", firstKnownTick: 8 },
    { verb: "observed", subjectId: "river-gauge.level-trend", firstKnownTick: 9 },
    { verb: "reported", subjectId: "river-gauge.level-trend", firstKnownTick: 12 },
  ] as const;
  const requirements: ObjectiveFactClause[] = facts.map((fact) => ({
    anyOf: [{ verb: fact.verb, subjectId: fact.subjectId }],
  }));

  assert.equal(taskRequirementsSatisfied(facts, requirements), true);
});

test("guidance returns the first incomplete step without relying on transient events", () => {
  const steps: ObjectiveGuidanceStep[] = [
    {
      id: "reach-river",
      requirements: [{ anyOf: [VISITED_RIVER] }],
      instruction: "沿低地找到河道",
    },
    {
      id: "inspect-or-sample",
      requirements: [{ anyOf: [INSPECTED_GAUGE, COLLECTED_SAMPLE] }],
      instruction: "检查水位尺或取得土壤样本",
    },
  ];

  assert.equal(firstUnsatisfiedGuidanceStep([], steps)?.id, "reach-river");

  const reached = recordObjectiveFact([], VISITED_RIVER, 10);
  assert.equal(
    firstUnsatisfiedGuidanceStep(reached, steps)?.id,
    "inspect-or-sample",
  );

  const inspected = recordObjectiveFact(reached, INSPECTED_GAUGE, 14);
  assert.equal(firstUnsatisfiedGuidanceStep(inspected, steps), null);
});
