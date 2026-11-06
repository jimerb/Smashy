import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { chromium, type Page } from "playwright-core";
import { lessonGame } from "../src/content/lessons";
import { resolveShot, validateState, type GameState } from "../src/core";
import { sourceDigest } from "./source-digest.mjs";

const base = process.env.SMASHY_URL;
if (!base) throw Error("Supply audited SMASHY_URL; this check never builds");
const audit = JSON.parse(fs.readFileSync("review/build-audit.json", "utf8"));
const source = sourceDigest().digest;
assert.equal(
  source,
  audit.sources.digest,
  "Current source must match build audit",
);
const expectedHtml = audit.inventory.find(
  (entry: any) => entry.file === "dist/index.html",
)?.sha256;
assert(expectedHtml);
const html = async () => {
  const response = await fetch(base!);
  assert(response.ok);
  return crypto
    .createHash("sha256")
    .update(Buffer.from(await response.arrayBuffer()))
    .digest("hex");
};
assert.equal(await html(), expectedHtml, "Serve the audited candidate");
const browser = await chromium.launch({
  channel: process.env.SMASHY_BROWSER || "chrome",
  headless: true,
});
const errors: string[] = [];
const checks: string[] = [];
const cases: any[] = [];
let verified = false;
let failure: string | undefined;

function gameFor(dropped: number, keepReady = true) {
  const game = lessonGame(1, "standard");
  const c = Math.floor(game.config.columns / 2);
  for (let i = 4; i < dropped; i++)
    game.board.push({
      row: 4 + Math.floor((i - 4) / 2),
      col: c + 1 + (i % 2),
      type: 1 + (i % 6),
    });
  if (keepReady) game.board.push({ row: 0, col: 0, type: 6 });
  assert(validateState(game), "Fixture passes production validator");
  const resolution = resolveShot(game, 92);
  assert.equal(resolution.matched.length, 3);
  assert.equal(resolution.dropped.length, dropped);
  assert.equal(resolution.state.status, keepReady ? "ready" : "cleared");
  return game;
}

