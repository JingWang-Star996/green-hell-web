import type { WindFieldState } from "../world/windField";

const TAU = Math.PI * 2;
const MAX_RAIN_TILT_RADIANS = Math.PI / 6;

export type WindPresentationQuality = "full" | "low-power";
export type WindStrengthBand = "calm" | "breeze" | "strong" | "gust";
export type WindDirectionSector =
  | "unknown"
  | "calm"
  | "north"
  | "east"
  | "south"
  | "west";
export type WindPerceptionChannel =
  | "indicator-leaves"
  | "rain-lines"
  | "directional-audio"
  | "text-sector";

export interface WindPresentationOptions {
  stableObjectId?: string;
  quality?: WindPresentationQuality;
  reducedMotion?: boolean;
}

export interface WindPresentation {
  valid: boolean;
  strength: number;
  strengthBand: WindStrengthBand;
  directionSector: WindDirectionSector;
  /** Unit flow vector. Angle zero is +Z; positive angles turn clockwise to +X. */
  worldDirection: { x: number; z: number };
  rainLines: {
    tiltRadians: number;
    tiltNormalized: number;
    directionX: number;
    directionZ: number;
  };
  canopy: {
    swayAmplitudeRadians: number;
    swayFrequencyHertz: number;
    phaseRadians: number;
    directionX: number;
    directionZ: number;
  };
  leafUnderside: {
    flipAmount: number;
    visible: boolean;
    transitionFrequencyHertz: number;
  };
  soundscape: {
    flowDirectionX: number;
    flowDirectionZ: number;
    windBedGain: number;
    rustleGain: number;
    gustAccentGain: number;
    directionalBlend: number;
  };
  budget: {
    fallingLeafParticleLimit: 16 | 48;
    minimumIndicatorLeafCount: 4 | 8;
  };
  availableChannels: readonly WindPerceptionChannel[];
  motionMode: "full" | "reduced";
}

const FULL_CHANNELS = [
  "indicator-leaves",
  "rain-lines",
  "directional-audio",
  "text-sector",
] as const satisfies readonly WindPerceptionChannel[];

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function wrapRadians(value: number): number {
  const wrapped = value % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** Stable FNV-1a phase; it never rotates or otherwise alters the wind vector. */
export function stableWindObjectPhase(stableObjectId: string): number {
  const id = stableObjectId.trim() || "wind-object";
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0x1_0000_0000) * TAU;
}

function strengthBand(strength: number): WindStrengthBand {
  if (strength < 0.18) return "calm";
  if (strength < 0.45) return "breeze";
  if (strength <= 0.72) return "strong";
  return "gust";
}

function directionSector(
  directionRadians: number,
  strength: number,
): WindDirectionSector {
  if (strength < 0.18) return "calm";
  const quarter = Math.round(wrapRadians(directionRadians) / (Math.PI / 2)) % 4;
  return (["north", "east", "south", "west"] as const)[quarter];
}

function failClosedPresentation(
  options: WindPresentationOptions,
): WindPresentation {
  const lowPower = options.quality === "low-power";
  const reducedMotion = options.reducedMotion === true;
  return {
    valid: false,
    strength: 0,
    strengthBand: "calm",
    directionSector: "unknown",
    worldDirection: { x: 0, z: 0 },
    rainLines: {
      tiltRadians: 0,
      tiltNormalized: 0,
      directionX: 0,
      directionZ: 0,
    },
    canopy: {
      swayAmplitudeRadians: 0,
      swayFrequencyHertz: 0,
      phaseRadians: stableWindObjectPhase(options.stableObjectId ?? "wind-object"),
      directionX: 0,
      directionZ: 0,
    },
    leafUnderside: {
      flipAmount: 0,
      visible: false,
      transitionFrequencyHertz: 0,
    },
    soundscape: {
      flowDirectionX: 0,
      flowDirectionZ: 0,
      windBedGain: 0,
      rustleGain: 0,
      gustAccentGain: 0,
      directionalBlend: 0,
    },
    budget: {
      fallingLeafParticleLimit: lowPower ? 16 : 48,
      minimumIndicatorLeafCount: lowPower ? 4 : 8,
    },
    availableChannels: FULL_CHANNELS,
    motionMode: reducedMotion ? "reduced" : "full",
  };
}

/**
 * Pure renderer projection of the authoritative wind field. Object identity
 * changes animation phase only; every perceptual channel keeps the same world
 * direction and strength truth.
 */
export function projectWindPresentation(
  state: Pick<WindFieldState, "directionRadians" | "speed" | "gust">,
  options: WindPresentationOptions = {},
): WindPresentation {
  if (
    !Number.isFinite(state.directionRadians) ||
    !Number.isFinite(state.speed) ||
    !Number.isFinite(state.gust)
  ) {
    return failClosedPresentation(options);
  }

  const directionRadians = wrapRadians(state.directionRadians);
  const strength = clamp01(Math.max(state.speed, state.gust));
  const directionX = Math.sin(directionRadians);
  const directionZ = Math.cos(directionRadians);
  const reducedMotion = options.reducedMotion === true;
  const lowPower = options.quality === "low-power";
  const baseSwayAmplitude = 0.018 * strength + 0.16 * strength * strength;
  const baseFrequency = strength < 0.01 ? 0 : 0.14 + strength * 0.46;
  const swayAmplitudeRadians = reducedMotion
    ? baseSwayAmplitude * 0.18
    : baseSwayAmplitude;
  const swayFrequencyHertz = reducedMotion
    ? baseFrequency * 0.3
    : baseFrequency;
  const flipAmount = smoothstep((strength - 0.18) / 0.54);
  const tiltNormalized = smoothstep(strength);

  return {
    valid: true,
    strength,
    strengthBand: strengthBand(strength),
    directionSector: directionSector(directionRadians, strength),
    worldDirection: { x: directionX, z: directionZ },
    rainLines: {
      tiltRadians: tiltNormalized * MAX_RAIN_TILT_RADIANS,
      tiltNormalized,
      directionX,
      directionZ,
    },
    canopy: {
      swayAmplitudeRadians,
      swayFrequencyHertz,
      phaseRadians: stableWindObjectPhase(options.stableObjectId ?? "wind-object"),
      directionX,
      directionZ,
    },
    leafUnderside: {
      flipAmount,
      visible: strength >= 0.18,
      transitionFrequencyHertz: reducedMotion
        ? baseFrequency * 0.25
        : baseFrequency,
    },
    soundscape: {
      flowDirectionX: directionX,
      flowDirectionZ: directionZ,
      windBedGain: clamp01(strength * 0.46),
      rustleGain: smoothstep((strength - 0.12) / 0.68),
      gustAccentGain: smoothstep((strength - 0.72) / 0.28),
      directionalBlend: smoothstep((strength - 0.18) / 0.62),
    },
    budget: {
      fallingLeafParticleLimit: lowPower ? 16 : 48,
      minimumIndicatorLeafCount: lowPower ? 4 : 8,
    },
    availableChannels: FULL_CHANNELS,
    motionMode: reducedMotion ? "reduced" : "full",
  };
}
