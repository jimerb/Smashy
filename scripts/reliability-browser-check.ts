import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.SMASHY_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: string[] = [];
const errors: string[] = [];
try {
  const unavailable = await browser.newContext();
  await unavailable.addInitScript({
    content: `const originalContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(type.includes('webgl'))return null;return originalContext.call(this,type,...args);};if(typeof OffscreenCanvas!=='undefined'){const originalOffscreen=OffscreenCanvas.prototype.getContext;OffscreenCanvas.prototype.getContext=function(type,...args){if(type.includes('webgl'))return null;return originalOffscreen.call(this,type,...args);};}try{Object.defineProperty(navigator,'gpu',{configurable:true,value:undefined});}catch{}`,
  });
  const noGPU = await unavailable.newPage();
  noGPU.setDefaultTimeout(10000);
  noGPU.on("pageerror", (e) => errors.push(e.message));
  await noGPU.goto(base);
  await noGPU.getByRole("button", { name: "New Classic game" }).click();
  await noGPU.locator("#dialog").waitFor({ state: "visible" });
  assert.match(
    await noGPU.locator("#dialog-body").innerText(),
    /render|WebGL|graphics/i,
  );
  assert.equal(await noGPU.locator("#game").isVisible(), false);
  checks.push(
    "Unavailable graphics produces a visible recoverable explanation instead of a blank game",
  );
  await unavailable.close();
  const noLocal = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await noLocal.addInitScript({
    content: `Object.defineProperty(window,'localStorage',{configurable:true,get:function(){throw new DOMException('Blocked','SecurityError');}});`,
  });
  const p = await noLocal.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);
  await p.locator('[data-mode="puzzles"]').click();
  await p.locator('[data-puzzle="0"]').click();
  await p.getByRole("button", { name: "New Puzzles game" }).click();
  await p.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  await p.locator("#input").focus();
  await p.keyboard.press("Space");
  await p
    .getByRole("button", { name: "Next puzzle", exact: true })
    .waitFor({ state: "visible" });
  await p.reload();
  await p.locator('[data-mode="puzzles"]').click();
  await p.locator('[data-puzzle="1"]').waitFor({ state: "visible" });
  assert.equal(await p.locator('[data-puzzle="1"]').isEnabled(), true);
  checks.push(
    "Puzzle unlocks survive reload with localStorage denied because completion and checkpoint use IndexedDB",
  );
  await noLocal.close();
  const normal = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const game = await normal.newPage();
  game.setDefaultTimeout(10000);
  game.on("pageerror", (e) => errors.push(e.message));
  await game.goto(base);
  await game.locator("#difficulty").selectOption("expert");
  const launchStart = Date.now();
  await game.getByRole("button", { name: "New Classic game" }).click();
  await game.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  const startToReadyMs = Date.now() - launchStart;
  const timings = await game.evaluate(
    `(async()=>{const frames=[];let prior=performance.now();await new Promise(resolve=>{function next(now){frames.push(now-prior);prior=now;if(frames.length<150)requestAnimationFrame(next);else resolve();}requestAnimationFrame(next);});frames.shift();frames.sort((a,b)=>a-b);return{samples:frames.length,medianMs:frames[Math.floor(frames.length*.5)],p95Ms:frames[Math.floor(frames.length*.95)],maxMs:frames[frames.length-1]};})()`,
  );
  checks.push(
    "Expert full board renders for a measured headless frame sample without page errors",
  );
  await game.getByRole("button", { name: "Pause", exact: true }).click();
  assert.equal(await game.locator("#score").innerText(), "0");
  await game.getByRole("button", { name: "Home", exact: true }).click();
  await game.locator("#home").waitFor({ state: "visible" });
  await game.locator("#profile").selectOption("compact");
  await game.locator('[data-mode="custom"]').click();
  for (const [key, value] of Object.entries({
    columns: 5,
    rows: 8,
    startRows: 3,
    types: 7,
    anchors: 1,
    dangerThreshold: 1,
    target: 10,
  }))
    await game.locator(`[name="${key}"]`).fill(String(value));
  await game
    .getByRole("button", { name: "Use these rules", exact: true })
    .click();
  await game.getByRole("button", { name: "New Custom game" }).click();
  await game.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  assert.equal(await game.locator("#dialog").isVisible(), false);
  await game.setViewportSize({ width: 360, height: 640 });
  await game.waitForTimeout(180);
  await game.getByRole("button", { name: "Resume", exact: true }).click();
  const stage = await game.locator("#stage").boundingBox();
  assert(stage);
  await game.mouse.click(
    stage.x + ((240 - 46) * stage.width) / 240,
    stage.y + ((350 + 47) * stage.height) / 482,
  );
  assert.equal(await game.locator("#shots").innerText(), "0");
  await game.locator("#input").focus();
  await game.keyboard.press("Space");
  await game
    .waitForFunction(
      () => document.querySelector("#shots")!.textContent === "1",
    )
    .catch(async (error) => {
      await game.screenshot({ path: ".local/reliability-custom-failure.png" });
      console.log(
        await game.evaluate(() => ({
          focused: document.activeElement?.id,
          overlay: document.querySelector("#overlay")?.textContent,
          stage: document
            .querySelector("#stage")
            ?.getBoundingClientRect()
            .toJSON(),
          fireDisabled: (
            document.querySelector("#fire-button") as HTMLButtonElement
          ).disabled,
          context: document.querySelector("#run-label")?.textContent,
        })),
      );
      throw error;
    });
  await game.screenshot({ path: ".local/smashy-narrow-custom.png" });
  checks.push(
    "Minimum-width Custom keeps Next separate and excludes its tray from mouse firing",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "review/reliability-browser-chrome.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        url: base,
        browser: browser.version(),
        boundary:
          "Headless desktop Chrome; mocked missing APIs and a synthetic narrow viewport. Frame sample describes this run only, not physical-device performance or human comfort.",
        checks,
        startToReadyMs,
        expertFrameTiming: timings,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, startToReadyMs, timings }));
} finally {
  await browser.close();
}
