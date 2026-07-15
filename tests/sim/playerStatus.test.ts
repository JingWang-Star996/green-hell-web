import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialState,
  applyCommand,
  authoredSnakeIndividualId,
  deriveDamageIncidents,
  deriveDeathReview,
  deriveStatusSignals,
  FIXED_DT_SECONDS,
  MAX_HEALTH_LOSS_HISTORY,
  MAX_SANITY_LOSS_HISTORY,
  mergeTimedDamageIncidents,
  migrateGameState,
  pruneExpiredDamageIncidents,
  stepSimulation,
  type DamageIncident,
} from "../../src/game/sim/index";

test("state signals grade causal problems and keep critical hysteresis", () => {
  const state = createInitialState(71);
  state.player.conditions.wound.open = false;
  state.player.conditions.wound.severity = 0;
  state.player.conditions.wound.infection = 0;
  state.player.nutrition.hydration = 6;

  const first = deriveStatusSignals(state);
  const hydration = first.find((signal) => signal.id === "hydration");
  assert.equal(hydration?.severity, "critical");
  assert.match(hydration?.consequence ?? "", /归零后会快速损失生命/);
  assert.match(hydration?.actionLabel ?? "", /安全水源/);

  state.clock.tick += 30;
  state.player.nutrition.hydration = 11;
  const held = deriveStatusSignals(state, { previousSignals: first });
  assert.equal(
    held.find((signal) => signal.id === "hydration")?.severity,
    "critical",
  );

  state.player.nutrition.hydration = 32;
  const recovered = deriveStatusSignals(state, { previousSignals: held });
  assert.equal(
    recovered.find((signal) => signal.id === "hydration")?.severity,
    "observe",
  );
});

test("authoritative attack events become one bounded impact with source and amount", () => {
  const state = createInitialState(72);
  state.player.lookYaw = Math.PI;
  state.clock.elapsedSeconds = 12;
  state.eventLog.push({
    id: 900,
    tick: 330,
    elapsedSeconds: 11,
    type: "wildlife-attack",
    message: "琥珀环猎兽扑击。",
    cause: { source: "system", code: "wildlife:contact:glassfang-stalker" },
    details: {
      speciesId: "glassfang-stalker",
      healthLost: 18,
      bodyPart: "右肩",
      directionDegrees: -45,
    },
  });

  const impacts = deriveDamageIncidents(state, { afterEventId: 899 });
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].sourceLabel, "琥珀环猎兽");
  assert.equal(impacts[0].amount, 18);
  assert.equal(impacts[0].bodyPart, "右肩");
  assert.equal(impacts[0].directionDegrees, 315);
  assert.equal(impacts[0].relativeDirectionDegrees, -45);
  assert.equal(
    deriveDamageIncidents(state, { afterEventId: 900 }).length,
    0,
  );
});

test("death review names continuous dehydration and only reveals known advice", () => {
  const state = createInitialState(73);
  state.status = "lost";
  state.lossReason = "health";
  state.player.vitals.health = 0;
  state.player.vitals.energy = 60;
  state.player.nutrition.hydration = 0;
  state.player.nutrition.carbohydrates = 50;
  state.player.nutrition.protein = 50;
  state.player.nutrition.fat = 50;
  state.player.conditions.wound.open = false;
  state.player.conditions.wound.severity = 0;
  state.player.conditions.wound.infection = 0;

  const unknown = deriveDeathReview(state);
  assert.equal(unknown.directCauseCode, "condition:dehydration");
  assert.match(unknown.directCauseLabel, /脱水/);
  assert.equal(unknown.advice, null);
  assert.ok(unknown.chain.length >= 1 && unknown.chain.length <= 5);

  state.objectives.flags.waterPurified = true;
  const known = deriveDeathReview(state);
  assert.match(known.advice ?? "", /已经验证/);
});

test("a same-moment wildlife hit outranks background condition inference", () => {
  const state = createInitialState(74);
  state.status = "lost";
  state.lossReason = "health";
  state.player.vitals.health = 0;
  state.clock.elapsedSeconds = 40;
  state.eventLog.push({
    id: 901,
    tick: state.clock.tick,
    elapsedSeconds: 40,
    type: "snake-bite",
    message: "卷藤蝰咬中左臂。",
    cause: { source: "system", code: "wildlife:contact:coiled-viper" },
    details: {
      speciesId: "coiled-viper",
      healthLost: 12,
      healthBefore: 12,
      healthAfter: 0,
      lethal: true,
    },
  });

  const review = deriveDeathReview(state);
  assert.equal(review.directCauseCode, "wildlife:contact:coiled-viper");
  assert.match(review.directCauseLabel, /卷藤蝰/);
  assert.equal(review.inferred, false);
});

