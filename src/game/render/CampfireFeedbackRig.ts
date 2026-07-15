import * as THREE from "three";

import {
  resolveCampfireFeedback,
  type CampfireFeedbackTargets,
  type CampfireTransientDescriptor,
} from "./campfireFeedback";

type ActiveTransient = {
  descriptor: CampfireTransientDescriptor;
  startedAt: number;
};

const MAX_SPARKS = 12;
const MAX_SMOKE_PUFFS = 6;
const MAX_SEEN_EVENT_IDS = 64;
const MAX_TRANSIENT_QUEUE = 8;

/**
 * Session-only presentation for an authoritative campfire. It consumes
 * bounded targets/descriptors and never reads or mutates simulation fuel.
 */
export class CampfireFeedbackRig {
  private targets = resolveCampfireFeedback({
    built: false,
    lit: false,
    fuelSeconds: 0,
    fuelCapacitySeconds: 0,
    reducedMotion: false,
    authoritativeEvents: [],
    lastProcessedEventId: 0,
  });
  private readonly queue: CampfireTransientDescriptor[] = [];
  private readonly seenEventIds = new Set<number>();
  private active: ActiveTransient | null = null;
  private transientStartListener:
    | ((descriptor: CampfireTransientDescriptor) => void)
    | null = null;
  private readonly flames: THREE.Mesh[] = [];
  private readonly logs: THREE.Mesh[] = [];
  private readonly embers: THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >;
  private readonly sparks: THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >;
  private readonly smoke: THREE.Points<
    THREE.BufferGeometry,
    THREE.PointsMaterial
  >;
  private readonly droppedLog: THREE.Mesh<
    THREE.CylinderGeometry,
    THREE.MeshStandardMaterial
  >;

