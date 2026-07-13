type NoiseLayer = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
};

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private rain: NoiseLayer | null = null;
  private jungle: NoiseLayer | null = null;
  private fire: NoiseLayer | null = null;
  private enabled = true;
  private volume = 0.72;

  async unlock(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      if (!this.context) this.createContext();
      if (this.context?.state === "suspended") await this.context.resume();
      return this.context?.state === "running";
    } catch {
      this.context = null;
      this.master = null;
      this.rain = null;
      this.jungle = null;
      this.fire = null;
      return false;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master) this.master.gain.setTargetAtTime(enabled ? this.volume : 0, this.context?.currentTime ?? 0, 0.08);
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
    this.fire?.gain.gain.setTargetAtTime(fireLit ? 0.085 : 0, now, 0.25);
    this.jungle?.gain.gain.setTargetAtTime(0.045 * (1 - rainLevel * 0.55), now, 0.45);
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
    for (const layer of [this.rain, this.jungle, this.fire]) {
      try { layer?.source.stop(); } catch { /* already stopped */ }
    }
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.rain = null;
    this.jungle = null;
    this.fire = null;
  }

  private createContext(): void {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    this.master.connect(this.context.destination);
    this.rain = this.createNoise(1500, "bandpass");
    this.jungle = this.createNoise(4200, "lowpass");
    this.fire = this.createNoise(720, "lowpass");
    this.rain.gain.gain.value = 0;
    this.jungle.gain.gain.value = 0.045;
    this.fire.gain.gain.value = 0;
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
}
