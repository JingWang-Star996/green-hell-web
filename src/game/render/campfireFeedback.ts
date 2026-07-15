import type { GameEvent } from "../sim";

export type CampfireVisualStage =
  | "unbuilt"
  | "cold"
  | "embers"
  | "low"
  | "steady"
  | "full";

export type CampfireFeedbackEvent = Pick<
  GameEvent,
  "id" | "type" | "details" | "cause"
>;

export interface CampfireFeedbackInput {
  built: boolean;
  lit: boolean;
  fuelSeconds: number;
  fuelCapacitySeconds: number;
  reducedMotion: boolean;
  authoritativeEvents: readonly CampfireFeedbackEvent[];
  /** Null only during bootstrap/save hydration; zero means an empty live run. */
  lastProcessedEventId: number | null;
}

export interface CampfireTransientDescriptor {
  eventId: number;
  kind: "fuel-added" | "fire-lit" | "fire-extinguished";
  deterministicSeed: number;
  visualCue: "log-drop-sparks" | "ignition-bloom" | "smoke-collapse";
  durationMs: number;
  motionScale: number;
  sparkCount: number;
  smokePuffCount: number;
  logDrop: Readonly<{
    enabled: boolean;
    distance: number;
    rotationTurns: number;
  }>;
  lightPulse: number;
  audioCue: "fuel-drop" | "fire-ignite" | "fire-extinguish";
  audioGain: number;
}

/** One source of truth for both the React feedback resolver and WebGL rigs. */
export function resolveEffectiveReducedMotion(
  userPreference: boolean,
  systemPreference: boolean,
): boolean {
  return userPreference === true || systemPreference === true;
}

export interface CampfireFeedbackTargets {
  stage: CampfireVisualStage;
  fuelRatio: number;
  flame: Readonly<{
    visible: boolean;
    heightScale: number;
    widthScale: number;
    opacity: number;
    flickerAmplitude: number;
  }>;
  light: Readonly<{
    intensity: number;
    range: number;
    flickerAmplitude: number;
    colorTemperatureKelvin: number;
  }>;
  embers: Readonly<{
    glow: number;
    opacity: number;
    sparkRatePerSecond: number;
  }>;
  logChar: Readonly<{
    amount: number;
    emberTint: number;
  }>;
  audio: Readonly<{
    loopGain: number;
    crackleRatePerSecond: number;
    lowPassHertz: number;
  }>;
  /** Caller stores this cursor outside simulation/save state. */
  lastProcessedEventId: number;
  transients: readonly CampfireTransientDescriptor[];
}

export const CAMPFIRE_FEEDBACK_LIMITS = {
  maximumTransientDescriptors: 4,
  flameScale: 1.2,
  lightIntensity: 3,
  lightRange: 9,
  emberSparkRate: 14,
  audioGain: 0.12,
  crackleRate: 2,
  transientDurationMs: 1_200,
} as const;

function clamp(value: number, minimum = 0, maximum = 1): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function stageFor(
  built: boolean,
  lit: boolean,
  fuelSeconds: number,
  fuelCapacitySeconds: number,
  fuelRatio: number,
): CampfireVisualStage {
  if (!built) return "unbuilt";
  const validFlame = lit && fuelSeconds > 0 && fuelCapacitySeconds > 0;
  if (!validFlame) return fuelSeconds > 0 ? "embers" : "cold";
  if (fuelRatio <= 0.2) return "low";
  if (fuelRatio >= 0.9) return "full";
  return "steady";
}

function staticTargets(
  stage: CampfireVisualStage,
  fuelRatio: number,
  reducedMotion: boolean,
): Pick<
  CampfireFeedbackTargets,
  "flame" | "light" | "embers" | "logChar" | "audio"
