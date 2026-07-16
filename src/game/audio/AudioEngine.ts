import type {
  CampfireFeedbackTargets,
  CampfireTransientDescriptor,
} from "../render/campfireFeedback";
import type { WindPresentation } from "../render/windPresentation";

type NoiseLayer = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
};

type DirectionalNoiseLayer = NoiseLayer & {
  /** Null on older Safari/WebViews; gain/filter audio remains available. */
  panner: StereoPannerNode | null;
};

export type DirectionalWindSoundscape = WindPresentation["soundscape"];

export interface DirectionalWindAudioTargets {
  gain: number;
  lowPassHertz: number;
  stereoPan: number;
}

const SILENT_WIND_AUDIO: DirectionalWindAudioTargets = {
  gain: 0,
  lowPassHertz: 600,
  stereoPan: 0,
};

/**
 * Converts a world-space flow vector to listener-relative WebAudio targets.
 * A Three.js camera at yaw 0 looks toward -Z and has +X on its right.
 */
export function resolveDirectionalWindAudio(
  soundscape: DirectionalWindSoundscape | null | undefined,
  playerYaw: number,
): DirectionalWindAudioTargets {
  if (!soundscape || !Number.isFinite(playerYaw)) return SILENT_WIND_AUDIO;
  const values = [
    soundscape.flowDirectionX,
    soundscape.flowDirectionZ,
    soundscape.windBedGain,
    soundscape.rustleGain,
    soundscape.gustAccentGain,
    soundscape.directionalBlend,
  ];
  if (!values.every(Number.isFinite)) return SILENT_WIND_AUDIO;

  const magnitude = Math.hypot(
    soundscape.flowDirectionX,
    soundscape.flowDirectionZ,
  );
  const componentGain =
    finiteClamp(soundscape.windBedGain, 0, 1) * 0.12 +
    finiteClamp(soundscape.rustleGain, 0, 1) * 0.045 +
    finiteClamp(soundscape.gustAccentGain, 0, 1) * 0.035;
  if (magnitude <= 1e-9 || componentGain <= 0) {
    return SILENT_WIND_AUDIO;
  }

  const directionX = soundscape.flowDirectionX / magnitude;
  const directionZ = soundscape.flowDirectionZ / magnitude;
  const rightX = Math.cos(playerYaw);
  const rightZ = -Math.sin(playerYaw);
  const forwardX = -Math.sin(playerYaw);
  const forwardZ = -Math.cos(playerYaw);
  const side = directionX * rightX + directionZ * rightZ;
  const front = directionX * forwardX + directionZ * forwardZ;
  const directionalBlend = finiteClamp(soundscape.directionalBlend, 0, 1);
  const rustle = finiteClamp(soundscape.rustleGain, 0, 1);
  const gust = finiteClamp(soundscape.gustAccentGain, 0, 1);

  return {
    gain: finiteClamp(componentGain, 0, 0.16),
    lowPassHertz: finiteClamp(
      650 + rustle * 2_400 + ((front + 1) / 2) * 600 + gust * 500,
      450,
      4_200,
    ),
    stereoPan: finiteClamp(side * directionalBlend, -1, 1),
  };
}

const MAX_CAMPFIRE_AUDIO_EVENTS = 64;
const MAX_PENDING_CAMPFIRE_AUDIO_EVENTS = 8;
const DEFAULT_PENDING_CAMPFIRE_AUDIO_TTL_MS = 1_200;

interface PendingCampfireAudioEvent {
  transient: CampfireTransientDescriptor;
  expiresAtMs: number;
}

export interface CampfireAudioEventBufferOptions {
  now?: () => number;
  pendingTtlMs?: number;
}

/**
 * Bounded event ownership for WebAudio autoplay/suspension boundaries. An id
 * becomes seen only after presentation succeeds (or the player explicitly
 * muted it), so a suspended AudioContext cannot permanently swallow feedback.
 */