test("a recent nonlethal hit is not promoted into a certain direct death cause", () => {
  const state = createInitialState(75);
  state.status = "lost";
  state.lossReason = "health";
  state.player.vitals.health = 0;
  state.player.nutrition.hydration = 0;
  state.clock.elapsedSeconds = 40;
  state.eventLog.push({
    id: 902,
    tick: state.clock.tick,
    elapsedSeconds: 40,
    type: "wildlife-attack",
    message: "捕食者造成擦伤。",
    cause: { source: "system", code: "wildlife:contact:glassfang-stalker" },
    details: {
      speciesId: "glassfang-stalker",
      healthLost: 8,
      healthBefore: 30,
      healthAfter: 22,
      lethal: false,
    },
  });

  const review = deriveDeathReview(state);
  assert.equal(review.directCauseCode, "condition:dehydration");
  assert.equal(review.inferred, true);
  assert.equal(review.chain.some((step) => /捕食者造成擦伤/.test(step.label)), false);
});

test("a snake bite without an authoritative body location does not invent one", () => {
  const state = createInitialState(76);
  state.eventLog.push({
    id: 903,
    tick: 1,
    elapsedSeconds: 0,
    type: "snake-bite",
    message: "毒蛇扑咬。",
    cause: { source: "system", code: "wildlife:contact:coiled-viper" },
    details: { healthLost: 9, lethal: false },
  });
  const [incident] = deriveDamageIncidents(state, { afterEventId: 902 });
  assert.equal(incident.bodyPart, undefined);
});

test("concurrent continuous losses record the exact lethal crossing in source order", () => {
  const state = createInitialState(77);
  state.player.vitals.health = 0.004;
  state.player.vitals.energy = 0;
  state.player.nutrition.hydration = 0;
  state.player.nutrition.carbohydrates = 0;
  state.player.nutrition.protein = 0;
  state.player.nutrition.fat = 0;
  state.player.conditions.wound.open = true;
  state.player.conditions.wound.severity = 100;
  state.player.conditions.wound.infection = 100;

  const lost = stepSimulation(state, {}, FIXED_DT_SECONDS);
  const history = lost.healthLossHistory ?? [];
  assert.equal(lost.status, "lost");
  assert.deepEqual(
    history.map((record) => record.sourceCode),
    [
      "condition:infected-wound",
      "condition:dehydration",
      "condition:starvation",
    ],
  );
  assert.equal(history.filter((record) => record.lethal).length, 1);
  assert.equal(history.at(-1)?.sourceCode, "condition:starvation");
  for (const record of history) {
    assert.ok(record.amount > 0);
    assert.ok(
      Math.abs(record.amount - (record.healthBefore - record.healthAfter)) <
        1e-12,
    );
  }

  const review = deriveDeathReview(lost);
  assert.equal(review.directCauseCode, "condition:starvation");
  assert.equal(review.inferred, false);
  assert.ok(review.chain.length >= 3 && review.chain.length <= 5);
  assert.match(review.summary, /真正跨过致死线/);
});

test("one uninterrupted health source merges without losing exact boundaries", () => {
  const state = createInitialState(78);
  state.player.conditions.wound.open = true;
  state.player.conditions.wound.severity = 50;
  state.player.conditions.wound.infection = 0;
  state.player.nutrition.hydration = 100;
  state.player.nutrition.carbohydrates = 100;
  state.player.nutrition.protein = 100;
  state.player.nutrition.fat = 100;
  state.player.vitals.energy = 100;

  const advanced = stepSimulation(state, {}, 1);
  const history = advanced.healthLossHistory ?? [];
  assert.equal(history.length, 1);
  assert.equal(history[0].sourceCode, "condition:open-wound");
  assert.ok(history[0].sampleCount > 1);
  assert.ok(
    Math.abs(
      history[0].amount -
        (history[0].healthBefore - history[0].healthAfter),
    ) < 1e-12,
  );
});

