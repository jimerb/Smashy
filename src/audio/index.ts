import {
  synthesizeBreakage,
  type BreakageKind,
  type BreakageOptions,
} from "./breakage";
export { breakageProfile, synthesizeBreakage } from "./breakage";

export type SoundCue =
  | "fire"
  | "bounce"
  | "attach"
  | "match"
  | "drop"
  | "danger"
  | "descend"
  | "undo"
  | "clear"
  | "loss"
  | "ui";

interface SoundVoice {
  oscillator: OscillatorNode | AudioBufferSourceNode;
  gain: GainNode;
  end: number;
  debris?: boolean;
}

/** Original, quiet procedural material cues. Sound never schedules gameplay. */
export class SmashyAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private voices: SoundVoice[] = [];
  // Include fading stolen voices until their source has actually ended.
  private activeSources = new Set<SoundVoice>();
  private muted = false;
  private volume = 0.35;
  private failed = false;
  private blocked = false;
  private lastPlay = new Map<SoundCue, number>();
  private breakageCache = new Map<string, AudioBuffer>();
  private breakageSequence = 0;

  get available() {
    return !this.failed;
  }
  get state() {
    return this.failed
      ? "unavailable"
      : this.muted
        ? "muted"
        : this.blocked
          ? "blocked"
          : (this.context?.state ?? "locked");
  }
  async unlock(): Promise<boolean> {
    try {
      if (!this.context) {
        const AudioContextConstructor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioContextConstructor) {
          this.failed = true;
          return false;
        }
        this.context = new AudioContextConstructor();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.compressor = this.context.createDynamicsCompressor();
        this.compressor.threshold.value = -20;
        this.compressor.knee.value = 16;
        this.compressor.ratio.value = 5;
        this.compressor.attack.value = 0.003;
        this.compressor.release.value = 0.14;
        this.master.connect(this.compressor);
        this.compressor.connect(this.context.destination);
      }
      if (this.context.state !== "running") await this.context.resume();
      this.blocked = false;
      return this.context.state === "running";
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "AbortError")
        this.blocked = true;
      else this.failed = true;
      return false;
    }
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stopVoices();
    this.applyVolume();
  }
  setVolume(volume: number) {
    this.volume = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : 0.35;
    this.applyVolume();
  }
  private applyVolume() {
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.context.currentTime,
        0.012,
      );
  }
  private tone(
    frequency: number,
    endFrequency: number,
    duration: number,
    level: number,
    offset = 0,
    type: OscillatorType = "sine",
  ) {
    const ctx = this.context,
      master = this.master;
    if (!ctx || !master) return;
    const now = ctx.currentTime,
      start = now + offset;
    this.makeRoom(now);
    const oscillator = ctx.createOscillator(),
      gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, endFrequency),
      start + duration,
    );
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0002, level),
      start + 0.006,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
    const voice = { oscillator, gain, end: start + duration + 0.015 };
    this.voices.push(voice);
    this.activeSources.add(voice);
    oscillator.onended = () => {
      this.activeSources.delete(voice);
      oscillator.disconnect();
      gain.disconnect();
    };
  }
  private makeRoom(now: number) {
    this.voices = this.voices.filter((voice) => voice.end > now);
    while (this.voices.length >= 8) {
      // Steal cosmetic debris before clear/loss/fire tones. Keep stolen sources
      // in activeSources until onended, so pause still cancels every future start.
      const debris = this.voices.findIndex((voice) => voice.debris);
      const [old] = this.voices.splice(debris < 0 ? 0 : debris, 1);
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setTargetAtTime(0.0001, now, 0.008);
      try {
        old.oscillator.stop(now + 0.025);
      } catch {
        /* already stopped */
      }
    }
  }
  /** Count affects material density/tail, never score or the shot queue. */
  playBreakage(
    count: number,
    kind: BreakageKind = "match",
    options: BreakageOptions = {},
  ) {
    const ctx = this.context,
      master = this.master;
    if (
      !(count > 0) ||
      this.muted ||
      this.failed ||
      !ctx ||
      !master ||
      ctx.state !== "running"
    )
      return;
    const reduced = !!options.reduced;
    const boundedCount = Math.max(1, Math.min(30, Math.round(count)));
    const variant = ((options.variant ?? this.breakageSequence++) >>> 0) % 4;
    const key = `${boundedCount}:${kind}:${reduced}:${variant}`;
    let buffer = this.breakageCache.get(key);
    if (!buffer) {
      const { samples } = synthesizeBreakage(
        boundedCount,
        kind,
        ctx.sampleRate,
        0x534d4153 ^ (variant * 0x9e3779b9),
        reduced,
      );
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.copyToChannel(samples, 0);
      if (this.breakageCache.size >= 32)
        this.breakageCache.delete(this.breakageCache.keys().next().value!);
      this.breakageCache.set(key, buffer);
    }
    const now = ctx.currentTime;
    const delay = reduced
      ? 0
      : Math.max(
          0,
          Math.min(
            0.7,
            Number.isFinite(options.delay)
              ? options.delay!
              : kind === "match"
                ? 0.065
                : 0,
          ),
        );
    const start = now + delay;
    this.makeRoom(now);
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(master);
    const voice: SoundVoice = {
      oscillator: source,
      gain,
      end: start + buffer.duration,
      debris: true,
    };
    this.voices.push(voice);
    this.activeSources.add(voice);
    source.onended = () => {
      this.activeSources.delete(voice);
      source.disconnect();
      gain.disconnect();
    };
    source.start(start);
    source.stop(start + buffer.duration + 0.005);
  }
  play(cue: SoundCue) {
    if (
      this.muted ||
      this.failed ||
      !this.context ||
      this.context.state !== "running"
    )
      return;
    const now = this.context.currentTime;
    if (
      now - (this.lastPlay.get(cue) ?? -100) <
      (cue === "bounce" ? 0.045 : 0.025)
    )
      return;
    this.lastPlay.set(cue, now);
    switch (cue) {
      case "fire":
        this.tone(135, 62, 0.14, 0.18, 0, "triangle");
        this.tone(270, 95, 0.09, 0.055, 0.008);
        break;
      case "bounce":
        this.tone(185, 110, 0.07, 0.085);
        break;
      case "attach":
        this.tone(220, 135, 0.08, 0.08, 0, "triangle");
        break;
      case "match":
        this.tone(320, 170, 0.19, 0.12, 0, "triangle");
        this.tone(460, 250, 0.12, 0.045, 0.025);
        break;
      case "drop":
        this.tone(240, 65, 0.38, 0.12, 0, "triangle");
        this.tone(170, 48, 0.29, 0.07, 0.05);
        break;
      case "danger":
        this.tone(125, 90, 0.2, 0.12);
        break;
      case "descend":
        this.tone(95, 55, 0.28, 0.17, 0, "triangle");
        this.tone(160, 80, 0.16, 0.04, 0.04);
        break;
      case "undo":
        this.tone(120, 240, 0.16, 0.07);
        break;
      case "clear":
        this.tone(261.63, 261.63, 0.37, 0.09);
        this.tone(329.63, 329.63, 0.4, 0.085, 0.16);
        this.tone(392, 392, 0.55, 0.08, 0.32);
        break;
      case "loss":
        this.tone(164.81, 130.81, 0.28, 0.08);
        this.tone(110, 82.41, 0.4, 0.07, 0.18);
        break;
      case "ui":
        this.tone(190, 130, 0.045, 0.045);
        break;
    }
  }
  private stopVoices() {
    const now = this.context?.currentTime ?? 0;
    for (const voice of this.activeSources) {
      // Cancel future notes too: suspending context time alone would replay
      // the interrupted phrase when the player explicitly resumes later.
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(0, now);
      try {
        voice.oscillator.stop(now);
      } catch {
        /* The source may have ended just before interruption. */
      }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    this.activeSources.clear();
    this.voices = [];
    this.lastPlay.clear();
  }
  /** Cancel an old presentation on undo/restart without changing unlock state. */
  cancelPresentation() {
    this.stopVoices();
  }
  suspend() {
    this.stopVoices();
    if (this.context?.state === "running")
      void this.context.suspend().catch(() => {});
  }
  destroy() {
    this.stopVoices();
    if (this.context) void this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.voices = [];
    this.breakageCache.clear();
  }
}
