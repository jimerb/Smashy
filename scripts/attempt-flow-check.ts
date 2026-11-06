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
async function noReplacementPrompt(p: Page, previousID: string) {
  await p.locator('[data-action="play"]').click();
  await ready(p); // A mistaken confirmation leaves this false and times out.
  const e = await read(p);
  assert.notEqual(e.active.runId, previousID);
  assert.equal(e.active.checkpoint.game.score, 0);
  assert.equal(await p.locator("#dialog").isVisible(), false);
  return e;
}
async function check(name: string, run: () => Promise<unknown>) {
  try {
    checks.push({ name, passed: true, evidence: await run() });
    console.log(`PASS ${name}`);
  } catch (e) {
    checks.push({
      name,
      passed: false,
      error: e instanceof Error ? e.stack : String(e),
    });
    console.log(`FAIL ${name}: ${String(e)}`);
    for (const c of contexts)
      for (const p of c.pages())
        await p
          .screenshot({
            path: `review/attempt-flow-failure-${checks.length}-${contexts.indexOf(c)}.png`,
          })
          .catch(() => {});
  }
}

try {
  await check(
    "Fresh zero-score board replaces directly without an abandon prompt",
    async () => {
      const c = await context(),
        p = await start(c);
      const before = await read(p);
      await home(p);
      const after = await noReplacementPrompt(p, before.active.runId);
      await c.close();
      return {
        beforeScore: 0,
        afterScore: after.active.checkpoint.game.score,
        replacement: true,
      };
    },
  );
  await check(
    "Zero score after an accepted no-match shot still replaces directly",
    async () => {
      const c = await context(),
        p = await start(c);
      const g = board((await read(p)).active.checkpoint.game.config, "zero");
      await install(p, g);
      await fireAndSave(p, 1);
      await ready(p);
      const before = await read(p);
      assert.equal(before.active.checkpoint.game.score, 0);
      await home(p);
      await noReplacementPrompt(p, before.active.runId);
      await c.close();
      return { acceptedShots: 1, score: 0, noAbandonPrompt: true };
    },
  );
  await check(
    "Scored live and reloaded Home attempts retain a cancelable replacement warning",
    async () => {
      const c = await context(),
        p = await start(c);
      const g = board(
        (await read(p)).active.checkpoint.game.config,
        "positive",
      );
      await install(p, g);
      await fireAndSave(p, 1);
      await ready(p);
      const before = await read(p);
      assert(before.active.checkpoint.game.score > 0);
      await home(p);
      for (const reload of [false, true]) {
        if (reload) await p.reload();
        await p.locator('[data-action="play"]').click();
        await p.locator("#confirm").waitFor({ state: "visible" });
        assert.match(
          await p.locator("#dialog-body").innerText(),
          /saved|attempt|replace|abandon/i,
        );
        assert.equal((await read(p)).active.runId, before.active.runId);
        await p.locator('#dialog-foot [data-action="close-dialog"]').click();
        assert.deepEqual(
          (await read(p)).active.checkpoint.game,
          before.active.checkpoint.game,
        );
      }
      await c.close();
      return {
        score: before.active.checkpoint.game.score,
        liveAndReloadedGuarded: true,
        cancelPreservedState: true,
      };
    },
  );
  await check(
    "Completed Classic retry is exact; new random Classic differs and retains selected configuration",
    async () => {
      const c = await context(),
        p = await start(c, "compact", "tricky");
      const g = board((await read(p)).active.checkpoint.game.config, "clear");
      await install(p, g);
      await fireAndSave(p, 1);
      const retry = p.locator('#overlay-card [data-action="retry"]');
      await retry.waitFor({ state: "visible" });
      const retryLabel = await retry.innerText();
      const newLabel = await p
        .locator('#overlay-card [data-action="new-board"]')
        .innerText();
      assert.match(retryLabel, /same|replay/i);
      assert.match(newLabel, /random/i);
      const terminal = await read(p);
      assert.equal(terminal.active.status, "terminal");
      await retry.click();
      await ready(p);
      const retried = await read(p);
      assert.deepEqual(retried.active.checkpoint.game, g);
      assert.notEqual(retried.active.runId, terminal.active.runId);
      await fireAndSave(p, 1);
      await p
        .locator('#overlay-card [data-action="new-board"]')
        .waitFor({ state: "visible" });
      await p.locator('#overlay-card [data-action="new-board"]').click();
      await ready(p);
      const fresh = (await read(p)).active.checkpoint.game;
      assert.deepEqual(fresh.config, g.config);
      assert.notEqual(fresh.seed, g.seed);
      assert.notDeepEqual(fresh.board, g.board);
      await c.close();
      return {
        retryLabel,
        newLabel,
        exactInitialStateAndQueue: true,
        newSeedAndBoard: true,
        profile: g.config.profile,
        difficulty: g.config.difficulty,
      };
    },
  );
  await check(
    "Completed scored Classic goes Home and starts again without abandonment",
    async () => {
      const c = await context(),
        p = await start(c);
      const g = board((await read(p)).active.checkpoint.game.config, "clear");
      await install(p, g);
      await fireAndSave(p, 1);
      await p
        .locator('#overlay-card [data-action="retry"]')
        .waitFor({ state: "visible" });
      const before = await read(p);
      assert(before.active.checkpoint.game.score > 0);
      await home(p);
      await noReplacementPrompt(p, before.active.runId);
      await c.close();
      return {
        completedScore: before.active.checkpoint.game.score,
        noAbandonPrompt: true,
      };
    },
  );
  await check(
    "Stale cached Home cannot silently replace another tab's scored attempt",
    async () => {
      const c = await context(),
        b = await c.newPage();
      await b.goto(base!); // Cache an empty Home before the other tab starts.
      const a = await start(c);
      const g = board(
        (await read(a)).active.checkpoint.game.config,
        "positive",
      );
      await install(a, g);
      await fireAndSave(a, 1);
      await ready(a);
      const before = await read(a);
      await b.bringToFront();
      await b.locator('[data-action="play"]').click();
      await b.locator("#confirm").waitFor({ state: "visible" });
      const guarded = await read(b);
      assert.equal(guarded.active.runId, before.active.runId);
      assert.equal(guarded.generation, before.generation);
      await b.locator('#dialog-foot [data-action="close-dialog"]').click();
      assert.deepEqual(
        (await read(b)).active.checkpoint.game,
        before.active.checkpoint.game,
      );
      await b.locator('[data-action="play"]').click();
      await b.locator("#confirm").click();
      await ready(b);
      assert.notEqual((await read(b)).active.runId, before.active.runId);
      await c.close();
      return {
        actualScoringShot: true,
        score: before.active.checkpoint.game.score,
        atomicConflictGuard: true,
        explicitReplacementWorks: true,
      };
    },
  );
  await check(
    "Puzzle beyond its bonus goal still earns exact clear awards and advances; UI explains the goal",
    async () => {
      const c = await context(),
        p = await start(c);
      const g = board((await read(p)).active.checkpoint.game.config, "clear");
      g.shots = g.config.target + 2;
      assert(validateState(g));
      const progress = createProgress("puzzles", "standard", 0);
      await install(p, g, progress);
      const expected = resolveShot(g, 90);
      assert(!expected.error);
      assert.equal(expected.award.efficiency, 100);
      await fireAndSave(p, g.shots + 1);
      const next = p.locator('#overlay-card [data-action="next-board"]');
      await next.waitFor({ state: "visible" });
      const details = await p.locator("#overlay-card").innerText();
      assert.match(details, /bonus goal/i);
      assert.match(details, /over|beyond|missed/i);
      assert.match(details, /clear|unlocked|advance|next/i);
      const before = await read(p);
      assert.equal(before.active.checkpoint.game.score, expected.state.score);
      assert.equal(before.active.checkpoint.lastAward.efficiency, 100);
      assert.equal(before.puzzleProgress.standard, 1);
      assert.equal(before.active.status, "active");
      assert.equal(before.receipts[before.active.runId], undefined);
      await next.click();
      await ready(p);
      const after = await read(p);
      assert.equal(after.active.checkpoint.progress.puzzleIndex, 1);
      assert.equal(after.active.checkpoint.game.shots, 0);
      assert.equal(after.active.checkpoint.game.score, expected.state.score);
      await c.close();
      return {
        shots: g.shots + 1,
        bonusGoal: g.config.target,
        exactEfficiency: 100,
        clearBasedUnlock: true,
        carriedScore: expected.state.score,
        explanation: details,
      };
    },
  );
  assert.deepEqual(errors, []);
  assert(
    checks.every((c) => c.passed),
    "One or more attempt-flow checks failed",
  );
  assert.equal(
    sourceDigest().digest,
    startSource,
    "Source changed during checks",
  );
  assert.equal(await htmlHash(), startHTML, "Candidate changed during checks");
  verified = true;
} finally {
  const report = {
    at: new Date().toISOString(),
    url: base,
    browser: browser.version(),
    sourceDigest: startSource,
    htmlSHA256: startHTML,
    boundary:
      "Installed headless desktop Chrome, fresh isolated origins. Durable checkpoints use validated small fixtures; scoring, no-match, clearing and puzzle advancement are actual UI-fired shots with exact core-award comparison. The beyond-goal case sets a valid pre-shot counter to isolate goal semantics; it is not a naturally played full Puzzle campaign. Checks cover the named replacement/Retry/random/goal flows, not human fun or physical-device usability.",
    passed:
      verified &&
      checks.length === 7 &&
      checks.every((c) => c.passed) &&
      errors.length === 0,
    checks,
    errors,
  };
  fs.writeFileSync(
    "review/attempt-flow-chrome.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser.close();
}
