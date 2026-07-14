import type { InteractionTarget } from "../render/types";
import type { EventView, MeterView, ObjectiveView, WatchView } from "./types";

type HudProps = {
  watch: WatchView;
  meters: MeterView[];
  objective: ObjectiveView | null;
  target: InteractionTarget | null;
  pointerLocked: boolean;
  ready: boolean;
  events: EventView[];
  compassDegrees: number;
  onFocusGame: () => void;
  onOpenWatch: () => void;
  onOpenBody: () => void;
};

export function Hud({
  watch,
  meters,
  objective,
  target,
  pointerLocked,
  ready,
  events,
  compassDegrees,
  onFocusGame,
  onOpenWatch,
  onOpenBody,
}: HudProps) {
  const cardinal = getCardinal(compassDegrees);
  return (
    <div className="hud-layer">
      <header className="hud-top">
        <div className="hud-brand"><span>C</span><div><b>CANOPY</b><small>FIELD SESSION 01</small></div></div>
        <div className="compass" aria-label={`朝向 ${cardinal} ${Math.round(compassDegrees)} 度`}>
          <small>{cardinal}</small><strong>{String(Math.round(compassDegrees)).padStart(3, "0")}°</strong>
          <div className="compass-track"><i style={{ transform: `translateX(${((compassDegrees % 45) / 45) * 42 - 21}px)` }} /></div>
        </div>
        <button className="clock-chip" onClick={onOpenWatch} aria-label="打开手表">
          <span>DAY {String(watch.day).padStart(2, "0")}</span><strong>{watch.time}</strong><small>{watch.weather} · {watch.biome}</small>
        </button>
      </header>

      {objective && (
        <section className="objective-card" aria-label="当前目标">
          <span className="objective-index">{objective.completed ? "✓" : "当前"}</span>
          <div>
            <small>{objective.progressLabel ?? "生存目标"}</small>
            <strong>{objective.label}</strong>
            <p>{objective.description}{objective.blocker && <><br /><b>阻断条件：{objective.blocker}</b></>}</p>
          </div>
        </section>
      )}

      <section className="vitals-rail" aria-label="生命状态">
        {meters.slice(0, 4).map((meter) => (
          <button key={meter.id} className={`vital vital-${meter.tone}`} onClick={meter.id === "health" ? onOpenBody : onOpenWatch}>
            <span>{meter.shortLabel}</span>
            <div><i style={{ height: `${meter.value}%` }} /></div>
            <strong>{Math.round(meter.value)}</strong>
          </button>
        ))}
      </section>

      <div className={`crosshair ${target ? "has-target" : ""}`} aria-hidden="true"><i /><i /></div>
      {target && <div className="interaction-prompt"><kbd>E</kbd><span>{interactionVerb(target, objective)}</span><strong>{target.label}</strong></div>}

      {!pointerLocked && (
        <button className="focus-prompt" onClick={onFocusGame} disabled={!ready}>
          <span>{ready ? "点击返回雨林" : "正在生成雨林"}</span><small>{ready ? "鼠标将用于观察 · Esc 暂停" : "加载三维场景与生存数据…"}</small>
        </button>
      )}

      <div className="event-stack" aria-live="polite" aria-atomic="false">
        {events.slice(0, 3).map((event) => <p key={event.id} className={`event-${event.tone}`}><small>{event.time}</small>{event.message}</p>)}
      </div>

      <nav className="key-strip" aria-label="快捷键">
        <span><kbd>F</kbd> 手表</span><span><kbd>Tab</kbd> 背包</span><span><kbd>C</kbd> 制作</span>
        <span><kbd>B</kbd> 身体</span><span><kbd>N</kbd> 笔记</span><span><kbd>M</kbd> 地图</span>
      </nav>
    </div>
  );
}

function interactionVerb(target: InteractionTarget, objective: ObjectiveView | null): string {
  if (target.kind === "water") return "取水";
  if (target.kind === "wreck" && objective?.id === "transmit-signal") return "发报";
  if (target.kind === "wreck" || target.kind === "station" || target.kind === "cache") return "调查";
  if (target.kind === "beacon") return "拆取";
  return "采集";
}

function getCardinal(degrees: number): string {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}
