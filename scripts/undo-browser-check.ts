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
  await p.locator('#overlay-card [data-action="resume"]').click();
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

async function settingsFor(p: Page, enabled?: boolean) {
  await p.getByRole("button", { name: "Pause", exact: true }).click();
  await p.locator('#overlay-card [data-action="settings"]').click();
  const toggle = p.locator("#setting-undo-penalty");
  if (enabled !== undefined) await toggle.setChecked(enabled);
  const checked = await toggle.isChecked();
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await p.locator('#overlay-card [data-action="resume"]').click();
  await ready(p);
  return checked;
}
async function savedUndo(p: Page) {
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#shots")?.textContent === "0",
  );
  for (let i = 0; i < 100; i++) {
    const cp = (await read(p)).active.checkpoint;
    if (cp.undo === null && cp.game.shots === 0) return cp;
    await p.waitForTimeout(50);
  }
  throw Error("Undo was not saved");
}
try {
  const c = await context(),
    p = await start(c);
  assert.equal(await settingsFor(p), true);
  checks.push({ name: "Fresh settings default to paid Undo", passed: true });
  for (const value of [undefined, "invalid"]) {
    await p.evaluate(
      (value) =>
        localStorage.setItem(
          "smashy.settings.v1",
          JSON.stringify({ undoPenalty: value }),
        ),
      value,
    );
    await p.reload();
    await p.locator('[data-action="resume-saved"]').click();
    await p.locator('#overlay-card [data-action="resume"]').click();
    await ready(p);
    assert.equal(await settingsFor(p), true);
  }
  checks.push({
    name: "Missing and malformed legacy settings keep the default on",
    passed: true,
  });
  const config = (await read(p)).active.checkpoint.game.config;
  for (const score of [0, 499, 500, 750]) {
    const g = board(config, "positive");
    g.score = score;
    await install(p, g);
    await fireAndSave(p, 1);
    await ready(p);
    const button = p.getByRole("button", { name: "Undo", exact: true });
    assert.match((await button.getAttribute("title"))!, /500 points/);
    if (score < 500) {
      assert(await button.isDisabled());
      continue;
    }
    assert(await button.isEnabled());
    const cp = await savedUndo(p);
    assert.deepEqual(cp.game, { ...g, score: score - 500, assisted: true });
    assert.equal(cp.lastAward, null);
    assert(await button.isDisabled());
    assert.equal(cp.replay.start.score, score - 500);
    await p.reload();
    await p.locator('[data-action="resume-saved"]').click();
    await p.locator('#overlay-card [data-action="resume"]').click();
    await ready(p);
    assert.deepEqual((await read(p)).active.checkpoint.game, cp.game);
  }
  checks.push({
    name: "0/499 blocked, 500/750 pay exactly 500, full state and debit survive reload",
    passed: true,
  });
  const g = board(config, "positive");
  await install(p, g);
  await fireAndSave(p, 1);
  await ready(p);
  const before = (await read(p)).active.checkpoint.game;
  assert.equal(await settingsFor(p, false), false);
  assert.deepEqual((await read(p)).active.checkpoint.game, before);
  assert.match(
    (await p.locator("#undo-button").getAttribute("title"))!,
    /free/,
  );
  const free = await savedUndo(p);
  assert.deepEqual(free.game, { ...g, assisted: true });
  await p.reload();
  await p.locator('[data-action="resume-saved"]').click();
  await p.locator('#overlay-card [data-action="resume"]').click();
  await ready(p);
  assert.equal(await settingsFor(p), false);
  assert.equal(await settingsFor(p, true), true);
  assert.deepEqual((await read(p)).active.checkpoint.game, free.game);
  checks.push({
    name: "Free Undo at zero, preference persists and toggling does not charge",
    passed: true,
  });
  for (const viewport of [
    { width: 390, height: 664 },
    { width: 1024, height: 768 },
  ]) {
    await p.setViewportSize(viewport);
    await p.getByRole("button", { name: "Pause", exact: true }).click();
    await p.locator('#overlay-card [data-action="settings"]').click();
    await p.locator("#setting-undo-penalty").scrollIntoViewIfNeeded();
    assert(await p.locator("#setting-undo-penalty").isVisible());
    await p.getByRole("button", { name: "Done", exact: true }).click();
    await p.locator('#overlay-card [data-action="resume"]').click();
    await ready(p);
    await p.getByRole("button", { name: "How to play", exact: true }).click();
    await p.locator("#help-tab-4").click();
    assert.match(
      await p.locator("#dialog").innerText(),
      /Undo costs 500 points by default/,
    );
    await p.locator("#help-next").click();
    await p.locator('#overlay-card [data-action="resume"]').click();
    await ready(p);
  }
  checks.push({
    name: "Phone and tablet Settings and Help expose penalty rule with reachable Done",
    passed: true,
  });
  assert.equal(sourceDigest().digest, startSource);
  assert.equal(await htmlHash(), startHTML);
  assert.deepEqual(errors, []);
  verified = true;
} finally {
  fs.writeFileSync(
    process.env.SMASHY_REPORT_PATH || "review/undo-browser.json",
    JSON.stringify(
      { verified, base, source: startSource, html: startHTML, checks, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(JSON.stringify({ verified, checks }, null, 2));
