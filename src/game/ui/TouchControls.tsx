import React, { useEffect, useRef, useState } from "react";
import type { ActionPhase, TouchInput } from "../render/types";
import type { HeldItemKind } from "../render/HeldItemRig";
import type { AffordanceInteractionMode } from "../sim/affordances";
import { interactionCueFor } from "./actionUx";
import type { EquipmentSlotView } from "./EquipmentBar";
import { PANEL_IDS, type PanelId } from "./types";

const TOUCH_PANEL_COPY: Record<PanelId, {
  label: string;
  detail: string;
}> = {
  watch: { label: "手表", detail: "时间与营养" },
  inventory: { label: "背包", detail: "物资与使用" },
  crafting: { label: "制作", detail: "手工与建造" },
  body: { label: "身体", detail: "伤口与治疗" },
  notebook: { label: "笔记", detail: "任务与日志" },
  map: { label: "地图", detail: "路线与地标" },
  pause: { label: "暂停", detail: "存档与设置" },
};

export const TOUCH_PANEL_ENTRIES = PANEL_IDS.map((id) => ({
  id,
  ...TOUCH_PANEL_COPY[id],
}));

type TouchControlsProps = {
  visible: boolean;
  onInput: (input: Partial<TouchInput>) => void;
  onInteract: () => void;
  actionLabel: string;
  actionTarget?: string;
  /** Exact shared affordance explanation; essential when desktop HUD is hidden. */
  actionDetail?: string;
  interactionMode: AffordanceInteractionMode;
  actionPhase?: ActionPhase | null;
  placementActive: boolean;
  onRotatePlacement: () => void;
  onCancelPlacement: () => void;
  equipmentSlots: readonly EquipmentSlotView[];
  equipped: HeldItemKind;
  onEquip: (itemId: HeldItemKind) => void;
  onOpenPanel: (panel: PanelId) => void;
};