test("concurrent parasite, wet-cold and night pressure records the exact sanity collapse", () => {
  const state = createInitialState("sanity-causal-night");
  state.player.vitals.health = 100;
  state.player.vitals.energy = 100;
  state.player.vitals.sanity = 0.0003;
  state.player.nutrition.hydration = 100;
  state.player.nutrition.carbohydrates = 100;
  state.player.nutrition.protein = 100;
  state.player.nutrition.fat = 100;
  state.player.conditions.wound = {
    open: false,
    treated: false,
    severity: 0,
    infection: 0,
  };
  state.player.conditions.parasites = 3;
  state.player.conditions.wetness = 100;
  // 600 game minutes after the 14:00 start is midnight; keep the two clock
  // representations coherent so the next fixed tick remains in the night.
  state.clock.gameMinutesElapsed = 600;
  state.clock.minuteOfDay = 0;

  const lost = stepSimulation(state, {}, FIXED_DT_SECONDS);
  const history = lost.sanityLossHistory ?? [];
  assert.equal(lost.status, "lost");
  assert.equal(lost.lossReason, "sanity");
  assert.deepEqual(
    history.map((record) => record.sourceCode),
    [
      "condition:parasites",
      "condition:wet-cold",
      "condition:night-isolation",
    ],
  );
  assert.equal(history.filter((record) => record.lethal).length, 1);
  assert.equal(history.at(-1)?.sourceCode, "condition:night-isolation");
  for (const record of history) {
    assert.ok(record.amount > 0);
    assert.ok(
      Math.abs(
        record.amount - (record.sanityBefore - record.sanityAfter),
      ) < 1e-12,
    );
  }

  const review = deriveDeathReview(lost);
  assert.equal(review.directCauseCode, "condition:night-isolation");
  assert.match(review.directCauseLabel, /黑夜/);
  assert.equal(review.inferred, false);
  assert.match(review.summary, /真正跨过崩溃线/);
  assert.ok(review.chain.length >= 3 && review.chain.length <= 5);
});

test("an embodied enemy can authoritatively cross the sanity death boundary", () => {
  const hazardId = "hazard.snake.stream-ridge";
  const state = createInitialState("sanity-causal-enemy");
  state.player.vitals.health = 100;
  state.player.vitals.sanity = 5;
  state.player.conditions.wound = {
    open: false,
    treated: false,
    severity: 0,
    infection: 0,
  };
  state.player.position = { ...state.world.entities[hazardId].position };

  const lost = applyCommand(state, {
    type: "encounter-wildlife",
    individualId: authoredSnakeIndividualId(hazardId),
  });
  const lethal = lost.sanityLossHistory?.at(-1);
  assert.equal(lost.status, "lost");
  assert.equal(lost.lossReason, "sanity");
  assert.equal(lethal?.sourceCode, "wildlife:contact:coiled-viper");
  assert.equal(lethal?.sanityBefore, 5);
  assert.equal(lethal?.sanityAfter, 0);
  assert.equal(lethal?.lethal, true);

  const review = deriveDeathReview(lost);
  assert.equal(review.directCauseCode, "wildlife:contact:coiled-viper");
  assert.match(review.directCauseLabel, /眼镜蛇/);
  assert.equal(review.inferred, false);
});