  constructor(
    private readonly root: THREE.Group,
    private readonly light: THREE.PointLight,
  ) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.flame === true) this.flames.push(object);
      if (object.userData.fireLog === true) this.logs.push(object);
    });

    this.embers = createPoints(MAX_SPARKS, 0xff8a2c, 0.055);
    this.embers.name = "campfire-embers";
    const emberPositions = this.embers.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      const angle = (index / MAX_SPARKS) * Math.PI * 2;
      const radius = 0.12 + (index % 3) * 0.035;
      emberPositions.setXYZ(
        index,
        Math.cos(angle) * radius,
        0.23 + (index % 2) * 0.018,
        Math.sin(angle) * radius,
      );
    }
    emberPositions.needsUpdate = true;

    this.sparks = createPoints(MAX_SPARKS, 0xffb13b, 0.065);
    this.sparks.name = "campfire-transient-sparks";
    this.smoke = createPoints(MAX_SMOKE_PUFFS, 0xa6aaa3, 0.22);
    this.smoke.name = "campfire-transient-smoke";
    this.droppedLog = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.11, 0.82, 7),
      new THREE.MeshStandardMaterial({ color: 0x71452b, roughness: 1 }),
    );
    this.droppedLog.name = "campfire-transient-log";
    this.droppedLog.visible = false;
    this.droppedLog.castShadow = true;
    root.add(this.embers, this.sparks, this.smoke, this.droppedLog);
    this.applyStatic(0, 0);
    this.hideTransientVisuals();
  }

  apply(feedback: CampfireFeedbackTargets): void {
    this.targets = feedback;
    for (const descriptor of feedback.transients) {
      if (this.seenEventIds.has(descriptor.eventId)) continue;
      this.seenEventIds.add(descriptor.eventId);
      this.queue.push(descriptor);
    }
    while (this.queue.length > MAX_TRANSIENT_QUEUE) this.queue.shift();
    while (this.seenEventIds.size > MAX_SEEN_EVENT_IDS) {
      const oldest = this.seenEventIds.values().next().value;
      if (typeof oldest !== "number") break;
      this.seenEventIds.delete(oldest);
    }
    this.applyStatic(performance.now(), 0);
  }

  setTransientStartListener(
    listener: ((descriptor: CampfireTransientDescriptor) => void) | null,
  ): void {
    this.transientStartListener = listener;
  }

  update(deltaSeconds: number, now = performance.now()): void {
    if (!this.active && this.queue.length > 0) {
      this.active = { descriptor: this.queue.shift()!, startedAt: now };
      try {
        this.transientStartListener?.(this.active.descriptor);
      } catch {
        // Presentation feedback must never stop the render loop if an optional
        // audio consumer fails or is disposed between frames.
      }
    }
    let transientPulse = 0;
    if (this.active) {
      const progress = THREE.MathUtils.clamp(
        (now - this.active.startedAt) / this.active.descriptor.durationMs,
        0,
        1,
      );
      transientPulse =
        Math.sin(progress * Math.PI) * this.active.descriptor.lightPulse;
      this.updateTransient(this.active.descriptor, progress);
      if (progress >= 1) {
        this.active = null;
        this.hideTransientVisuals();
      }
    } else {
      this.hideTransientVisuals();
    }
    this.applyStatic(now, transientPulse, deltaSeconds);
  }

  resetTransients(): void {
    this.queue.length = 0;
    this.seenEventIds.clear();
    this.active = null;
    this.hideTransientVisuals();
  }

  /** Clears both event history and the previous run's authoritative targets. */
  reset(): void {
    this.resetTransients();
    this.targets = resolveCampfireFeedback({
      built: false,
      lit: false,
      fuelSeconds: 0,
      fuelCapacitySeconds: 0,
      reducedMotion: false,
      authoritativeEvents: [],
      lastProcessedEventId: 0,
    });
    this.applyStatic(performance.now(), 0);
  }

  getDebugState(): Readonly<{
    stage: CampfireFeedbackTargets["stage"];
    queued: number;
    activeEventId: number | null;
    seen: number;
  }> {
    return {
      stage: this.targets.stage,
      queued: this.queue.length,
      activeEventId: this.active?.descriptor.eventId ?? null,
      seen: this.seenEventIds.size,
    };
  }

  private applyStatic(
    now: number,
    transientPulse: number,
    deltaSeconds = 0,
  ): void {
    const targets = this.targets;
    this.root.visible = targets.stage !== "unbuilt";
    const flickerWave = Math.sin(now * 0.015) * 0.62 + Math.sin(now * 0.027) * 0.38;
    const lightFlicker = flickerWave * targets.light.flickerAmplitude;
    this.light.intensity = Math.max(
      0,
      targets.light.intensity + lightFlicker + transientPulse,
    );
    this.light.distance = targets.light.range;
    this.light.color.copy(
      fireColorForTemperature(targets.light.colorTemperatureKelvin),
    );

    for (const [index, flame] of this.flames.entries()) {
      flame.visible = targets.flame.visible;
      const phase = Math.sin(now * 0.012 + index * 1.7);
      const flicker = phase * targets.flame.flickerAmplitude;
      flame.scale.set(
        Math.max(0.02, targets.flame.widthScale * (1 + flicker * 0.35)),
        Math.max(0.02, targets.flame.heightScale * (1 + flicker)),
        Math.max(0.02, targets.flame.widthScale * (1 - flicker * 0.2)),
      );
      if (deltaSeconds > 0) {
        flame.rotation.y += deltaSeconds * (index % 2 ? 0.9 : -0.7) *
          Math.max(0.1, targets.flame.flickerAmplitude * 4);
      }
      const materials = Array.isArray(flame.material)
        ? flame.material
        : [flame.material];
      for (const material of materials) {
        material.transparent = true;
        material.depthWrite = false;
        material.opacity = targets.flame.opacity;
      }
    }

    this.embers.visible = targets.embers.opacity > 0.01;
    this.embers.material.opacity = targets.embers.opacity *
      (1 + Math.sin(now * 0.006) * targets.embers.glow * 0.08);
    this.embers.material.size = 0.035 + targets.embers.glow * 0.04;
    this.embers.rotation.y =
      now * 0.00005 * targets.embers.sparkRatePerSecond;
    for (const log of this.logs) {
      const materials = Array.isArray(log.material)
        ? log.material
        : [log.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        material.color
          .set(0x694128)
          .lerp(new THREE.Color(0x171310), targets.logChar.amount);
        material.emissive.set(0x9a2f0b);
        material.emissiveIntensity = targets.logChar.emberTint * 0.32;
      }
    }
  }

  private updateTransient(
    descriptor: CampfireTransientDescriptor,
    progress: number,
  ): void {
    const fade = 1 - THREE.MathUtils.smoothstep(progress, 0.55, 1);
    const sparkPositions = this.sparks.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      if (index >= descriptor.sparkCount) {
        sparkPositions.setXYZ(index, 0, -10, 0);
        continue;
      }
      const random = seededUnit(descriptor.deterministicSeed, index);
      const angle = random * Math.PI * 2 + index * 1.31;
      const drift =
        (0.1 + seededUnit(descriptor.deterministicSeed ^ 0x9e3779b9, index) * 0.48) *
        descriptor.motionScale * progress;
      sparkPositions.setXYZ(
        index,
        Math.cos(angle) * drift,
        0.28 + progress * (0.55 + random * 0.72) * descriptor.motionScale,
        Math.sin(angle) * drift,
      );
    }
    sparkPositions.needsUpdate = true;
    this.sparks.visible = descriptor.sparkCount > 0 && fade > 0.01;
    this.sparks.material.opacity = fade;

    const smokePositions = this.smoke.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    for (let index = 0; index < MAX_SMOKE_PUFFS; index += 1) {
      if (index >= descriptor.smokePuffCount) {
        smokePositions.setXYZ(index, 0, -10, 0);
        continue;
      }
      const random = seededUnit(descriptor.deterministicSeed ^ 0x85ebca6b, index);
      const angle = random * Math.PI * 2;
      const spread = progress * 0.32 * descriptor.motionScale;
      smokePositions.setXYZ(
        index,
        Math.cos(angle) * spread,
        0.35 + progress * (0.4 + random * 0.55) * descriptor.motionScale,
        Math.sin(angle) * spread,
      );
    }
    smokePositions.needsUpdate = true;
    this.smoke.visible = descriptor.smokePuffCount > 0 && fade > 0.01;
    this.smoke.material.opacity = fade * 0.56;

    this.droppedLog.visible = descriptor.logDrop.enabled;
    if (descriptor.logDrop.enabled) {
      const eased = 1 - Math.pow(1 - progress, 3);
      this.droppedLog.position.set(
        descriptor.logDrop.distance * (1 - eased),
        0.22 + Math.sin(eased * Math.PI) * 0.46 * descriptor.motionScale,
        0.05,
      );
      this.droppedLog.rotation.set(
        0,
        eased * descriptor.logDrop.rotationTurns * Math.PI * 2,
        Math.PI / 2,
      );
    }
  }

  private hideTransientVisuals(): void {
    this.sparks.visible = false;
    this.sparks.material.opacity = 0;
    this.smoke.visible = false;
    this.smoke.material.opacity = 0;
    this.droppedLog.visible = false;
  }
}

function createPoints(
  count: number,
  color: number,
  size: number,
): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return points;
}

function seededUnit(seed: number, index: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value / 0x1_0000_0000;
}

function fireColorForTemperature(kelvin: number): THREE.Color {
  const normalized = Number.isFinite(kelvin)
    ? THREE.MathUtils.clamp((kelvin - 1_200) / 1_000, 0, 1)
    : 0;
  return new THREE.Color(0xff3f16).lerp(
    new THREE.Color(0xffa24a),
    normalized,
  );
}
