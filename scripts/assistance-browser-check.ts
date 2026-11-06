import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createGame,
  resolveShot,
  validateState,
  type GameState,
} from "../src/core";

const base = process.env.SMASHY_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks: {
  mode: string;
  passed: boolean;
  evidence?: unknown;
  error?: string;
}[] = [];
const pageErrors: string[] = [];
fs.mkdirSync("review", { recursive: true });
fs.mkdirSync(".local", { recursive: true });

async function read(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("smashy-personal-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction("state", "readonly"),
          r = tx.objectStore("state").get("envelope");
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function waitCheckpoint(
  page: Page,
  expected: {
    assisted?: boolean;
    guide?: boolean;
    status?: string;
    index?: number;
  },
) {
  await page.waitForFunction(async (expected) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise<boolean>((resolve) => {
        const tx = db.transaction("state", "readonly"),
          r = tx.objectStore("state").get("envelope");
        r.onsuccess = () => {
          const cp = r.result?.active?.checkpoint;
          resolve(
            !!cp &&
              (expected.assisted === undefined ||
                cp.game.assisted === expected.assisted) &&
              (expected.guide === undefined || cp.guide === expected.guide) &&
              (expected.status === undefined ||
                cp.game.status === expected.status) &&
              (expected.index === undefined ||
                cp.progress.puzzleIndex === expected.index),
          );
        };
      });
    } finally {
      db.close();
    }
  }, expected);
}
async function ready(page: Page) {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function shoot(page: Page) {
  await ready(page);
  await page.locator("#input").focus();
  await page.keyboard.press("Space");
}
async function resumeSaved(page: Page, continuingClear = false) {
  await page.reload();
  await page
    .getByRole("button", { name: "Resume saved board", exact: true })
    .click();
  await page.locator("#game").waitFor({ state: "visible" });
  if (!continuingClear) {
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await ready(page);
  }
}
async function fixture(page: Page, game: GameState) {
  assert.equal(
    validateState(game),
    true,
    "Browser fixture must pass the production state validator",
  );
  await page.evaluate(async (game) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("state", "readwrite"),
          os = tx.objectStore("state"),
          r = os.get("envelope");
        r.onsuccess = () => {
          const envelope = r.result,
            cp = envelope.active.checkpoint;
          cp.game = game;
          cp.replay = null;
          cp.undo = null;
          cp.angle = 90;
          cp.lastAward = null;
          os.put(envelope, "envelope");
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, game);
  await resumeSaved(page);
}

try {
  for (const mode of ["puzzles", "journey"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (e) => pageErrors.push(e.message));
    try {
      await page.goto(base);
      await page.locator(`[data-mode="${mode}"]`).click();
      if (mode === "puzzles") await page.locator('[data-puzzle="0"]').click();
      else await page.locator("#difficulty").selectOption("gentle");
      await page
        .getByRole("button", {
          name: mode === "puzzles" ? "Play Puzzles" : "Play Journey",
        })
        .click();
      await ready(page);
      const original = await read(page);
      const originalProgress = structuredClone(
        original.active.checkpoint.progress,
      );
      assert.equal(original.active.checkpoint.game.assisted, false);
      if (mode === "journey") {
        const cp = original.active.checkpoint,
          col = Math.floor(cp.game.config.columns / 2);
        const tiny = createGame({
          config: cp.game.config,
          seed: 1337,
          board: [
            { row: 0, col, type: 0 },
            { row: 0, col: col + 1, type: 0 },
          ],
          current: 0,
          next: 0,
        });
        tiny.score = cp.game.score;
        assert.equal(resolveShot(tiny, 90).state.status, "cleared");
        await fixture(page, tiny);
      }
      await shoot(page);
      const nextName = mode === "puzzles" ? "Next puzzle" : "Next board";
      await page
        .getByRole("button", { name: nextName, exact: true })
        .waitFor({ state: "visible" });
      await waitCheckpoint(page, { status: "cleared", assisted: false });
      const firstClear = await read(page);
      assert.equal(firstClear.active.status, "active");
      assert.equal(Object.values(firstClear.tables).flat().length, 0);
      if (mode === "puzzles")
        assert.deepEqual(firstClear.puzzleProgress, {
          standard: 1,
          compact: 0,
        });

      // The important regression: a board is cleared, but this run is continuing.
      await page.locator("#guide-button").click();
      await waitCheckpoint(page, {
        status: "cleared",
        assisted: true,
        guide: true,
      });
      const guideMarked = await read(page);
      assert.equal(guideMarked.active.runId, original.active.runId);
      assert.equal(
        guideMarked.active.checkpoint.game.score,
        firstClear.active.checkpoint.game.score,
      );
      assert.equal(await page.locator("#assist-label").isVisible(), true);
      assert(
        (await page.locator("#run-label").innerText()).includes("Assisted"),
      );

      await resumeSaved(page, true);
      await page
        .getByRole("button", { name: nextName, exact: true })
        .waitFor({ state: "visible" });
      assert.equal(await page.locator("#guide-button").innerText(), "Guide on");
      assert.equal(await page.locator("#assist-label").isVisible(), true);
      await page.locator("#guide-button").click();
      await waitCheckpoint(page, {
        status: "cleared",
        assisted: true,
        guide: false,
      });
      await page.getByRole("button", { name: nextName, exact: true }).click();
      await ready(page);
      await waitCheckpoint(page, {
        status: "ready",
        assisted: true,
        guide: false,
        ...(mode === "puzzles" ? { index: 1 } : {}),
      });
      const advanced = await read(page),
        cp = advanced.active.checkpoint;
      assert.equal(cp.game.score, firstClear.active.checkpoint.game.score);
      assert.equal(cp.game.shots, 0);
      assert.equal(cp.progress.configId, originalProgress.configId);
      assert.equal(
        cp.progress.startDifficulty,
        originalProgress.startDifficulty,
      );
      assert.equal(
        cp.progress.startPuzzleIndex,
        originalProgress.startPuzzleIndex,
      );
      assert.equal(
        await page.locator("#guide-button").innerText(),
        "Guide off",
      );
      assert.equal(await page.locator("#assist-label").isVisible(), true);

      // A valid, ceiling-supported near-loss board lets a real shot end the run.
      // The fixture changes only current board state; initial/start metadata is retained.
      const col = Math.floor(cp.game.config.columns / 2);
      const nearLoss = createGame({
        config: cp.game.config,
        seed: 7331,
        assisted: cp.game.assisted,
        board: [
          { row: 0, col, type: 0 },
          { row: 0, col: col + 1, type: 1 },
        ],
        current: 2,
        next: 1,
      });
      nearLoss.score = cp.game.score;
      nearLoss.danger = nearLoss.config.dangerThreshold;
      nearLoss.descent = (nearLoss.config.rows - 2) * 42;
      assert.equal(validateState(nearLoss), true);
      const expected = resolveShot(nearLoss, 90);
      assert.equal(expected.state.status, "lost");
      await fixture(page, nearLoss);
      await shoot(page);
      await page
        .getByRole("heading", { name: "Out of room.", exact: true })
        .waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          document.querySelector(".result-badge")?.textContent ===
          "New personal best",
      );
      const ended = await read(page),
        entries = Object.values(ended.tables).flat() as any[];
      assert.equal(ended.active.status, "terminal");
      assert.equal(ended.active.checkpoint.game.status, "lost");
      assert.equal(ended.active.checkpoint.game.score, expected.state.score);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].category.mode, mode);
      assert.equal(entries[0].assisted, true);
      assert.equal(entries[0].category.assisted, true);
      assert.equal(entries[0].category.configId, originalProgress.configId);
      assert.equal(
        entries[0].category.difficulty,
        originalProgress.startDifficulty,
      );
      assert.equal(ended.receipts[ended.active.runId].assisted, true);
      if (mode === "puzzles")
        assert.deepEqual(ended.puzzleProgress, { standard: 1, compact: 0 });
      assert.deepEqual(
        ended.active.checkpoint.initialProgress,
        original.active.checkpoint.initialProgress,
      );
      assert.deepEqual(
        ended.active.checkpoint.initial,
        original.active.checkpoint.initial,
      );
      await page.screenshot({ path: `.local/assisted-${mode}-terminal.png` });
      checks.push({
        mode,
        passed: true,
        evidence: {
          intermediateClearStayedActive: true,
          intermediateRecords: 0,
          guideMarkedContinuingRun: true,
          persistedThroughReload: true,
          guideOffStayedAssisted: true,
          nextBoardStayedAssisted: true,
          actualShotTriggeredLoss: true,
          finalAssistedRecordCount: entries.length,
          finalScore: expected.state.score,
          originalCategory: entries[0].category,
          puzzleProgress: ended.puzzleProgress,
          fixtures:
            mode === "journey"
              ? ["two-piece clear board", "ceiling-supported near-loss board"]
              : ["ceiling-supported near-loss board"],
        },
      });
      console.log(
        `PASS ${mode} continuing-run assistance → reload → next board → actual terminal record`,
      );
    } catch (error) {
      const state = await read(page).catch(() => null);
      await page
        .screenshot({ path: `.local/assisted-${mode}-failure.png` })
        .catch(() => {});
      checks.push({
        mode,
        passed: false,
        error: error instanceof Error ? error.stack : String(error),
        evidence: {
          game: state?.active?.checkpoint?.game,
          progress: state?.active?.checkpoint?.progress,
        },
      });
      console.log(`FAIL ${mode}: ${String(error)}`);
    } finally {
      await context.close();
    }
  }
} finally {
  const report = {
    at: new Date().toISOString(),
    url: base,
    browser: browser.version(),
    boundary:
      "Actual production application in installed headless desktop Chrome. Actual first Puzzle clear; Journey clear and final loss use documented validated IndexedDB board fixtures followed by real keyboard-fired shots. Checks persistence, monotonic assistance and terminal record categories, not human enjoyment, physical mobile input or naturally played Journey difficulty.",
    checks,
    pageErrors,
    passed: checks.every((c) => c.passed) && pageErrors.length === 0,
  };
  fs.writeFileSync(
    "review/assistance-browser-chrome.json",
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