test("migration bounds causal evidence and rejects fabricated rows", () => {
  const state = createInitialState(79);
  const rows = Array.from({ length: 12 }, (_, index) => ({
    id: `legacy:${index}`,
    sourceCode: "condition:dehydration",
    sourceLabel: "持续脱水",
    amount: 99,
    healthBefore: 100 - index,
    healthAfter: 99 - index,
    startedTick: index,
    startedElapsedSeconds: index,
    tick: index,
    elapsedSeconds: index,
    sampleCount: 1,
    lethal: true,
  }));
  (state as unknown as { healthLossHistory: unknown[] }).healthLossHistory = [
    { sourceCode: "", healthBefore: 5, healthAfter: 0 },
    ...rows,
  ];

  const migrated = migrateGameState(state);
  assert.equal(migrated.healthLossHistory?.length, MAX_HEALTH_LOSS_HISTORY);
  assert.equal(migrated.healthLossHistory?.[0].id, "legacy:4");
  assert.ok(
    migrated.healthLossHistory?.every(
      (record) => record.amount === 1 && record.lethal === false,
    ),
  );

  const sanityRows = Array.from({ length: 12 }, (_, index) => ({
    id: `legacy-sanity:${index}`,
    sourceCode: "condition:night-isolation",
    sourceLabel: "无火照明的黑夜",
    amount: 99,
    sanityBefore: 100 - index,
    sanityAfter: 99 - index,
    startedTick: index,
    startedElapsedSeconds: index,
    tick: index,
    elapsedSeconds: index,
    sampleCount: 1,
    lethal: true,
  }));
  (state as unknown as { sanityLossHistory: unknown[] }).sanityLossHistory = [
    { sourceCode: "", sanityBefore: 5, sanityAfter: 0 },
    ...sanityRows,
  ];
  const migratedSanity = migrateGameState(state);
  assert.equal(
    migratedSanity.sanityLossHistory?.length,
    MAX_SANITY_LOSS_HISTORY,
  );
  assert.equal(migratedSanity.sanityLossHistory?.[0].id, "legacy-sanity:4");
  assert.ok(
    migratedSanity.sanityLossHistory?.every(
      (record) => record.amount === 1 && record.lethal === false,
    ),
  );

  const oldSave = createInitialState(80);
  delete oldSave.healthLossHistory;
  delete oldSave.sanityLossHistory;
  assert.deepEqual(migrateGameState(oldSave).healthLossHistory, []);
  assert.deepEqual(migrateGameState(oldSave).sanityLossHistory, []);
});

test("migration rejects known-shape loss rows with unknown or spoofed provenance", () => {
  const health = createInitialState("forged-health-history");
  health.status = "lost";
  health.lossReason = "health";
  health.player.vitals.health = 0;
  health.clock.tick = 90;
  health.clock.elapsedSeconds = 3;
  health.healthLossHistory = [{
    id: "forged-health",
    sourceCode: "condition:meteor-strike",
    sourceLabel: "来自存档的伪造死因",
    amount: 5,
    healthBefore: 5,
    healthAfter: 0,
    startedTick: 90,
    startedElapsedSeconds: 3,
    tick: 90,
    elapsedSeconds: 3,
    sampleCount: 1,
    lethal: true,
  }];

  const migratedHealth = migrateGameState(health);
  assert.deepEqual(migratedHealth.healthLossHistory, []);
  assert.equal(deriveDeathReview(migratedHealth).inferred, true);

  const sanity = createInitialState("forged-sanity-history");
  sanity.status = "lost";
  sanity.lossReason = "sanity";
  sanity.player.vitals.sanity = 0;
  sanity.clock.tick = 120;
  sanity.clock.elapsedSeconds = 4;
  sanity.sanityLossHistory = [{
    id: "forged-sanity",
    sourceCode: "condition:night-isolation",
    sourceLabel: "并不存在的神秘低语",
    amount: 2,
    sanityBefore: 2,
    sanityAfter: 0,
    startedTick: 120,
    startedElapsedSeconds: 4,
    tick: 120,
    elapsedSeconds: 4,
    sampleCount: 1,
    lethal: true,
  }];

  const migratedSanity = migrateGameState(sanity);
  assert.deepEqual(migratedSanity.sanityLossHistory, []);
  assert.equal(deriveDeathReview(migratedSanity).inferred, true);
});

test("migration discards out-of-order and discontinuous causal boundaries", () => {
  const health = createInitialState("broken-health-chain");
  health.healthLossHistory = [
    {
      id: "health-valid",
      sourceCode: "condition:dehydration",
      sourceLabel: "持续脱水",
      amount: 10,
      healthBefore: 100,
      healthAfter: 90,
      startedTick: 10,
      startedElapsedSeconds: 1,
      tick: 10,
      elapsedSeconds: 1,
      sampleCount: 1,
      lethal: false,
    },
    {
      id: "health-gap",
      sourceCode: "condition:starvation",
      sourceLabel: "3 类营养归零",
      amount: 80,
      healthBefore: 80,
      healthAfter: 0,
      startedTick: 11,
      startedElapsedSeconds: 1.1,
      tick: 11,
      elapsedSeconds: 1.1,
      sampleCount: 1,
      lethal: true,
    },
  ];
  assert.deepEqual(
    migrateGameState(health).healthLossHistory?.map((record) => record.id),
    ["health-valid"],
  );

  const sanity = createInitialState("broken-sanity-chain");
  sanity.sanityLossHistory = [
    {
      id: "sanity-valid",
      sourceCode: "condition:wet-cold",
      sourceLabel: "持续湿冷暴露",
      amount: 5,
      sanityBefore: 100,
      sanityAfter: 95,
      startedTick: 20,
      startedElapsedSeconds: 2,
      tick: 20,
      elapsedSeconds: 2,
      sampleCount: 1,
      lethal: false,
    },
    {
      id: "sanity-backdated",
      sourceCode: "condition:night-isolation",
      sourceLabel: "无火照明的黑夜",
      amount: 5,
      sanityBefore: 95,
      sanityAfter: 90,
      startedTick: 19,
      startedElapsedSeconds: 1.9,
      tick: 19,
      elapsedSeconds: 1.9,
      sampleCount: 1,
      lethal: false,
    },
  ];
  assert.deepEqual(
    migrateGameState(sanity).sanityLossHistory?.map((record) => record.id),
    ["sanity-valid"],
  );
});

