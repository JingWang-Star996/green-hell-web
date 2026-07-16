import * as THREE from "three";

export type PersonalLightSource = "off" | "watch" | "torch";

export type PersonalLightProfile = {
  source: PersonalLightSource;
  strength: number;
  color: number;
  pointIntensity: number;
  pointDistance: number;
  beamIntensity: number;
  beamDistance: number;
  beamAngle: number;
  beamPenumbra: number;
};

const TORCH_POINT_INTENSITY = 18;
const TORCH_POINT_DISTANCE = 12;
const TORCH_BEAM_INTENSITY = 64;
const TORCH_BEAM_DISTANCE = 24;
const TORCH_BEAM_ANGLE = 0.8;
const TORCH_BEAM_PENUMBRA = 0.62;
const TORCH_RAIN_INTENSITY_FLOOR = 0.72;
const TORCH_RAIN_DISTANCE_FLOOR = 0.92;

const OFF_PROFILE: PersonalLightProfile = {
  source: "off",
  strength: 0,
  color: 0x9fd8cf,
  pointIntensity: 0,
  pointDistance: 0,
  beamIntensity: 0,
  beamDistance: 0,
  beamAngle: 0.62,
  beamPenumbra: 0.82,
};

/**
 * Matches the renderer's authored sun curve. Keeping this pure makes the
 * automatic backlight deterministic from simulation time rather than frame or
 * browser time.
 */
export function daylightAtMinute(minuteOfDay: number): number {
  const safeMinute = Number.isFinite(minuteOfDay) ? minuteOfDay : 0;
  const minute = ((safeMinute % 1440) + 1440) % 1440;
  const raw = Math.sin(((minute - 360) / 1440) * Math.PI * 2) * 0.5 + 0.5;
  return smoothstep(raw, 0.08, 0.82);
}

/**
 * Mirrors Three.js' inverse-square punctual-light attenuation for decay=2.
 * Keeping this pure lets tests protect useful range without requiring WebGL
 * or treating a light's cutoff distance as its visible illumination radius.
 */
export function inverseSquareLightContribution(
  intensity: number,
  lightDistance: number,
  cutoffDistance: number,
): number {
  if (
    !Number.isFinite(intensity) ||
    !Number.isFinite(lightDistance) ||
    !Number.isFinite(cutoffDistance) ||
    intensity <= 0 ||
    lightDistance < 0 ||
    cutoffDistance < 0
  ) {
    return 0;
  }
  const distanceFalloff = 1 / Math.max(lightDistance ** 2, 0.01);
  if (cutoffDistance === 0) return intensity * distanceFalloff;
  const cutoff = clamp01(1 - (lightDistance / cutoffDistance) ** 4);
  return intensity * distanceFalloff * cutoff ** 2;
}

/**
 * The watch light is intentionally a readability floor, not a free torch. It
 * fades in with darkness and only reaches a few metres. Equipping a torch (the
 * simulation remains authoritative for heldItem) upgrades the same rig.
 */
export function resolvePersonalLightProfile(
  minuteOfDay: number,
  heldItem: string | null,
  rainIntensity = 0,
): PersonalLightProfile {
  const darkness = smoothstep(1 - daylightAtMinute(minuteOfDay), 0.38, 0.78);
  if (darkness <= 0.001) return OFF_PROFILE;
  const rain = clampFinite01(rainIntensity, 1);

  if (heldItem === "torch") {
    // An uncovered flame remains useful in rain, but loses range and stability.
    // The item/burn rules stay in simulation; this is only their light output.
    const intensityScale = 1 - rain * (1 - TORCH_RAIN_INTENSITY_FLOOR);
    const distanceScale = 1 - rain * (1 - TORCH_RAIN_DISTANCE_FLOOR);
    return {
      source: "torch",
      strength: darkness,
      color: 0xff9a45,
      pointIntensity: TORCH_POINT_INTENSITY * darkness * intensityScale,
      pointDistance: TORCH_POINT_DISTANCE * distanceScale,
      beamIntensity: TORCH_BEAM_INTENSITY * darkness * intensityScale,
      beamDistance: TORCH_BEAM_DISTANCE * distanceScale,
      beamAngle: TORCH_BEAM_ANGLE,
      beamPenumbra: TORCH_BEAM_PENUMBRA,
    };
  }

  return {
    source: "watch",
    strength: darkness,
    color: 0xa8e2d6,
    pointIntensity: 0.72 * darkness,
    pointDistance: 3.8,
    beamIntensity: 1.55 * darkness,
    beamDistance: 6.2,
    beamAngle: 0.62,
    beamPenumbra: 0.82,
  };
}

/** Camera-local personal light presentation. It never owns gameplay state. */
export class NightLightRig {
  readonly root = new THREE.Group();
  private readonly point = new THREE.PointLight(0xa8e2d6, 0, 3.8, 2);
  private readonly beam = new THREE.SpotLight(
    0xa8e2d6,
    0,
    6.2,
    0.62,
    0.82,
    2,
  );
  private readonly target = new THREE.Object3D();
  private source: PersonalLightSource = "off";

  constructor() {
    this.root.name = "first-person-night-light";
    this.point.name = "watch-fill-light";
    this.point.position.set(0.12, -0.24, -0.42);
    this.beam.name = "watch-forward-light";
    this.beam.position.set(0.18, -0.16, -0.3);
    this.target.position.set(0, -1.45, -4.2);
    this.beam.target = this.target;
    this.root.add(this.point, this.beam, this.target);
    this.root.visible = false;
  }

  update(
    minuteOfDay: number,
    heldItem: string | null,
    rainIntensity: number,
    elapsedSeconds: number,
    reducedMotion: boolean,
  ): PersonalLightSource {
    const profile = resolvePersonalLightProfile(
      minuteOfDay,
      heldItem,
      rainIntensity,
    );
    this.source = profile.source;
    this.root.visible = profile.source !== "off";
    if (!this.root.visible) {
      this.point.intensity = 0;
      this.beam.intensity = 0;
      return this.source;
    }

    const safeElapsedSeconds = Number.isFinite(elapsedSeconds)
      ? elapsedSeconds
      : 0;
    const flicker =
      profile.source === "torch" && !reducedMotion
        ? 1 +
          Math.sin(safeElapsedSeconds * 13.7) * 0.035 +
          Math.sin(safeElapsedSeconds * 23.1) * 0.025
        : 1;
    this.point.color.setHex(profile.color);
    this.point.intensity = profile.pointIntensity * flicker;
    this.point.distance = profile.pointDistance;
    this.beam.color.setHex(profile.color);
    this.beam.intensity = profile.beamIntensity * flicker;
    this.beam.distance = profile.beamDistance;
    this.beam.angle = profile.beamAngle;
    this.beam.penumbra = profile.beamPenumbra;
    return this.source;
  }

  getSource(): PersonalLightSource {
    return this.source;
  }
}

function smoothstep(value: number, minimum: number, maximum: number): number {
  const normalized = clamp01((value - minimum) / (maximum - minimum));
  return normalized * normalized * (3 - 2 * normalized);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampFinite01(value: number, fallback: number): number {
  return Number.isFinite(value) ? clamp01(value) : clamp01(fallback);
}
