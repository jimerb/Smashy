import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
const url = process.env.SMASHY_URL || "http://127.0.0.1:5180";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: string[] = [],
  errors: string[] = [];
try {
  for (const failure of ["missing", "constructor", "resume"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    // Literal browser code avoids tsx's injected class-name helper becoming an
    // undefined closure inside a serialized page initialization callback.
    const mocks = {
      missing: "Object.defineProperty(window,'AudioContext',{configurable:true,value:undefined});Object.defineProperty(window,'webkitAudioContext',{configurable:true,value:undefined});",
      constructor: "Object.defineProperty(window,'AudioContext',{configurable:true,value:class{constructor(){throw new Error('Harness blocked audio');}}});",
      resume: "const OriginalAudio=window.AudioContext;Object.defineProperty(window,'AudioContext',{configurable:true,value:class extends OriginalAudio{get state(){return 'suspended';}resume(){return Promise.reject(new DOMException('Harness blocked resume','NotAllowedError'));}}});",
    };
    await context.addInitScript({content:mocks[failure]});
    console.log(`Checking ${failure} audio`);
    const p = await context.newPage();
    p.setDefaultTimeout(10000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    await p.getByRole("button", { name: "Play Classic" }).click();
    await p.waitForFunction(
      () =>
        !(document.querySelector("#game") as HTMLElement).hidden &&
        !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
    );
    const sound = p.locator('#game [data-action="sound"]');
    await p.waitForFunction(() =>
      document
        .querySelector('#game [data-action="sound"]')!
        .getAttribute("aria-label")!
        .includes("unavailable"),
    );
    assert.equal(await sound.getAttribute("aria-pressed"), "false");
    assert.match((await sound.getAttribute("title")) || "", /unavailable/);
    await p.locator("#input").focus();
    await p.keyboard.press("Space");
    await p.waitForFunction(
      () => document.querySelector("#shots")!.textContent === "1",
    );
    assert.match(
      await p.locator("#live").innerText(),
      /Score [\d,]+\. Danger \d+ of \d+/,
    );
    await p.getByRole("button", { name: "Pause", exact: true }).click();
    await p.getByRole("button", { name: "Settings", exact: true }).click();
    assert.match(
      await p.locator("#dialog-body").innerText(),
      /Browser audio is unavailable\. Play continues silently/,
    );
    await p.locator("#setting-muted").uncheck();
    assert.equal(await sound.getAttribute("aria-pressed"), "false");
    await p.keyboard.press("Escape");
    await p.getByRole("button", { name: "Resume", exact: true }).click();
    await p.waitForFunction(
      () =>
        !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
    );
    await p.locator("#input").focus();
    await p.keyboard.press("Space");
    await p.waitForFunction(
      () => document.querySelector("#shots")!.textContent === "2",
    );
    checks.push(
      `${failure}: actual gameplay continues after audio failure; unavailable sound state and Settings explanation are truthful; shot score/danger announced`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = {
    at: new Date().toISOString(),
    url,
    browser: browser.version(),
    checks,
    pageErrors: errors,
    boundary:
      "Installed isolated headless Chrome with explicitly injected missing/throwing/rejected AudioContext APIs; actual app shots and Settings interaction, not physical speaker/listening/autoplay-policy certification.",
  };
  fs.writeFileSync(
    "review/audio-availability-chrome.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
