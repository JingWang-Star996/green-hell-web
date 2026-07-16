import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameCommand, GameEvent, GameEventType } from "../../src/game/sim";
import { ActionFeedbackLayer } from "../../src/game/ui/ActionFeedbackLayer";
import { Panels } from "../../src/game/ui/Panels";
import {
  ACTION_RECEIPT_TTL_MS,
  actionReceiptTone,
  createActionReceipt,
  enqueueActionReceipt,
  pruneExpiredActionReceipts,
  type ActionReceipt,
} from "../../src/game/ui/actionReceipt";
import { createInitialState } from "../../src/game/sim/state";
import { createGameViewModel } from "../../src/game/ui/viewModel";

function gameEvent(
  id: number,
  type: GameEventType,
  message: string,
  source: GameEvent["cause"]["source"] = "command",
  details?: GameEvent["details"],
): GameEvent {
  return {
    id,
    tick: id,
    elapsedSeconds: id,
    type,
    message,
    cause: { source, code: type },
    details,
  };
}

function receiptFor(
  command: GameCommand,
  events: readonly GameEvent[],
  beforeEventId = 10,
  transactionId = `tx-${command.type}`,
): ActionReceipt {
  const receipt = createActionReceipt({
    transactionId,
    command,
    beforeEventId,
    events,
    nowMs: 1_000,
  });
  assert.ok(receipt);
  return receipt;
}

test("a command receipt keeps its primary result while pinning danger side effects above it", () => {
  const receipt = receiptFor(
    { type: "drink-water", itemId: "dirty-water" },
    [
      gameEvent(9, "food-spoiled", "旧存档里的腐坏", "system"),
      gameEvent(11, "parasite-contracted", "浑水带来了寄生虫。"),
      gameEvent(12, "water-drunk", "浑水暂时缓解了口渴。"),
      gameEvent(13, "weather-changed", "雨势在操作期间增强。", "system"),
    ],
  );

  assert.equal(receipt.primary.id, 12, "a later system event must not replace the command result");
  assert.equal(receipt.primary.type, "water-drunk");
  assert.deepEqual(receipt.dangerSideEffects.map((event) => event.id), [11]);
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.tone, "danger");
  assert.deepEqual(receipt.eventRange, { fromExclusive: 10, toInclusive: 13 });
  assert.equal(receipt.expiresAtMs - receipt.createdAtMs, ACTION_RECEIPT_TTL_MS.danger);

  const markup = renderToStaticMarkup(
    createElement(ActionFeedbackLayer, { receipts: [receipt], onExpire: () => undefined }),
  );
  assert.match(markup, /role="alert"/);
  assert.ok(markup.indexOf("浑水带来了寄生虫") < markup.indexOf("浑水暂时缓解了口渴"));
});

test("world, inventory, body, and crafting commands use command-specific primary results", () => {
  const cases: Array<{
    command: GameCommand;
    events: GameEvent[];
    primary: GameEventType;
  }> = [
    {
      command: { type: "harvest", entityId: "tree:1" },
      events: [
        gameEvent(11, "harvest-struck", "斧刃咬进树干。"),
        gameEvent(12, "task-completed", "任务完成。", "system"),
      ],
      primary: "harvest-struck",
    },
    {
      command: { type: "eat", itemId: "coconut" },
      events: [gameEvent(11, "item-used", "食用了椰子。")],
      primary: "item-used",
    },
    {
      command: { type: "use-item", itemId: "bandage" },
      events: [
        gameEvent(11, "wound-treated", "伤口已经包扎。"),
        gameEvent(12, "item-used", "使用了草药绷带。"),
      ],
      primary: "wound-treated",
    },
    {
      command: { type: "craft", recipeId: "stone-blade" },
      events: [
        gameEvent(11, "craft-succeeded", "完成制作：石刃。"),
        gameEvent(12, "recipe-discovered", "发现新配方。", "system"),
      ],
      primary: "craft-succeeded",
    },
  ];

  for (const entry of cases) {
    assert.equal(receiptFor(entry.command, entry.events).primary.type, entry.primary);
  }
});

