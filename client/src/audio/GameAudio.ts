type AudioContextConstructor = typeof AudioContext;

/**
 * Small procedural sound bank. It avoids network-loaded audio assets, starts
 * instantly after the first interaction, and gives each repeated sound a tiny
 * variation so movement does not feel mechanical.
 */
class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private muted = localStorage.getItem("tetherbound-muted") === "true";
  private stepSide = 0;

  get isMuted(): boolean { return this.muted; }

  setMuted(muted: boolean): void {
    this.muted = muted;
    localStorage.setItem("tetherbound-muted", String(muted));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.7, this.context.currentTime, 0.015);
    }
  }

  toggleMuted(): boolean {
    this.setMuted(!this.muted);
    if (!this.muted) void this.unlock();
    return this.muted;
  }

  async unlock(): Promise<void> {
    const context = this.ensureContext();
    if (context?.state === "suspended") await context.resume();
  }

  jump(): void {
    const now = this.now();
    if (now === undefined) return;
    this.tone("sine", 190, 430, now, 0.16, 0.22);
    this.tone("triangle", 105, 210, now + 0.015, 0.11, 0.12);
  }

  footstep(surface: "soft" | "hard" = "soft"): void {
    const now = this.now();
    if (now === undefined) return;
    this.stepSide = 1 - this.stepSide;
    const shift = this.stepSide ? 8 : -5;
    this.noise(now, 0.055, surface === "hard" ? 0.11 : 0.07, surface === "hard" ? 950 : 520);
    this.tone("sine", 92 + shift, 55, now, 0.065, surface === "hard" ? 0.12 : 0.08);
  }

  skate(speed = 0.5): void {
    const now = this.now();
    if (now === undefined) return;
    const amount = Math.min(1, Math.max(0.2, speed));
    // Overlapping, filtered scrapes create a continuous ice glide instead of
    // a sequence of discrete foot impacts. Pitch and brightness follow speed.
    this.iceNoise(now, 0.3, 0.035 + amount * 0.045, 1050 + amount * 1150);
    this.tone("triangle", 480 + amount * 170, 540 + amount * 260, now, 0.22, 0.008 + amount * 0.012);
  }

  land(strength = 0.5): void {
    const now = this.now();
    if (now === undefined) return;
    const amount = Math.min(1, Math.max(0.25, strength));
    this.noise(now, 0.09 + amount * 0.07, 0.08 + amount * 0.12, 420);
    this.tone("sine", 105, 48, now, 0.12, 0.1 + amount * 0.12);
  }

  fall(): void {
    const now = this.now();
    if (now === undefined) return;
    this.noise(now, 0.24, 0.045, 1250, 260);
  }

  death(): void {
    const now = this.now();
    if (now === undefined) return;
    this.tone("sawtooth", 260, 72, now, 0.34, 0.13);
    this.tone("square", 130, 48, now + 0.06, 0.27, 0.06);
    this.noise(now + 0.04, 0.18, 0.12, 650);
  }

  respawn(): void {
    const now = this.now();
    if (now === undefined) return;
    [220, 330, 440].forEach((frequency, index) =>
      this.tone("sine", frequency, frequency * 1.18, now + index * 0.07, 0.16, 0.09));
  }

  touch(): void {
    const now = this.now();
    if (now === undefined) return;
    this.noise(now, 0.1, 0.12, 1100);
    this.tone("square", 150, 95, now, 0.12, 0.1);
  }

  collectKey(): void {
    const now = this.now();
    if (now === undefined) return;
    [659, 880, 1175].forEach((frequency, index) =>
      this.tone("sine", frequency, frequency, now + index * 0.065, 0.18, 0.09));
  }

  doorOpen(): void {
    const now = this.now();
    if (now === undefined) return;
    this.tone("triangle", 130, 260, now, 0.42, 0.12);
    this.tone("sine", 196, 392, now + 0.08, 0.38, 0.1);
  }

  exit(): void {
    const now = this.now();
    if (now === undefined) return;
    [392, 523, 659].forEach((frequency, index) =>
      this.tone("triangle", frequency, frequency * 1.08, now + index * 0.09, 0.24, 0.1));
  }

  victory(): void {
    const now = this.now();
    if (now === undefined) return;
    [262, 330, 392, 523].forEach((frequency, index) =>
      this.tone("triangle", frequency, frequency, now + index * 0.11, 0.34, 0.12));
    this.tone("sine", 784, 784, now + 0.46, 0.5, 0.12);
  }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    const Context = (window.AudioContext ?? (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext);
    if (!Context) return undefined;
    this.context = new Context();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.context.destination);
    return this.context;
  }

  private now(): number | undefined {
    const context = this.ensureContext();
    if (!context || this.muted || context.state !== "running") return undefined;
    return context.currentTime;
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    start: number,
    duration: number,
    volume: number
  ): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(start: number, duration: number, volume: number, from: number, to = from): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(start);
  }

  private iceNoise(start: number, duration: number, volume: number, frequency: number): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index++) {
      const envelope = Math.sin(Math.PI * index / data.length);
      data[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(frequency * 0.88, start);
    filter.frequency.linearRampToValueAtTime(frequency * 1.12, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.045);
    gain.gain.setValueAtTime(volume, start + duration - 0.07);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(start);
  }
}

export const gameAudio = new GameAudio();