> {
  if (stage === "unbuilt") {
    return {
      flame: {
        visible: false,
        heightScale: 0,
        widthScale: 0,
        opacity: 0,
        flickerAmplitude: 0,
      },
      light: {
        intensity: 0,
        range: 0,
        flickerAmplitude: 0,
        colorTemperatureKelvin: 1_800,
      },
      embers: { glow: 0, opacity: 0, sparkRatePerSecond: 0 },
      logChar: { amount: 0, emberTint: 0 },
      audio: { loopGain: 0, crackleRatePerSecond: 0, lowPassHertz: 800 },
    };
  }
  if (stage === "cold") {
    return {
      flame: {
        visible: false,
        heightScale: 0,
        widthScale: 0,
        opacity: 0,
        flickerAmplitude: 0,
      },
      light: {
        intensity: 0,
        range: 0,
        flickerAmplitude: 0,
        colorTemperatureKelvin: 1_800,
      },
      embers: { glow: 0, opacity: 0, sparkRatePerSecond: 0 },
      logChar: { amount: 0.82, emberTint: 0 },
      audio: { loopGain: 0, crackleRatePerSecond: 0, lowPassHertz: 800 },
    };
  }
  if (stage === "embers") {
    return {
      flame: {
        visible: false,
        heightScale: 0,
        widthScale: 0,
        opacity: 0,
        flickerAmplitude: 0,
      },
      light: {
        intensity: clamp(0.18 + fuelRatio * 0.32, 0, 0.5),
        range: clamp(1.2 + fuelRatio * 1.4, 0, 2.6),
        flickerAmplitude: reducedMotion ? 0.015 : 0.06,
        colorTemperatureKelvin: 1_250,
      },
      embers: {
        glow: clamp(0.48 + fuelRatio * 0.42),
        opacity: clamp(0.58 + fuelRatio * 0.3),
        sparkRatePerSecond: reducedMotion ? 0.25 : 1,
      },
      logChar: { amount: 0.94, emberTint: clamp(0.42 + fuelRatio * 0.4) },
      audio: {
        loopGain: 0.012,
        crackleRatePerSecond: 0.08,
        lowPassHertz: 1_600,
      },
    };
  }
  const motionFactor = reducedMotion ? 0.22 : 1;
  return {
    flame: {
      visible: true,
      heightScale: clamp(0.34 + fuelRatio * 0.72, 0, 1.2),
      widthScale: clamp(0.38 + fuelRatio * 0.48, 0, 1.2),
      opacity: clamp(0.62 + fuelRatio * 0.3),
      flickerAmplitude: clamp(
        (0.08 + fuelRatio * 0.14) * motionFactor,
        0,
        0.25,
      ),
    },
    light: {
      intensity: clamp(0.72 + fuelRatio * 1.95, 0, 3),
      range: clamp(3.1 + fuelRatio * 4.6, 0, 9),
      flickerAmplitude: clamp(
        (0.09 + fuelRatio * 0.22) * motionFactor,
        0,
        0.35,
      ),
      colorTemperatureKelvin: 1_850,
    },
    embers: {
      glow: clamp(0.55 + fuelRatio * 0.4),
      opacity: clamp(0.62 + fuelRatio * 0.3),
      sparkRatePerSecond: clamp(
        (3 + fuelRatio * 8) * (reducedMotion ? 0.2 : 1),
        0,
        14,
      ),
    },
    logChar: {
      amount: clamp(0.9 - fuelRatio * 0.28),
      emberTint: clamp(0.55 + fuelRatio * 0.35),
    },
    audio: {
      loopGain: clamp(0.025 + fuelRatio * 0.065, 0, 0.12),
      crackleRatePerSecond: clamp(0.28 + fuelRatio * 0.82, 0, 2),
      lowPassHertz: clamp(3_200 + fuelRatio * 2_800, 800, 8_000),
    },
  };
}

function eventSignature(event: CampfireFeedbackEvent): string {
  const added = event.details?.fuelAddedSeconds;
  return [
    event.type,
    event.cause.source,
    event.cause.code,
    typeof added === "number" && Number.isFinite(added) ? added : "-",
  ].join("|");
}

