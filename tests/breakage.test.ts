import test from "node:test";
import assert from "node:assert/strict";
import { breakageProfile, synthesizeBreakage } from "../src/audio/breakage.ts";
import { SmashyAudio } from "../src/audio/index.ts";

test("breakage density grows with the actual group and saturates acoustically at 30", () => {
  const small = breakageProfile(3),
    middle = breakageProfile(10),
    large = breakageProfile(30);
  assert(
    small.crackGrains < middle.crackGrains &&
      middle.crackGrains < large.crackGrains,
  );
  assert(
    small.durationSeconds < middle.durationSeconds &&
      middle.durationSeconds < large.durationSeconds,
  );
  assert(large.level / small.level <= 1.15 + Number.EPSILON);
  assert.deepEqual(breakageProfile(300), large);
  assert(Number.isFinite(breakageProfile(NaN).durationSeconds));
  assert(breakageProfile(30, "floor", true).durationSeconds <= 0.22);
});

test("original noise is deterministic, finite, bounded and independent of Math.random", () => {
  const old = Math.random;
  Math.random = () => {
    throw new Error("game/global randomness must not be consumed");
  };
  try {
    const baseline = synthesizeBreakage(10, "match", 44100, 17);
    assert.deepEqual(
      baseline.samples,
      synthesizeBreakage(10, "match", 44100, 17).samples,
    );
    assert.notDeepEqual(
      baseline.samples,
      synthesizeBreakage(10, "match", 44100, 18).samples,
    );
    for (const rate of [22050, 44100, 48000])
      for (let count = 1; count <= 30; count++) {
        for (const kind of ["match", "floor"] as const)
          for (const reduced of [false, true]) {
            const { samples } = synthesizeBreakage(
              count,
              kind,
              rate,
              count * 17,
              reduced,
            );
            assert.equal(samples[0], 0);
            assert.equal(Math.abs(samples.at(-1)!), 0);
            for (const sample of samples)
              assert(Number.isFinite(sample) && Math.abs(sample) < 0.32);
          }
      }
  } finally {
    Math.random = old;
  }
});

class Param {
  value = 0;
  cancellations: number[] = [];
  setValueAtTime(value: number, _at: number) {
    this.value = value;
  }
  setTargetAtTime(value: number, _at: number, _t: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime(_v: number, _at: number) {}
  cancelScheduledValues(at: number) {
    this.cancellations.push(at);
  }
}
class Gain {
  gain = new Param();
  disconnected = false;
  connect(_n: unknown) {}
  disconnect() {
    this.disconnected = true;
  }
}
class Source {
  buffer?: { duration: number };
  frequency = new Param();
  type = "sine";
  starts: number[] = [];
  stops: number[] = [];
  disconnected = false;
  onended: (() => void) | null = null;
  connect(_n: unknown) {}
  disconnect() {
    this.disconnected = true;
  }
  start(at: number) {
    this.starts.push(at);
  }
  stop(at: number) {
    this.stops.push(at);
  }
}
class Context {
  static latest: Context;
  currentTime = 0;
  sampleRate = 44100;
  state = "running";
  destination = {};
  sources: Source[] = [];
  buffers = 0;
  constructor() {
    Context.latest = this;
  }
  createGain() {
    return new Gain();
  }
  createBufferSource() {
    const source = new Source();
    this.sources.push(source);
    return source;
  }
  createOscillator() {
    return this.createBufferSource();
  }
  createBuffer(_c: number, n: number, rate: number) {
    this.buffers++;
    return {
      duration: n / rate,
      copyToChannel(_samples: Float32Array, _c: number) {},
    };
  }
  createDynamicsCompressor() {
    return {
      threshold: new Param(),
      knee: new Param(),
      ratio: new Param(),
      attack: new Param(),
      release: new Param(),
      connect(_n: unknown) {},
    };
  }
  async resume() {
    this.state = "running";
  }
  async suspend() {
    this.state = "suspended";
  }
  async close() {
    this.state = "closed";
  }
}

test("buffered debris obeys unlock, mute, bounded cache, interruption and no replay", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: { AudioContext: Context },
    configurable: true,
  });
  try {
    const audio = new SmashyAudio();
    audio.playBreakage(3); // locked: no allocation/playback
    await audio.unlock();
    const ctx = Context.latest;
    audio.playBreakage(3);
    assert.equal(ctx.sources[0].starts[0], 0.065);
    audio.playBreakage(10, "floor", { delay: 0.58 });
    assert.equal(ctx.sources[1].starts[0], 0.58);
    audio.playBreakage(30, "floor", { reduced: true, delay: 0.58 });
    assert.equal(ctx.sources[2].starts[0], 0);
    for (let i = 1; i <= 60; i++)
      audio.playBreakage(i, i % 2 ? "floor" : "match");
    const internal = audio as unknown as {
      voices: unknown[];
      breakageCache: Map<string, unknown>;
    };
    assert(internal.voices.length <= 8);
    assert(internal.breakageCache.size <= 32);
    ctx.currentTime = 0.02;
    audio.suspend();
    for (const source of ctx.sources) {
      assert.equal(source.stops.at(-1), 0.02);
      assert(source.disconnected);
    }
    const previousSources = ctx.sources.length;
    await audio.unlock();
    assert.equal(
      ctx.sources.length,
      previousSources,
      "resume cannot replay a pending landing",
    );
    audio.playBreakage(4);
    audio.setMuted(true);
    assert.equal(ctx.sources.at(-1)?.stops.at(-1), 0.02);
    const mutedCount = ctx.sources.length;
    audio.playBreakage(8);
    assert.equal(ctx.sources.length, mutedCount);
    audio.setMuted(false);
    audio.playBreakage(0);
    audio.playBreakage(NaN);
    assert.equal(ctx.sources.length, mutedCount);
    audio.destroy();
    assert.equal(internal.breakageCache.size, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