async function instrument(page: Page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => {
    const w = window as any;
    w.__name = (target: unknown) => target; // tsx callback serialization helper
    localStorage.setItem(
      "smashy.settings.v1",
      JSON.stringify({
        undoPenalty: false,
        muted: false,
        volume: 0.35,
        musicMuted: false,
        musicVolume: 0.08,
      }),
    );
    const requests: any[] = [],
      decodes: any[] = [],
      starts: any[] = [],
      effectsStarts: any[] = [];
    const byteUrls = new WeakMap<ArrayBuffer, string>();
    const bufferInfo = new WeakMap<AudioBuffer, any>();
    const edges = new WeakMap<AudioNode, AudioNode[]>();
    const nodeIds = new WeakMap<AudioNode, number>();
    const contexts = new WeakMap<BaseAudioContext, number>();
    const musicContexts = new Set<BaseAudioContext>();
    let nextNode = 0,
      nextContext = 0;
    const nodeId = (node: AudioNode) => {
      if (!nodeIds.has(node)) nodeIds.set(node, ++nextNode);
      return nodeIds.get(node);
    };
    const contextId = (context: BaseAudioContext) => {
      if (!contexts.has(context)) contexts.set(context, ++nextContext);
      return contexts.get(context);
    };
    const isReward = (url: string) =>
      /(?:wheeee-[12]|ooo-smashy)[^/]*\.mp3(?:\?|$)/i.test(url);
    const nativeFetch = window.fetch;
    window.fetch = async function (...args) {
      const input = args[0];
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        location.href,
      ).href;
      const request = isReward(url)
        ? {
            url,
            at: performance.now(),
            status: null as number | null,
            failed: false,
          }
        : null;
      if (request) requests.push(request);
      try {
        const response = await nativeFetch.apply(this, args);
        if (request) {
          request.status = response.status;
          const read = response.arrayBuffer.bind(response);
          response.arrayBuffer = async () => {
            const bytes = await read();
            byteUrls.set(bytes, url);
            return bytes;
          };
        }
        return response;
      } catch (error) {
        if (request) request.failed = true;
        throw error;
      }
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (bytes: ArrayBuffer) {
      const url = byteUrls.get(bytes);
      return decode.call(this, bytes).then((buffer) => {
        if (url) {
          let peak = 0,
            squares = 0;
          for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
            const samples = buffer.getChannelData(ch);
            for (const sample of samples) {
              peak = Math.max(peak, Math.abs(sample));
              squares += sample * sample;
            }
          }
          const record = {
            url,
            duration: buffer.duration,
            sampleRate: buffer.sampleRate,
            channels: buffer.numberOfChannels,
            frames: buffer.length,
            peak,
            rms: Math.sqrt(squares / (buffer.length * buffer.numberOfChannels)),
            context: contextId(this),
          };
          bufferInfo.set(buffer, record);
          decodes.push(record);
        }
        return buffer;
      });
    };
    const connect = AudioNode.prototype.connect;
    (AudioNode.prototype as any).connect = function (
      destination: AudioNode,
      ...rest: any[]
    ) {
      const result = (connect as any).call(this, destination, ...rest);
      if (destination instanceof AudioNode) {
        const list = edges.get(this) || [];
        list.push(destination);
        edges.set(this, list);
      }
      return result;
    };
    const mediaSource = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (element) {
      musicContexts.add(this);
      return mediaSource.call(this, element);
    };
    const toneStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      const gain = edges.get(this)?.[0];
      const master = gain && edges.get(gain)?.[0];
      effectsStarts.push({
        context: contextId(this.context),
        masterNode: master ? nodeId(master) : null,
      });
      return toneStart.apply(this, args);
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const info = this.buffer && bufferInfo.get(this.buffer);
      if (info) {
        const chain: AudioNode[] = [];
        let current: AudioNode | undefined = this;
        for (let i = 0; current && i < 8; i++) {
          chain.push(current);
          current = edges.get(current)?.[0];
        }
        const gain = chain[1] as GainNode | undefined;
        const master = chain[2] as GainNode | undefined;
        const record = {
          id: starts.length + 1,
          source: this,
          master,
          localGainNode: gain,
          url: info.url,
          context: contextId(this.context),
          at: performance.now(),
          contextAt: this.context.currentTime,
          duration: this.buffer!.duration,
          peak: info.peak,
          localGain: gain?.gain.value,
          normalizedPeak: info.peak * (gain?.gain.value ?? NaN),
          masterAtStart: master?.gain.value,
          masterNode: master ? nodeId(master) : null,
          graph: chain.map((node) => ({
            id: nodeId(node),
            type: node.constructor.name,
          })),
          musicContext: musicContexts.has(this.context),
          ended: false,
          stopped: false,
          stopAt: null as number | null,
          endedAt: null as number | null,
        };
        starts.push(record);
        this.addEventListener("ended", () => {
          record.ended = true;
          record.endedAt = performance.now();
        });
      }
      return start.apply(this, args);
    };
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (when?: number) {
      const record = starts.find((item) => item.source === this);
      if (record) {
        record.stopped = true;
        record.stopAt = when ?? this.context.currentTime;
      }
      return stop.call(this, when);
    };
    w.dropRewardProbe = {
      requests,
      decodes,
      starts,
      snapshot: () => ({
        requests: requests.map((item) => ({ ...item })),
        decodes: decodes.map((item) => ({ ...item })),
        effectsStarts: effectsStarts.map((item) => ({ ...item })),
        starts: starts.map(({ source, master, localGainNode, ...record }) => ({
          ...record,
          masterNow: master?.gain.value,
          localGainNow: localGainNode?.gain.value,
          currentContextTime: source.context.currentTime,
          contextState: source.context.state,
        })),
      }),
    };
  });
}

