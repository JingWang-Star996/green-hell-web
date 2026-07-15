import type {
  GameEvent,
  GameState,
  HealthLossRecord,
  SanityLossRecord,
} from "./types";

export type StatusSeverity = "observe" | "warning" | "critical";
export type StatusCategory =
  | "injury"
  | "illness"
  | "nutrition"
  | "hydration"
  | "exposure"
  | "threat";

export interface StatusSignal {
  id: string;
  category: StatusCategory;
  severity: StatusSeverity;
  icon: string;
  label: string;
  consequence: string;
  actionLabel: string;
  value: number;
  startedTick: number;
  updatedTick: number;
}

export interface DamageIncident {
  id: string;
  eventId: number;
  tick: number;
  elapsedSeconds: number;
  causeCode: string;
  sourceLabel: string;
  amount: number;
  lethal: boolean;
  severity: "warning" | "critical";
  bodyPart?: string;
  /** Source bearing relative to the current view: 0 front, 90 right. */
  relativeDirectionDegrees?: number;
  directionDegrees?: number;
  conditionIds: string[];
  actionLabel: string;
}

export interface TimedDamageIncident extends DamageIncident {
  /** Browser monotonic-clock deadline; presentation-only and never persisted. */
  expiresAtMilliseconds: number;
}

export const DAMAGE_INCIDENT_VISIBLE_MILLISECONDS = 8_000;
export const MAX_VISIBLE_DAMAGE_INCIDENTS = 3;

export interface DeathReviewStep {
  id: string;
  elapsedSeconds: number;
  label: string;
  sourceEventId?: number;
}

export interface DeathReviewModel {
  directCauseCode: string;
  directCauseLabel: string;
  summary: string;
  chain: DeathReviewStep[];
  advice: string | null;
  inferred: boolean;
}

export interface DeriveStatusOptions {
  previousSignals?: readonly StatusSignal[];
}

export interface DeriveDamageOptions {
  afterEventId?: number;
  /** `null` keeps the complete bounded event-log window. */
  maximumAgeSeconds?: number | null;
}

interface Thresholds {
  observe: number;
  warning: number;
  critical: number;
  recovery: number;
}

const SEVERITY_RANK: Readonly<Record<StatusSeverity, number>> = {
  observe: 1,
  warning: 2,
  critical: 3,
};

