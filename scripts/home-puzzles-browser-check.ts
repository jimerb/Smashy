import { PUZZLES } from "../src/content/puzzles";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import {
  createGame,
  resolveShot,
  validateState,
  type GameState,
} from "../src/core";
import { createProgress, type RunProgress } from "../src/progression";
import { sourceDigest } from "./source-digest.mjs";

// Explicit URL is required so this harness cannot accidentally test the owner's
// frozen server while a new candidate is being prepared.
const base = process.env.SMASHY_URL;
if (!base) throw new Error("Supply the audited candidate SMASHY_URL");
const audit = JSON.parse(fs.readFileSync("review/build-audit.json", "utf8"));
const expectedHTML = audit.inventory.find(
  (f: any) => f.file === "dist/index.html",
)?.sha256;
async function htmlHash() {
  const r = await fetch(base!);
  assert(r.ok);
  return crypto
    .createHash("sha256")
    .update(Buffer.from(await r.arrayBuffer()))
    .digest("hex");
}
const startSource = sourceDigest().digest;
const startHTML = await htmlHash();
assert.equal(startHTML, expectedHTML, "Candidate does not match build audit");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts: BrowserContext[] = [];
const errors: string[] = [];
const checks: {
  name: string;
  passed: boolean;
  evidence?: unknown;
  error?: string;
}[] = [];
let verified = false;
fs.mkdirSync("review", { recursive: true });

async function context() {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  contexts.push(c);
  c.on("page", (p) => {
    p.setDefaultTimeout(12000);
    p.on("pageerror", (e) => errors.push(e.message));
  });
  return c;
}
async function read(p: Page): Promise<any> {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const t = db.transaction("state"),
          r = t.objectStore("state").get("envelope");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function ready(p: Page) {
  await p.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled &&
      !(document.querySelector("#dialog") as HTMLDialogElement).open &&
      (document.querySelector("#overlay") as HTMLElement).hidden,
  );
}
async function start(
  c: BrowserContext,
  profile = "standard",
  difficulty = "standard",
) {
  const p = await c.newPage();
  await p.goto(base!);
  await p.locator("#profile").selectOption(profile);
  await p.locator("#difficulty").selectOption(difficulty);
  await p.locator('[data-action="play"]').click();
  await ready(p);
  return p;
}
async function install(p: Page, game: GameState, progress?: RunProgress) {
  assert(validateState(game));
  await p.evaluate(
    async ({ game, progress }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("smashy-personal-v1");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const t = db.transaction("state", "readwrite"),
            os = t.objectStore("state"),
            r = os.get("envelope");
          r.onsuccess = () => {
            const e = r.result;
            e.active.status = "active";
            Object.assign(e.active.checkpoint, {
              game,
              initial: structuredClone(game),
              undo: null,
              replay: null,
              lastAward: null,
              angle: 90,
              guide: false,
              ...(progress
                ? { progress, initialProgress: structuredClone(progress) }
                : {}),
            });
            os.put(e, "envelope");
          };
          t.oncomplete = () => resolve();
          t.onabort = () => reject(t.error);
        });
      } finally {
        db.close();
      }
    },
    { game, progress },
  );
  await p.reload();
  await p.locator('[data-action="resume-saved"]').click();
  try {
    await p.locator('#overlay-card [data-action="resume"]').click();
  } catch (error) {
    console.error(await p.locator("body").innerText());
    console.error(JSON.stringify((await read(p)).active?.checkpoint?.progress));
    throw error;
  }
  await ready(p);
}
function board(
  config: GameState["config"],
  kind: "positive" | "zero" | "clear",
) {
  const col = Math.floor(config.columns / 2);
  const g = createGame({
    config,
    seed: 2424,
    board:
      kind === "zero"
        ? [{ row: 0, col: 0, type: 1 }]
        : [
            { row: 0, col, type: 0 },
            { row: 0, col: col + 1, type: 0 },
            ...(kind === "positive"
              ? [
                  { row: 0, col: 0, type: 1 as const },
                  { row: 0, col: 1, type: 1 as const },
                ]
              : []),
          ],
    current: 0,
    next: 0,
  });
  const r = resolveShot(g, 90);
  assert(!r.error);
  assert.equal(r.state.status, kind === "clear" ? "cleared" : "ready");
  assert.equal(r.state.score > 0, kind !== "zero");
  return g;
}
async function fireAndSave(p: Page, n: number) {
  await p.locator("#input").press("Space");
  await p.waitForFunction(
    (shots) => document.querySelector("#shots")?.textContent === String(shots),
    n,
  );
  for (let i = 0; i < 100; i++) {
    if ((await read(p)).active?.checkpoint?.game?.shots === n) return;
    await p.waitForTimeout(50);
  }
  throw new Error("Accepted shot not saved");
}
async function home(p: Page) {
  if (await p.locator("#overlay").isHidden())
    await p.getByRole("button", { name: "Pause", exact: true }).click();
  await p.locator('#overlay-card [data-action="home"]').click();
  if (await p.locator("#dialog").isVisible()) {
    assert.match(await p.locator("#confirm").innerText(), /save.*home/i);
    await p.locator("#confirm").click();
  }
  await p.locator("#home").waitFor({ state: "visible" });
}

