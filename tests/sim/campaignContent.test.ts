import assert from "node:assert/strict";
import test from "node:test";
import {
  CAMPAIGN_FACTS,
  EMERGENCY_RIVER_RESPONSE,
  RIVER_RISING_TASK,
  campaignTaskSatisfied,
  preparedRiverExpeditionFacts,
  radioResponseDue,
  riverReportReady,
} from "../../src/game/sim/campaignContent";
import { recordObjectiveFact } from "../../src/game/sim/objectiveFacts";
import type { ObjectiveFactRecord } from "../../src/game/sim/objectiveFacts";

test("emergency response is deterministic, delayed and idempotent", () => {
  let facts: ObjectiveFactRecord[] = [];
  facts = recordObjectiveFact(facts, CAMPAIGN_FACTS.distressReported, 300);

  assert.equal(radioResponseDue(facts, 419), false);
  assert.equal(radioResponseDue(facts, 420), true);
  facts = recordObjectiveFact(facts, EMERGENCY_RIVER_RESPONSE.produces, 420);
  assert.equal(radioResponseDue(facts, 9_999), false);
});

test("three preparation alternatives are based on carried inventory without consuming it", () => {
  const inventory = {
    torch: 1,
    "clean-water": 1,
    spear: 1,
    bandage: 1,
    stick: 4,
    stone: 3,
    vine: 1,
  };
  const before = structuredClone(inventory);
  const prepared = preparedRiverExpeditionFacts(inventory);

  assert.deepEqual(prepared, [
    CAMPAIGN_FACTS.riverLightKitPrepared,
    CAMPAIGN_FACTS.riverDefenseKitPrepared,
    CAMPAIGN_FACTS.riverFieldKitPrepared,
  ]);
  assert.deepEqual(inventory, before);
});

test("A1 requires the request, one preparation, world change, observation and report", () => {
  let facts: ObjectiveFactRecord[] = [];
  const required = [
    CAMPAIGN_FACTS.riverRequestHeard,
    CAMPAIGN_FACTS.riverDefenseKitPrepared,
    CAMPAIGN_FACTS.riverGaugeCleared,
    CAMPAIGN_FACTS.riverTrendObserved,
  ] as const;
  required.forEach((reference, index) => {
    facts = recordObjectiveFact(facts, reference, index + 1);
  });
  assert.equal(riverReportReady(facts), true);
  assert.equal(campaignTaskSatisfied(facts, RIVER_RISING_TASK), false);

  facts = recordObjectiveFact(facts, CAMPAIGN_FACTS.riverTrendReported, 8);
  assert.equal(campaignTaskSatisfied(facts, RIVER_RISING_TASK), true);
});

test("A1 radio authority rejects early observation until the request, preparation and clearance all exist", () => {
  let facts: ObjectiveFactRecord[] = [];
  facts = recordObjectiveFact(facts, CAMPAIGN_FACTS.riverTrendObserved, 1);
  assert.equal(riverReportReady(facts), false);
  facts = recordObjectiveFact(facts, CAMPAIGN_FACTS.riverRequestHeard, 2);
  facts = recordObjectiveFact(facts, CAMPAIGN_FACTS.riverLightKitPrepared, 3);
  assert.equal(riverReportReady(facts), false);
  facts = recordObjectiveFact(facts, CAMPAIGN_FACTS.riverGaugeCleared, 4);
  assert.equal(riverReportReady(facts), true);
});
