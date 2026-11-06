import test from "node:test";
import assert from "node:assert/strict";
import { CosmeticClock } from "../src/render/clock.ts";
import { SmashyAudio } from "../src/audio/index.ts";
import { apparatusLayout } from "../src/render/layout.ts";

test("minimum Custom apparatus keeps the full Next tray below loss and outside the striker", () => {
  for (const width of [240, 288, 336, 432, 528, 624]) {
    for (const strikerOffset of [76, 88]) {
      const lossY = 644,
        striker = { x: width / 2, y: lossY + strikerOffset };
      const layout = apparatusLayout(width, lossY, striker.y),
        tray = layout.tray;
      assert.ok(tray.x >= 0 && tray.x + tray.width <= width);
      assert.ok(tray.y > lossY);
      assert.ok(tray.y + tray.height < striker.y + 60);
      assert.ok(layout.next.x - layout.spriteSize / 2 >= tray.x);
      assert.ok(layout.next.x + layout.spriteSize / 2 <= tray.x + tray.width);
      assert.ok(layout.next.y - layout.spriteSize / 2 >= tray.y);
      assert.ok(layout.next.y + layout.spriteSize / 2 <= tray.y + tray.height);
      const nearestX = Math.max(
        tray.x,
        Math.min(striker.x, tray.x + tray.width),
      );
      const nearestY = Math.max(
        tray.y,
        Math.min(striker.y, tray.y + tray.height),
      );
      assert.ok(
        Math.hypot(striker.x - nearestX, striker.y - nearestY) > 35,
        "tray must clear the striker ring",
      );
      const base = {
        left: striker.x - 52,
        right: striker.x + 52,
        top: striker.y + 24,
        bottom: striker.y + 43,
      };
      assert.ok(
        tray.x > base.right ||
          tray.x + tray.width < base.left ||
          tray.y > base.bottom ||
          tray.y + tray.height < base.top,
        "tray must clear striker feet",
      );
    }
  }
});

test("cosmetic clock freezes effects across pause and resumes without a wall-time jump", () => {
  let wallTime = 0;
  const clock = new CosmeticClock(() => wallTime);
  wallTime = 100;
  assert.equal(clock.read(), 100);
  wallTime = 120;
  clock.setPaused(true);
  assert.equal(clock.read(), 120);
  wallTime = 10_120;
  assert.equal(clock.read(), 120);
  // Repeated paused frames and effect scheduling use this same frozen value.
  clock.setPaused(true);
  assert.equal(clock.read(), 120);
  clock.setPaused(false);
  assert.equal(clock.read(), 120);
  wallTime += 16;
  assert.equal(clock.read(), 136);
});

class Parameter {
  value = 0;
  values: number[] = [];
  cancellations: number[] = [];
  setValueAtTime(value: number, _when: number) {
    this.values.push(value);
  }
  exponentialRampToValueAtTime(_value: number, _when: number) {}
  setTargetAtTime(_value: number, _when: number, _constant: number) {}
  cancelScheduledValues(when: number) {
    this.cancellations.push(when);
  }
}
class Gain {
  gain = new Parameter();
  disconnected = false;
  connect(_target: unknown) {}
  disconnect() {
    this.disconnected = true;
  }
}
class Oscillator {
  frequency = new Parameter();
  type = "sine";
  starts: number[] = [];
  stops: number[] = [];
  disconnected = false;
  onended: (() => void) | null = null;
  connect(_target: unknown) {}
  start(when: number) {
    this.starts.push(when);
  }
  stop(when: number) {
    this.stops.push(when);
  }
  disconnect() {
    this.disconnected = true;
  }
}
class TestAudioContext {
  static latest: TestAudioContext;
  currentTime = 0;
  state = "running";
  destination = {};
  oscillators: Oscillator[] = [];
  gains: Gain[] = [];
  constructor() {
    TestAudioContext.latest = this;
  }
  createGain() {
    const gain = new Gain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator() {
    const oscillator = new Oscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createDynamicsCompressor() {
    return {
      threshold: new Parameter(),
      knee: new Parameter(),
      ratio: new Parameter(),
      attack: new Parameter(),
      release: new Parameter(),
      connect(_target: unknown) {},
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

test("audio interruption cancels scheduled notes and fading stolen voices before resume", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    value: { AudioContext: TestAudioContext },
    configurable: true,
  });
  try {
    const audio = new SmashyAudio();
    assert.equal(await audio.unlock(), true);
    const context = TestAudioContext.latest;
    audio.play("clear");
    assert.deepEqual(
      context.oscillators.map((source) => source.starts[0]),
      [0, 0.16, 0.32],
    );
    // Fill the voice limit, so stolen sources are outside the priority queue.
    for (let i = 0; i < 5; i++) {
      context.currentTime += 0.03;
      audio.play("fire");
    }
    assert.ok(context.oscillators.length > 8);
    const interruptedAt = context.currentTime;
    audio.suspend();
    for (const source of context.oscillators) {
      assert.equal(source.stops.at(-1), interruptedAt);
      assert.equal(source.disconnected, true);
    }
    for (const gain of context.gains.slice(1)) {
      assert.equal(gain.gain.values.at(-1), 0);
      assert.equal(gain.gain.cancellations.at(-1), interruptedAt);
    }
    const sourceCount = context.oscillators.length;
    assert.equal(await audio.unlock(), true);
    assert.equal(context.oscillators.length, sourceCount);
    audio.play("fire");
    assert.equal(
      context.oscillators.length,
      sourceCount + 2,
      "fresh cues are not rate-limited by the interrupted cue",
    );
    audio.destroy();
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
