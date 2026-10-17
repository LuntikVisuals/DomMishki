export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private music: GainNode | null = null;
  private drone: OscillatorNode[] = [];
  private heart: OscillatorNode | null = null;
  private heartGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      this.sfx = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.music.connect(this.master);
      this.master.connect(this.ctx.destination);
      const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.4, this.ctx.sampleRate);
      const data = n.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = n;
      this.startDrone();
      this.heart = this.ctx.createOscillator();
      this.heart.type = "sine";
      this.heart.frequency.value = 58;
      this.heartGain = this.ctx.createGain();
      this.heartGain.gain.value = 0;
      this.heart.connect(this.heartGain);
      this.heartGain.connect(this.music);
      this.heart.start();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(v: boolean) {
    this.muted = v;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(v ? 0 : 0.85, this.ctx.currentTime, 0.03);
    }
  }

  private startDrone() {
    if (!this.ctx || !this.music) return;
    for (const f of [55, 82.5, 110]) {
      const o = this.ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.value = f === 55 ? 0.045 : 0.02;
      o.connect(g);
      g.connect(this.music);
      o.start();
      this.drone.push(o);
    }
  }

  heartbeat(closeness: number) {
    if (!this.heartGain || !this.ctx || !this.heart) return;
    const k = Math.max(0, Math.min(1, closeness));
    this.heartGain.gain.setTargetAtTime(k * 0.08, this.ctx.currentTime, 0.05);
    const bpm = 60 + k * 90;
    const pulse = 0.5 + 0.5 * Math.sin(this.ctx.currentTime * (bpm / 60) * Math.PI * 2);
    this.heart.frequency.setTargetAtTime(50 + pulse * 30, this.ctx.currentTime, 0.05);
  }

  step(kind: "walk" | "run" | "crouch") {
    if (!this.ctx || !this.sfx || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = kind === "run" ? 420 : kind === "crouch" ? 180 : 280;
    const g = this.ctx.createGain();
    const vol = kind === "run" ? 0.22 : kind === "crouch" ? 0.04 : 0.1;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.12);
    src.playbackRate.value = 0.85 + Math.random() * 0.3;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    src.start();
    src.stop(this.ctx.currentTime + 0.14);
  }

  creak() {
    this.tone(140, 0.18, "sawtooth", 0.07, 0.35);
  }

  pickup() {
    this.tone(520, 0.08, "sine", 0.08, 0.12);
    this.tone(780, 0.06, "sine", 0.1, 0.1);
  }

  bang() {
    this.noise(0.28, 900, 0.35);
    this.tone(90, 0.2, "square", 0.08, 0.25);
  }

  wrong() {
    this.tone(180, 0.16, "square", 0.06, 0.2);
  }

  scream() {
    this.noise(0.55, 1800, 0.5);
    this.tone(90, 0.45, "sawtooth", 0.12, 0.5);
    this.tone(140, 0.3, "square", 0.08, 0.35);
  }

  escape() {
    this.tone(392, 0.12, "sine", 0.07, 0.2);
    this.tone(523, 0.14, "sine", 0.14, 0.25);
    this.tone(659, 0.18, "sine", 0.2, 0.4);
  }

  tick() {
    this.tone(880, 0.02, "square", 0.015, 0.04);
  }

  private tone(
    freq: number,
    peak: number,
    type: OscillatorType,
    at: number,
    dur: number,
  ) {
    if (!this.ctx || !this.sfx) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime + at;
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfx);
    o.start();
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, peak: number) {
    if (!this.ctx || !this.sfx || !this.noiseBuf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    src.start();
    src.stop(this.ctx.currentTime + dur);
  }

  dispose() {
    this.heart?.stop();
    for (const o of this.drone) o.stop();
    void this.ctx?.close();
  }
}