export class CampfireAudioEventBuffer {
  private readonly seenEventIds = new Set<number>();
  private readonly pending: PendingCampfireAudioEvent[] = [];
  private readonly pendingEventIds = new Set<number>();
  private readonly now: () => number;
  private readonly pendingTtlMs: number;

  constructor(options: CampfireAudioEventBufferOptions = {}) {
    this.now = options.now ?? Date.now;
    this.pendingTtlMs = Number.isFinite(options.pendingTtlMs)
      ? Math.max(0, options.pendingTtlMs!)
      : DEFAULT_PENDING_CAMPFIRE_AUDIO_TTL_MS;
  }

  submit(
    transient: CampfireTransientDescriptor,
    present: (transient: CampfireTransientDescriptor) => boolean,
  ): "played" | "queued" | "duplicate" {
    this.expirePending();
    if (
      this.seenEventIds.has(transient.eventId) ||
      this.pendingEventIds.has(transient.eventId)
    ) {
      return "duplicate";
    }
    if (present(transient)) {
      this.markSeen(transient.eventId);
      return "played";
    }
    this.pending.push({
      transient,
      expiresAtMs: this.now() + this.pendingTtlMs,
    });
    this.pendingEventIds.add(transient.eventId);
    while (this.pending.length > MAX_PENDING_CAMPFIRE_AUDIO_EVENTS) {
      const dropped = this.pending.shift();
      if (dropped) this.pendingEventIds.delete(dropped.transient.eventId);
    }
    return "queued";
  }

  flush(
    present: (transient: CampfireTransientDescriptor) => boolean,
  ): number {
    this.expirePending();
    let played = 0;
    while (this.pending.length > 0) {
      const transient = this.pending[0].transient;
      if (!present(transient)) break;
      this.pending.shift();
      this.pendingEventIds.delete(transient.eventId);
      this.markSeen(transient.eventId);
      played += 1;
    }
    return played;
  }

  acknowledgeMuted(transient: CampfireTransientDescriptor): void {
    const pendingIndex = this.pending.findIndex(
      (candidate) => candidate.transient.eventId === transient.eventId,
    );
    if (pendingIndex >= 0) this.pending.splice(pendingIndex, 1);
    this.pendingEventIds.delete(transient.eventId);
    this.markSeen(transient.eventId);
  }

  acknowledgeAllPendingMuted(): void {
    for (const pending of this.pending) {
      this.markSeen(pending.transient.eventId);
    }
    this.pending.length = 0;
    this.pendingEventIds.clear();
  }

  reset(): void {
    this.pending.length = 0;
    this.pendingEventIds.clear();
    this.seenEventIds.clear();
  }

  getDebugState(): Readonly<{ pending: number; seen: number }> {
    this.expirePending();
    return { pending: this.pending.length, seen: this.seenEventIds.size };
  }