const snapshot = (page: Page) =>
  page.evaluate(() => (window as any).dropRewardProbe.snapshot());
async function ready(page: Page) {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function seed(page: Page, game: GameState) {
  await page.goto(base!);
  assert.equal(
    (await snapshot(page)).requests.length,
    0,
    "No reward fetch before a trusted unlock",
  );
  await page.locator('[data-action="play"]').click();
  await ready(page);
  await page.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise<boolean>((resolve) => {
        const r = db.transaction("state").objectStore("state").get("envelope");
        r.onsuccess = () => resolve(!!r.result?.active?.checkpoint);
      });
    } finally {
      db.close();
    }
  });
  await page.evaluate(async (game) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("state", "readwrite"),
          store = tx.objectStore("state"),
          read = store.get("envelope");
        read.onsuccess = () => {
          const envelope = read.result,
            checkpoint = envelope.active.checkpoint;
          checkpoint.game = game;
          checkpoint.initial = structuredClone(game);
          checkpoint.replay = null;
          checkpoint.undo = null;
          checkpoint.lesson = null;
          checkpoint.angle = 92;
          checkpoint.lastAward = null;
          store.put(envelope, "envelope");
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, game);
  await page.reload();
  await page.locator('[data-action="resume-saved"]').click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await ready(page);
  assert.equal(Number.parseFloat(await page.locator("#angle").innerText()), 92);
}
async function preloaded(page: Page) {
  await page.waitForFunction(
    () => (window as any).dropRewardProbe.decodes.length === 3,
  );
}
async function fire(page: Page, dropped: number, expectedStarts: number) {
  await ready(page);
  await page.locator("#fire-button").click();
  await page.waitForFunction(
    (dropped) =>
      document
        .querySelector("#live")
        ?.textContent?.includes(`3 matched · ${dropped} dropped`),
    dropped,
  );
  if (expectedStarts > 0)
    await page.waitForFunction(
      (count) => (window as any).dropRewardProbe.starts.length >= count,
      expectedStarts,
    );
  else await page.waitForTimeout(450);
  assert.equal((await snapshot(page)).starts.length, expectedStarts);
}
async function undo(page: Page) {
  await page.locator("#undo-button").click();
  await ready(page);
  assert.equal(await page.locator("#shots").innerText(), "0");
}
async function flyout(page: Page) {
  if (!(await page.locator("#audio-flyout").isVisible()))
    await page.locator('[data-action="sound"]:visible').first().click();
}
async function closeFlyout(page: Page) {
  if (await page.locator("#audio-flyout").isVisible())
    await page.keyboard.press("Escape");
}
async function volume(page: Page, channel: "music" | "sound", value: string) {
  await flyout(page);
  await page.locator(`#audio-${channel}-volume`).fill(value);
  await page.locator(`#audio-${channel}-volume`).dispatchEvent("input");
}
async function assertStopped(page: Page, id: number, action: string) {
  await page.waitForFunction(
    (id) =>
      (window as any).dropRewardProbe.starts.find((item: any) => item.id === id)
        ?.stopped,
    id,
  );
  const record = (await snapshot(page)).starts.find(
    (item: any) => item.id === id,
  );
  assert(
    record.stopAt < record.contextAt + record.duration,
    `${action} stops the reward before its natural end`,
  );
}
function verifyProbe(probe: any, expectedDecodes = 3) {
  assert.equal(
    probe.requests.length,
    3,
    "Only three reward fetches per document, despite repeated gestures/shots",
  );
  assert.equal(new Set(probe.requests.map((item: any) => item.url)).size, 3);
  assert.equal(probe.decodes.length, expectedDecodes);
  for (const decoded of probe.decodes) {
    assert(
      decoded.duration > 0.1 &&
        decoded.frames > 0 &&
        decoded.peak > 0.001 &&
        Number.isFinite(decoded.rms),
    );
  }
  const masterIds = new Set();
  for (const item of probe.starts) {
    assert.equal(item.musicContext, false);
    assert.deepEqual(
      item.graph.map((node: any) => node.type),
      [
        "AudioBufferSourceNode",
        "GainNode",
        "GainNode",
        "DynamicsCompressorNode",
        "AudioDestinationNode",
      ],
    );
    assert(item.localGain > 0 && item.localGain <= 64);
    assert(Math.abs(item.localGain - Math.min(64, 0.4 / item.peak)) < 0.001);
    assert(item.normalizedPeak <= 0.40001);
    masterIds.add(item.masterNode);
    assert(
      probe.effectsStarts.some(
        (effect: any) =>
          effect.masterNode === item.masterNode &&
          effect.context === item.context,
      ),
      "Reward shares the actual Fire/Undo effects master and AudioContext",
    );
  }
  assert(masterIds.size <= 1, "All rewards share one SFX master bus");
  for (let i = 1; i < probe.starts.length; i++) {
    const previous = probe.starts[i - 1],
      current = probe.starts[i];
    const end = previous.stopped
      ? previous.stopAt
      : previous.contextAt + previous.duration;
    assert(end <= current.contextAt + 0.001, "Reward voices do not overlap");
  }
}