export function TouchControls({
  visible,
  onInput,
  onInteract,
  actionLabel,
  actionTarget,
  actionDetail,
  interactionMode,
  actionPhase = null,
  placementActive,
  onRotatePlacement,
  onCancelPlacement,
  equipmentSlots,
  equipped,
  onEquip,
  onOpenPanel,
}: TouchControlsProps) {
  const movePointer = useRef<number | null>(null);
  const moveOrigin = useRef({ x: 0, y: 0 });
  const lookPointer = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const lookResetTimer = useRef<number | null>(null);
  const inputRef = useRef(onInput);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSection, setMenuSection] = useState<"systems" | "equipment">("systems");

  useEffect(() => {
    inputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    if (visible) return;
    // Defer presentation resets so this synchronization effect does not cause
    // a cascading render while React is committing the visibility change.
    const resetTimer = window.setTimeout(() => {
      setMenuOpen(false);
      setMenuSection("systems");
    }, 0);
    movePointer.current = null;
    lookPointer.current = null;
    if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
    lookResetTimer.current = null;
    inputRef.current({ forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false });
    return () => window.clearTimeout(resetTimer);
  }, [visible]);

  useEffect(() => () => {
    if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
    inputRef.current({ forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false });
  }, []);

  if (!visible) return null;
  const interactionCue = interactionCueFor(interactionMode);
  const actionAvailable = placementActive || interactionCue.acceptsInput;
  const presentedActionLabel = placementActive || interactionMode === "execute"
    ? actionLabel
    : interactionCue.label;
  const presentedActionTarget =
    !placementActive &&
    (interactionMode === "movement" || interactionMode === "unavailable")
      ? [actionLabel, actionTarget].filter(Boolean).join(" · ")
      : actionTarget;
  const actionClassName = actionPhase
    ? `touch-action touch-action-${actionPhase.phase}`
    : "touch-action";
  const actionAriaLabel = actionPhase
    ? `${touchActionPhaseLabel(actionPhase)}：${actionPhase.targetLabel}`
    : presentedActionTarget
      ? `${presentedActionLabel}：${presentedActionTarget}`
      : presentedActionLabel;
  const actionContent = (
    <>
      <strong>{actionPhase ? touchActionPhaseLabel(actionPhase) : presentedActionLabel}</strong>
      {(actionPhase?.targetLabel ?? presentedActionTarget) && (
        <small>{actionPhase?.targetLabel ?? presentedActionTarget}</small>
      )}
      {actionPhase && actionPhase.phase !== "interrupted" && (
        <i
          className="touch-action-progress"
          aria-hidden="true"
          style={{ width: `${actionPhase.progress * 100}%` }}
        />
      )}
    </>
  );
  const toggleMenu = () => {
    if (!menuOpen) {
      onInput({ forward: 0, right: 0, lookX: 0, lookY: 0, sprint: false });
    }
    setMenuOpen((open) => !open);
  };
  const choosePanel = (panel: PanelId) => {
    setMenuOpen(false);
    setMenuSection("systems");
    onOpenPanel(panel);
  };
  const chooseEquipment = (itemId: HeldItemKind) => {
    setMenuOpen(false);
    onEquip(itemId);
  };
  return (
    <div className={`touch-controls${menuOpen ? " touch-menu-open" : ""}`}>
      <div
        className="touch-move"
        onPointerDown={(event) => {
          movePointer.current = event.pointerId;
          moveOrigin.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (movePointer.current !== event.pointerId) return;
          const dx = Math.max(-42, Math.min(42, event.clientX - moveOrigin.current.x));
          const dy = Math.max(-42, Math.min(42, event.clientY - moveOrigin.current.y));
          onInput({ right: dx / 42, forward: -dy / 42 });
        }}
        onPointerUp={(event) => {
          if (movePointer.current !== event.pointerId) return;
          movePointer.current = null;
          onInput({ right: 0, forward: 0 });
        }}
        onPointerCancel={(event) => {
          if (movePointer.current !== event.pointerId) return;
          movePointer.current = null;
          onInput({ right: 0, forward: 0 });
        }}
        onLostPointerCapture={(event) => {
          if (movePointer.current !== event.pointerId) return;
          movePointer.current = null;
          onInput({ right: 0, forward: 0 });
        }}
      ><span>移动</span></div>
      <div
        className="touch-look"
        onPointerDown={(event) => {
          lookPointer.current = event.pointerId;
          lookLast.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          const dx = event.clientX - lookLast.current.x;
          const dy = event.clientY - lookLast.current.y;
          lookLast.current = { x: event.clientX, y: event.clientY };
          onInput({ lookX: dx * 0.12, lookY: dy * 0.12 });
          if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
          lookResetTimer.current = window.setTimeout(() => {
            lookResetTimer.current = null;
            inputRef.current({ lookX: 0, lookY: 0 });
          }, 32);
        }}
        onPointerUp={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          lookPointer.current = null;
          if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
          lookResetTimer.current = null;
          onInput({ lookX: 0, lookY: 0 });
        }}
        onPointerCancel={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          lookPointer.current = null;
          if (lookResetTimer.current !== null) window.clearTimeout(lookResetTimer.current);
          lookResetTimer.current = null;
          onInput({ lookX: 0, lookY: 0 });
        }}
        onLostPointerCapture={(event) => {
          if (lookPointer.current !== event.pointerId) return;
          lookPointer.current = null;
          onInput({ lookX: 0, lookY: 0 });
        }}
      />
      {actionAvailable || actionPhase ? (
        <button
          className={actionClassName}
          data-interaction-mode={interactionMode}
          onClick={onInteract}
          disabled={!actionAvailable || Boolean(actionPhase)}
          aria-busy={actionPhase ? "true" : undefined}
          aria-label={actionAriaLabel}
        >
          {actionContent}
        </button>
      ) : (
        <div
          className={`${actionClassName} touch-action-status`}
          data-interaction-mode={interactionMode}
          role="status"
          aria-label={actionAriaLabel}
        >
          {actionContent}
        </div>
      )}
      {!placementActive &&
        !actionPhase &&
        (interactionMode === "movement" || interactionMode === "unavailable") &&
        actionDetail && (
          <div className="touch-action-explanation" role="status">
            <strong>{presentedActionLabel}</strong>
            <span>{actionDetail}</span>
          </div>
        )}
      {placementActive && (
        <div className="touch-placement-actions" aria-label="建筑放置操作">
          <button onClick={onRotatePlacement}>旋转</button>
          <button onClick={onCancelPlacement}>取消</button>
        </div>
      )}
      <button
        className="touch-sprint"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          onInput({ sprint: true });
        }}
        onPointerUp={() => onInput({ sprint: false })}
        onPointerCancel={() => onInput({ sprint: false })}
        onLostPointerCapture={() => onInput({ sprint: false })}
      >冲刺</button>
      <button
        type="button"
        className="touch-menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="touch-survival-menu"
        onClick={toggleMenu}
      >
        <span>生存菜单</span>
        <small>{menuOpen ? "收起" : "功能 · 装备"}</small>
      </button>
      <button
        type="button"
        className="touch-menu-scrim"
        aria-label="关闭生存菜单"
        hidden={!menuOpen}
        onClick={() => setMenuOpen(false)}
      />
      <section
        id="touch-survival-menu"
        className="touch-menu-drawer"
        aria-label="移动端生存菜单"
        hidden={!menuOpen}
      >
        <header>
          <div>
            <strong>生存菜单</strong>
            <small>全部桌面功能均可在这里进入</small>
          </div>
          <button type="button" onClick={() => setMenuOpen(false)} aria-label="关闭生存菜单">×</button>
        </header>
        <div className="touch-menu-tabs" role="tablist" aria-label="生存菜单分类">
          <button
            type="button"
            role="tab"
            aria-selected={menuSection === "systems"}
            aria-controls="touch-system-actions"
            onClick={() => setMenuSection("systems")}
          >功能</button>
          <button
            type="button"
            role="tab"
            aria-selected={menuSection === "equipment"}
            aria-controls="touch-equipment-actions"
            onClick={() => setMenuSection("equipment")}
          >装备</button>
        </div>
        <nav
          id="touch-system-actions"
          className="touch-menu-section touch-system-actions"
          aria-label="功能入口"
          hidden={menuSection !== "systems"}
        >
          {TOUCH_PANEL_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-panel-id={entry.id}
              onClick={() => choosePanel(entry.id)}
            >
              <strong>{entry.label}</strong>
              <small>{entry.detail}</small>
            </button>
          ))}
        </nav>
        <div
          id="touch-equipment-actions"
          className="touch-menu-section touch-equipment-actions"
          role="toolbar"
          aria-label="触控装备栏"
          hidden={menuSection !== "equipment"}
        >
          {equipmentSlots.map((slot) => {
            const selected = equipped === slot.id;
            return (
              <button
                key={slot.id}
                type="button"
                className={selected ? "is-equipped" : ""}
                aria-pressed={selected}
                disabled={slot.count <= 0}
                onClick={() => chooseEquipment(selected ? null : slot.id)}
              >
                <strong>{slot.label}</strong>
                <small>{slot.count > 0 ? slot.durabilityLabel ?? `×${slot.count}` : "未持有"}</small>
              </button>
            );
          })}
          <button
            type="button"
            className={equipped === null ? "is-equipped" : ""}
            aria-pressed={equipped === null}
            onClick={() => chooseEquipment(null)}
          >
            <strong>空手</strong>
            <small>收起装备</small>
          </button>
        </div>
      </section>
    </div>
  );
}

function touchActionPhaseLabel(phase: ActionPhase): string {
  if (phase.phase === "windup") return `准备${phase.verb}`;
  if (phase.phase === "hit-window") return `${phase.verb}判定`;
  if (phase.phase === "recovery") return "恢复";
  return "动作中断";
}