test("historical and timer-only events cannot enter the session receipt queue", () => {
  const historical = [
    gameEvent(2, "state-created", "旧进度", "system"),
    gameEvent(7, "food-spoiled", "旧食物已经腐坏", "system"),
  ];
  assert.equal(
    createActionReceipt({
      transactionId: "tx-old-log",
      command: { type: "rest" },
      beforeEventId: 7,
      events: historical,
      nowMs: 1_000,
    }),
    null,
  );
});

test("rejections and interruptions have explicit receipt status", () => {
  const rejected = receiptFor(
    { type: "use-item", itemId: "bandage" },
    [gameEvent(11, "command-rejected", "伤口不需要包扎。")],
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.tone, "warning");

  const interrupted = receiptFor(
    { type: "boil-water" },
    [gameEvent(11, "command-rejected", "煮水途中营火熄灭。", "command", { interrupted: true })],
  );
  assert.equal(interrupted.status, "interrupted");
});

test("progressive hits stay accepted and a lethal side effect interrupts the transaction", () => {
  const harvest = receiptFor(
    { type: "harvest", entityId: "tree:1" },
    [gameEvent(11, "harvest-struck", "斧刃咬进树干。")],
  );
  const wildlifeHit = receiptFor(
    { type: "attack-wildlife", individualId: "animal:1" },
    [gameEvent(11, "wildlife-hit", "石矛命中。")],
  );
  const lethalDrink = receiptFor(
    { type: "drink-water", itemId: "dirty-water" },
    [
      gameEvent(11, "water-drunk", "喝下了浑水。"),
      gameEvent(12, "game-lost", "生命体征消失。", "system"),
    ],
  );

  assert.equal(harvest.status, "accepted");
  assert.equal(wildlifeHit.status, "accepted");
  assert.equal(lethalDrink.primary.type, "water-drunk");
  assert.equal(lethalDrink.status, "interrupted");
  assert.deepEqual(lethalDrink.dangerSideEffects.map((event) => event.type), ["game-lost"]);
});

test("torch-waymark maintenance produces an exact successful receipt and visible event tones", () => {
  const inserted = receiptFor(
    { type: "use-structure", structureId: "waymark.receipt" },
    [
      gameEvent(11, "structure-fuel-added", "实体火把已装入路标。", "command", {
        structureId: "waymark.receipt",
        fuelAddedSeconds: 300,
        fuelSlots: 1,
      }),
      gameEvent(12, "structure-ignited", "火把路标亮起。", "command", {
        structureId: "waymark.receipt",
      }),
    ],
  );
  assert.equal(inserted.primary.type, "structure-fuel-added");
  assert.equal(inserted.status, "completed");
  assert.equal(inserted.tone, "good");

  const relit = receiptFor(
    { type: "use-structure", structureId: "waymark.receipt" },
    [gameEvent(11, "structure-ignited", "火把路标重新亮起。")],
  );
  assert.equal(relit.primary.type, "structure-ignited");
  assert.equal(relit.status, "completed");
  assert.equal(relit.tone, "good");
  assert.equal(actionReceiptTone(gameEvent(13, "structure-extinguished", "暴雨压灭路标。", "system")), "warning");

  const state = createInitialState("waymark-event-tones");
  state.eventLog.push(
    gameEvent(100, "structure-fuel-added", "实体火把已装入路标。"),
    gameEvent(101, "structure-ignited", "火把路标亮起。"),
    gameEvent(102, "structure-extinguished", "暴雨压灭路标。", "system"),
  );
  const byMessage = new Map(
    createGameViewModel(state).events.map((event) => [event.message, event.tone]),
  );
  assert.equal(byMessage.get("实体火把已装入路标。"), "good");
  assert.equal(byMessage.get("火把路标亮起。"), "good");
  assert.equal(byMessage.get("暴雨压灭路标。"), "warning");
});

