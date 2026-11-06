import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { sourceDigest } from "./source-digest.mjs";

const base = process.env.SMASHY_URL;
if (!base) throw Error("Supply the audited SMASHY_URL");
const audit = JSON.parse(fs.readFileSync("review/build-audit.json", "utf8"));
const source = sourceDigest().digest;
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
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  const w = window as any;
  w.musicEvents = [];
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
  assert.deepEqual(errors, []);
  assert.equal(sourceDigest().digest, source);
  assert.equal(await html(), expected);
  verified = true;
} finally {
  fs.mkdirSync("review", { recursive: true });
  fs.writeFileSync(
    process.env.SMASHY_REPORT_PATH || "review/music-browser.json",
    JSON.stringify(
      { verified, base, source, html: expected, checks, timings, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(JSON.stringify({ verified, checks, timings }, null, 2));
