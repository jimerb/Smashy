import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { sourceDigest } from "./source-digest.mjs";

const base = process.env.SMASHY_URL;
if (!base) throw Error("Supply the audited SMASHY_URL");
const audit = JSON.parse(fs.readFileSync("review/build-audit.json", "utf8"));
const source = sourceDigest().digest;
assert.equal(
  source,
  audit.sources.digest,
  "Source must match the current build audit",
);
const html = async () =>
  crypto
    .createHash("sha256")
    .update(Buffer.from(await (await fetch(base!)).arrayBuffer()))
    .digest("hex");
const expected = audit.inventory.find(
  (f: any) => f.file === "dist/index.html",
).sha256;
assert.equal(await html(), expected);
const browser = await chromium.launch({
  channel: process.env.SMASHY_BROWSER || "chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors: string[] = [],
  checks: string[] = [],
  timings: number[] = [];
const pauseEvidence: unknown[] = [];
let pausedGap: unknown;
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const w = window as any;
  w.__name = (target: unknown) => target;
  w.musicEvents = [];
  w.musicPlayCalls = [];
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (this.dataset.smashyMusic)
      w.musicPlayCalls.push({
        time: performance.now(),
        index: this.dataset.trackIndex,
      });
    return nativePlay.call(this);
  };
  const Native = window.AudioContext;
  w.AudioContext = class extends Native {
    createMediaElementSource(element: HTMLMediaElement) {
      const node = super.createMediaElementSource(element),
        connect = node.connect.bind(node);
      (node as any).connect = (destination: any, ...rest: any[]) => {
        w.musicNode = destination;
        w.musicContext = this;
        return (connect as any)(destination, ...rest);
      };
      for (const name of ["ended", "playing"])
        element.addEventListener(name, () =>
          w.musicEvents.push({
            event: name,
            index: element.dataset.trackIndex,
            time: performance.now(),
            duration: element.duration,
          }),
        );
      return node;
    }
  };
});
async function musicSnapshot() {
  return page.evaluate(() => {
    const audio = document.querySelector<HTMLAudioElement>(
      "audio[data-smashy-music]",
    )!;
    return {
      index: audio.dataset.trackIndex,
      src: audio.currentSrc,
      time: audio.currentTime,
      paused: audio.paused,
      gain: (window as any).musicNode.gain.value,
      playCalls: (window as any).musicPlayCalls.length,
      now: performance.now(),
    };
  });
}
async function remainsPaused(
  baseline: Awaited<ReturnType<typeof musicSnapshot>>,
  reason: string,
) {
  await page.waitForTimeout(120);
  const current = await musicSnapshot();
  assert(current.paused, `${reason}: native media stays paused`);
  assert(
    Math.abs(current.time - baseline.time) < 0.06,
    `${reason}: position is held`,
  );
  assert.equal(current.index, baseline.index, `${reason}: same track`);
  assert.equal(current.src, baseline.src, `${reason}: same source`);
  assert.equal(
    current.playCalls,
    baseline.playCalls,
    `${reason}: no hidden native play attempt`,
  );
  assert(current.gain < 0.001, `${reason}: music gain is zero`);
  pauseEvidence.push({ reason, baseline, current });
}
async function resumedFrom(
  baseline: Awaited<ReturnType<typeof musicSnapshot>>,
  reason: string,
) {
  await page.waitForFunction((time) => {
    const audio = document.querySelector<HTMLAudioElement>(
      "audio[data-smashy-music]",
    )!;
    return !audio.paused && audio.currentTime > time + 0.04;
  }, baseline.time);
  const current = await musicSnapshot();
  assert.equal(
    current.index,
    baseline.index,
    `${reason}: track was not advanced`,
  );
  assert.equal(current.src, baseline.src, `${reason}: source was not replaced`);
  assert(
    current.time < baseline.time + 1.5,
    `${reason}: resumes near the held position`,
  );
  assert(current.gain > 0, `${reason}: selected gain restored`);
  pauseEvidence.push({ reason, baseline, current });
}
async function injectHidden(hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: hidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}
let verified = false;
try {
  await page.goto(base);
  assert.equal(
    await page.locator("audio[data-smashy-music]").count(),
    0,
    "No audio is created before interaction",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>(
      "audio[data-smashy-music]",
    );
    return a && !a.paused && a.currentTime > 0.05 && a.readyState >= 2;
  });
  assert(await page.locator("#setting-music").isChecked());
  assert.equal(
    await page.locator("#setting-music-volume").inputValue(),
    "0.08",
  );
  assert.equal(await page.locator("#music-volume-value").innerText(), "8%");
  const defaults = await page.evaluate(() => ({
    gain: (window as any).musicNode.gain.value,
    title: document.querySelector<HTMLAudioElement>("audio[data-smashy-music]")!
      .dataset.trackTitle,
  }));
  assert(Math.abs(defaults.gain - 0.08) < 0.001);
  assert.equal(defaults.title, "Relaxed Pocket");
  const tracks = audit.inventory
    .filter((f: any) => f.file.endsWith(".m4a"))
    .sort((a: any, b: any) => a.file.localeCompare(b.file));
  assert.equal(tracks.length, 4);
  for (const track of tracks) {
    const url = new URL(track.file.replace(/^dist\//, ""), base).href;
    const first = await fetch(url, { headers: { Range: "bytes=0-15" } });
    assert.equal(first.status, 206);
    assert.equal((await first.arrayBuffer()).byteLength, 16);
    assert.equal(first.headers.get("content-type")?.split(";")[0], "audio/mp4");
    const suffix = await fetch(url, { headers: { Range: "bytes=-16" } });
    assert.equal(suffix.status, 206);
    assert.equal((await suffix.arrayBuffer()).byteLength, 16);
    const bad = await fetch(url, { headers: { Range: "bytes=999999999-" } });
    assert.equal(bad.status, 416);
  }
  checks.push(
    "Music is lazy, starts from a real click at 8%, and all four AAC files support correct media byte ranges",
  );
  const titles = [
    "Relaxed Pocket",
    "Soft Pixel Play",
    "Cozy Game Loop",
    "Puzzle Pulse",
    "Relaxed Pocket",
  ];
  for (let i = 0; i < 4; i++) {
    await page.waitForFunction((index) => {
      const a = document.querySelector<HTMLAudioElement>(
        "audio[data-smashy-music]",
      );
      return (
        a?.dataset.trackIndex === String(index) &&
        a.readyState >= 2 &&
        !a.paused &&
        a.duration > 60
      );
    }, i);
    assert.equal(
      await page.locator("audio").getAttribute("data-track-title"),
      titles[i],
    );
    await page.evaluate(() => {
      const a = document.querySelector<HTMLAudioElement>(
        "audio[data-smashy-music]",
      )!;
      a.currentTime = a.duration - 0.08;
    });
    await page.waitForFunction(
      (count) =>
        (window as any).musicEvents.filter((e: any) => e.event === "ended")
          .length >= count,
      i + 1,
    );
    if (i === 0) {
      await page.locator("#setting-music").uncheck();
      await page.waitForTimeout(300);
      await page.locator("#setting-music").check();
    }
    if (i === 1) {
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          configurable: true,
          value: false,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    assert.deepEqual(
      errors,
      [],
      "Muting/hiding during the actual native inter-song timer must not throw",
    );
    await page.waitForFunction(
      (index) => {
        const a = document.querySelector<HTMLAudioElement>(
          "audio[data-smashy-music]",
        );
        return (
          a?.dataset.trackIndex === String(index) &&
          !a.paused &&
          a.currentTime > 0.03
        );
      },
      (i + 1) % 4,
    );
    const gap = await page.evaluate((count) => {
      const events = (window as any).musicEvents,
        ends = events.filter((e: any) => e.event === "ended"),
        end = ends[count - 1];
      return (
        events.find((e: any) => e.event === "playing" && e.time > end.time)
          ?.time - end.time
      );
    }, i + 1);
    assert(gap >= 4950 && gap < 9000, `Gap ${i}: ${gap}ms`);
    timings.push(gap);
    assert.equal(
      await page.locator("audio").getAttribute("data-track-title"),
      titles[i + 1],
    );
  }
  checks.push(
    "Native media plays 1→2→3→4→1 with five-second active gaps, retaining the gap through mute and simulated hidden-tab interruptions",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenTime = await page
    .locator("audio")
    .evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.waitForTimeout(300);
  assert(
    await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
  );
  assert(
    Math.abs(
      (await page
        .locator("audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime)) - hiddenTime,
    ) < 0.05,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForFunction(
    () => !document.querySelector<HTMLAudioElement>("audio")!.paused,
  );
  checks.push(
    "An injected visibility transition exercises the real app pause/resume wiring without advancing the playlist",
  );
  await page.locator("#setting-muted").uncheck();
  await page.waitForTimeout(150);
  assert(
    await page.locator("audio").evaluate((a: HTMLAudioElement) => !a.paused),
  );
  await page.locator("#setting-music-volume").fill("0.19");
  await page.locator("#setting-music-volume").dispatchEvent("input");
  await page.waitForTimeout(200);
  assert(
    Math.abs(
      (await page.evaluate(() => (window as any).musicNode.gain.value)) - 0.19,
    ) < 0.001,
  );
  await page.locator("#setting-music").uncheck();
  const time = await page
    .locator("audio")
    .evaluate((a: HTMLAudioElement) => a.currentTime);
  await page.waitForTimeout(350);
  assert.equal(
    await page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused),
    true,
  );
  assert(
    Math.abs(
      (await page
        .locator("audio")
        .evaluate((a: HTMLAudioElement) => a.currentTime)) - time,
    ) < 0.05,
  );
  assert(
    Math.abs(await page.evaluate(() => (window as any).musicNode.gain.value)) <
      0.001,
  );
  await page.reload();
  assert.equal(await page.locator("audio").count(), 0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(await page.locator("#setting-music").isChecked(), false);
  assert.equal(
    await page.locator("#setting-music-volume").inputValue(),
    "0.19",
  );
  assert.equal(await page.locator("audio").count(), 0);
  await page.locator("#setting-music").check();
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>("audio");
    return a && !a.paused && a.currentTime > 0.03;
  });
  checks.push(
    "Music mute/volume work independently of SFX, preserve position, persist after reload, and respect a saved mute before downloading media",
  );
  for (const viewport of [
    { width: 390, height: 664 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator("#setting-music-volume").scrollIntoViewIfNeeded();
    assert(await page.locator("#setting-music-volume").isVisible());
    const done = await page
      .getByRole("button", { name: "Done", exact: true })
      .boundingBox();
    assert(
      done && done.height >= 44 && done.y + done.height <= viewport.height,
    );
  }
  checks.push(
    "Music controls are reachable on phone/tablet with Done pinned at 44px or larger",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="play"]').click();
  await page.waitForFunction(
    () =>
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled &&
      !(document.querySelector("#game") as HTMLElement).hidden,
  );
  await page.locator("#input").press("Space");
  await page.waitForFunction(
    () => document.querySelector("#shots")?.textContent === "1",
  );
  checks.push(
    "Actual gameplay still fires and settles while the music player is active",
  );
  await page.waitForFunction(
    () =>
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  assert(
    await page
      .locator("audio[data-smashy-music]")
      .evaluate((audio: HTMLAudioElement) => !audio.paused),
    "Starting a new game clears the music pause gate",
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  const paused = await musicSnapshot();
  assert(paused.paused, "Game Pause pauses native music");
  await remainsPaused(paused, "Explicit game Pause");
  await page.locator('[data-action="sound"]:visible').first().click();
  await page.locator("#audio-music-volume").fill("0.14");
  await page.locator("#audio-music-volume").dispatchEvent("input");
  await page.locator("#audio-music-mute").click();
  await page.locator("#audio-music-mute").click();
  await page.locator("#audio-music-volume").press("ArrowRight");
  await page.keyboard.press("Escape");
  await remainsPaused(
    paused,
    "Trusted flyout clicks, keyboard, volume and mute changes during Pause",
  );

  await page.locator('#overlay [data-action="settings"]').click();
  await remainsPaused(paused, "Settings opened from paused gameplay");
  await page.locator("#setting-music").uncheck();
  await page.locator("#setting-music").check();
  await page.locator("#setting-music-volume").fill("0.12");
  await page.locator("#setting-music-volume").dispatchEvent("input");
  await remainsPaused(
    paused,
    "Settings music preferences cannot override gameplay Pause",
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await remainsPaused(
    paused,
    "Closing Settings leaves the game and music paused",
  );
  await page.locator('[data-action="help"]:visible').first().click();
  await page.locator("#help-tab-1").click();
  await remainsPaused(paused, "Help navigation while gameplay is paused");
  await page.locator("#dialog").press("Escape");
  await remainsPaused(paused, "Closing Help does not resume gameplay music");
  await injectHidden(true);
  await injectHidden(false);
  await remainsPaused(
    paused,
    "Visibility restoration cannot override an existing game Pause",
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await resumedFrom(paused, "Explicit Resume restores the held song");
  checks.push(
    "Real game Pause/Settings/Help hold the same song and zero gain; trusted taps, keys, preference changes and visibility restoration do not restart it; explicit Resume restores position",
  );

  // Settings is available through the Pause card; Help also has a live-game
  // header entry, so exercise that additional direct route separately.
  for (const action of ["help"] as const) {
    await page.locator(`[data-action="${action}"]:visible`).first().click();
    await page.waitForTimeout(120);
    const dialogPause = await musicSnapshot();
    await remainsPaused(
      dialogPause,
      `Opening ${action} directly from live gameplay pauses music`,
    );
    if (action === "settings")
      await page.getByRole("button", { name: "Done", exact: true }).click();
    else await page.locator("#dialog").press("Escape");
    await remainsPaused(
      dialogPause,
      `Closing live-game ${action} still requires Resume`,
    );
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await resumedFrom(
      dialogPause,
      `Resume after opening ${action} from live gameplay`,
    );
  }
  checks.push(
    "Opening Help directly from live gameplay pauses native music; closing the dialog preserves Pause until explicit Resume",
  );

  await injectHidden(true);
  await page.waitForTimeout(120);
  const hiddenInGame = await musicSnapshot();
  assert(
    await page.getByRole("button", { name: "Resume", exact: true }).isVisible(),
  );
  await injectHidden(false);
  await remainsPaused(
    hiddenInGame,
    "A hidden-tab game pause requires explicit Resume after returning",
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await resumedFrom(
    hiddenInGame,
    "Resume after a game visibility interruption",
  );
  checks.push(
    "Injected hidden/visible transitions pause active gameplay music and do not restart it until the real game Resume action",
  );

  // Seek the native media to its real end, then spend only active time in the
  // five-second playlist gap. No fake ended event or app debug API is used.
  const endedCount = await page.evaluate(
    () =>
      (window as any).musicEvents.filter(
        (event: any) => event.event === "ended",
      ).length,
  );
  const gapIndex = Number((await musicSnapshot()).index);
  await page
    .locator("audio[data-smashy-music]")
    .evaluate((audio: HTMLAudioElement) => {
      audio.currentTime = audio.duration - 0.08;
    });
  await page.waitForFunction(
    (count) =>
      (window as any).musicEvents.filter(
        (event: any) => event.event === "ended",
      ).length > count,
    endedCount,
  );
  const endAt = await page.evaluate(
    () =>
      (window as any).musicEvents
        .filter((event: any) => event.event === "ended")
        .at(-1).time,
  );
  await page.waitForTimeout(1000);
  await page.keyboard.press("Escape");
  const gapPause = await musicSnapshot();
  const pauseAt = gapPause.now;
  await page.locator('[data-action="sound"]:visible').first().click();
  await page.locator("#audio-music-volume").fill("0.17");
  await page.locator("#audio-music-volume").dispatchEvent("input");
  await page.locator("#audio-music-mute").click();
  await page.locator("#audio-music-mute").click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  await remainsPaused(
    gapPause,
    "Paused playlist gap survives controls and elapsed wall time",
  );
  const resumeAt = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForFunction(
    (index) => {
      const audio = document.querySelector<HTMLAudioElement>(
        "audio[data-smashy-music]",
      )!;
      return (
        audio.dataset.trackIndex === String(index) &&
        !audio.paused &&
        audio.currentTime > 0.03
      );
    },
    (gapIndex + 1) % 4,
  );
  const nextPlayingAt = await page.evaluate(
    (endAt) =>
      (window as any).musicEvents.find(
        (event: any) => event.event === "playing" && event.time > endAt,
      ).time,
    endAt,
  );
  const activeGapMs = pauseAt - endAt + (nextPlayingAt - resumeAt);
  assert(
    activeGapMs >= 4850 && activeGapMs < 5700,
    `Remaining gap preserved: ${activeGapMs}ms active`,
  );
  assert(
    nextPlayingAt - endAt >= activeGapMs + 1500,
    "Paused wall time does not consume the playlist gap",
  );
  pausedGap = {
    endAt,
    pauseAt,
    resumeAt,
    nextPlayingAt,
    activeGapMs,
    pausedWallMs: resumeAt - pauseAt,
    expectedActiveMs: 5000,
  };
  checks.push(
    "A real native song end retains the remaining five-second gap through game Pause and trusted preference changes, excluding paused wall time and advancing exactly one track on Resume",
  );

  await page.keyboard.press("Escape");
  await page.locator('#overlay [data-action="home"]').click();
  if (await page.locator("#confirm").isVisible())
    await page.locator("#confirm").click();
  await page.locator("#home").waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLAudioElement>("audio[data-smashy-music]")!
        .paused,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert(
    await page
      .locator("audio[data-smashy-music]")
      .evaluate((audio: HTMLAudioElement) => !audio.paused),
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('[data-action="resume-saved"]').click();
  await page
    .getByRole("button", { name: "Resume", exact: true })
    .waitFor({ state: "visible" });
  await page.waitForTimeout(120);
  const savedPause = await musicSnapshot();
  await remainsPaused(
    savedPause,
    "Resuming a saved board opens paused without restarting music",
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await resumedFrom(
    savedPause,
    "Explicit Resume after loading the saved board",
  );
  checks.push(
    "Home ambience and Home Settings keep music playing; loading the saved board pauses it until explicit Resume without resetting the playlist",
  );
  assert.deepEqual(errors, []);
  assert.equal(sourceDigest().digest, source);
  assert.equal(await html(), expected);
  verified = true;
} finally {
  fs.mkdirSync("review", { recursive: true });
  fs.writeFileSync(
    process.env.SMASHY_REPORT_PATH || "review/music-browser.json",
    JSON.stringify(
      {
        verified,
        base,
        source,
        html: expected,
        checks,
        timings,
        pauseEvidence,
        pausedGap,
        errors,
        boundary:
          "Headless Chrome native media and trusted mouse/keyboard controls; song ends use a real native ended event after seeking. Visibility transitions are injected. This does not certify physical iOS/Safari interruptions, physical audio output or listening comfort.",
      },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(JSON.stringify({ verified, checks, timings }, null, 2));