  private expirePending(): void {
    const now = this.now();
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const pending = this.pending[index];
      if (pending.expiresAtMs > now) continue;
      this.pending.splice(index, 1);
      this.pendingEventIds.delete(pending.transient.eventId);
      this.markSeen(pending.transient.eventId);
    }
  }

  private markSeen(eventId: number): void {
    this.seenEventIds.add(eventId);
    while (this.seenEventIds.size > MAX_CAMPFIRE_AUDIO_EVENTS) {
      const oldest = this.seenEventIds.values().next().value;
      if (typeof oldest !== "number") break;
      this.seenEventIds.delete(oldest);
    }
  }
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: NoiseLayer | null = null;
  private jungle: NoiseLayer | null = null;
  private fire: NoiseLayer | null = null;
  private wind: DirectionalNoiseLayer | null = null;
  private enabled = true;
  private volume = 0.72;
  private campfireLoopGain: number | null = null;
  private campfireLowPassHertz = 720;
  private windTargets: DirectionalWindAudioTargets = { ...SILENT_WIND_AUDIO };
  private readonly campfireEvents = new CampfireAudioEventBuffer();

  async unlock(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      if (!this.context) this.createContext();
      if (this.context?.state === "suspended") await this.context.resume();
      const running = this.context?.state === "running";
      if (running) this.flushPendingCampfireTransients();
      return running;
    } catch {
      this.context = null;
      this.master = null;
      this.rain = null;
      this.jungle = null;
      this.fire = null;
      this.wind = null;
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.setTargetAtTime(enabled ? this.volume : 0, this.context?.currentTime ?? 0, 0.08);
    if (!enabled) this.campfireEvents.acknowledgeAllPendingMuted();
    else this.flushPendingCampfireTransients();
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, 0.08);
  }

  setEnvironment(rain: number, fireLit: boolean, sheltered: boolean): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    const rainLevel = Math.max(0, Math.min(1, rain));
    this.rain?.gain.gain.setTargetAtTime(rainLevel * (sheltered ? 0.13 : 0.29), now, 0.35);
    this.rain?.filter.frequency.setTargetAtTime(sheltered ? 520 : 1800, now, 0.3);
    this.fire?.gain.gain.setTargetAtTime(
      this.campfireLoopGain ?? (fireLit ? 0.085 : 0),
      now,
      0.25,
    );
    this.fire?.filter.frequency.setTargetAtTime(
      this.campfireLowPassHertz,
      now,
      0.25,
    );
    this.jungle?.gain.gain.setTargetAtTime(0.045 * (1 - rainLevel * 0.55), now, 0.45);
  }

  setWindEnvironment(
    soundscape: DirectionalWindSoundscape | null | undefined,
    playerYaw: number,
  ): void {
    this.windTargets = resolveDirectionalWindAudio(soundscape, playerYaw);
    if (!this.context || !this.wind) return;
    const now = this.context.currentTime;
    this.wind.gain.gain.setTargetAtTime(
      this.windTargets.gain,
      now,
      0.3,
    );
    this.wind.filter.frequency.setTargetAtTime(
      this.windTargets.lowPassHertz,
      now,
      0.3,
    );
    this.wind.panner?.pan.setTargetAtTime(
      this.windTargets.stereoPan,
      now,
      0.2,
    );
  }

  getWindDebugState(): Readonly<DirectionalWindAudioTargets> {
    return { ...this.windTargets };
  }

  applyCampfireFeedback(
    audio: CampfireFeedbackTargets["audio"],
  ): void {
    this.campfireLoopGain = finiteClamp(audio.loopGain, 0, 0.12);
    this.campfireLowPassHertz = finiteClamp(
      audio.lowPassHertz,
      800,
      8_000,
    );
    if (this.context && this.fire) {
      const now = this.context.currentTime;
      this.fire.gain.gain.setTargetAtTime(
        this.campfireLoopGain,
        now,
        0.2,
      );
      this.fire.filter.frequency.setTargetAtTime(
        this.campfireLowPassHertz,
        now,
        0.18,
      );
    }
  }

  presentCampfireTransient(transient: CampfireTransientDescriptor): void {
    if (!this.enabled || campfireTransientPeakGain(transient.audioGain) <= 0) {
      this.campfireEvents.acknowledgeMuted(transient);
      return;
    }
    this.campfireEvents.submit(
      transient,
      (candidate) => this.cueCampfireTransient(candidate),
    );
  }

  resetCampfireFeedback(): void {
    this.campfireLoopGain = 0;
    this.campfireLowPassHertz = 720;
    this.campfireEvents.reset();
    if (this.context && this.fire) {
      const now = this.context.currentTime;
      this.fire.gain.gain.setTargetAtTime(0, now, 0.03);
      this.fire.filter.frequency.setTargetAtTime(720, now, 0.03);
    }
  }

  getCampfireDebugState(): Readonly<{
    pending: number;
    seen: number;
    loopGain: number | null;
  }> {
    return {
      ...this.campfireEvents.getDebugState(),
      loopGain: this.campfireLoopGain,
    };
  }

  cue(kind: "pickup" | "craft" | "hurt" | "warning" | "success" | "step" | "water"): void {
    if (!this.context || !this.enabled || this.context.state !== "running") return;
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain).connect(this.master!);
    const now = ctx.currentTime;
    const settings = {
      pickup: [520, 740, 0.12, "sine"],
      craft: [180, 310, 0.2, "triangle"],
      hurt: [95, 48, 0.3, "sawtooth"],
      warning: [210, 165, 0.42, "square"],
      success: [390, 880, 0.65, "sine"],
      step: [70, 48, 0.06, "triangle"],
      water: [330, 220, 0.14, "sine"],
    } as const;
    const [from, to, duration, type] = settings[kind];
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    gain.gain.setValueAtTime(kind === "step" ? 0.025 : 0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  dispose(): void {
    for (const layer of [this.rain, this.jungle, this.fire, this.wind]) {
      try { layer?.source.stop(); } catch { /* already stopped */ }
    }
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.rain = null;
    this.jungle = null;
    this.fire = null;
    this.wind = null;
  }

  private createContext(): void {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.context.destination);
    this.rain = this.createNoise(1500, "bandpass");
    this.jungle = this.createNoise(4200, "lowpass");
    this.fire = this.createNoise(720, "lowpass");
    this.wind = this.createDirectionalNoise(950, "bandpass");
    this.rain.gain.gain.value = 0;
    this.jungle.gain.gain.value = 0.045;
    this.fire.gain.gain.value = 0;
    this.fire.filter.frequency.value = this.campfireLowPassHertz;
    this.wind.gain.gain.value = this.windTargets.gain;
    this.wind.filter.frequency.value = this.windTargets.lowPassHertz;
    if (this.wind.panner) {
      this.wind.panner.pan.value = this.windTargets.stereoPan;
    }
    if (this.campfireLoopGain !== null) {
      this.fire.gain.gain.value = this.campfireLoopGain;
    }
  }

  private cueCampfireTransient(
    transient: CampfireTransientDescriptor,
  ): boolean {
    const peak = campfireTransientPeakGain(transient.audioGain);
    if (peak <= 0) return true;
    if (!this.context || !this.enabled || this.context.state !== "running") {
      return false;
    }
    const ctx = this.context;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    oscillator.connect(filter).connect(gain).connect(this.master!);
    const now = ctx.currentTime;
    const settings = {
      "fuel-drop": [145, 82, 0.16, "triangle", 1_100],
      "fire-ignite": [180, 520, 0.34, "sine", 2_800],
      "fire-extinguish": [210, 58, 0.42, "sawtooth", 620],
    } as const;
    const [from, to, duration, type, cutoff] = settings[transient.audioCue];
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, to),
      now + duration,
    );
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, now);
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    return true;
  }

  private flushPendingCampfireTransients(): void {
    if (!this.enabled) return;
    this.campfireEvents.flush(
      (transient) => this.cueCampfireTransient(transient),
    );
  }

  private createNoise(frequency: number, type: BiquadFilterType): NoiseLayer {
    const context = this.context!;
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.82 + white * 0.18;
      data[i] = last;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    source.connect(filter).connect(gain).connect(this.master!);
    source.start();
    return { source, gain, filter };
  }

  private createDirectionalNoise(
    frequency: number,
    type: BiquadFilterType,
  ): DirectionalNoiseLayer {
    const context = this.context!;
    const buffer = context.createBuffer(
      1,
      context.sampleRate * 2,
      context.sampleRate,
    );
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.9 + white * 0.1;
      data[index] = last;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    source.connect(filter).connect(gain);

    let panner: StereoPannerNode | null = null;
    const stereoFactory = Reflect.get(context, "createStereoPanner");
    if (typeof stereoFactory === "function") {
      try {
        panner = stereoFactory.call(context) as StereoPannerNode;
      } catch {
        panner = null;
      }
    }
    if (panner) gain.connect(panner).connect(this.master!);
    else gain.connect(this.master!);
    source.start();
    return { source, gain, filter, panner };
  }
}

/** Pure gain mapping shared with tests; zero audibility creates no oscillator. */
export function campfireTransientPeakGain(audioGain: number): number {
  return finiteClamp(audioGain, 0, 1) * 0.12;
}

function finiteClamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
