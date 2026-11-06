import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createGame, resolveShot, validateState } from "../src/core";

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
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
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
async function ready(page: Page) {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function waitStage(
  page: Page,
  mode: "puzzles" | "journey",
  stage: number,
) {
  await page.waitForFunction(
    async ({ mode, stage }) => {
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
                cp.game.status === "ready" &&
                (mode === "puzzles"
                  ? cp.progress.puzzleIndex
                  : cp.progress.journeyStage) === stage,
            );
          };
        });
      } finally {
        db.close();
      }
    },
    { mode, stage },
  );
}

try {
  for (const mode of ["puzzles", "journey"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on("pageerror", (error) => pageErrors.push(error.message));
    try {
      await page.goto(base);
      await page.locator(`[data-mode="${mode}"]`).click();
      if (mode === "puzzles") await page.locator('[data-puzzle="0"]').click();
      else await page.locator("#difficulty").selectOption("gentle");
      await page
        .getByRole("button", {
          name: mode === "puzzles" ? "New Puzzles game" : "New Journey game",
        })
        .click();
      await ready(page);
      const original = await read(page),
        originalCheckpoint = structuredClone(original.active.checkpoint);
      assert.equal(originalCheckpoint.game.score, 0);
      assert.equal(originalCheckpoint.game.shots, 0);
      if (mode === "journey") {
        const col = Math.floor(originalCheckpoint.game.config.columns / 2);
        const tiny = createGame({
          config: originalCheckpoint.game.config,
          seed: 2424,
          board: [
            { row: 0, col, type: 0 },
            { row: 0, col: col + 1, type: 0 },
          ],
          current: 0,
          next: 0,
        });
        assert.equal(validateState(tiny), true);
        assert.equal(resolveShot(tiny, 90).state.status, "cleared");
        // Keep the original campaign's initial board/progression; replace only
        // the current board so the real UI can clear it in one accepted shot.
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
                const e = r.result,
                  cp = e.active.checkpoint;
                cp.game = game;
                cp.undo = null;
                cp.angle = 90;
                cp.lastAward = null;
                cp.replay = null;
                os.put(e, "envelope");
              };
              tx.oncomplete = () => resolve();
              tx.onabort = () => reject(tx.error);
            });
          } finally {
            db.close();
          }
        }, tiny);
        await page.reload();
        await page
          .locator('[data-action="resume-saved"]')
          .click();
        await page.locator("#game").waitFor({ state: "visible" });
        await page.getByRole("button", { name: "Resume", exact: true }).click();
        await ready(page);
      }
      await page.locator("#input").focus();
      await page.keyboard.press("Space");
      const next = page.getByRole("button", {
        name: mode === "puzzles" ? "Next puzzle" : "Next board",
        exact: true,
      });
      await next.waitFor({ state: "visible" });
      await next.click();
      await ready(page);
      await waitStage(page, mode, 1);
      const advanced = await read(page);
      assert(advanced.active.checkpoint.game.score > 0);
      assert.equal(advanced.active.runId, original.active.runId);
      assert.equal(Object.values(advanced.tables).flat().length, 0);
      assert.equal(advanced.receipts[original.active.runId], undefined);
      assert.deepEqual(
        advanced.active.checkpoint.initial,
        originalCheckpoint.initial,
      );
      assert.deepEqual(
        advanced.active.checkpoint.initialProgress,
        originalCheckpoint.initialProgress,
      );
      if (mode === "puzzles")
        assert.deepEqual(advanced.puzzleProgress, { standard: 1, compact: 0 });

      await page.getByRole("button", { name: "Pause", exact: true }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "Restart this board", exact: true })
          .count(),
        0,
      );
      const restart = page.getByRole("button", {
        name: "Restart this run",
        exact: true,
      });
      await restart.click();
      await page
        .getByRole("heading", { name: "Restart this attempt?", exact: true })
        .waitFor();
      assert(
        (await page.locator("#dialog-body").innerText()).includes(
          "original layout and toy order from the beginning of this run",
        ),
      );
      // Cancellation is also reversible and must not create a replacement ID.
      await page
        .getByRole("button", { name: "Keep board", exact: true })
        .click();
      assert.equal((await read(page)).active.runId, original.active.runId);
      await restart.click();
      await page
        .getByRole("button", { name: "Restart attempt", exact: true })
        .click();
      await ready(page);
      await waitStage(page, mode, 0);
      const restarted = await read(page),
        cp = restarted.active.checkpoint;
      assert.notEqual(restarted.active.runId, original.active.runId);
      assert.equal(restarted.active.status, "active");
      assert.deepEqual(cp.game, originalCheckpoint.initial);
      assert.deepEqual(cp.initial, originalCheckpoint.initial);
      assert.deepEqual(cp.progress, originalCheckpoint.initialProgress);
      assert.deepEqual(cp.initialProgress, originalCheckpoint.initialProgress);
      assert.equal(cp.game.score, 0);
      assert.equal(cp.game.shots, 0);
      assert.equal(cp.game.danger, 0);
      assert.equal(cp.game.rng, originalCheckpoint.game.rng);
      assert.equal(cp.game.current, originalCheckpoint.game.current);
      assert.equal(cp.game.next, originalCheckpoint.game.next);
      assert.equal(cp.undo, null);
      assert.deepEqual(cp.replay.start, originalCheckpoint.initial);
      assert.deepEqual(cp.replay.events, []);
      assert.equal(cp.replay.truncated, false);
      assert.equal(Object.values(restarted.tables).flat().length, 0);
      assert.equal(Object.keys(restarted.receipts).length, 0);
      assert.deepEqual(restarted.puzzleProgress, advanced.puzzleProgress);
      await page.screenshot({ path: `.local/${mode}-campaign-restarted.png` });
      checks.push({
        mode,
        passed: true,
        evidence: {
          advancedToSecondBoard: true,
          restartLabel: "Restart this run",
          confirmationRequired: true,
          cancellationPreservedAttempt: true,
          replacementRunIdChanged: true,
          exactOriginalBoardRngQueueRestored: true,
          originalStartProgressRestored: true,
          score: cp.game.score,
          shots: cp.game.shots,
          receipts: 0,
          records: 0,
          freshReplay: true,
          retainedPuzzleProgress: restarted.puzzleProgress,
          fixture:
            mode === "journey"
              ? "Validated pair-clear current board; original initial and progression preserved; actual keyboard-fired clear"
              : "No fixture: actual first puzzle clear",
        },
      });
      console.log(
        `PASS ${mode} advanced campaign restarts exact original run without finalizing abandonment`,
      );
    } catch (error) {
      await page
        .screenshot({ path: `.local/${mode}-campaign-restart-failure.png` })
        .catch(() => {});
      checks.push({
        mode,
        passed: false,
        error: error instanceof Error ? error.stack : String(error),
        evidence: {
          overlay: await page
            .locator("#overlay-card")
            .innerText()
            .catch(() => ""),
          dialog: await page
            .locator("#dialog-body")
            .innerText()
            .catch(() => ""),
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
      "Installed headless desktop Chrome against production output, fresh isolated profile for each mode. Actual first Puzzle clear; Journey uses a validated pair-clear current-board fixture preserving original initial board/progress, followed by a real keyboard-fired shot. Verifies restart state and persistence, not human fun or naturally completed random Journey boards.",
    checks,
    pageErrors,
    passed: checks.every((check) => check.passed) && pageErrors.length === 0,
  };
  fs.writeFileSync(
    "review/campaign-restart-chrome.json",
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
if (checks.some((check) => !check.passed) || pageErrors.length)
  process.exitCode = 1;