async function reloadResume(p: Page) {
  await p.reload();
  await p.locator('[data-action="resume-saved"]').click();
  await p.locator('#overlay-card [data-action="resume"]').click();
  await ready(p);
}
async function setting(p: Page, value: boolean) {
  await p.getByRole("button", { name: "Settings", exact: true }).click();
  await p.locator("#setting-locked-puzzles").setChecked(value);
  await p.getByRole("button", { name: "Done", exact: true }).click();
}
async function newGame(p: Page) {
  await p.locator('[data-action="play"]').click();
  await p.waitForFunction(
    () =>
      !!document.querySelector("#confirm") ||
      (!(document.querySelector("#game") as HTMLElement).hidden &&
        !(document.querySelector("#fire-button") as HTMLButtonElement)
          .disabled),
  );
  if (await p.locator("#confirm").isVisible())
    await p.locator("#confirm").click();
  await ready(p);
}
async function shotAt(p: Page, angle: number, n: number) {
  const current = parseFloat(await p.locator("#angle").innerText());
  await p.locator("#input").focus();
  await p.keyboard.down("Shift");
  for (let i = 0; i < Math.round(Math.abs(angle - current) / 0.25); i++)
    await p.keyboard.press(angle > current ? "ArrowLeft" : "ArrowRight");
  await p.keyboard.up("Shift");
  await fireAndSave(p, n);
  await p.locator("#overlay:not([hidden])").waitFor({ state: "visible" });
}
async function shelf(p: Page) {
  await p.locator('[data-mode="puzzles"]').click();
  await p.locator(".puzzle-grid").waitFor({ state: "visible" });
}
async function unlocks(p: Page, n: number) {
  const e = await read(p);
  assert.equal(e.puzzleProgress.compact, n);
}
try {
  const c = await context(),
    p = await start(c, "compact");
  await fireAndSave(p, 1);
  await ready(p);
  const original = (await read(p)).active.checkpoint.game;
  await home(p);
  assert.equal(await p.locator('#home [data-action="settings"]').count(), 1);
  assert.equal(
    await p.locator('[data-action="play"]').innerText(),
    "New Classic game",
  );
  assert.equal(
    await p.locator('[data-action="resume-saved"]').innerText(),
    "Resume Classic",
  );
  await reloadResume(p);
  assert.deepEqual((await read(p)).active.checkpoint.game, original);
  await home(p);
  await newGame(p);
  const fresh = (await read(p)).active.checkpoint.game;
  assert.notEqual(fresh.seed, original.seed);
  assert.equal(fresh.shots, 0);
  assert.equal(fresh.score, 0);
  checks.push({
    name: "New Classic creates a fresh random attempt; Resume restores exact saved board, queue, score and shots after reload",
    passed: true,
  });
  await home(p);
  await p.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(await p.locator("#setting-locked-puzzles").isChecked(), false);
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await shelf(p);
  assert.equal(await p.locator("[data-puzzle]:disabled").count(), 49);
  assert.equal(await p.locator(".puzzle-lock svg").count(), 49);
  assert(await p.locator('[data-puzzle="0"]').isEnabled());
  await p.locator('[data-puzzle="0"]').click();
  await newGame(p);
  await shotAt(p, PUZZLES[0].variants.compact.solution[0], 1);
  await unlocks(p, 1);
  await home(p);
  await p.reload();
  await shelf(p);
  assert.equal(await p.locator("[data-puzzle]:disabled").count(), 48);
  assert(await p.locator('[data-puzzle="1"]').isEnabled());
  assert(await p.locator('[data-puzzle="2"]').isDisabled());
  assert.equal(await p.locator('[data-puzzle="0"] .puzzle-check').count(), 1);
  await p
    .locator("#dialog")
    .screenshot({ path: ".local/home-earned-shelf.png" });
  checks.push({
    name: "Shelf shows padlocks by default; an actual earned clear persists and unlocks only the next puzzle after reload",
    passed: true,
  });
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await setting(p, true);
  await shelf(p);
  assert.equal(await p.locator("[data-puzzle]:disabled").count(), 0);
  assert.equal(await p.locator('[data-puzzle="7"] .puzzle-lock').count(), 1);
  await p.locator('[data-puzzle="7"]').click();
  assert.equal(
    await p.locator('[data-action="play"]').innerText(),
    "Practice puzzle 8",
  );
  await newGame(p);
  let cp = (await read(p)).active.checkpoint;
  assert.equal(cp.progress.puzzlePractice, true);
  assert(cp.progress.configId.endsWith("-practice"));
  assert.equal(cp.game.assisted, true);
  for (const viewport of [
    { width: 360, height: 540 },
    { width: 390, height: 664 },
    { width: 320, height: 568 },
  ]) {
    await p.setViewportSize(viewport);
    await p.waitForTimeout(150);
    const resume = p.locator('#overlay-card [data-action="resume"]');
    if (await resume.isVisible()) await resume.click();
    await ready(p);
    assert.match(await p.locator("#run-label").innerText(), /^Practice 8/);
    const fit = await p.locator("#run-label").evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        visible: getComputedStyle(e).display !== "none",
        fits: r.left >= 0 && r.top >= 0 && r.bottom <= innerHeight,
        lines: e.scrollHeight <= e.clientHeight + 1,
      };
    });
    assert(fit.visible && fit.fits && fit.lines, JSON.stringify(fit));
    await p.screenshot({
      path:
        ".local/home-practice-" +
        viewport.width +
        "x" +
        viewport.height +
        ".png",
    });
  }
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.waitForTimeout(120);
  const resumeAfterResize = p.locator('#overlay-card [data-action="resume"]');
  if (await resumeAfterResize.isVisible()) await resumeAfterResize.click();
  await ready(p);
  await shotAt(p, PUZZLES[7].variants.compact.solution[0], 1);
  await unlocks(p, 1);
  assert.match(
    await p.locator("#overlay-card").innerText(),
    /Practice does not change your earned puzzle unlocks/,
  );
  await p
    .getByRole("button", { name: "Next practice puzzle", exact: true })
    .click();
  await ready(p);
  for (let i = 0; i < 100; i++) {
    if ((await read(p)).active.checkpoint.progress.puzzleIndex === 8) break;
    await p.waitForTimeout(50);
  }
  assert.equal((await read(p)).active.checkpoint.progress.puzzleIndex, 8);
  await reloadResume(p);
  cp = (await read(p)).active.checkpoint;
  assert.equal(cp.progress.puzzlePractice, true);
  assert.equal(cp.progress.puzzleIndex, 8);
  await unlocks(p, 1);
  await home(p);
  await p.getByRole("button", { name: "Settings", exact: true }).click();
  assert(await p.locator("#setting-locked-puzzles").isChecked());
  await p.locator("#setting-locked-puzzles").uncheck();
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await shelf(p);
  assert.equal(await p.locator("[data-puzzle]:disabled").count(), 48);
  assert(await p.locator('[data-puzzle="7"]').isDisabled());
  await p.locator('[data-puzzle="1"]').click();
  await newGame(p);
  cp = (await read(p)).active.checkpoint;
  assert(!cp.progress.puzzlePractice);
  await shotAt(p, PUZZLES[1].variants.compact.solution[0], 1);
  await unlocks(p, 2);
  await home(p);
  await p.reload();
  await shelf(p);
  assert(await p.locator('[data-puzzle="2"]').isEnabled());
  assert(await p.locator('[data-puzzle="3"]').isDisabled());
  checks.push({
    name: "Practice access persists, plays locked boards and resumes across reload without earning unlocks; switching it off restores locks and earned play still advances normally",
    passed: true,
  });
  assert.equal(sourceDigest().digest, startSource);
  assert.equal(await htmlHash(), startHTML);
  assert.deepEqual(errors, []);
  verified = true;
} finally {
  fs.writeFileSync(
    process.env.SMASHY_REPORT_PATH || "review/home-puzzles-browser.json",
    JSON.stringify(
      { verified, base, source: startSource, html: startHTML, checks, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(JSON.stringify({ verified, checks }, null, 2));