test("death review requires exact terminal clock and vital association", () => {
  const state = createInitialState("stale-terminal-history");
  state.status = "lost";
  state.lossReason = "health";
  state.player.vitals.health = 0;
  state.clock.tick = 300;
  state.clock.elapsedSeconds = 10;
  state.healthLossHistory = [{
    id: "stale-lethal-row",
    sourceCode: "condition:dehydration",
    sourceLabel: "持续脱水",
    amount: 1,
    healthBefore: 1,
    healthAfter: 0,
    startedTick: 299,
    startedElapsedSeconds: 9.9,
    tick: 299,
    elapsedSeconds: 9.9,
    sampleCount: 1,
    lethal: true,
  }];

  const migrated = migrateGameState(state);
  assert.equal(migrated.healthLossHistory?.length, 1);
  const review = deriveDeathReview(migrated);
  assert.equal(review.inferred, true);
  assert.notEqual(review.directCauseCode, "condition:dehydration");

  const sanity = createInitialState("stale-sanity-terminal-history");
  sanity.status = "lost";
  sanity.lossReason = "sanity";
  sanity.player.vitals.sanity = 0;
  sanity.clock.tick = 600;
  sanity.clock.elapsedSeconds = 20;
  sanity.sanityLossHistory = [{
    id: "stale-sanity-lethal-row",
    sourceCode: "condition:night-isolation",
    sourceLabel: "无火照明的黑夜",
    amount: 1,
    sanityBefore: 1,
    sanityAfter: 0,
    startedTick: 599,
    startedElapsedSeconds: 19.9,
    tick: 599,
    elapsedSeconds: 19.9,
    sampleCount: 1,
    lethal: true,
  }];

  const migratedSanity = migrateGameState(sanity);
  assert.equal(migratedSanity.sanityLossHistory?.length, 1);
  const sanityReview = deriveDeathReview(migratedSanity);
  assert.equal(sanityReview.inferred, true);
  assert.notEqual(sanityReview.directCauseCode, "condition:night-isolation");
});

function impact(eventId: number): DamageIncident {
  return {
    id: `damage:${eventId}`,
    eventId,
    tick: eventId,
    elapsedSeconds: eventId,
    causeCode: "wildlife:contact:coiled-viper",
    sourceLabel: `毒蛇 ${eventId}`,
    amount: 8,
    lethal: false,
    severity: "warning",
    conditionIds: ["open-wound"],
    actionLabel: "拉开距离",
  };
}

test("rapid triple hits merge by event id and expire on independent deadlines", () => {
  let visible = mergeTimedDamageIncidents([], [impact(1)], 1_000);
  visible = mergeTimedDamageIncidents(visible, [impact(2)], 3_000);
  visible = mergeTimedDamageIncidents(visible, [impact(3)], 4_000);

  assert.deepEqual(visible.map((incident) => incident.eventId), [1, 2, 3]);
  assert.deepEqual(
    visible.map((incident) => incident.expiresAtMilliseconds),
    [9_000, 11_000, 12_000],
  );

  const duplicate = mergeTimedDamageIncidents(visible, [impact(3)], 5_000);
  assert.equal(duplicate.length, 3);
  assert.equal(duplicate.at(-1)?.expiresAtMilliseconds, 12_000);

  const afterFirstDeadline = pruneExpiredDamageIncidents(duplicate, 9_001);
  assert.deepEqual(
    afterFirstDeadline.map((incident) => incident.eventId),
    [2, 3],
  );
  assert.deepEqual(pruneExpiredDamageIncidents(afterFirstDeadline, 12_001), []);
});
