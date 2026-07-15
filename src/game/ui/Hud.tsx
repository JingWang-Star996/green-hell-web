import type { ActionPhase, InteractionTarget } from "../render/types";
import type { PersonalLightSource } from "../render/NightLightRig";
import { simulationSecondsToGameMinutes } from "../sim/time";
import { interactionCueFor } from "./actionUx";
import type { EventView, MeterView, ObjectiveView, WatchView } from "./types";

type HudProps = {
  watch: WatchView;
  meters: MeterView[];
  objective: ObjectiveView | null;
  target: InteractionTarget | null;
  actionPhase?: ActionPhase | null;
  pointerLocked: boolean;
  ready: boolean;
  events: EventView[];
  compassDegrees: number;
  personalLight?: PersonalLightSource;
  onFocusGame: () => void;
  onOpenWatch: () => void;
  onOpenBody: () => void;
};

export function Hud({
  watch,
  meters,
  objective,
  target,
  actionPhase = null,
  pointerLocked,
  ready,
  events,
  compassDegrees,
  personalLight = "off",
  onFocusGame,
  onOpenWatch,
  onOpenBody,
}: HudProps) {
  const cardinal = getCardinal(compassDegrees);
  const interactionCue = target
    ? interactionCueFor(target.affordance.interactionMode)
    : null;
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
          {personalLight !== "off" && (
            <em className={`personal-light personal-light-${personalLight}`}>
              {personalLight === "torch" ? "火把照明 · 占手燃烧" : "手表夜光 · 近距自动"}
            </em>
          )}
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

      <div className={`crosshair ${target ? `has-target affordance-${target.affordance.state}` : ""} ${actionPhase ? `action-${actionPhase.phase}` : ""}`} aria-hidden="true"><i /><i /></div>
      {actionPhase && (
        <div
          className={`action-phase action-phase-${actionPhase.phase}`}
        >
          <span
            className="sr-only action-phase-announcement"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {actionPhaseAnnouncement(actionPhase)}
          </span>
          <span>{actionPhaseLabel(actionPhase)}</span>
          <strong>{actionPhase.targetLabel}</strong>
          <small>{actionPhaseDetail(actionPhase)}</small>
          {actionPhase.phase !== "interrupted" && (
            <div
              className="action-phase-progress"
              role="progressbar"
              aria-label={`${actionPhase.verb}动作进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(actionPhase.progress * 100)}
            >
              <i style={{ width: `${actionPhase.progress * 100}%` }} />
            </div>
          )}
        </div>
      )}
      {target && !actionPhase && (
        <div
          className={`interaction-prompt affordance-${target.affordance.state}`}
          data-affordance-state={target.affordance.state}
          data-interaction-mode={target.affordance.interactionMode}
          aria-keyshortcuts={interactionCue?.keyboardKey ?? undefined}
        >
          {interactionCue?.keyboardKey ? (
            <kbd aria-label={`${interactionCue.label}输入`}>{interactionCue.keyboardKey}</kbd>
          ) : (
            <span className="interaction-mode-badge">{interactionCue?.label}</span>
          )}
          <div>
            <span>{target.affordance.verb}</span>
            <strong>{target.label}</strong>
            <small>{target.affordance.preview.detail}</small>
            {typeof target.affordance.preview.fuelSeconds === "number" &&
              typeof target.affordance.preview.fuelCapacitySeconds === "number" && (
                 <div
                   className="interaction-fuel"
                   role="meter"
                   aria-label={
                     target.affordance.semanticKind === "torch-waymark"
                       ? `火把路标剩余燃料 ${Math.ceil(target.affordance.preview.fuelSeconds)} 秒，槽位 ${target.affordance.preview.fuelSlots ?? 0}/${target.affordance.preview.fuelSlotCapacity ?? 2}`
                       : "营火剩余燃料"
                   }
                  aria-valuemin={0}
                  aria-valuemax={target.affordance.preview.fuelCapacitySeconds}
                  aria-valuenow={target.affordance.preview.fuelSeconds}
                >
                  <i
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (target.affordance.preview.fuelSeconds /
                            target.affordance.preview.fuelCapacitySeconds) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                   <span>
                     {target.affordance.semanticKind === "torch-waymark"
                       ? `剩余 ${formatDuration(target.affordance.preview.fuelSeconds)} · 槽位 ${target.affordance.preview.fuelSlots ?? 0}/${target.affordance.preview.fuelSlotCapacity ?? 2}`
                       : `约 ${formatFuelGameHours(target.affordance.preview.fuelSeconds)} 游戏小时`}
                   </span>
                </div>
              )}
            {typeof target.affordance.preview.storedUnits === "number" &&
              typeof target.affordance.preview.storageCapacity === "number" && (
                <div
                  className="interaction-fuel interaction-water"
                  role="meter"
                  aria-label="雨水架储水"
                  aria-valuemin={0}
                  aria-valuemax={target.affordance.preview.storageCapacity}
                  aria-valuenow={target.affordance.preview.storedUnits}
                >
                  <i
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (target.affordance.preview.storedUnits /
                            target.affordance.preview.storageCapacity) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                  <span>
                    储水 {target.affordance.preview.storedUnits.toFixed(2)} / {target.affordance.preview.storageCapacity}
                    {typeof target.affordance.preview.rateMultiplier === "number"
                      ? ` · 效率 ×${target.affordance.preview.rateMultiplier.toFixed(2)}`
                      : ""}
                    {target.affordance.preview.siteEfficiencyBand === "low"
                      ? " · 冠层遮挡"
                      : ""}
                    {target.affordance.preview.environmentBlocker === "overhead-cover"
                      ? " · 叶棚遮顶，停止集水"
                      : ""}
                  </span>
                </div>
              )}
            {typeof target.affordance.preview.health === "number" &&
              typeof target.affordance.preview.maxHealth === "number" && (
                <div
                  className="interaction-health"
                  role="meter"
                  aria-label={`${target.label}生命`}
                  aria-valuemin={0}
                  aria-valuemax={target.affordance.preview.maxHealth}
                  aria-valuenow={target.affordance.preview.health}
                >
                  <i
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (target.affordance.preview.health /
                            target.affordance.preview.maxHealth) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                  <span>
                    {Math.ceil(target.affordance.preview.health)} / {target.affordance.preview.maxHealth}
                  </span>
                </div>
              )}
            {typeof target.affordance.preview.progressSeconds === "number" &&
              typeof target.affordance.preview.progressCapacitySeconds ===
                "number" && (
                <div
                  className="interaction-fuel interaction-progress"
                  role="meter"
                  aria-label={`${target.label}加工进度`}
                  aria-valuemin={0}
                  aria-valuemax={
                    target.affordance.preview.progressCapacitySeconds
                  }
                  aria-valuenow={target.affordance.preview.progressSeconds}
                >
                  <i
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(
                          100,
                          (target.affordance.preview.progressSeconds /
                            target.affordance.preview
                              .progressCapacitySeconds) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                  <span>
                    烟熏 {Math.round(
                      (target.affordance.preview.progressSeconds /
                        target.affordance.preview.progressCapacitySeconds) *
                        100,
                    )}%
                    {typeof target.affordance.preview.rateMultiplier ===
                    "number"
                      ? ` · ×${target.affordance.preview.rateMultiplier.toFixed(2)}`
                      : ""}
                  </span>
                </div>
              )}
            {target.affordance.blocker && (
              <em>
                {blockerLabel(target.affordance.blocker)}
                {target.affordance.requiredItem
                  ? ` · 需要${requiredItemLabel(target.affordance.requiredItem)}`
                  : ""}
              </em>
            )}
          </div>
        </div>
      )}

      {!pointerLocked && (
        <button className="focus-prompt" onClick={onFocusGame} disabled={!ready}>
          <span>{ready ? "点击返回雨林" : "正在生成雨林"}</span><small>{ready ? "鼠标将用于观察 · Esc 暂停" : "加载三维场景与生存数据…"}</small>
        </button>
      )}

      <div className="event-stack" aria-live="off" aria-atomic="false">
        {events.slice(0, 3).map((event) => <p key={event.id} className={`event-${event.tone}`}><small>{event.time}</small>{event.message}</p>)}
      </div>

      <nav className="key-strip" aria-label="快捷键">
        <span><kbd>F</kbd> 手表</span><span><kbd>Tab</kbd> 背包</span><span><kbd>C</kbd> 制作</span>
        <span><kbd>B</kbd> 身体</span><span><kbd>N</kbd> 笔记</span><span><kbd>M</kbd> 地图</span>
      </nav>
    </div>
  );
}

function blockerLabel(blocker: InteractionTarget["affordance"]["blocker"]): string {
  const labels: Record<string, string> = {
    "resource-depleted": "资源尚未恢复",
    "inventory-full": "背包空间不足",
    "missing-required-tool": "缺少所需工具",
    "required-tool-not-equipped": "工具尚未装备",
    "tool-tier-insufficient": "工具等级不足",
    "missing-mining-tool": "缺少采矿工具",
    "missing-container": "缺少空容器",
    "reservoir-empty": "储水未满一份",
    "camp-not-established": "营地尚未通过过夜验证",
    "missing-prerequisite": "前置调查尚未完成",
    "missing-fuel": "缺少燃料",
    "fire-unlit": "邻近营火尚未点燃",
    "fuel-full": "燃料已满",
    "missing-raw-meat": "缺少生肉",
    "process-active": "加工正在进行",
    "fire-too-far": "距离燃烧营火过远",
    "missing-tinder": "缺少引火物",
    "missing-torch": "缺少实体火把",
    "fuel-slots-full": "火把槽位已满",
    "rain-exposed": "暴雨阻止点火",
    "structure-not-operational": "结构尚不可用",
    "objective-not-ready": "任务阶段尚未推进到这里",
    "unsupported-object": "当前没有可执行动作",
  };
  return blocker ? labels[blocker] ?? blocker : "";
}

function actionPhaseLabel(phase: ActionPhase): string {
  if (phase.phase === "windup") return `准备${phase.verb}`;
  if (phase.phase === "hit-window") return `${phase.verb}判定`;
  if (phase.phase === "recovery") return "动作恢复";
  return "动作中断";
}

function actionPhaseDetail(phase: ActionPhase): string {
  if (phase.phase === "windup") return "保持目标在准星、距离与视线内";
  if (phase.phase === "hit-window") return "正在提交动作判定，结果以系统回执为准";
  if (phase.phase === "recovery") return "动作恢复期间不能再次出手";
  if (phase.interruptReason === "paused") return "已暂停，动作没有提交";
  if (phase.interruptReason === "visibility-lost") {
    return "页面失去焦点，动作没有提交";
  }
  return "目标离开准星、距离或视线，动作没有提交";
}

function actionPhaseAnnouncement(phase: ActionPhase): string {
  return `${actionPhaseLabel(phase)}：${actionPhaseDetail(phase)}`;
}

function formatFuelGameHours(simulationSeconds: number): string {
  const hours = simulationSecondsToGameMinutes(Math.max(0, simulationSeconds)) / 60;
  return hours >= 10 ? String(Math.round(hours)) : hours.toFixed(1);
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.ceil(seconds));
  if (wholeSeconds < 60) return `${wholeSeconds} 秒`;
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}

function requiredItemLabel(
  item: InteractionTarget["affordance"]["requiredItem"],
): string {
  const labels: Record<string, string> = {
    axe: "石斧",
    "stone-blade": "石刃",
    spear: "石矛",
    "stone-pick": "石镐",
    "mining-tool": "采矿工具",
    stick: "木棍",
    "dry-leaf": "干叶",
    torch: "火把",
    "coconut-shell": "空椰壳",
    battery: "气象站电池",
  };
  return item ? labels[item] ?? item : "";
}

function getCardinal(degrees: number): string {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}
