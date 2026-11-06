import test from "node:test";
import assert from "node:assert/strict";
import {
  selectDropReward,
  rewardPlaybackGain,
} from "../src/audio/drop-rewards";
import { SmashyAudio } from "../src/audio";

test("reward thresholds count detached pieces and ten-plus has one higher-priority cheer", () => {
  for (const count of [0, 3, 6, -1, NaN, Infinity, 7.5])
    assert.equal(selectDropReward(count), null);
  for (const count of [7, 8, 9]) {
    assert.equal(
      selectDropReward(count, () => 0),
      "wheeee-1",
    );
    assert.equal(
      selectDropReward(count, () => 0.99),
      "wheeee-2",
    );
  }
  for (const count of [10, 11, 1000])
    assert.equal(
      selectDropReward(count, () => {
        throw Error("No Wheeee selection needed");
      }),
      "ooo-smashy",
    );
});

const buffer = (peak: number) =>
  ({
    duration: 2,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([0, -peak, peak / 2]),
  }) as unknown as AudioBuffer;

test("quiet recordings receive bounded playback balancing, silence remains silent", () => {
  assert(Math.abs(rewardPlaybackGain(buffer(0.5)) - 0.8) < 0.0001);
  assert(Math.abs(rewardPlaybackGain(buffer(0.0065)) * 0.0065 - 0.4) < 0.0001);
  assert.equal(rewardPlaybackGain(buffer(0.002)), 64);
  assert.equal(rewardPlaybackGain(buffer(0)), 0);
});

test("late sample decoding cannot play after pause or mute, and reuses the effects graph", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousFetch = globalThis.fetch;
  const sources: any[] = [],
    gains: any[] = [];
  let finish!: (value: AudioBuffer) => void,
    contexts = 0,
    fetches = 0;
  const decoded = new Promise<AudioBuffer>((resolve) => {
    finish = resolve;
  });
  const parameter = () => ({
    value: 0,
    setTargetAtTime(value: number) {
      this.value = value;
    },
    setValueAtTime(value: number) {
      this.value = value;
    },
    cancelScheduledValues() {},
  });
  class Context {
    state = "running";
    currentTime = 0;
    destination = {};
    constructor() {
      contexts++;
    }
    createGain() {
      const node = {
        gain: parameter(),
        connect(target: unknown) {
          (this as any).target = target;
        },
        disconnect() {},
      };
      gains.push(node);
      return node;
    }
    createDynamicsCompressor() {
      return {
        threshold: parameter(),
        knee: parameter(),
        ratio: parameter(),
        attack: parameter(),
        release: parameter(),
        connect() {},
      };
    }
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    suspend() {
      this.state = "suspended";
      return Promise.resolve();
    }
    decodeAudioData() {
      return decoded;
    }
    createBufferSource() {
      const source = {
        buffer: null,
        stopped: false,
        start() {
          sources.push(this);
        },
        stop() {
          this.stopped = true;
        },
        connect(target: unknown) {
          (this as any).target = target;
        },
        disconnect() {},
      };
      return source;
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: Context },
  });
  globalThis.fetch = async () => {
    fetches++;
    return {
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    } as Response;
  };
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  try {
    const sound = new SmashyAudio({ "ooo-smashy": "/test-voice.mp3" });
    await sound.unlock();
    sound.playDropReward(10);
    sound.suspend();
    finish(buffer(0.5));
    await flush();
    assert.equal(sources.length, 0, "Do not cheer late after leaving play");
    await sound.unlock();
    sound.playDropReward(10);
    assert.equal(sources.length, 1);
    assert.equal(
      sources[0].target.target,
      gains[0],
      "Reward routes through the existing effects master",
    );
    sound.setVolume(0.12);
    assert.equal(gains[0].gain.value, 0.12);
    sound.setMuted(true);
    assert(sources[0].stopped);
    sound.playDropReward(10);
    assert.equal(sources.length, 1);
    sound.setMuted(false);
    sound.playDropReward(10);
    assert.equal(sources.length, 2);
    sound.cancelPresentation();
    assert(sources[1].stopped);
    sound.setVolume(0);
    sound.playDropReward(10);
    assert.equal(sources.length, 2);
    assert.equal(fetches, 1);
    assert.equal(contexts, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
