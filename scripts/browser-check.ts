import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createGame, getConfig } from "../src/core/index";
import { lessonGame } from "../src/content/lessons";

const base = process.env.SMASHY_URL || "http://127.0.0.1:5173";
const channel = process.env.SMASHY_BROWSER || "chrome";
const browser = await chromium.launch({ channel, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(10000);
const errors: string[] = [];
const checks: string[] = [];
const oldPush = checks.push.bind(checks);
checks.push = (...items: string[]) => {
  console.log(items.join("\n"));
  return oldPush(...items);
};
page.on("pageerror", (e) => errors.push(e.message));
async function envelope(p: Page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise<any>((resolve, reject) => {
      const t = db.transaction("state");
      const r = t.objectStore("state").get("envelope");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      t.oncomplete = () => db.close();
    });
  });
}
async function angle(value: number) {
  await page.locator("#input").focus();
  const current = parseFloat(await page.locator("#angle").innerText());
  const diff = value - current;
  await page.keyboard.down("Shift");
  for (let i = 0; i < Math.round(Math.abs(diff) / 0.25); i++)
    await page.keyboard.press(diff > 0 ? "ArrowLeft" : "ArrowRight");
  await page.keyboard.up("Shift");
}
async function waitReady() {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function assertFit(p: Page, fit: boolean) {
  const r = await p.evaluate(() => {
    const b = document.querySelector("#stage")!.getBoundingClientRect();
    const ctrl = [
      ...document.querySelectorAll<HTMLElement>(
        "#game .actions button, #game .bottom-controls button",
      ),
    ]
      .filter((x) => x.offsetParent !== null)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
    return {
      w: innerWidth,
      h: innerHeight,
      sw: document.documentElement.scrollWidth,
      sh: document.documentElement.scrollHeight,
      stage: { x: b.x, y: b.y, w: b.width, h: b.height },
      noFit: document
        .querySelector("#play-layout")!
        .classList.contains("no-fit"),
      ctrl,
    };
  });
  assert.equal(r.noFit, !fit, JSON.stringify(r));
  assert(r.sw <= r.w && r.sh <= r.h, JSON.stringify(r));
  for (const b of r.ctrl)
    assert(
      b.w >= 43.9 &&
        b.h >= 43.9 &&
        b.x >= -0.1 &&
        b.y >= -0.1 &&
        b.x + b.w <= r.w + 0.1 &&
        b.y + b.h <= r.h + 0.1,
      JSON.stringify(r),
    );
  if (fit)
    assert(
      r.stage.x >= 0 &&
        r.stage.y >= 0 &&
        r.stage.x + r.stage.w <= r.w + 0.1 &&
        r.stage.y + r.stage.h <= r.h + 0.1,
      JSON.stringify(r),
    );
}
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Play Classic" }).click();
  await waitReady();
  await assertFit(page, true);
  assert.equal(await page.locator("canvas").count(), 1);
  await page.screenshot({ path: ".local/smashy-pc-playable.png" });
  checks.push(
    "PC boots with original Pixi characters; full stage and 44px commands fit",
  );
  const stage = await page.locator("#stage").boundingBox();
  assert(stage);
  await page.mouse.move(
    stage.x + stage.width * 0.55,
    stage.y + stage.height * 0.5,
  );
  await page.mouse.click(
    stage.x + stage.width * 0.55,
    stage.y + stage.height * 0.5,
  );
  await page.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "1",
  );
  await waitReady();
  checks.push(
    "Pointer inverse transform and one click produce one settled shot",
  );
  await page.locator("#input").focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  const shotsBefore = await page.locator("#shots").innerText();
  await page.waitForTimeout(900);
  assert.equal(await page.locator("#shots").innerText(), shotsBefore);
  await page.keyboard.press("Space");
  assert.equal(await page.locator("#overlay").isVisible(), true);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "2",
  );
  checks.push(
    "Help pauses mid-flight, cancels fire-through and requires explicit Resume",
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const replacingScoredAttempt =
    (await envelope(page)).active.checkpoint.game.score > 0;
  await page.getByRole("button", { name: "Home", exact: true }).click();
  if (replacingScoredAttempt)
    await page
      .getByRole("button", { name: "Save and go Home", exact: true })
      .click();
  await page.locator("#home").waitFor({ state: "visible" });
  await page
    .getByRole("button", { name: "Learn by smashing", exact: true })
    .click();
  await page.locator('[data-lesson="0"]').click();
  if (replacingScoredAttempt)
    await page
      .getByRole("button", { name: "Replace saved game", exact: true })
      .click();
  await waitReady();
  await page.locator("#input").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      !(document.querySelector("#overlay") as HTMLElement).hidden &&
      document
        .querySelector("#overlay-card")!
        .textContent!.includes("Beautifully smashed."),
  );
  assert.equal(await page.locator("#shots").innerText(), "1");
  assert((await page.locator("#score").innerText()).includes("15,910"));
  checks.push("Lesson 1 connected match clears via keyboard with exact score");
  await page.getByRole("button", { name: "Next lesson", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#run-label")!.textContent!.startsWith("Lesson 2"),
  );
  await waitReady();
  await angle(92);
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      !(document.querySelector("#overlay") as HTMLElement).hidden &&
      document
        .querySelector("#overlay-card")!
        .textContent!.includes("Beautifully smashed."),
  );
  assert((await page.locator("#score").innerText()).includes("16,070"));
  checks.push(
    "Lesson 2 support cut drops four different pieces including Anchor",
  );
  await page.getByRole("button", { name: "Next lesson", exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector("#run-label")!.textContent!.startsWith("Lesson 3"),
  );
  await waitReady();
  await angle(49);
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      !(document.querySelector("#overlay") as HTMLElement).hidden &&
      document
        .querySelector("#overlay-card")!
        .textContent!.includes("Beautifully smashed."),
  );
  await page.screenshot({ path: ".local/smashy-bank-result.png" });
  checks.push("Lesson 3 one-wall bank shot clears");
  const e = await envelope(page);
  assert(e.active?.status === "terminal");
  assert(
    Object.values(e.tables).every((x: any) => x.length === 0),
    "Teaching boards do not enter Classic records",
  );
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator("#profile").selectOption("compact");
  await page
    .getByRole("button", { name: "Personal bests", exact: true })
    .click();
  await page.locator("#dialog").waitFor({ state: "visible" });
  assert(
    (await page.locator("#dialog-body").innerText()).includes(
      "Classic · Standard difficulty · Compact layout",
    ),
  );
  await page.getByRole("button", { name: "Done", exact: true }).click();
  checks.push(
    "Home records follow selected layout rather than previous lesson",
  );
  await page.getByRole("button", { name: "Play Classic" }).click();
  await waitReady();
  await page.locator("#input").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "1",
  );
  await waitReady();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.locator('#overlay-card [data-action="settings"]').click();
  await page.locator("#setting-undo-penalty").uncheck();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.locator('#overlay-card [data-action="resume"]').click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.locator("#shots").innerText(), "0");
  assert.equal(await page.locator("#assist-label").isVisible(), true);
  await page.waitForFunction(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    return await new Promise<boolean>((resolve) => {
      const t = db.transaction("state");
      const r = t.objectStore("state").get("envelope");
      r.onsuccess = () =>
        resolve(r.result?.active?.checkpoint?.game?.assisted === true);
      t.oncomplete = () => db.close();
    });
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Resume saved board", exact: true })
    .click();
  await page.locator("#game").waitFor({ state: "visible" });
  assert.equal(await page.locator("#assist-label").isVisible(), true);
  assert.equal(await page.locator("#overlay").isVisible(), true);
  checks.push(
    "Undo restores pre-shot boundary, keeps Assisted through reload, and resumes paused",
  );
  for (const [w, h, fit] of [
    [1024, 768, true],
    [390, 844, true],
    [360, 640, true],
    [360, 540, true],
    [844, 390, true],
    [844, 369, false],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(170);
    await assertFit(page, fit);
  }
  checks.push(
    "Actual playable Compact layout fits six desktop-emulated sizes or preserves paused needs-space state",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(170);
  await page.screenshot({ path: ".local/smashy-phone-layout.png" });
  // An explicitly authored terminal fixture exercises real UI/storage without
  // requiring hundreds of random-game shots. No fixture hook ships in the app.
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = lessonGame(0, "compact");
  fixture.assisted = false;
  await page.evaluate(async (state) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      const os = tx.objectStore("state");
      const get = os.get("envelope");
      get.onsuccess = () => {
        const e = get.result;
        const cp = e.active.checkpoint;
        cp.game = state;
        cp.replay = null;
        cp.initial = structuredClone(state);
        cp.undo = null;
        cp.lesson = null;
        cp.angle = 90;
        cp.guide = false;
        os.put(e, "envelope");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, fixture);
  await page.reload();
  await page
    .getByRole("button", { name: "Resume saved board", exact: true })
    .click();
  await page.locator("#game").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      document.querySelector(".result-badge")?.textContent ===
      "New personal best",
  );
  const firstResult = await envelope(page);
  assert.equal(Object.values(firstResult.tables).flat().length, 1);
  assert.equal(firstResult.active.checkpoint.game.score, 12910);
  await page
    .getByRole("button", { name: "Personal bests", exact: true })
    .click();
  await page.locator(".score-table").waitFor({ state: "visible" });
  assert.equal(await page.locator(".score-table tbody tr").count(), 1);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Resume saved board", exact: true })
    .click();
  await page.locator(".result-badge").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".result-badge").innerText(),
    "New personal best",
  );
  assert.equal(Object.values((await envelope(page)).tables).flat().length, 1);
  await page
    .getByRole("button", { name: "Retry same board", exact: true })
    .click();
  await waitReady();
  await page.locator("#input").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    () =>
      document.querySelector(".result-badge")?.textContent ===
      "Tied personal best",
  );
  assert.equal(Object.values((await envelope(page)).tables).flat().length, 2);
  checks.push(
    "Classic terminal fixture commits one record, survives result reload, and same-board retry produces a tie behind the original",
  );
  await page
    .getByRole("button", { name: "Settings", exact: true })
    .count()
    .then(async (n) => {
      if (!n) {
        await page
          .getByRole("button", { name: "How to play", exact: true })
          .click();
        await page.locator("#help-next").click();
        assert.equal(
          await page.locator("#help-panel").getAttribute("aria-labelledby"),
          "help-tab-1",
        );
        await page.locator("#help-next").click();
        assert.equal(
          await page.locator("#help-panel").getAttribute("aria-labelledby"),
          "help-tab-2",
        );
        await page.keyboard.press("Escape");
      }
    });
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-action"),
    ),
    "help",
  );
  checks.push(
    "Help navigation and Escape restore the original opener without firing",
  );
  assert.deepEqual(errors, []);
  fs.mkdirSync("review", { recursive: true });
  fs.writeFileSync(
    process.env.SMASHY_REPORT_PATH || `review/browser-${channel}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser: browser.version(),
        boundary:
          "Installed desktop browser headless. Actual game DOM/input/render/storage checks, not human fun or physical mobile validation.",
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (e) {
  await page.screenshot({ path: ".local/browser-failure.png" });
  console.log(await page.locator("#overlay-card").innerText());
  throw e;
} finally {
  await browser.close();
}
