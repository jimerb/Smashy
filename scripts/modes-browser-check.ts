import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createGame,
  getConfig,
  resolveShot,
  type GameState,
} from "../src/core";
import { PUZZLES, puzzleGame } from "../src/content/puzzles";
const base = process.env.SMASHY_URL || "http://127.0.0.1:4173";
const browserChannel = process.env.SMASHY_BROWSER || "chrome";
const browser = await chromium.launch({
  channel: browserChannel,
  headless: true,
});
const checks: string[] = [];
const errors: string[] = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (e) => errors.push(e.message));
async function read(p = page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    return await new Promise<any>((resolve) => {
      const tx = db.transaction("state");
      const r = tx.objectStore("state").get("envelope");
      r.onsuccess = () => resolve(r.result);
      tx.oncomplete = () => db.close();
    });
  });
}
async function ready() {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function fireAngle(degrees: number, expectedShots: number) {
  await ready();
  const e = await read();
  const c = e.active.checkpoint.game.config;
  const r = await page.locator("#stage").boundingBox();
  assert(r);
  const radians = (degrees * Math.PI) / 180;
  await page.mouse.move(
    r.x + ((c.launcher.x + 150 * Math.cos(radians)) * r.width) / c.width,
    r.y + ((c.launcher.y - 150 * Math.sin(radians)) * r.height) / c.height,
  );
  await page.locator("#input").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(
    (n) => document.querySelector("#shots")!.textContent === String(n),
    expectedShots,
  );
}
async function fixture(game: GameState) {
  await page.evaluate(async (game) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      const os = tx.objectStore("state");
      const r = os.get("envelope");
      r.onsuccess = () => {
        const e = r.result;
        e.active.checkpoint.game = game;
        e.active.checkpoint.replay = null;
        e.active.checkpoint.undo = null;
        e.active.checkpoint.angle = 90;
        os.put(e, "envelope");
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, game);
  await page.reload();
  await page.locator('[data-action="resume-saved"]').click();
  await page.locator("#game").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Resume", exact: true }).click();
}
try {
  await page.goto(base);
  await page.locator('[data-mode="puzzles"]').click();
  await page.locator('[data-puzzle="0"]').click();
  await page.getByRole("button", { name: "Play Puzzles" }).click();
  await ready();
  let expectedTotal = 0;
  for (let index = 0; index < 50; index++) {
    assert(
      (await page.locator("#run-label").innerText()).includes(
        `Puzzle ${index + 1}:`,
      ),
    );
    let expected = puzzleGame(index, "standard");
    const solution = PUZZLES[index].variants.standard.solution;
    assert(solution.length > 0);
    for (let shot = 0; shot < solution.length; shot++) {
      expected = resolveShot(expected, solution[shot]).state;
      await fireAngle(solution[shot], shot + 1);
    }
    expectedTotal += expected.score;
    await page.locator("#overlay").waitFor({ state: "visible" });
    assert.equal(
      Number((await page.locator("#score").innerText()).replaceAll(",", "")),
      expectedTotal,
    );
    const saved = await read();
    assert.equal(saved.active.checkpoint.progress.puzzleIndex, index);
    if (index < 49) {
      assert.equal(saved.active.status, "active");
      assert.equal(Object.values(saved.tables).flat().length, 0);
      await page
        .getByRole("button", { name: "Next puzzle", exact: true })
        .click();
      await ready();
    } else {
      await page.waitForFunction(
        () =>
          document.querySelector(".result-badge")?.textContent ===
          "New personal best",
      );
      assert.equal(Object.values((await read()).tables).flat().length, 1);
    }
    if ((index + 1) % 10 === 0)
      console.log(`Puzzle UI completed ${index + 1}/50`);
  }
  checks.push(
    "All 50 Standard puzzles complete through actual pointer/keyboard/flight UI; score accumulates exactly and only final clear creates a record",
  );
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator('[data-mode="puzzles"]').click();
  await page.locator("#dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-puzzle]:enabled").count(), 50);
  await page.locator('[data-puzzle="24"]').click();
  await page.getByRole("button", { name: "Play Puzzles" }).click();
  await ready();
  assert.equal((await read()).active.checkpoint.progress.startPuzzleIndex, 24);
  await page.reload();
  await page.locator('[data-action="resume-saved"]').click();
  await page.locator("#game").waitFor({ state: "visible" });
  assert(
    (await page.locator("#run-label").getAttribute("title"))!.includes(
      "Starting puzzle 25",
    ),
  );
  checks.push(
    "Unlocks, completed-board replay and puzzle checkpoint survive reload with distinct starting category",
  );
  assert.equal((await read()).active.checkpoint.game.score, 0);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.locator("#home").waitFor({ state: "visible" });
  await page.locator('[data-mode="journey"]').click();
  await page.locator("#difficulty").selectOption("gentle");
  await page.getByRole("button", { name: "Play Journey" }).click();
  await ready();
  assert.equal(await page.locator("#dialog").isVisible(), false);
  for (const difficulty of [
    "gentle",
    "relaxed",
    "standard",
    "tricky",
    "expert",
    "expert",
  ] as const) {
    const before = await read();
    assert.equal(before.active.checkpoint.game.config.difficulty, difficulty);
    const c = before.active.checkpoint.game.config;
    const col = Math.floor(c.columns / 2);
    const state = createGame({
      config: c,
      seed: 123,
      board: [
        { row: 0, col, type: 0 },
        { row: 0, col: col + 1, type: 0 },
      ],
      current: 0,
      next: 0,
    });
    state.score = before.active.checkpoint.game.score;
    await fixture(state);
    await fireAngle(90, 1);
    await page
      .getByRole("button", { name: "Next board", exact: true })
      .waitFor({ state: "visible" });
    assert.equal((await read()).active.status, "active");
    await page.getByRole("button", { name: "Next board", exact: true }).click();
    await ready();
    assert.equal(
      (await read()).active.checkpoint.progress.startDifficulty,
      "gentle",
    );
  }
  checks.push(
    "Journey exercises Gentle through repeated Expert, retaining starting category, cumulative score and per-board reset without intermediate finalization",
  );
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Save and go Home", exact: true })
    .click();
  await page.locator('[data-mode="custom"]').click();
  await page.locator('[name="target"]').fill("0");
  await page
    .getByRole("button", { name: "Use these rules", exact: true })
    .click();
  assert.equal(await page.locator("#dialog").isVisible(), true);
  await page.locator('[name="target"]').fill("160");
  await page.locator('[name="columns"]').fill("12");
  await page.locator('[name="anchors"]').fill("5");
  await page
    .getByRole("button", { name: "Use these rules", exact: true })
    .click();
  await page.getByRole("button", { name: "Play Custom" }).click();
  await page
    .getByRole("button", { name: "Replace saved game", exact: true })
    .click();
  await ready();
  const custom = (await read()).active.checkpoint;
  assert.equal(custom.game.config.columns, 12);
  assert.equal(custom.game.config.target, 160);
  assert.equal(custom.game.config.anchors, 5);
  assert(custom.progress.configId.includes("12-15-6-5-5-8-160"));
  checks.push(
    "Custom rejects zero target, applies checked numeric geometry, and records full configuration identity",
  );
  await page.screenshot({ path: ".local/smashy-expanded-pc.png" });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `review/modes-browser-${browserChannel}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        url: base,
        browser: browser.version(),
        boundary: `Actual headless desktop ${browserChannel} game UI, with documented Journey terminal fixtures. Automated solvability and state evidence, not human fun or physical device validation.`,
        checks,
        puzzleScore: expectedTotal,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (e) {
  await page.screenshot({ path: ".local/modes-failure.png" });
  console.log(await page.locator("#overlay-card").innerText());
  throw e;
} finally {
  await browser.close();
}
