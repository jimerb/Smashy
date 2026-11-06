import test from "node:test";
import assert from "node:assert/strict";
import {
  SmashyMusic,
  MUSIC_GAP_MS,
  MUSIC_DEFAULT_VOLUME,
} from "../src/audio/music";

const tracks = [1, 2, 3, 4].map((n) => ({
  title: `Track ${n}`,
  url: `https://game.test/${n}.m4a`,
}));
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
function fixture() {
  let now = 0,
    id = 0,
    creations = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  class Media extends EventTarget {
    paused = true;
    currentTime = 0;
    preload = "";
    loop = false;
    hidden = false;
    dataset: Record<string, string> = {};
    src = "";
    plays: string[] = [];
    failure: Error | null = null;
    deferred: Promise<void> | null = null;
    setAttribute() {}
    getAttribute(name: string) {
      return name === "src" ? this.src : null;
    }
    pause() {
      this.paused = true;
    }
    play() {
      this.plays.push(this.src);
      if (this.failure) {
        const e = this.failure;
        this.failure = null;
        return Promise.reject(e);
      }
      this.paused = false;
      return this.deferred ?? Promise.resolve();
    }
  }
  const media = new Media();
  const gain = {
    value: 0,
    setTargetAtTime(value: number) {
      this.value = value;
    },
  };
  const context = {
    state: "suspended",
    currentTime: 0,
    destination: {},
    resume() {
      this.state = "running";
      return Promise.resolve();
    },
    createGain() {
      return { gain, connect() {} };
    },
    createMediaElementSource() {
      return { connect() {} };
    },
  };
  const player = new SmashyMusic(tracks, {
    createAudio: () => {
      creations++;
      return media as unknown as HTMLAudioElement;
    },
    createContext: () => context as unknown as AudioContext,
    now: () => now,
    schedule: (callback, delay) => {
      const n = ++id;
      timers.set(n, { at: now + delay, callback });
      return n as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (timer) => {
      timers.delete(timer as unknown as number);
    },
  });
  function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  }
  return { player, media, context, gain, advance, creations: () => creations };
}
test("music is lazy, quiet by default, ordered 1-4 and loops with exactly five-second gaps", async () => {
  const f = fixture();
  f.player.setPreferences(false, MUSIC_DEFAULT_VOLUME);
  assert.equal(f.creations(), 0);
  f.player.startFromGesture();
  await flush();
  assert.equal(f.gain.value, 0.08);
  assert.equal(f.player.state, "playing");
  for (let i = 0; i < 4; i++) {
    f.media.dispatchEvent(new Event("ended"));
    assert.equal(f.player.state, "gap");
    f.advance(MUSIC_GAP_MS - 1);
    assert.equal(f.media.plays.length, i + 1);
    f.advance(1);
    await flush();
    assert.equal(f.media.plays[i + 1], tracks[(i + 1) % 4].url);
  }
  assert.equal(f.creations(), 1);
});
test("music mute and volume preserve position and do not need another player", async () => {
  const f = fixture();
  f.player.startFromGesture();
  await flush();
  f.media.currentTime = 19;
  f.player.setPreferences(true, 0.25);
  assert(f.media.paused);
  assert.equal(f.gain.value, 0);
  f.player.startFromGesture();
  assert.equal(f.media.plays.length, 1);
  f.player.setPreferences(false, 0.25);
  await flush();
  assert.equal(f.media.currentTime, 19);
  assert.equal(f.gain.value, 0.25);
  assert.equal(f.media.plays.length, 2);
  f.player.setPreferences(false, 0);
  assert(f.media.paused);
  f.player.setPreferences(false, NaN);
  await flush();
  assert.equal(f.gain.value, 0.08);
  assert.equal(f.creations(), 1);
});
test("mute freezes the inter-song gap rather than skipping or restarting it", async () => {
  const f = fixture();
  f.player.startFromGesture();
  await flush();
  f.media.dispatchEvent(new Event("ended"));
  f.advance(2000);
  f.player.setPreferences(true, 0.08);
  f.advance(60000);
  assert.equal(f.media.plays.length, 1);
  f.player.setPreferences(false, 0.08);
  f.advance(2999);
  assert.equal(f.media.plays.length, 1);
  f.advance(1);
  await flush();
  assert.equal(f.media.plays[1], tracks[1].url);
});
test("background visibility freezes audio and the remaining gap across preferences", async () => {
  const f = fixture();
  f.player.startFromGesture();
  await flush();
  f.media.dispatchEvent(new Event("ended"));
  f.advance(1000);
  f.player.setHidden(true);
  f.player.setPreferences(false, 0.12);
  f.advance(30000);
  assert.equal(f.media.plays.length, 1);
  f.player.setHidden(false);
  f.advance(3999);
  assert.equal(f.media.plays.length, 1);
  f.advance(1);
  await flush();
  assert.equal(f.media.plays.length, 2);
  assert.equal(f.gain.value, 0.12);
});
test("game pause preserves the song and cannot be bypassed by taps, settings or tab return", async () => {
  const f = fixture();
  f.player.startFromGesture();
  await flush();
  f.media.currentTime = 19;
  f.player.setPaused(true);
  assert(f.media.paused);
  assert.equal(f.player.state, "paused");
  assert.equal(f.gain.value, 0);
  f.player.startFromGesture();
  f.player.setPreferences(false, 0.19);
  f.player.setHidden(true);
  f.player.setHidden(false);
  await flush();
  assert(f.media.paused);
  assert.equal(f.media.plays.length, 1);
  f.player.setPaused(false);
  await flush();
  assert.equal(f.player.state, "playing");
  assert.equal(f.media.currentTime, 19);
  assert.equal(f.gain.value, 0.19);
  f.player.setPaused(true);
  f.player.setPreferences(true, 0.19);
  f.player.setPaused(false);
  assert(f.media.paused, "Resume respects a stored mute");
});
test("game pause freezes the remaining song gap independently of hidden state", async () => {
  const f = fixture();
  f.player.startFromGesture();
  await flush();
  f.media.dispatchEvent(new Event("ended"));
  f.advance(2000);
  f.player.setPaused(true);
  f.player.setHidden(true);
  f.advance(60000);
  f.player.setHidden(false);
  f.player.startFromGesture();
  f.player.setPreferences(false, 0.08);
  f.advance(60000);
  assert.equal(f.media.plays.length, 1);
  f.player.setPaused(false);
  f.advance(2999);
  assert.equal(f.media.plays.length, 1);
  f.advance(1);
  await flush();
  assert.equal(f.media.plays[1], tracks[1].url);
});
test("pausing cancels a pending music startup before its promise resolves", async () => {
  const f = fixture();
  let finish!: () => void;
  f.media.deferred = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.player.startFromGesture();
  f.player.setPaused(true);
  finish();
  await flush();
  assert(f.media.paused);
  assert.equal(f.player.state, "paused");
  f.media.deferred = null;
  f.player.setPaused(false);
  await flush();
  assert.equal(f.player.state, "playing");
});
test("autoplay rejection waits for a new gesture and rapid mute ignores old play promises", async () => {
  const f = fixture();
  f.media.failure = Object.assign(new Error("gesture required"), {
    name: "NotAllowedError",
  });
  f.player.startFromGesture();
  await flush();
  assert.equal(f.player.state, "blocked");
  f.player.startFromGesture();
  await flush();
  assert.equal(f.player.state, "playing");
  const g = fixture();
  let finish!: () => void;
  g.media.deferred = new Promise<void>((r) => (finish = r));
  g.player.startFromGesture();
  g.player.setPreferences(true, 0.08);
  finish();
  await flush();
  assert(g.media.paused);
  assert.equal(g.player.state, "muted");
});

