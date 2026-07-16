import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeathReview } from "../../src/game/ui/DeathReview";
import { PlayerStateFeedback } from "../../src/game/ui/PlayerStateFeedback";

test("player feedback names severity, source, damage and action without relying on colour", () => {
  const markup = renderToStaticMarkup(createElement(PlayerStateFeedback, {
    signals: [{
      id: "hydration",
      category: "hydration",
      severity: "critical",
      icon: "●",
      label: "水分不足",
      consequence: "水分归零后会快速损失生命。",
      actionLabel: "寻找安全水源",
      value: 4,
      startedTick: 1,
      updatedTick: 2,
    }],
    incidents: [{
      id: "damage:8",
      eventId: 8,
      tick: 20,
      elapsedSeconds: 3,
      causeCode: "wildlife:contact:coiled-viper",
      sourceLabel: "卷藤蝰",
      amount: 12,
      lethal: false,
      severity: "critical",
      bodyPart: "左臂",
      directionDegrees: 90,
      relativeDirectionDegrees: 90,
      conditionIds: ["open-wound"],
      actionLabel: "立刻拉开距离并检查伤口",
    }],
  }));
  assert.match(markup, /危急/);
  assert.match(markup, /卷藤蝰 · 12 点伤害/);
  assert.match(markup, /左臂受伤/);
  assert.match(markup, /伤害来自右侧/);
  assert.match(markup, /来源方向 90°（右侧）/);
  assert.match(markup, /寻找安全水源/);
  assert.match(markup, /data-severity="critical"/);
  assert.match(markup, /<details class="status-signal-mobile-tray status-signal-mobile-critical">/);
  assert.match(markup, /<summary aria-label="状态提醒：水分不足。点按展开详情">/);
  assert.doesNotMatch(markup, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.doesNotMatch(markup, /status-signal-stack" aria-live/);
});

test("mobile status tray collapses several persistent signals behind one compact summary", () => {
  const signals = ["开放伤口", "脱水", "寄生虫"].map((label, index) => ({
    id: `signal-${index}`,
    category: index === 0 ? "injury" as const : "hydration" as const,
    severity: index === 0 ? "critical" as const : "warning" as const,
    icon: "!",
    label,
    consequence: "继续活动会让状态恶化。",
    actionLabel: "展开后处理",
    value: 10,
    startedTick: index,
    updatedTick: index + 1,
  }));
  const markup = renderToStaticMarkup(createElement(PlayerStateFeedback, {
    signals,
    incidents: [],
  }));

  assert.match(markup, /状态提醒：开放伤口。点按展开详情/);
  assert.match(markup, /class="status-signal-count">\+2/);
  assert.equal((markup.match(/class="status-signal status-signal-/g) ?? []).length, 6);
});

test("death review makes checkpoint selection primary and keeps new run explicit", () => {
  const markup = renderToStaticMarkup(createElement(DeathReview, {
    review: {
      directCauseCode: "condition:dehydration",
      directCauseLabel: "持续脱水",
      summary: "水分归零后仍在活动。",
      chain: [{ id: "fact", elapsedSeconds: 42, label: "水分归零" }],
      advice: "你已经验证：出发前携带净水。",
      inferred: true,
    },
    hasCheckpoints: true,
    recommendedCheckpointLabel: "DAY 02 · 休息前",
    onChooseCheckpoint: () => undefined,
    onStartNewRun: () => undefined,
  }));
  assert.match(markup, /直接死因/);
  assert.match(markup, /选择恢复点/);
  assert.match(markup, /推荐：DAY 02 · 休息前/);
  assert.match(markup, /新的远征/);
  assert.ok(markup.indexOf("选择恢复点") < markup.indexOf("新的远征"));
});
