import type { CSSProperties } from "react";
import type { DamageIncident, StatusSignal } from "../sim/playerStatus";

const SEVERITY_LABEL: Readonly<Record<StatusSignal["severity"], string>> = {
  observe: "留意",
  warning: "警告",
  critical: "危急",
};

type PlayerStateFeedbackProps = {
  signals: readonly StatusSignal[];
  incidents: readonly DamageIncident[];
  onOpenBody?: () => void;
  onOpenWatch?: () => void;
};

function relativeDirectionLabel(degrees: number): string {
  const magnitude = Math.abs(degrees);
  if (magnitude <= 25) return "正前方";
  if (magnitude >= 155) return "正后方";
  if (degrees > 0) return magnitude < 110 ? "右侧" : "右后方";
  return magnitude < 110 ? "左侧" : "左后方";
}

function StatusSignalCard({
  signal,
  onOpenBody,
  onOpenWatch,
}: {
  signal: StatusSignal;
  onOpenBody?: () => void;
  onOpenWatch?: () => void;
}) {
  const openBody = signal.category === "injury" || signal.category === "illness";
  const onOpen = openBody ? onOpenBody : onOpenWatch;
  return (
    <article
      className={`status-signal status-signal-${signal.severity}`}
      data-severity={signal.severity}
    >
      <span className="state-symbol" aria-hidden="true">{signal.icon}</span>
      <div>
        <small>{SEVERITY_LABEL[signal.severity]}</small>
        <strong>{signal.label}</strong>
        <p>{signal.consequence}</p>
        <b>{signal.actionLabel}</b>
      </div>
      {onOpen && (
        <button type="button" onClick={onOpen}>
          {openBody ? "查看身体" : "查看手表"}
        </button>
      )}
    </article>
  );
}

/** Global state feedback remains visible above ordinary panels and HUD meters. */
export function PlayerStateFeedback({
  signals,
  incidents,
  onOpenBody,
  onOpenWatch,
}: PlayerStateFeedbackProps) {
  // One primary problem plus two secondary problems is enough to support a
  // decision without turning a dangerous moment into a wall of UI.
  const visibleSignals = signals.slice(0, 3);
  const visibleIncidents = incidents.slice(-3).reverse();
  const directionalIncident = visibleIncidents.find(
    (incident) => typeof incident.relativeDirectionDegrees === "number",
  );
  const primarySignal = visibleSignals[0];
  if (visibleSignals.length === 0 && visibleIncidents.length === 0) return null;

  return (
    <aside
      className={`player-state-feedback${visibleIncidents.length > 0 ? " has-impact" : ""}`}
      aria-label="玩家状态与伤害提示"
    >
      {directionalIncident && (
        <div
          className={`damage-direction-cue damage-direction-${directionalIncident.severity}`}
          style={{
            "--damage-direction": `${directionalIncident.relativeDirectionDegrees}deg`,
          } as CSSProperties}
          aria-label={`伤害来自${relativeDirectionLabel(directionalIncident.relativeDirectionDegrees!)}`}
        >
          <i aria-hidden="true" />
          <span>{relativeDirectionLabel(directionalIncident.relativeDirectionDegrees!)}</span>
        </div>
      )}
      <div className="damage-impact-stack" aria-live="assertive" aria-atomic="false">
        {visibleIncidents.map((incident) => (
          <article
            key={incident.id}
            className={`damage-impact damage-impact-${incident.severity}`}
            data-severity={incident.severity}
          >
            <span className="state-symbol" aria-hidden="true">!</span>
            <div>
              <small>{incident.severity === "critical" ? "致命威胁" : "受到伤害"}</small>
              <strong>{incident.sourceLabel} · {Math.round(incident.amount)} 点伤害</strong>
              <p>
                {incident.bodyPart ? `${incident.bodyPart}受伤。` : "身体受到冲击。"}
                {typeof incident.directionDegrees === "number"
                  ? ` 来源方向 ${Math.round(incident.directionDegrees)}°${typeof incident.relativeDirectionDegrees === "number" ? `（${relativeDirectionLabel(incident.relativeDirectionDegrees)}）` : ""}。`
                  : ""}
                {incident.actionLabel}
              </p>
            </div>
          </article>
        ))}
      </div>

      {primarySignal && (
        <details
          className={`status-signal-mobile-tray status-signal-mobile-${primarySignal.severity}`}
        >
          <summary aria-label={`状态提醒：${primarySignal.label}。点按展开详情`}>
            <span className="state-symbol" aria-hidden="true">{primarySignal.icon}</span>
            <span>
              <small>{SEVERITY_LABEL[primarySignal.severity]}</small>
              <strong>{primarySignal.label}</strong>
            </span>
            {visibleSignals.length > 1 && (
              <b className="status-signal-count">+{visibleSignals.length - 1}</b>
            )}
          </summary>
          <div className="status-signal-mobile-list">
            {visibleSignals.map((signal) => (
              <StatusSignalCard
                key={signal.id}
                signal={signal}
                onOpenBody={onOpenBody}
                onOpenWatch={onOpenWatch}
              />
            ))}
          </div>
        </details>
      )}

      <div className="status-signal-stack">
        {visibleSignals.map((signal) => (
          <StatusSignalCard
            key={signal.id}
            signal={signal}
            onOpenBody={onOpenBody}
            onOpenWatch={onOpenWatch}
          />
        ))}
      </div>
    </aside>
  );
}
