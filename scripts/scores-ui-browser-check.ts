import {
  insertScore,
  categoryKey,
  type ScoreCategory,
} from "../src/persistence";
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

async function history(p: Page, scores: number[]) {
  const e = await read(p),
    cp = e.active.checkpoint;
  const c: ScoreCategory = {
    mode: cp.progress.mode,
    difficulty: cp.progress.startDifficulty,
    rulesVersion: "1",
    layoutVersion: "1",
    layout: cp.game.config.profile,
    assisted: cp.game.assisted,
    configId: cp.progress.configId,
  };
  let entries: any[] = [];
  const receipts: Record<string, any> = {};
  scores.forEach((score, i) => {
    const r = insertScore(
      entries,
      {
        runId: "history-" + i,
        category: c,
        score,
        outcome: i % 3 === 0 ? "loss" : "clear",
        assisted: c.assisted,
      },
      i + 1,
      Date.UTC(2026, 10, 6) - i * 86400000,
    );
    entries = r.entries;
    receipts[r.receipt.runId] = r.receipt;
  });
  await p.evaluate(
    async ({ tables, receipts, sequence }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("smashy-personal-v1");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction("state", "readwrite"),
          o = t.objectStore("state"),
          r = o.get("envelope");
        r.onsuccess = () => {
          const e = r.result;
          e.tables = tables;
          e.receipts = receipts;
          e.sequence = sequence;
          e.lastResultRunId = null;
          o.put(e, "envelope");
        };
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error);
      });
      db.close();
    },
    {
      tables: { [categoryKey(c)]: entries },
      receipts,
      sequence: scores.length,
    },
  );
}
const shots = process.env.SMASHY_SHOTS_DIR || ".local/score-ui";
fs.mkdirSync(shots, { recursive: true });
try {
  for (const scenario of [
    "first",
    "third",
    "tenth",
    "below",
    "tie",
    "tied-eleventh",
  ]) {
    const c = await context(),
      p = await start(c, "compact");
    const g = board((await read(p)).active.checkpoint.game.config, "clear");
    const total = resolveShot(g, 90).state.score;
    const scores =
      scenario === "first"
        ? []
        : scenario === "third"
          ? [total + 300, total + 200]
          : scenario === "tie"
            ? [total]
            : scenario === "tied-eleventh"
              ? Array(10).fill(total)
              : Array.from(
                  { length: scenario === "tenth" ? 9 : 10 },
                  (_, i) => total + 1000 - i * 10,
                );
    await history(p, scores);
    await install(p, g);
    await fireAndSave(p, 1);
    await p.locator("#overlay.result-overlay").waitFor({ state: "visible" });
    const badge = p.locator(".result-badge");
    if (scenario === "below" || scenario === "tied-eleventh")
      assert.equal(await badge.count(), 0);
    else {
      assert.equal(
        await badge.innerText(),
        scenario === "first"
          ? "New personal best"
          : scenario === "third"
            ? "3rd best"
            : scenario === "tenth"
              ? "10th best"
              : "Tied personal best",
      );
      assert(
        await p
          .locator(".terminal-score")
          .evaluate((e) =>
            e.nextElementSibling?.classList.contains("result-record"),
          ),
      );
      const boxes = await p
        .locator(".terminal-score,.result-record,.score-breakdown")
        .evaluateAll((es) => es.map((e) => e.getBoundingClientRect().top));
      assert(boxes[0] < boxes[1] && boxes[1] < boxes[2]);
      await p.reload();
      await p.locator('[data-action="resume-saved"]').click();
      await badge.waitFor({ state: "visible" });
      assert.equal(await badge.count(), 1);
    }
    checks.push({
      name:
        scenario +
        " recognition uses saved top-ten decision directly below score",
      passed: true,
    });
    if (scenario === "third") {
      for (const v of [
        { width: 1440, height: 900 },
        { width: 360, height: 540 },
      ]) {
        await p.setViewportSize(v);
        await p.waitForTimeout(120);
        await p.screenshot({
          path: shots + "/result-" + v.width + "x" + v.height + ".png",
        });
        const badgeBox = await badge.boundingBox();
        assert(
          badgeBox &&
            badgeBox.y >= 0 &&
            badgeBox.y + badgeBox.height <= v.height,
        );
      }
    }
    if (scenario === "tenth") {
      await p
        .getByRole("button", { name: "Personal bests", exact: true })
        .click();
      await p.locator(".score-table").waitFor({ state: "visible" });
      assert.equal(await p.locator(".score-table tbody tr").count(), 10);
      assert.equal(await p.locator(".record-category").count(), 0);
      assert.equal(await p.locator("#dialog-title svg").count(), 1);
      assert.match(
        await p.locator("#record-filter option:checked").innerText(),
        /Classic · Standard · Compact · Unassisted/,
      );
      for (const v of [
        { width: 1440, height: 900 },
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
        { width: 390, height: 664 },
        { width: 360, height: 540 },
        { width: 320, height: 568 },
        { width: 844, height: 390 },
      ]) {
        await p.setViewportSize(v);
        await p.waitForTimeout(130);
        const fit = await p.locator("#dialog").evaluate((d) => {
          const r = d.getBoundingClientRect(),
            head = d.querySelector(".dialog-head")!.getBoundingClientRect(),
            foot = d.querySelector(".dialog-foot")!.getBoundingClientRect();
          return {
            fits:
              r.left >= 0 &&
              r.top >= 0 &&
              r.right <= innerWidth &&
              r.bottom <= innerHeight,
            noHorizontal: d.scrollWidth <= d.clientWidth,
            head: head.height,
            foot: foot.height,
            noPageScroll:
              document.documentElement.scrollHeight <= innerHeight + 1,
          };
        });
        assert(
          fit.fits && fit.noHorizontal && fit.noPageScroll,
          JSON.stringify({ v, fit }),
        );
        const done = p.getByRole("button", { name: "Done", exact: true });
        const b = await done.boundingBox();
        assert(b && b.height >= 44 && b.y + b.height <= v.height);
        await p
          .locator("#dialog-body")
          .evaluate((e) => (e.scrollTop = e.scrollHeight));
        await done.focus();
        assert(await done.isVisible());
        await p.locator("#dialog-body").evaluate((e) => (e.scrollTop = 0));
        await p.locator("#dialog").screenshot({
          path: shots + "/records-" + v.width + "x" + v.height + ".png",
        });
      }
      await p
        .getByRole("button", { name: "Recent results", exact: true })
        .click();
      await p
        .locator("#records-recent[aria-pressed=true]")
        .waitFor({ state: "visible" });
      await p.getByRole("button", { name: "Done", exact: true }).click();
      await p.reload();
      await p.locator('[data-action="resume-saved"]').click();
      await p.locator(".result-badge").waitFor({ state: "visible" });
      await p
        .getByRole("button", { name: "Personal bests", exact: true })
        .click();
      await p.locator(".score-table").waitFor({ state: "visible" });
      assert.equal(await p.locator(".score-table tbody tr").count(), 10);
      checks.push({
        name: "Trophy list, single concise selector, 10 saved rows, both tabs, pinned Done and no overflow at seven phone/tablet/PC sizes",
        passed: true,
      });
    }
    await c.close();
  }
  const c = await context(),
    p = await c.newPage();
  await p.goto(base!);
  const gear = await p
    .getByRole("button", { name: "Settings", exact: true })
    .locator("svg")
    .innerHTML();
  assert(gear.includes('r="3.1"') && gear.includes("Z"));
  await p.screenshot({ path: shots + "/home-gear.png" });
  await p.getByRole("button", { name: "Personal bests", exact: true }).click();
  await p.locator(".records-empty").waitFor({ state: "visible" });
  assert(await p.locator(".records-empty").isVisible());
  await p.locator("#dialog").screenshot({ path: shots + "/records-empty.png" });
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await p
    .getByRole("button", { name: "Settings", exact: true })
    .first()
    .click();
  assert.equal(await p.locator("#dialog.records-dialog").count(), 0);
  assert(await p.locator("#setting-undo-penalty").isChecked());
  checks.push({
    name: "Fresh trophy empty state and real gear; closing records restores normal Settings styling",
    passed: true,
  });
  assert.equal(sourceDigest().digest, startSource);
  assert.equal(await htmlHash(), startHTML);
  assert.deepEqual(errors, []);
  verified = true;
} finally {
  fs.writeFileSync(
    process.env.SMASHY_REPORT_PATH || "review/scores-ui-browser.json",
    JSON.stringify(
      { verified, base, source: startSource, html: startHTML, checks, errors },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(JSON.stringify({ verified, checks }, null, 2));