try {
  for (const dropped of [6, 7, 9, 10, 14]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await instrument(page);
    const keepReady = dropped !== 14;
    await seed(page, gameFor(dropped, keepReady));
    await preloaded(page);
    await fire(page, dropped, dropped < 7 ? 0 : 1);
    let probe = await snapshot(page);
    if (dropped < 7)
      assert.equal(
        probe.starts.length,
        0,
        "Six dropped plus three matched is not a seven-piece reward",
      );
    else if (dropped < 10) assert(/wheeee-[12]/.test(probe.starts[0].url));
    else assert(/ooo-smashy/.test(probe.starts[0].url));

    if (dropped === 7) {
      await undo(page);
      await assertStopped(page, 1, "Undo");
      await fire(page, dropped, 2);
      assert(
        (await snapshot(page)).starts.every((item: any) =>
          /wheeee-[12]/.test(item.url),
        ),
      );
      checks.push(
        "Seven/nine actual drops choose only a Wheeee variant; undo/retrigger uses decoded cache with no overlapping reward voice",
      );
    }

    if (dropped === 10) {
      // Use the longer ten-plus voice to inspect the live master while active.
      await volume(page, "sound", "0.23");
      await page.waitForFunction(
        () =>
          Math.abs(
            (window as any).dropRewardProbe.starts[0].master.gain.value - 0.23,
          ) < 0.001,
      );
      await page.locator("#audio-music-mute").click();
      assert.equal(
        (await snapshot(page)).starts[0].stopped,
        false,
        "Music mute does not stop reward",
      );
      assert(
        await page
          .locator("audio[data-smashy-music]")
          .evaluate((audio: HTMLAudioElement) => audio.paused),
      );
      await page.locator("#audio-sound-mute").click();
      await assertStopped(page, 1, "Sound mute");
      await closeFlyout(page);
      await undo(page);
      await fire(page, dropped, 1); // muted: reward must remain suppressed
      await flyout(page);
      await page.locator("#audio-sound-mute").click();
      await closeFlyout(page);
      await undo(page);
      await fire(page, dropped, 2);
      await volume(page, "sound", "0");
      await assertStopped(page, 2, "Sound zero volume");
      await page.locator("#audio-music-mute").click();
      await page.waitForFunction(() => {
        const audio = document.querySelector<HTMLAudioElement>(
          "audio[data-smashy-music]",
        );
        return audio && !audio.paused;
      });
      await closeFlyout(page);
      await undo(page);
      await fire(page, dropped, 2); // zero effects volume, music still plays
      await volume(page, "sound", "0.35");
      await closeFlyout(page);
      await undo(page);
      await fire(page, dropped, 3);
      await page.keyboard.press("Escape");
      await assertStopped(page, 3, "Pause");
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await ready(page);
      await page.waitForTimeout(180);
      assert.equal(
        (await snapshot(page)).starts.length,
        3,
        "Resume does not replay cancelled reward",
      );
      await undo(page);
      await fire(page, dropped, 4);
      await undo(page);
      await assertStopped(page, 4, "Undo");
      checks.push(
        "Native reward sources route through normalized local gain → effects master → compressor, track Sound volume, stop for Sound mute/zero/pause/undo, stay independent of Music mute, and never replay on Resume",
      );
    }

    if (dropped === 14) {
      await page
        .getByRole("button", { name: "Retry same board", exact: true })
        .click();
      await ready(page);
      await assertStopped(page, 1, "Restart");
      await page.waitForTimeout(180);
      assert.equal(
        (await snapshot(page)).starts.length,
        1,
        "Restart cannot replay previous cheer",
      );
      checks.push(
        "Fourteen-drop terminal reward stops when the real Retry same board action restarts the attempt",
      );
    }
    probe = await snapshot(page);
    verifyProbe(probe);
    if (dropped >= 10)
      assert(
        probe.starts.every((item: any) => /ooo-smashy/.test(item.url)),
        "Ten-plus exclusively uses ooo, never an extra Wheeee",
      );
    cases.push({ dropped, matched: 3, keepReady, probe });
    await context.close();
  }
  checks.push(
    "Production-validated fixtures fired through real UI resolve 3 matched and exactly 6/7/9/10/14 dropped; six drops stay silent even though total removals are nine; ten-plus exclusively uses ooo",
  );

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await instrument(page);
  await page.route(/(?:wheeee-[12]|ooo-smashy)[^/]*\.mp3(?:\?|$)/i, (route) =>
    route.abort("failed"),
  );
  await seed(page, gameFor(10));
  await page.waitForFunction(
    () =>
      (window as any).dropRewardProbe.requests.length === 3 &&
      (window as any).dropRewardProbe.requests.every(
        (item: any) => item.failed,
      ),
  );
  await fire(page, 10, 0);
  await ready(page);
  const optionalFailure = await snapshot(page);
  verifyProbe(optionalFailure, 0);
  assert.equal(optionalFailure.starts.length, 0);
  assert.equal(await page.locator("#shots").innerText(), "1");
  await flyout(page);
  assert(
    !(await page.locator("#audio-flyout-status").innerText()).includes(
      "unavailable",
    ),
  );
  cases.push({ optionalAssetFailure: true, probe: optionalFailure });
  checks.push(
    "All three optional MP3 fetch failures degrade to silence while the actual drop resolves, the next shot remains available, and effects do not become unavailable",
  );
  await context.close();
  assert.deepEqual(errors, []);
  assert.equal(
    sourceDigest().digest,
    source,
    "Source stayed frozen during check",
  );
  assert.equal(await html(), expectedHtml, "Audited served HTML stayed frozen");
  verified = true;
} catch (error) {
  failure =
    error instanceof Error ? error.stack || error.message : String(error);
  throw error;
} finally {
  fs.mkdirSync("review", { recursive: true });
  fs.writeFileSync(
    process.env.SMASHY_REPORT_PATH || "review/drop-reward-chrome.json",
    JSON.stringify(
      {
        verified,
        at: new Date().toISOString(),
        base,
        source,
        html: expectedHtml,
        browser: browser.version(),
        checks,
        cases,
        errors,
        failure,
        boundary:
          "Native headless Chrome MP3 fetch/decode and real WebAudio source/gain/compressor graph, real persisted-checkpoint fixtures and trusted Fire/Undo/Pause/Retry input. Instrumentation exposes test probes only; no app debug API. Does not establish physical listening, subjective reward loudness/comfort, or physical iOS/Safari decoding and activation behavior.",
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify({ verified, checks, cases: cases.length }, null, 2));