test("a successful dismantle owns a good, command-specific receipt", () => {
  const receipt = receiptFor(
    { type: "dismantle-structure", structureId: "rack.receipt" },
    [
      gameEvent(
        11,
        "structure-dismantled",
        "已拆除烟熏架，返还 木棍×2、藤条×1。",
        "command",
        { structureId: "rack.receipt", kind: "smoking-rack" },
      ),
    ],
  );
  assert.equal(receipt.primary.type, "structure-dismantled");
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.tone, "good");
});

test("the receipt queue is bounded and expires by TTL", () => {
  const first = receiptFor(
    { type: "collect-rainwater" },
    [gameEvent(11, "water-collected", "接到雨水。")],
    10,
    "tx-1",
  );
  const second = { ...first, id: "tx-2", expiresAtMs: 2_000 };
  const third = { ...first, id: "tx-3", expiresAtMs: 3_000 };
  const fourth = { ...first, id: "tx-4", expiresAtMs: 4_000 };
  const queued = [first, second, third, fourth].reduce<ActionReceipt[]>(
    (receipts, receipt) => enqueueActionReceipt(receipts, receipt),
    [],
  );
  assert.deepEqual(queued.map((receipt) => receipt.id), ["tx-4", "tx-3", "tx-2"]);
  assert.deepEqual(
    pruneExpiredActionReceipts(queued, 3_000).map((receipt) => receipt.id),
    ["tx-4"],
  );
});

test("feedback markup and CSS preserve the modal hierarchy contract", () => {
  const statusReceipt = receiptFor(
    { type: "collect-rainwater" },
    [gameEvent(11, "water-collected", "接到雨水。")],
  );
  const markup = renderToStaticMarkup(
    createElement(ActionFeedbackLayer, { receipts: [statusReceipt], onExpire: () => undefined }),
  );
  assert.match(markup, /class="action-feedback-layer"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /aria-live="polite"/);

  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
  const zIndex = (selector: string): number => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{[^}]*z-index:\\s*(\\d+)`));
    assert.ok(match, `missing z-index for ${selector}`);
    return Number(match[1]);
  };
  assert.ok(zIndex(".action-feedback-layer") > zIndex(".panel-backdrop"));
  assert.ok(zIndex(".action-feedback-layer") < zIndex(".resolution-screen"));

  const clientSource = readFileSync(
    new URL("../../src/game/GameClient.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(clientSource.match(/<ActionFeedbackLayer/g)?.length, 1);
  assert.ok(clientSource.indexOf("<ActionFeedbackLayer") > clientSource.indexOf("<Panels"));

  const panelsSource = readFileSync(
    new URL("../../src/game/ui/Panels.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(panelsSource, /firstEventId|pendingAction|panel-action-feedback/);

  const hudSource = readFileSync(
    new URL("../../src/game/ui/Hud.tsx", import.meta.url),
    "utf8",
  );
  assert.match(hudSource, /className="event-stack" aria-live="off"/);

  const modalMarkup = renderToStaticMarkup(
    createElement(Panels, {
      active: "crafting",
      feedback: createElement(ActionFeedbackLayer, {
        receipts: [statusReceipt],
        onExpire: () => undefined,
      }),
      watch: {} as never,
      inventory: [],
      recipes: [],
      body: {} as never,
      objectives: [],
      events: [],
      landmarks: [],
      mapChunks: [],
      score: 0,
      audioEnabled: true,
      reducedMotion: false,
      saveStatus: {} as never,
      onClose: () => undefined,
      onCraft: () => false,
      onItemAction: () => undefined,
      onTreatWound: () => undefined,
      onTreatParasites: () => undefined,
      onResume: () => undefined,
      onRestart: () => undefined,
      onManualSave: () => undefined,
      onToggleAudio: () => undefined,
      onToggleReducedMotion: () => undefined,
    }),
  );
  assert.match(
    modalMarkup,
    /class="panel-backdrop" role="dialog" aria-modal="true"[\s\S]*class="action-feedback-layer"/,
  );
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /\.action-receipt:nth-child\(n\+2\)/);
  assert.match(css, /\.panel-backdrop \.action-feedback-layer/);
});