const CATEGORY_RANK: Readonly<Record<StatusCategory, number>> = {
  injury: 6,
  illness: 5,
  hydration: 4,
  nutrition: 3,
  exposure: 2,
  threat: 1,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function detailString(event: GameEvent, key: string): string | undefined {
  const value = event.details?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function detailNumber(event: GameEvent, key: string): number | undefined {
  const value = event.details?.[key];
  return finite(value) ? value : undefined;
}

function detailBoolean(event: GameEvent, key: string): boolean | undefined {
  const value = event.details?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function lowSeverity(
  value: number,
  thresholds: Thresholds,
  previous?: StatusSeverity,
): StatusSeverity | null {
  if (value <= thresholds.critical) return "critical";
  if (
    previous === "critical" &&
    value <= thresholds.critical + thresholds.recovery
  ) {
    return "critical";
  }
  if (value <= thresholds.warning) return "warning";
  if (
    previous === "warning" &&
    value <= thresholds.warning + thresholds.recovery
  ) {
    return "warning";
  }
  if (value <= thresholds.observe) return "observe";
  if (
    previous === "observe" &&
    value <= thresholds.observe + thresholds.recovery
  ) {
    return "observe";
  }
  return null;
}

function highSeverity(
  value: number,
  thresholds: Thresholds,
  previous?: StatusSeverity,
): StatusSeverity | null {
  if (value >= thresholds.critical) return "critical";
  if (
    previous === "critical" &&
    value >= thresholds.critical - thresholds.recovery
  ) {
    return "critical";
  }
  if (value >= thresholds.warning) return "warning";
  if (
    previous === "warning" &&
    value >= thresholds.warning - thresholds.recovery
  ) {
    return "warning";
  }
  if (value >= thresholds.observe) return "observe";
  if (
    previous === "observe" &&
    value >= thresholds.observe - thresholds.recovery
  ) {
    return "observe";
  }
  return null;
}

function sourceLabelFor(event: GameEvent): string {
  const explicit = detailString(event, "sourceLabel");
  if (explicit) return explicit;
  const species = detailString(event, "speciesId");
  if (species === "reedtail-scuttler") return "芦尾窜兽";
  if (species === "mossback-grazer") return "苔背阔吻兽";
  if (species === "glassfang-stalker") return "琥珀环猎兽";
  if (species === "coiled-viper") return "卷藤蝰";
  if (event.type === "snake-bite") return "毒蛇";
  return event.type === "wildlife-attack" ? "雨林生物" : "未知伤害";
}

function normalizeDegrees(value: number | undefined): number | undefined {
  if (!finite(value)) return undefined;
  return ((value % 360) + 360) % 360;
}

function relativeDirectionDegrees(
  sourceBearing: number | undefined,
  lookYaw: number | undefined,
): number | undefined {
  const source = normalizeDegrees(sourceBearing);
  if (source === undefined || !finite(lookYaw)) return undefined;
  // Three.js looks toward -Z at yaw 0, while the authored compass treats +Z
  // as north. This mirrors GameClient.yawToCompassDegrees without coupling the
  // simulation projection to a React module.
  const viewBearing = normalizeDegrees((lookYaw * 180) / Math.PI + 180)!;
  return ((source - viewBearing + 540) % 360) - 180;
}

/**
 * Projects only authoritative attack events. Continuous condition damage is
 * represented by status signals and the death review, never by invented hits.
 */
export function deriveDamageIncidents(
  state: GameState,
  options: DeriveDamageOptions = {},
): DamageIncident[] {
  const afterEventId = Number.isFinite(options.afterEventId)
    ? Math.floor(options.afterEventId!)
    : -1;
  const maximumAgeSeconds =
    options.maximumAgeSeconds === undefined ? 8 : options.maximumAgeSeconds;

  return state.eventLog
    .filter((event) => {
      if (event.id <= afterEventId) return false;
      if (event.type !== "snake-bite" && event.type !== "wildlife-attack") {
        return false;
      }
      if (!finite(event.details?.healthLost) || event.details!.healthLost <= 0) {
        return false;
      }
      return (
        maximumAgeSeconds === null ||
        state.clock.elapsedSeconds - event.elapsedSeconds <=
          Math.max(0, maximumAgeSeconds)
      );
    })
    .map((event) => {
      const amount = Math.min(100, Math.max(0, detailNumber(event, "healthLost")!));
      const healthBefore = detailNumber(event, "healthBefore");
      const healthAfter = detailNumber(event, "healthAfter");
      const lethal = detailBoolean(event, "lethal") === true || Boolean(
        healthBefore !== undefined &&
        healthAfter !== undefined &&
        healthBefore > 0 &&
        healthAfter <= 0,
      );
      const sourceLabel = sourceLabelFor(event);
      // Body location is shown only when the authoritative hit event supplied
      // it. A generic snake bite must not silently become a left-arm injury.
      const bodyPart = detailString(event, "bodyPart");
      const directionDegrees = normalizeDegrees(
        detailNumber(event, "directionDegrees"),
      );
      const relativeDirection = relativeDirectionDegrees(
        directionDegrees,
        state.player.lookYaw,
      );
      return {
        id: `damage:${event.id}`,
        eventId: event.id,
        tick: event.tick,
        elapsedSeconds: event.elapsedSeconds,
        causeCode: event.cause.code,
        sourceLabel,
        amount,
        lethal,
        severity:
          amount >= 25 || state.player.vitals.health <= 20
            ? "critical"
            : "warning",
        ...(bodyPart ? { bodyPart } : {}),
        ...(directionDegrees !== undefined ? { directionDegrees } : {}),
        ...(relativeDirection !== undefined
          ? { relativeDirectionDegrees: relativeDirection }
          : {}),
        conditionIds: ["open-wound"],
        actionLabel:
          event.type === "snake-bite"
            ? "立刻拉开距离，打开身体检查处理伤口"
            : `先脱离${sourceLabel}的攻击范围，再检查伤口`,
      } satisfies DamageIncident;
    });
}

/** Removes only incidents whose own deadline elapsed. */
export function pruneExpiredDamageIncidents(
  incidents: readonly TimedDamageIncident[],
  nowMilliseconds: number,
): TimedDamageIncident[] {
  const now = Number.isFinite(nowMilliseconds) ? nowMilliseconds : 0;
  return incidents.filter(
    (incident) => incident.expiresAtMilliseconds > now,
  );
}

/**
 * Adds authoritative hits by event id while preserving each existing hit's
 * original deadline. A later hit therefore cannot make an older card linger.
 */
export function mergeTimedDamageIncidents(
  previous: readonly TimedDamageIncident[],
  fresh: readonly DamageIncident[],
  nowMilliseconds: number,
  lifetimeMilliseconds = DAMAGE_INCIDENT_VISIBLE_MILLISECONDS,
  maximumVisible = MAX_VISIBLE_DAMAGE_INCIDENTS,
): TimedDamageIncident[] {
  const now = Number.isFinite(nowMilliseconds) ? nowMilliseconds : 0;
  const lifetime = Number.isFinite(lifetimeMilliseconds)
    ? Math.max(0, lifetimeMilliseconds)
    : DAMAGE_INCIDENT_VISIBLE_MILLISECONDS;
  const byEventId = new Map<number, TimedDamageIncident>();
  for (const incident of pruneExpiredDamageIncidents(previous, now)) {
    byEventId.set(incident.eventId, incident);
  }
  for (const incident of fresh) {
    const existing = byEventId.get(incident.eventId);
    byEventId.set(incident.eventId, {
      ...incident,
      expiresAtMilliseconds:
        existing?.expiresAtMilliseconds ?? now + lifetime,
    });
  }
  const limit = Number.isFinite(maximumVisible)
    ? Math.max(0, Math.floor(maximumVisible))
    : MAX_VISIBLE_DAMAGE_INCIDENTS;
  if (limit === 0) return [];
  return [...byEventId.values()]
    .sort(
      (left, right) =>
        left.tick - right.tick || left.eventId - right.eventId,
    )
    .slice(-limit);
}

/** Derives a stable, severity-sorted state list with small recovery hysteresis. */
export function deriveStatusSignals(
  state: GameState,
  options: DeriveStatusOptions = {},
): StatusSignal[] {
  const previous = new Map(
    (options.previousSignals ?? []).map((signal) => [signal.id, signal]),
  );
  const signals: StatusSignal[] = [];
  const add = (
    id: string,
    category: StatusCategory,
    severity: StatusSeverity | null,
    icon: string,
    label: string,
    consequence: string,
    actionLabel: string,
    value: number,
  ) => {
    if (!severity) return;
    const prior = previous.get(id);
    signals.push({
      id,
      category,
      severity,
      icon,
      label,
      consequence,
      actionLabel,
      value,
      startedTick: prior?.startedTick ?? state.clock.tick,
      updatedTick: state.clock.tick,
    });
  };

  const { vitals, nutrition, conditions } = state.player;
  add(
    "health",
    "injury",
    lowSeverity(
      vitals.health,
      { observe: 65, warning: 35, critical: 15, recovery: 5 },
      previous.get("health")?.severity,
    ),
    "+",
    "生命状态下降",
    `当前生命 ${Math.round(vitals.health)}；继续承受伤害可能失去行动能力。`,
    "立即脱离危险并打开身体检查",
    vitals.health,
  );
  if (conditions.wound.open) {
    add(
      "open-wound",
      "injury",
      highSeverity(
        conditions.wound.severity,
        { observe: 1, warning: 35, critical: 70, recovery: 6 },
        previous.get("open-wound")?.severity,
      ),
      "!",
      "开放伤口",
      `伤势 ${Math.round(conditions.wound.severity)}；伤口会持续消耗生命并积累感染。`,
      "打开身体检查并使用已知止血材料",
      conditions.wound.severity,
    );
  }
  add(
    "infection",
    "illness",
    highSeverity(
      conditions.wound.infection,
      { observe: 15, warning: 40, critical: 70, recovery: 5 },
      previous.get("infection")?.severity,
    ),
    "✚",
    "伤口感染",
    `感染 ${Math.round(conditions.wound.infection)}%；开放伤口的生命损耗正在加重。`,
    "保持干燥并检查伤口处理是否有效",
    conditions.wound.infection,
  );
  add(
    "parasites",
    "illness",
    highSeverity(
      conditions.parasites,
      { observe: 1, warning: 2, critical: 3, recovery: 0.25 },
      previous.get("parasites")?.severity,
    ),
    "×",
    "寄生虫负担",
    `寄生虫 ×${conditions.parasites}；蛋白、能量与理智消耗正在加快。`,
    "打开身体检查，使用已经确认的驱虫处理",
    conditions.parasites,
  );
  add(
    "hydration",
    "hydration",
    lowSeverity(
      nutrition.hydration,
      { observe: 40, warning: 20, critical: 8, recovery: 5 },
      previous.get("hydration")?.severity,
    ),
    "◇",
    "水分不足",
    `水分 ${Math.round(nutrition.hydration)}；归零后会快速损失生命。`,
    "寻找安全水源，饮用净水或先进行净化",
    nutrition.hydration,
  );

  const macroEntries = [
    ["碳水", nutrition.carbohydrates],
    ["蛋白", nutrition.protein],
    ["脂肪", nutrition.fat],
  ] as const;
  const weakestMacro = macroEntries.reduce((weakest, entry) =>
    entry[1] < weakest[1] ? entry : weakest,
  );
  add(
    "nutrition",
    "nutrition",
    lowSeverity(
      weakestMacro[1],
      { observe: 35, warning: 15, critical: 2, recovery: 5 },
      previous.get("nutrition")?.severity,
    ),
    "△",
    `${weakestMacro[0]}储备不足`,
    `${weakestMacro[0]} ${Math.round(weakestMacro[1])}；多类营养归零会叠加生命损耗。`,
    "寻找与缺口匹配的食物，不要只补同一种营养",
    weakestMacro[1],
  );
  add(
    "energy",
    "nutrition",
    lowSeverity(
      vitals.energy,
      { observe: 35, warning: 18, critical: 5, recovery: 5 },
      previous.get("energy")?.severity,
    ),
    "↯",
    "能量耗尽",
    `能量 ${Math.round(vitals.energy)}；归零后身体会继续损失生命。`,
    "停止长途奔跑，进食并在安全处休息",
    vitals.energy,
  );
  add(
    "sanity",
    "threat",
    lowSeverity(
      vitals.sanity,
      { observe: 55, warning: 30, critical: 12, recovery: 6 },
      previous.get("sanity")?.severity,
    ),
    "◎",
    "理智动摇",
    `理智 ${Math.round(vitals.sanity)}；黑夜、湿冷和伤病会继续加重压力。`,
    "回到照明、火源或干燥庇护附近",
    vitals.sanity,
  );
  add(
    "wetness",
    "exposure",
    highSeverity(
      conditions.wetness,
      { observe: 60, warning: 82, critical: 96, recovery: 6 },
      previous.get("wetness")?.severity,
    ),
    "≈",
    "全身湿透",
    `湿度 ${Math.round(conditions.wetness)}%；能量与理智恢复正在恶化。`,
    "进入真正有顶棚的庇护，或靠近安全火源烘干",
    conditions.wetness,
  );

  return signals.sort(
    (left, right) =>
      SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
      CATEGORY_RANK[right.category] - CATEGORY_RANK[left.category] ||
      left.id.localeCompare(right.id),
  );
}

type DeathCauseCategory =
  | "attack"
  | "wound"
  | "dehydration"
  | "starvation"
  | "exhaustion"
  | "sanity"
  | "unknown";

interface ResolvedDeathCause {
  category: DeathCauseCategory;
  code: string;
  label: string;
  summary: string;
  inferred: boolean;
  incident?: DamageIncident;
  healthLoss?: HealthLossRecord;
  sanityLoss?: SanityLossRecord;
}

const TERMINAL_EVIDENCE_EPSILON = 1e-9;

function matchesTerminalMoment(
  state: GameState,
  tick: number,
  elapsedSeconds: number,
  valueAfter: number,
  currentValue: number,
): boolean {
  return state.status === "lost" &&
    tick === state.clock.tick &&
    Math.abs(elapsedSeconds - state.clock.elapsedSeconds) <=
      TERMINAL_EVIDENCE_EPSILON &&
    Math.abs(valueAfter - currentValue) <= TERMINAL_EVIDENCE_EPSILON;
}

function deathCategoryForHealthLoss(
  record: HealthLossRecord,
): DeathCauseCategory {
  if (
    record.sourceCode.startsWith("wildlife:") ||
    record.sourceCode.startsWith("hazard:")
  ) {
    return "attack";
  }
  if (
    record.sourceCode === "condition:open-wound" ||
    record.sourceCode === "condition:infected-wound"
  ) {
    return "wound";
  }
  if (record.sourceCode === "condition:dehydration") return "dehydration";
  if (record.sourceCode === "condition:starvation") return "starvation";
  if (record.sourceCode === "condition:exhaustion") return "exhaustion";
  return "unknown";
}

function authoritativeHealthDeathCause(
  state: GameState,
): ResolvedDeathCause | null {
  if (state.lossReason !== "health" || state.player.vitals.health > 0) {
    return null;
  }
  const history = state.healthLossHistory ?? [];
  const lethal = history.at(-1);
  if (
    !lethal?.lethal ||
    lethal.healthBefore <= 0 ||
    lethal.healthAfter > 0 ||
    history.slice(0, -1).some((record) => record.lethal) ||
    !matchesTerminalMoment(
      state,
      lethal.tick,
      lethal.elapsedSeconds,
      lethal.healthAfter,
      state.player.vitals.health,
    )
  ) {
    return null;
  }
  const duration = Math.max(
    0,
    lethal.elapsedSeconds - lethal.startedElapsedSeconds,
  );
  const interval =
    lethal.sampleCount > 1
      ? `在 ${Math.max(0.1, duration).toFixed(1)} 秒内累计`
      : "";
  return {
    category: deathCategoryForHealthLoss(lethal),
    code: lethal.sourceCode,
    label: lethal.sourceLabel,
    summary: `${lethal.sourceLabel}${interval}造成 ${lethal.amount.toFixed(1)} 点生命损失（${lethal.healthBefore.toFixed(1)} → ${lethal.healthAfter.toFixed(1)}），并真正跨过致死线。`,
    inferred: false,
    healthLoss: lethal,
  };
}

function deathCategoryForSanityLoss(
  record: SanityLossRecord,
): DeathCauseCategory {
  return record.sourceCode.startsWith("wildlife:") ||
    record.sourceCode.startsWith("hazard:")
    ? "attack"
    : "sanity";
}

function authoritativeSanityDeathCause(
  state: GameState,
): ResolvedDeathCause | null {
  if (state.lossReason !== "sanity" || state.player.vitals.sanity > 0) {
    return null;
  }
  const history = state.sanityLossHistory ?? [];
  const lethal = history.at(-1);
  if (
    !lethal?.lethal ||
    lethal.sanityBefore <= 0 ||
    lethal.sanityAfter > 0 ||
    history.slice(0, -1).some((record) => record.lethal) ||
    !matchesTerminalMoment(
      state,
      lethal.tick,
      lethal.elapsedSeconds,
      lethal.sanityAfter,
      state.player.vitals.sanity,
    )
  ) {
    return null;
  }
  const duration = Math.max(
    0,
    lethal.elapsedSeconds - lethal.startedElapsedSeconds,
  );
  const interval =
    lethal.sampleCount > 1
      ? `在 ${Math.max(0.1, duration).toFixed(1)} 秒内累计`
      : "";
  return {
    category: deathCategoryForSanityLoss(lethal),
    code: lethal.sourceCode,
    label: lethal.sourceLabel,
    summary: `${lethal.sourceLabel}${interval}造成 ${lethal.amount.toFixed(1)} 点理智损耗（${lethal.sanityBefore.toFixed(1)} → ${lethal.sanityAfter.toFixed(1)}），并真正跨过崩溃线。`,
    inferred: false,
    sanityLoss: lethal,
  };
}

function resolveDeathCause(state: GameState): ResolvedDeathCause {
  if (state.lossReason === "sanity") {
    const authoritative = authoritativeSanityDeathCause(state);
    if (authoritative) return authoritative;
    return {
      category: "sanity",
      code: "condition:sanity-collapse",
      label: "理智崩溃",
      summary: "黑夜、湿冷、孤立或伤病把理智推到了无法继续行动的边缘。",
      inferred: true,
    };
  }

  const authoritative = authoritativeHealthDeathCause(state);
  if (authoritative) return authoritative;

  // Compatibility fallback for saves created before healthLossHistory. Attack
  // events remain authoritative for their own hit, while continuous causes
  // below still have to be inferred from the terminal snapshot.
  const incidents = deriveDamageIncidents(state, { maximumAgeSeconds: null });
  const latest = incidents.at(-1);
  if (
    latest?.lethal &&
    state.clock.elapsedSeconds - latest.elapsedSeconds <= 1.5
  ) {
    return {
      category: "attack",
      code: latest.causeCode,
      label: `${latest.sourceLabel}的直接攻击`,
      summary: `${latest.sourceLabel}造成 ${Math.round(latest.amount)} 点伤害，使生命体征归零。`,
      inferred: false,
      incident: latest,
    };
  }

  const candidates: Array<ResolvedDeathCause & { score: number }> = [];
  const { conditions, nutrition, vitals } = state.player;
  if (nutrition.hydration <= 0) {
    candidates.push({
      category: "dehydration",
      code: "condition:dehydration",
      label: "持续脱水",
      summary: "水分归零后仍在活动，脱水持续削减生命。",
      inferred: true,
      score: 140,
    });
  }
  const emptyMacros = [
    nutrition.carbohydrates,
    nutrition.protein,
    nutrition.fat,
  ].filter((value) => value <= 0).length;
  if (emptyMacros > 0) {
    candidates.push({
      category: "starvation",
      code: "condition:starvation",
      label: "营养衰竭",
      summary: `${emptyMacros} 类关键营养归零，身体无法继续维持生命。`,
      inferred: true,
      score: emptyMacros * 35,
    });
  }
  if (vitals.energy <= 0) {
    candidates.push({
      category: "exhaustion",
      code: "condition:exhaustion",
      label: "极度衰竭",
      summary: "能量耗尽后仍在承受生存压力，身体最终失去支撑。",
      inferred: true,
      score: 40,
    });
  }
  if (conditions.wound.open) {
    const woundScore =
      (0.008 +
        conditions.wound.severity * 0.00016 +
        conditions.wound.infection * 0.00022) *
      1_000;
    candidates.push({
      category: "wound",
      code:
        conditions.wound.infection >= 40
          ? "condition:infected-wound"
          : "condition:open-wound",
      label:
        conditions.wound.infection >= 40
          ? "感染的开放伤口"
          : "未处理的开放伤口",
      summary:
        conditions.wound.infection >= 40
          ? `伤口感染达到 ${Math.round(conditions.wound.infection)}%，持续伤害耗尽了生命。`
          : `伤势达到 ${Math.round(conditions.wound.severity)}，持续失血耗尽了生命。`,
      inferred: true,
      score: woundScore,
    });
  }
  const winner = candidates.sort((left, right) => right.score - left.score)[0];
  if (winner) {
    return {
      category: winner.category,
      code: winner.code,
      label: winner.label,
      summary: winner.summary,
      inferred: winner.inferred,
      ...(winner.incident ? { incident: winner.incident } : {}),
    };
  }
  if (latest) {
    return {
      category: "wound",
      code: latest.causeCode,
      label: `${latest.sourceLabel}造成的伤势`,
      summary: `最近一次可信伤害来自${latest.sourceLabel}；现有记录不足以确认最后的持续伤害来源。`,
      inferred: true,
      incident: latest,
    };
  }
  return {
    category: "unknown",
    code: state.lossReason === "health" ? "terminal:health" : "terminal:unknown",
    label: "身体衰竭",
    summary: "现有因果记录不足以确认更具体的直接原因。",
    inferred: true,
  };
}

function eventStep(event: GameEvent): DeathReviewStep {
  const amount = detailNumber(event, "healthLost");
  const suffix = amount ? `，损失 ${Math.round(amount)} 点生命` : "";
  return {
    id: `event:${event.id}`,
    elapsedSeconds: event.elapsedSeconds,
    label:
      event.type === "snake-bite" || event.type === "wildlife-attack"
        ? `${sourceLabelFor(event)}命中${suffix}`
        : event.message,
    sourceEventId: event.id,
  };
}

function healthLossStep(record: HealthLossRecord): DeathReviewStep {
  const interval =
    record.sampleCount > 1
      ? `，连续 ${record.sampleCount} 次结算`
      : "";
  return {
    id: `health-loss:${record.id}`,
    elapsedSeconds: record.elapsedSeconds,
    label: `${record.sourceLabel}造成 ${record.amount.toFixed(1)} 点生命损失：${record.healthBefore.toFixed(1)} → ${record.healthAfter.toFixed(1)}${interval}`,
  };
}

function sanityLossStep(record: SanityLossRecord): DeathReviewStep {
  const interval =
    record.sampleCount > 1
      ? `，连续 ${record.sampleCount} 次结算`
      : "";
  return {
    id: `sanity-loss:${record.id}`,
    elapsedSeconds: record.elapsedSeconds,
    label: `${record.sourceLabel}造成 ${record.amount.toFixed(1)} 点理智损耗：${record.sanityBefore.toFixed(1)} → ${record.sanityAfter.toFixed(1)}${interval}`,
  };
}

function authoritativeHealthChain(
  state: GameState,
  cause: ResolvedDeathCause,
): DeathReviewStep[] {
  if (!cause.healthLoss) return [];
  const history = state.healthLossHistory ?? [];
  const lethalIndex = history.findIndex(
    (record) => record.id === cause.healthLoss?.id,
  );
  const end = lethalIndex >= 0 ? lethalIndex + 1 : history.length;
  const recent = history.slice(Math.max(0, end - 3), end);
  return [
    ...recent.map(healthLossStep),
    {
      id: `lethal-boundary:${cause.healthLoss.id}`,
      elapsedSeconds: cause.healthLoss.elapsedSeconds,
      label: `生命从 ${cause.healthLoss.healthBefore.toFixed(1)} 降至 ${cause.healthLoss.healthAfter.toFixed(1)}，该条记录被标记为致死结算。`,
    },
    currentFactStep(state, cause),
  ].slice(-5);
}

function authoritativeSanityChain(
  state: GameState,
  cause: ResolvedDeathCause,
): DeathReviewStep[] {
  if (!cause.sanityLoss) return [];
  const history = state.sanityLossHistory ?? [];
  const lethalIndex = history.findIndex(
    (record) => record.id === cause.sanityLoss?.id,
  );
  const end = lethalIndex >= 0 ? lethalIndex + 1 : history.length;
  const recent = history.slice(Math.max(0, end - 3), end);
  return [
    ...recent.map(sanityLossStep),
    {
      id: `lethal-sanity-boundary:${cause.sanityLoss.id}`,
      elapsedSeconds: cause.sanityLoss.elapsedSeconds,
      label: `理智从 ${cause.sanityLoss.sanityBefore.toFixed(1)} 降至 ${cause.sanityLoss.sanityAfter.toFixed(1)}，该条记录被标记为致命结算。`,
    },
    currentFactStep(state, cause),
  ].slice(-5);
}

function causalEvents(
  state: GameState,
  cause: ResolvedDeathCause,
): GameEvent[] {
  if (!cause.incident) return [];
  const source = state.eventLog.find(
    (event) => event.id === cause.incident?.eventId,
  );
  return source ? [source] : [];
}

function currentFactStep(
  state: GameState,
  cause: ResolvedDeathCause,
): DeathReviewStep {
  return {
    id: `fact:${cause.code}`,
    elapsedSeconds: state.clock.elapsedSeconds,
    label: cause.summary,
  };
}

function knownAdvice(
  state: GameState,
  cause: ResolvedDeathCause,
): string | null {
  const knownRecipes = new Set([
    ...(state.knowledge?.craftedRecipeIds ?? []),
    ...(state.knowledge?.announcedRecipeIds ?? []),
  ]);
  const observed = new Set(state.knowledge?.observedItemIds ?? []);
  const knowsBandage = knownRecipes.has("bandage") || state.inventory.bandage > 0;
  const knowsSpear = knownRecipes.has("spear") || state.inventory.spear > 0;

  if (cause.category === "attack") {
    if (knowsSpear) return "你已经记录：长矛可以在危险动物命中前进行反制。";
    if (knowsBandage) return "你已经记录：脱离攻击后应立即检查并处理开放伤口。";
  }
  if (cause.category === "wound" && knowsBandage) {
    return "你已经记录：草药绷带可先处理开放伤口，拖延会增加感染。";
  }
  if (
    cause.category === "dehydration" &&
    (state.objectives.flags.waterPurified || state.inventory["clean-water"] > 0)
  ) {
    return "你已经验证：出发前净化并携带饮水，比在生命见底时临时找水更安全。";
  }
  if (
    (cause.category === "starvation" || cause.category === "exhaustion") &&
    ([
      "palm-fruit",
      "brazil-nuts",
      "grubs",
      "cooked-meat",
      "smoked-meat",
    ] as const).some((item) => observed.has(item))
  ) {
    return "你已经记录了可食资源；下一次远征前同时检查碳水、蛋白和脂肪缺口。";
  }
  if (cause.category === "sanity" && state.camp.fire.built) {
    return "你已经观察到：点亮的营火与干燥庇护能减轻夜间心理压力。";
  }
  return null;
}

/** Builds an honest three-layer death review from bounded authoritative facts. */
export function deriveDeathReview(state: GameState): DeathReviewModel {
  const cause = resolveDeathCause(state);
  const authoritativeChain = [
    ...authoritativeHealthChain(state, cause),
    ...authoritativeSanityChain(state, cause),
  ].slice(-5);
  const chain =
    authoritativeChain.length > 0
      ? authoritativeChain
      : [
          ...causalEvents(state, cause).map(eventStep),
          currentFactStep(state, cause),
        ]
          .filter(
            (step, index, steps) =>
              steps.findIndex((candidate) => candidate.label === step.label) ===
              index,
          )
          .sort(
            (left, right) =>
              left.elapsedSeconds - right.elapsedSeconds ||
              left.id.localeCompare(right.id),
          )
          .slice(-5);
  return {
    directCauseCode: cause.code,
    directCauseLabel: cause.label,
    summary: cause.summary,
    chain,
    advice: knownAdvice(state, cause),
    inferred: cause.inferred,
  };
}
