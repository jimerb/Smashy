export interface MusicTrack {
  title: string;
  url: string;
}
export const MUSIC_DEFAULT_VOLUME = 0.08;
export const MUSIC_GAP_MS = 5000;
type Timer = ReturnType<typeof setTimeout>;
interface MusicOptions {
  createAudio?: () => HTMLAudioElement;
  createContext?: () => AudioContext;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
  onChange?: () => void;
}

/** One streaming player and one gain bus, entirely independent of gameplay/SFX. */
export class SmashyMusic {
  private media: HTMLAudioElement | null = null;
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private index = 0;
  private wanted = false;
  private muted = false;
  private volume = MUSIC_DEFAULT_VOLUME;
  private hidden = false;
  private pending = false;
  private epoch = 0;
  private gap = false;
  private remaining = 0;
  private deadline = 0;
  private timer: Timer | null = null;
  private unavailable = false;
  private blocked = false;
  private failed = new Set<number>();
  private now: () => number;
  private schedule: (callback: () => void, delay: number) => Timer;
  private cancel: (timer: Timer) => void;

  constructor(
    private tracks: readonly MusicTrack[],
    private options: MusicOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.schedule =
      options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer));
  }
  get state() {
    if (this.unavailable) return "unavailable";
    if (this.muted || this.volume === 0) return "muted";
    if (this.hidden) return "paused";
    if (!this.wanted) return "locked";
    if (this.blocked) return "blocked";
    if (this.gap) return "gap";
    if (this.pending) return "loading";
    return this.media && !this.media.paused ? "playing" : "paused";
  }
  get track() {
    return this.tracks[this.index];
  }
  private active() {
    return (
      this.wanted &&
      !this.hidden &&
      !this.muted &&
      this.volume > 0 &&
      !this.unavailable
    );
  }
  private changed() {
    this.options.onChange?.();
  }
  private applyGain() {
    if (this.context && this.gain)
      this.gain.gain.setTargetAtTime(
        this.active() ? this.volume : 0,
        this.context.currentTime,
        0.02,
      );
  }
  setPreferences(muted: boolean, volume: number) {
    this.muted = muted;
    this.volume = Number.isFinite(volume)
      ? Math.max(0, Math.min(1, volume))
      : MUSIC_DEFAULT_VOLUME;
    this.applyGain();
    if (!this.active()) this.hold();
    else this.reconcile();
    this.changed();
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    if (hidden) this.hold();
    else this.reconcile();
    this.changed();
  }
  /** Call directly from a trusted tap/click/key; don't await gameplay audio first. */
  startFromGesture() {
    this.wanted = true;
    this.blocked = false;
    this.reconcile();
  }
  private initialize() {
    if (this.media || this.unavailable) return;
    try {
      if (!this.tracks.length) throw new Error("No music tracks");
      const media = (this.media =
        this.options.createAudio?.() ?? document.createElement("audio"));
      media.preload = "none";
      media.loop = false;
      media.hidden = true;
      media.dataset.smashyMusic = "true";
      media.setAttribute("aria-hidden", "true");
      media.addEventListener("ended", () => this.advance(false));
      media.addEventListener("error", () => this.advance(true));
      if (!this.options.createAudio) document.body.append(media);
      const Constructor =
        typeof window === "undefined"
          ? undefined
          : window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
      this.context = this.options.createContext
        ? this.options.createContext()
        : Constructor
          ? new Constructor()
          : null;
      if (!this.context) throw new Error("Music mixing unavailable");
      const source = this.context.createMediaElementSource(media);
      this.gain = this.context.createGain();
      this.gain.gain.value = this.volume;
      source.connect(this.gain);
      this.gain.connect(this.context.destination);
    } catch {
      this.unavailable = true;
      this.media?.pause();
      this.changed();
    }
  }
  private hold() {
    this.epoch++;
    this.pending = false;
    this.media?.pause();
    if (this.timer !== null) {
      this.remaining = Math.max(0, this.deadline - this.now());
      this.cancel(this.timer);
      this.timer = null;
    }
    this.applyGain();
  }
  private advance(error: boolean) {
    if (this.gap || this.unavailable) return;
    this.epoch++;
    this.pending = false;
    if (error) {
      this.failed.add(this.index);
      if (this.failed.size >= this.tracks.length) {
        this.unavailable = true;
        this.hold();
        this.changed();
        return;
      }
    } else this.failed.clear();
    this.media?.pause();
    this.index = (this.index + 1) % this.tracks.length;
    this.gap = true;
    this.remaining = MUSIC_GAP_MS;
    this.reconcile();
    this.changed();
  }
  private reconcile() {
    if (!this.active()) return;
    if (this.gap) {
      if (this.timer === null) {
        this.deadline = this.now() + this.remaining;
        this.timer = this.schedule(() => {
          this.timer = null;
          this.remaining = 0;
          this.gap = false;
          this.reconcile();
        }, this.remaining);
      }
      return;
    }
    this.initialize();
    const media = this.media,
      context = this.context;
    if (this.unavailable || !media || !context || this.pending) return;
    this.applyGain();
    if (!media.paused && context.state === "running") return;
    if (media.getAttribute("src") !== this.track.url) {
      media.src = this.track.url;
      media.dataset.trackIndex = String(this.index);
      media.dataset.trackTitle = this.track.title;
    }
    const token = ++this.epoch;
    this.pending = true;
    this.blocked = false;
    // Both operations start synchronously in the gesture's activation window.
    let resume: Promise<void>, play: Promise<void>;
    try {
      resume =
        context.state === "running" ? Promise.resolve() : context.resume();
      play = media.play();
    } catch (error) {
      this.pending = false;
      this.playFailed(error, token);
      return;
    }
    Promise.all([resume, play])
      .then(() => {
        if (token !== this.epoch) {
          if (!this.active()) media.pause();
          return;
        }
        this.pending = false;
        if (!this.active()) media.pause();
        this.changed();
      })
      .catch((error) => this.playFailed(error, token));
    this.changed();
  }
  private playFailed(error: unknown, token: number) {
    if (token !== this.epoch) return;
    this.pending = false;
    this.media?.pause();
    const name = (error as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "AbortError")
      this.blocked = true;
    else if (name === "NotSupportedError") this.advance(true);
    else this.unavailable = true;
    this.changed();
  }
}
