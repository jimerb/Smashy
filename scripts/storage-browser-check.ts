import { chromium, type BrowserContext, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lessonGame } from "../src/content/lessons";
import { createGame, resolveShot, validateState } from "../src/core";

const base = process.env.SMASHY_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const pageErrors: string[] = [];
const checks: {
  name: string;
  passed: boolean;
  evidence?: unknown;
  error?: string;
}[] = [];
const contexts: BrowserContext[] = [];
fs.mkdirSync("review", { recursive: true });
fs.mkdirSync(".local", { recursive: true });

async function newContext(denyStorage = false) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  contexts.push(context);
  if (denyStorage)
    await context.addInitScript({
      content:
        "Object.defineProperty(window, 'indexedDB', { configurable: true, get: function () { return undefined; } });",
    });
  context.on("page", (page) => {
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(10000);
    page.on("pageerror", (e) => pageErrors.push(e.message));
  });
  return context;
}
async function envelope(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("smashy-personal-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = database.transaction("state", "readonly");
        const get = tx.objectStore("state").get("envelope");
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
    } finally {
      database.close();
    }
  });
}
async function waitDurableShots(page: Page, shots: number) {
  await page.waitForFunction(async (expected) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction("state", "readonly"),
          r = tx.objectStore("state").get("envelope");
        r.onsuccess = () =>
          resolve(r.result?.active?.checkpoint?.game?.shots === expected);
      });
    } finally {
      db.close();
    }
  }, shots);
}
async function waitReady(page: Page) {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function resumePaused(page: Page) {
  await page.bringToFront();
  await page.locator("#game").waitFor({ state: "visible" });
  const resume = page.getByRole("button", { name: "Resume", exact: true });
  await resume.click();
  await waitReady(page);
}
async function shoot(page: Page) {
  await page.locator("#input").press("Space");
}
async function check(name: string, run: () => Promise<unknown>) {
  try {
    const evidence = await run();
    checks.push({ name, passed: true, evidence });
    console.log(`PASS ${name}`);
  } catch (error) {
    const snapshots = [];
    for (const context of contexts)
      for (const page of context.pages()) {
        snapshots.push(
          await page
            .evaluate(() => ({
              title: document.title,
              shots: document.querySelector("#shots")?.textContent,
              overlay: document.querySelector("#overlay-card")?.textContent,
              dialog: document.querySelector("#dialog-title")?.textContent,
              notice: document.querySelector("#storage-note")?.textContent,
            }))
            .catch(() => null),
        );
      }
    checks.push({
      name,
      passed: false,
      evidence: snapshots,
      error: error instanceof Error ? error.stack : String(error),
    });
    console.log(`FAIL ${name}: ${String(error)}`);
  }
}

try {
  await check(
    "Fresh cross-tab new-run conflict protects the latest scored checkpoint",
    async () => {
      const context = await newContext();
      const a = await context.newPage(),
        b = await context.newPage();
      await a.goto(base);
      await b.goto(base);
      // Both Home screens cached an empty origin before A starts its attempt.
      await a.bringToFront();
      await a.getByRole("button", { name: "Play Classic" }).click();
      await waitReady(a);
      // Explicit valid scored-checkpoint fixture: B's Home remains cached empty.
      // The resolved match leaves a separate ceiling pair, so play is not over.
      const config = (await envelope(a)).active.checkpoint.game.config;
      const col = Math.floor(config.columns / 2);
      const initial = createGame({
        config,
        seed: 2424,
        board: [
          { row: 0, col, type: 0 },
          { row: 0, col: col + 1, type: 0 },
          { row: 0, col: 0, type: 1 },
          { row: 0, col: 1, type: 1 },
        ],
        current: 0,
        next: 0,
      });
      const resolved = resolveShot(initial, 90);
      assert(!resolved.error && validateState(resolved.state));
      assert.equal(resolved.state.status, "ready");
      assert(resolved.state.score > 0);
      await a.evaluate(
        async ({ initial, game }) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open("smashy-personal-v1");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          try {
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction("state", "readwrite"),
                os = tx.objectStore("state"),
                r = os.get("envelope");
              r.onsuccess = () => {
                const e = r.result;
                Object.assign(e.active.checkpoint, {
                  initial,
                  game,
                  undo: null,
                  replay: null,
                  lastAward: null,
                });
                os.put(e, "envelope");
              };
              tx.oncomplete = () => resolve();
              tx.onabort = () => reject(tx.error);
            });
          } finally {
            db.close();
          }
        },
        { initial, game: resolved.state },
      );
      const before = await envelope(a);
      await b.bringToFront();
      await b.getByRole("button", { name: "Play Classic" }).click();
      await b
        .getByRole("heading", { name: "Start a new board?", exact: true })
        .waitFor();
      const unchanged = await envelope(b);
      assert.equal(unchanged.active.runId, before.active.runId);
      assert.equal(unchanged.generation, before.generation);
      await b.getByRole("button", { name: "Keep board", exact: true }).click();
      assert.equal(await b.locator("#home").isVisible(), true);
      await context.close();
      return {
        previousRunPreserved: true,
        ownershipUnchanged: true,
        replacementRequiredConfirmation: true,
        fixture:
          "Validated resolved-match checkpoint injected through IndexedDB; B's Home cached no run. No owner profile or naturally earned score claim.",
      };
    },
  );

  await check(
    "Stale tab Resume adopts freshest stable checkpoint instead of rolling it back",
    async () => {
      const context = await newContext();
      const a = await context.newPage();
      await a.goto(base);
      await a.getByRole("button", { name: "Play Classic" }).click();
      await waitReady(a);
      const original = await envelope(a);
      const b = await context.newPage();
      await b.goto(base);
      await b
        .getByRole("button", { name: "Resume saved board", exact: true })
        .click();
      await resumePaused(b);
      await shoot(b);
      await b.waitForFunction(
        () => document.querySelector("#shots")?.textContent === "1",
      );
      await waitReady(b);
      await waitDurableShots(b, 1);
      const freshest = await envelope(b);
      assert.equal(freshest.active.runId, original.active.runId);
      assert.notEqual(freshest.active.ownerId, original.active.ownerId);
      await a.bringToFront();
      // This attempted old-owner save detects the lost lease; it must not mutate B's state.
      await a.locator("#guide-button").click();
      await a
        .getByRole("heading", { name: "Board active elsewhere", exact: true })
        .waitFor();
      const rejected = await envelope(a);
      assert.deepEqual(rejected.active.checkpoint, freshest.active.checkpoint);
      await a.getByRole("button", { name: "Resume here", exact: true }).click();
      await waitReady(a);
      assert.equal(await a.locator("#shots").innerText(), "1");
      assert.equal(
        await a.locator("#score").innerText(),
        freshest.active.checkpoint.game.score.toLocaleString(),
      );
      assert.equal(
        await a.locator("#guide-button").innerText(),
        freshest.active.checkpoint.guide ? "Guide on" : "Guide off",
      );
      assert.equal(
        await a.locator("#assist-label").isVisible(),
        freshest.active.checkpoint.game.assisted,
      );
      const adopted = await envelope(a);
      assert.deepEqual(adopted.active.checkpoint, freshest.active.checkpoint);
      assert.equal(adopted.active.ownerId, original.active.ownerId);
      assert(adopted.generation > freshest.generation);
      // A subsequent real shot must continue from the adopted boundary.
      await shoot(a);
      await a.waitForFunction(
        () => document.querySelector("#shots")?.textContent === "2",
      );
      await waitDurableShots(a, 2);
      await context.close();
      return {
        oldShots: 0,
        adoptedShots: 1,
        nextDurableShots: 2,
        rejectedOldWrite: true,
        adoptedSavedAssistance: true,
      };
    },
  );

  await check(
    "Home guide changes future settings without mutating the saved attempt",
    async () => {
      const context = await newContext(),
        page = await context.newPage();
      await page.goto(base);
      await page.getByRole("button", { name: "Play Classic" }).click();
      await waitReady(page);
      await shoot(page);
      await page.waitForFunction(
        () => document.querySelector("#shots")?.textContent === "1",
      );
      await waitDurableShots(page, 1);
      const scored = (await envelope(page)).active.checkpoint.game.score > 0;
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Home", exact: true }).click();
      if (scored)
        await page
          .getByRole("button", { name: "Save and go Home", exact: true })
          .click();
      await page.locator("#home").waitFor({ state: "visible" });
      const before = await envelope(page);
      await page.locator("#home [data-action=settings]").first().click();
      await page.locator("#setting-guide").check();
      await page.getByRole("button", { name: "Done", exact: true }).click();
      assert(
        (await page.locator("#home-best").innerText()).includes("Assisted"),
      );
      await page.locator("#profile").selectOption("compact");
      await page
        .getByRole("button", { name: "Personal bests", exact: true })
        .click();
      assert(
        (await page.locator(".record-category").innerText()).includes(
          "Classic · Standard difficulty · Compact layout · Assisted",
        ),
      );
      const after = await envelope(page);
      assert.deepEqual(after, before);
      await context.close();
      return {
        savedEnvelopeUnchanged: true,
        selectedHomeCategory:
          "Classic / Standard difficulty / Compact layout / Assisted",
      };
    },
  );

  await check(
    "Terminal guide toggle preserves saved category, receipt and ownership",
    async () => {
      const context = await newContext(),
        page = await context.newPage();
      await page.goto(base);
      await page.getByRole("button", { name: "Play Classic" }).click();
      await waitReady(page);
      const fixture = lessonGame(0, "standard");
      fixture.assisted = false;
      await page.evaluate(async (state) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open("smashy-personal-v1");
          r.onsuccess = () => resolve(r.result);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("state", "readwrite"),
              os = tx.objectStore("state"),
              get = os.get("envelope");
            get.onsuccess = () => {
              const e = get.result,
                cp = e.active.checkpoint;
              cp.game = state;
              cp.replay = null;
              cp.initial = structuredClone(state);
              cp.undo = null;
              cp.lesson = null;
              cp.angle = 90;
              cp.guide = false;
              cp.lastAward = null;
              os.put(e, "envelope");
            };
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      }, fixture);
      await page.reload();
      await page
        .getByRole("button", { name: "Resume saved board", exact: true })
        .click();
      await resumePaused(page);
      await shoot(page);
      await page.waitForFunction(
        () =>
          document.querySelector(".result-badge")?.textContent ===
          "New personal best",
      );
      const before = await envelope(page);
      assert.equal(before.active.status, "terminal");
      assert.equal(Object.values(before.tables).flat().length, 1);
      await page.locator("#guide-button").click();
      assert(
        (await page.locator("#run-label").innerText()).includes("Unassisted"),
      );
      assert.equal(
        await page
          .getByRole("heading", { name: "Beautifully smashed.", exact: true })
          .isVisible(),
        true,
      );
      // Refresh through the actual Records path also drains pending persistence work.
      await page
        .getByRole("button", { name: "Personal bests", exact: true })
        .click();
      await page.locator(".score-table").waitFor({ state: "visible" });
      assert.equal(await page.locator(".score-table tbody tr").count(), 1);
      assert(
        (await page.locator(".record-category").innerText()).includes(
          "Unassisted",
        ),
      );
      await page.getByRole("button", { name: "Done", exact: true }).click();
      assert.equal(
        await page
          .getByRole("heading", { name: "Board active elsewhere", exact: true })
          .count(),
        0,
      );
      assert.deepEqual(await envelope(page), before);
      await context.close();
      return {
        fixture:
          "Original one-match teaching board under Classic terminal integration category",
        recordCount: 1,
        savedEnvelopeUnchanged: true,
        noStaleOwner: true,
      };
    },
  );

  await check(
    "Unavailable IndexedDB keeps actual shots and terminal teaching results playable with an unsaved notice",
    async () => {
      const context = await newContext(true),
        page = await context.newPage();
      await page.goto(base);
      assert.equal(await page.evaluate(() => typeof indexedDB), "undefined");
      await page.getByRole("button", { name: "Play Classic" }).click();
      await waitReady(page);
      await shoot(page);
      await page.waitForFunction(
        () => document.querySelector("#shots")?.textContent === "1",
      );
      await waitReady(page);
      assert(
        (await page.locator("#storage-note").innerText()).includes(
          "Scores aren't being saved",
        ),
      );
      const scored =
        Number((await page.locator("#score").innerText()).replaceAll(",", "")) >
        0;
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await page.getByRole("button", { name: "Home", exact: true }).click();
      if (scored)
        await page
          .getByRole("button", { name: "Save and go Home", exact: true })
          .click();
      await page.locator("#home").waitFor({ state: "visible" });
      await page
        .getByRole("button", { name: "Learn by smashing", exact: true })
        .click();
      await page.locator('[data-lesson="0"]').click();
      if (scored)
        await page
          .getByRole("button", { name: "Replace saved game", exact: true })
          .click();
      await waitReady(page);
      await shoot(page);
      await page
        .getByRole("heading", { name: "Beautifully smashed.", exact: true })
        .waitFor();
      assert.equal(await page.locator("#shots").innerText(), "1");
      assert.equal(
        (await page.locator("#score").innerText()).replaceAll(",", ""),
        "15910",
      );
      assert(
        (await page.locator("#storage-note").innerText()).includes(
          "Scores aren't being saved",
        ),
      );
      await page
        .getByRole("button", { name: "Personal bests", exact: true })
        .click();
      assert(
        (await page.locator("#dialog-body").innerText()).includes(
          "Scores aren't being saved",
        ),
      );
      assert.equal(await page.locator(".score-table").count(), 0);
      await page.screenshot({ path: ".local/storage-denied-chrome.png" });
      await context.close();
      return {
        indexedDB: "unavailable via browser init script",
        classicShotResolved: true,
        teachingClearScore: 15910,
        honestUnsavedNotice: true,
        noInventedRecords: true,
      };
    },
  );
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  const report = {
    at: new Date().toISOString(),
    browser: browser.version(),
    url: base,
    boundary:
      "Actual installed desktop Chrome, headless, isolated browser contexts. Real app DOM/keyboard, IndexedDB, two-tab ownership, guide and memory-fallback integration. One original authored terminal fixture is written through IndexedDB; no application source hooks. Not human fun, physical-device usability, cross-browser or crash-power-loss evidence.",
    checks,
    pageErrors,
    passed: checks.every((c) => c.passed) && pageErrors.length === 0,
  };
  fs.writeFileSync(
    "review/storage-browser-chrome.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: report.passed,
      checks: checks.length,
      pageErrors,
    }),
  );
  await browser.close();
}
if (checks.some((c) => !c.passed) || pageErrors.length) process.exitCode = 1;