test("a completed tap can recover a pending pointer-down audio resume without toggling mute", async () => {
  const f = fixture();
  let finish!: () => void;
  f.media.deferred = new Promise<void>((resolve) => {
    finish = resolve;
  });
  f.player.startFromGesture();
  assert.equal(f.player.state, "loading");
  f.media.paused = true;
  f.media.deferred = null;
  f.player.startFromGesture();
  await flush();
  assert.equal(f.player.state, "playing");
  assert.equal(f.media.plays.length, 2);
  assert.equal(f.creations(), 1);
  assert.equal(f.gain.value, MUSIC_DEFAULT_VOLUME);
  finish();
  await flush();
  assert.equal(
    f.media.paused,
    false,
    "A stale first promise cannot stop the completed-tap retry",
  );
});
test("a completed tap retries a suspended context even while media play is pending", async () => {
  const f = fixture();
  let rejectFirst!: (error: Error) => void;
  f.context.resume = () =>
    new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
  f.player.startFromGesture();
  assert.equal(f.media.paused, false);
  assert.equal(f.context.state, "suspended");
  f.context.resume = () => {
    f.context.state = "running";
    return Promise.resolve();
  };
  f.player.startFromGesture();
  await flush();
  assert.equal(f.player.state, "playing");
  rejectFirst(
    Object.assign(new Error("old gesture rejected"), {
      name: "NotAllowedError",
    }),
  );
  await flush();
  assert.equal(f.player.state, "playing");
  assert.equal(f.creations(), 1);
});
test("missing tracks fail quietly after one bounded cycle, with no retry storm", async () => {
  const f = fixture();
  f.player.startFromGesture();
  await flush();
  for (let i = 0; i < 4; i++) {
    f.media.dispatchEvent(new Event("error"));
    if (i < 3) {
      f.advance(5000);
      await flush();
    }
  }
  assert.equal(f.player.state, "unavailable");
  assert.equal(f.media.plays.length, 4);
  f.advance(100000);
  f.player.startFromGesture();
  assert.equal(f.media.plays.length, 4);
});
test("an unavailable audio graph never falls back to uncontrolled loud media", () => {
  let play = 0;
  const player = new SmashyMusic(tracks, {
    createAudio: () =>
      ({
        preload: "",
        dataset: {},
        setAttribute() {},
        addEventListener() {},
        pause() {},
        play() {
          play++;
        },
      }) as unknown as HTMLAudioElement,
    createContext: () => {
      throw Error("no mixing");
    },
  });
  player.startFromGesture();
  assert.equal(player.state, "unavailable");
  assert.equal(play, 0);
});