function deterministicSeed(event: CampfireFeedbackEvent): number {
  let hash = 0x811c9dc5;
  const source = `${event.id}|${eventSignature(event)}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function transientFor(
  event: CampfireFeedbackEvent,
  reducedMotion: boolean,
): CampfireTransientDescriptor | null {
  const seed = deterministicSeed(event);
  const motionScale = reducedMotion ? 0.25 : 1;
  if (event.type === "fuel-added") {
    const fuelAddedSeconds = event.details?.fuelAddedSeconds;
    if (
      typeof fuelAddedSeconds !== "number" ||
      !Number.isFinite(fuelAddedSeconds) ||
      fuelAddedSeconds <= 0
    ) {
      return null;
    }
    return {
      eventId: event.id,
      kind: "fuel-added",
      deterministicSeed: seed,
      visualCue: "log-drop-sparks",
      durationMs: reducedMotion ? 320 : 760,
      motionScale,
      sparkCount: 8 + (seed % 5),
      smokePuffCount: 0,
      logDrop: {
        enabled: true,
        distance: reducedMotion ? 0.08 : 0.42,
        rotationTurns: reducedMotion ? 0.05 : 0.32,
      },
      lightPulse: reducedMotion ? 0.18 : 0.55,
      audioCue: "fuel-drop",
      audioGain: 0.65,
    };
  }
  if (event.type === "fire-lit") {
    return {
      eventId: event.id,
      kind: "fire-lit",
      deterministicSeed: seed,
      visualCue: "ignition-bloom",
      durationMs: reducedMotion ? 380 : 920,
      motionScale,
      sparkCount: 10 + (seed % 5),
      smokePuffCount: 1,
      logDrop: { enabled: false, distance: 0, rotationTurns: 0 },
      lightPulse: reducedMotion ? 0.35 : 1,
      audioCue: "fire-ignite",
      audioGain: 0.75,
    };
  }
  if (event.type === "fire-extinguished") {
    return {
      eventId: event.id,
      kind: "fire-extinguished",
      deterministicSeed: seed,
      visualCue: "smoke-collapse",
      durationMs: reducedMotion ? 360 : 840,
      motionScale,
      sparkCount: 0,
      smokePuffCount: 4 + (seed % 3),
      logDrop: { enabled: false, distance: 0, rotationTurns: 0 },
      lightPulse: 0,
      audioCue: "fire-extinguish",
      audioGain: 0.7,
    };
  }
  return null;
}

function isValidEventId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

function normalizeCursor(cursor: number | null): number | null {
  if (cursor === null) return null;
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

function eventTransients(
  events: readonly CampfireFeedbackEvent[],
  cursor: number | null,
  reducedMotion: boolean,
): Readonly<{
  lastProcessedEventId: number;
  transients: readonly CampfireTransientDescriptor[];
}> {
  const byId = new Map<
    number,
    { event: CampfireFeedbackEvent; signature: string; ambiguous: boolean }
  >();
  let maximumEventId = 0;
  for (const event of events) {
    if (!isValidEventId(event.id)) continue;
    maximumEventId = Math.max(maximumEventId, event.id);
    const signature = eventSignature(event);
    const existing = byId.get(event.id);
    if (!existing) {
      byId.set(event.id, { event, signature, ambiguous: false });
    } else if (existing.signature !== signature) {
      existing.ambiguous = true;
    }
  }
  if (cursor === null) {
    return { lastProcessedEventId: maximumEventId, transients: [] };
  }
  const candidates = [...byId.entries()]
    .filter(
      ([eventId, candidate]) => eventId > cursor && !candidate.ambiguous,
    )
    .sort(([left], [right]) => left - right)
    .map(([, candidate]) => ({
      event: candidate.event,
      descriptor: transientFor(candidate.event, reducedMotion),
    }))
    .filter(
      (candidate): candidate is {
        event: CampfireFeedbackEvent;
        descriptor: CampfireTransientDescriptor;
      } => candidate.descriptor !== null,
    );
  const coalesced: Array<{
    event: CampfireFeedbackEvent;
    descriptor: CampfireTransientDescriptor;
  }> = [];
  for (const candidate of candidates) {
    const { descriptor, event } = candidate;
    const previous = coalesced.at(-1);
    if (
      previous?.descriptor.kind === "fuel-added" &&
      descriptor.kind === "fire-lit" &&
      descriptor.eventId === previous.descriptor.eventId + 1 &&
      event.cause.source === previous.event.cause.source &&
      event.cause.code === previous.event.cause.code
    ) {
      // A cold relight authors fuel-added then fire-lit in the same command.
      // Present that one player gesture as one ignition beat: the dropped log
      // remains visible, while the stronger ignition sound/light fires once.
      coalesced[coalesced.length - 1] = {
        event,
        descriptor: {
          ...descriptor,
          durationMs: Math.max(
            previous.descriptor.durationMs,
            descriptor.durationMs,
          ),
          sparkCount: Math.max(
            previous.descriptor.sparkCount,
            descriptor.sparkCount,
          ),
          smokePuffCount: Math.max(
            previous.descriptor.smokePuffCount,
            descriptor.smokePuffCount,
          ),
          logDrop: previous.descriptor.logDrop,
          lightPulse: Math.max(
            previous.descriptor.lightPulse,
            descriptor.lightPulse,
          ),
        },
      };
      continue;
    }
    coalesced.push(candidate);
  }
  const bounded = coalesced
    .slice(-CAMPFIRE_FEEDBACK_LIMITS.maximumTransientDescriptors)
    .map((candidate) => candidate.descriptor);
  return {
    lastProcessedEventId: Math.max(cursor, maximumEventId),
    transients: bounded,
  };
}

/**
 * Produces bounded presentation targets from authoritative state and events.
 * The result contains no callbacks and cannot mutate fuel, fire, or event data.
 */
export function resolveCampfireFeedback(
  input: CampfireFeedbackInput,
): CampfireFeedbackTargets {
  const built = input.built === true;
  const requestedLit = input.lit === true;
  const fuelCapacitySeconds = finiteNonNegative(input.fuelCapacitySeconds);
  const fuelSeconds = clamp(
    finiteNonNegative(input.fuelSeconds),
    0,
    fuelCapacitySeconds,
  );
  const fuelRatio =
    fuelCapacitySeconds > 0
      ? clamp(fuelSeconds / fuelCapacitySeconds)
      : 0;
  const stage = stageFor(
    built,
    requestedLit,
    fuelSeconds,
    fuelCapacitySeconds,
    fuelRatio,
  );
  const eventFeedback = eventTransients(
    input.authoritativeEvents,
    normalizeCursor(input.lastProcessedEventId),
    input.reducedMotion === true,
  );
  return {
    stage,
    fuelRatio,
    ...staticTargets(stage, fuelRatio, input.reducedMotion === true),
    ...eventFeedback,
  };
}
