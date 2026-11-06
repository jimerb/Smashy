import test from "node:test";
import assert from "node:assert/strict";
import { SmashyAudio } from "../src/audio";

test("sound effects recover from a rejected startup on the next gesture without a mute toggle", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let contexts = 0,
    attempts = 0;
  const parameter = () => ({ value: 0, setTargetAtTime() {} });
  class Context {
    state = "suspended";
    currentTime = 0;
    destination = {};
    constructor() {
      contexts++;
    }
    createGain() {
      return { gain: parameter(), connect() {} };
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
    async resume() {
      if (++attempts === 1)
        throw Object.assign(new Error("Tap required"), {
          name: "NotAllowedError",
        });
      this.state = "running";
    }
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { AudioContext: Context },
  });
  try {
    const sound = new SmashyAudio();
    assert.equal(await sound.unlock(), false);
    assert.equal(sound.state, "blocked");
    assert.equal(sound.available, true);
    assert.equal(await sound.unlock(), true);
    assert.equal(sound.state, "running");
    assert.equal(contexts, 1);
    assert.equal(attempts, 2);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
