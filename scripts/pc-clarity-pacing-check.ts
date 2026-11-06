import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createGame,
  getConfig,
  resolveShot,
  type GameState,
  type Cell,
} from "../src/core";
import { createProgress } from "../src/progression";
const url = process.env.SMASHY_URL || "http://127.0.0.1:5180";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors: string[] = [],
  checks: string[] = [],
  timings: unknown[] = [];
async function read(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    return new Promise<any>((resolve) => {
      const t = db.transaction("state"),
        r = t.objectStore("state").get("envelope");
      r.onsuccess = () => resolve(r.result);
      t.oncomplete = () => db.close();
    });
  });
}
async function ready(page: Page) {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function start() {
  const c = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    p = await c.newPage();
  p.setDefaultTimeout(12000);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(url);
  await p.getByRole("button", { name: "Play Classic" }).click();
  await ready(p);
  return { c, p };
}
async function fixture(
  p: Page,
  state: GameState,
  angle = 90,
  finalPuzzle = false,
) {
  await p.evaluate(
    async ({ state, angle, progress }) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("smashy-personal-v1");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction("state", "readwrite"),
          os = t.objectStore("state"),
          r = os.get("envelope");
        r.onsuccess = () => {
          const e = r.result;
          Object.assign(e.active.checkpoint, {
            game: state,
            initial: state,
            undo: null,
            replay: null,
            lastAward: null,
            angle,
            guide: false,
            ...(progress ? { progress, initialProgress: progress } : {}),
          });
          os.put(e, "envelope");
        };
        t.oncomplete = () => resolve();
        t.onabort = () => reject(t.error);
      });
      db.close();
    },
    {
      state,
      angle,
      progress: finalPuzzle ? createProgress("puzzles", "standard", 49) : null,
    },
  );
  await p.reload();
  await p
    .getByRole("button", { name: "Resume saved board", exact: true })
    .click();
  await p.locator("#game").waitFor({ state: "visible" });
  await p.getByRole("button", { name: "Resume", exact: true }).click();
  await ready(p);
}
async function actualShot(p: Page) {
  await p.locator("#input").focus();
  await p.keyboard.press("Space");
}
try {
  for (const roofOnly of [false, true]) {
    const { c, p } = await start();
    const starting = (await read(p)).active.checkpoint.game as GameState;
    const state = roofOnly
      ? createGame({
          config: getConfig(),
          seed: 882,
          board: [
            { row: 0, col: 5, type: 0 },
            { row: 0, col: 6, type: 0 },
          ],
          current: 1,
          next: 2,
        })
      : starting;
    const expected = resolveShot(state, 5);
    assert(!expected.error);
    assert(
      expected.trace.points.length > 6,
      "Long shot must exercise several wall reflections",
    );
    const oldFlightSeconds = expected.trace.distance / 1100;
    await fixture(p, state, 5);
    const started = Date.now();
    await actualShot(p);
    let pausedMs = 0;
    if (roofOnly) {
      await p.waitForTimeout(220);
      await p.getByRole("button", { name: "Pause", exact: true }).click();
      const pauseStart = Date.now();
      await p.waitForTimeout(500);
      assert.equal(await p.locator("#shots").innerText(), "0");
      await p.getByRole("button", { name: "Resume", exact: true }).click();
      pausedMs = Date.now() - pauseStart;
    }
    await p.waitForFunction(
      (n) => document.querySelector("#shots")!.textContent === String(n),
      state.shots + 1,
    );
    const elapsedMs = Date.now() - started - pausedMs;
    await ready(p);
    await p.waitForFunction(async () => {
      const d = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("smashy-personal-v1");
        r.onsuccess = () => resolve(r.result);
      });
      return new Promise<boolean>((resolve) => {
        const t = d.transaction("state"),
          r = t.objectStore("state").get("envelope");
        r.onsuccess = () =>
          resolve(r.result?.active?.checkpoint?.game?.shots === 1);
        t.oncomplete = () => d.close();
      });
    });
    assert.deepEqual((await read(p)).active.checkpoint.game, expected.state);
    assert(
      elapsedMs < 3800,
      `Long flight still blocks play for ${elapsedMs}ms`,
    );
    timings.push({
      case: roofOnly ? "two-roof-piece fixture" : "actual fresh Standard",
      banks: expected.trace.points.length - 2,
      distance: expected.trace.distance,
      previousFlightSeconds: oldFlightSeconds,
      activeElapsedMs: elapsedMs,
      pausedMs,
    });
    await c.close();
  }
  checks.push(
    "Initial and sparse-roof 5-degree multi-bank flights settle promptly, retain exact engine landing/state, and pause without hidden flight progress",
  );
  for (const shotsBefore of [0, 3]) {
    const { c, p } = await start();
    const config = { ...getConfig(), target: 1 };
    const state = createGame({
      config,
      seed: 29,
      board: [
        { row: 0, col: 5, type: 0 },
        { row: 0, col: 6, type: 0 },
      ],
      current: 0,
      next: 0,
    });
    state.shots = shotsBefore;
    state.score = 321;
    const expected = resolveShot(state, 90);
    assert.equal(expected.state.status, "cleared");
    assert.equal(expected.award.efficiency, 100);
    await fixture(p, state, 90, shotsBefore === 3);
    await actualShot(p);
    await p.locator(".score-breakdown").waitFor({ state: "visible" });
    const text = await p.locator("#overlay-card").innerText();
    const announcement = await p.locator("#live").innerText();
    assert(
      announcement.includes(
        `Score ${expected.state.score.toLocaleString()}. Danger ${expected.state.danger} of ${expected.state.config.dangerThreshold}.`,
      ),
    );
    assert(announcement.includes("Board cleared."));
    assert(
      text.includes(`Last shot +${expected.award.total.toLocaleString()}`),
    );
    assert(text.includes("Efficiency +100"));
    assert(text.includes("Board clear +1,000"));
    assert(
      text
        .toLowerCase()
        .includes(shotsBefore === 3 ? "run total" : "total score"),
    );
    assert.equal(
      Number(
        (await p.locator(".terminal-score").innerText()).replaceAll(",", ""),
      ),
      expected.state.score,
    );
    await p.reload();
    await p
      .getByRole("button", { name: "Resume saved board", exact: true })
      .click();
    await p.locator(".score-breakdown").waitFor({ state: "visible" });
    assert(
      (await p.locator(".score-breakdown").innerText()).includes(
        "Efficiency +100",
      ),
    );
    await c.close();
  }
  checks.push(
    "Classic at-target and final-campaign above-target clear fixtures show actual last-shot components, explicit total, minimum 100 efficiency and persistent reload copy",
  );
  {
    const { c, p } = await start();
    const config = getConfig("standard", "compact"),
      board: Cell[] = [];
    const hole = Math.floor(config.columns / 2);
    for (let row = 0; row < config.rows; row++)
      for (let col = 0; col < config.columns - (row & 1); col++)
        if (row !== config.rows - 1 || col !== hole)
          board.push({ row, col, type: 0 });
    const state = createGame({ config, seed: 12, board, current: 6, next: 1 });
    state.score = 123;
    assert.equal(resolveShot(state, 90).award.total, 0);
    await fixture(p, state);
    await actualShot(p);
    await p.locator(".score-breakdown").waitFor({ state: "visible" });
    assert.equal(
      await p.locator(".score-breakdown").innerText(),
      "No points on the last shot.",
    );
    assert(
      (await p.locator("#live").innerText()).includes("Out of room. Run over."),
    );
    assert.equal(await p.locator(".terminal-score").innerText(), "123");
    await c.close();
  }
  checks.push(
    "Actual zero-award capacity loss explains no last-shot points while preserving earlier total",
  );
  {
    const c = await browser.newContext({
        viewport: { width: 360, height: 540 },
      }),
      p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    await p.locator('[data-mode="puzzles"]').click();
    await p.locator('[data-puzzle="0"]').click();
    await p.getByRole("button", { name: "Play Puzzles" }).click();
    await ready(p);
    await actualShot(p);
    await p.locator(".score-breakdown").waitFor({ state: "visible" });
    assert(
      (await p.locator("#overlay-card").innerText())
        .toLowerCase()
        .includes("run total"),
    );
    const stored = await read(p);
    assert(
      (await p.locator(".score-breakdown").innerText()).includes(
        `Last shot +${stored.active.checkpoint.lastAward.total.toLocaleString()}`,
      ),
    );
    const next = p.getByRole("button", { name: "Next puzzle", exact: true });
    const box = await next.boundingBox();
    assert(box && box.height >= 44 && box.y >= 0 && box.y + box.height <= 540);
    const actions = await p
      .locator("#overlay-card .overlay-actions button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const r = button.getBoundingClientRect(),
            card = button.closest("#overlay-card")!.getBoundingClientRect();
          return {
            height: r.height,
            fullyVisible: r.top >= card.top && r.bottom <= card.bottom,
          };
        }),
      );
    assert(
      actions.every((action) => action.height >= 44 && action.fullyVisible),
      JSON.stringify(actions),
    );
    assert(
      await p.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await p.screenshot({ path: ".local/smashy-clear-clarity-compact.png" });
    await next.click();
    await ready(p);
    assert.match(await p.locator("#run-label").innerText(), /Puzzle 2\b/);
    await c.close();
  }
  checks.push(
    "Natural intermediate puzzle clear shows last-shot bonus breakdown and keeps every 44px action initially visible on the minimum Compact viewport without scrolling the page or card",
  );
  {
    const context = await browser.newContext({
      viewport: { width: 360, height: 540 },
    });
    const p = await context.newPage();
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(url);
    await p
      .getByRole("button", { name: "Learn by smashing", exact: true })
      .click();
    await p.locator('[data-lesson="0"]').click();
    await ready(p);
    await actualShot(p);
    await p
      .getByRole("button", { name: "Next lesson", exact: true })
      .waitFor({ state: "visible" });
    const bounds = await p
      .locator("#overlay-card .overlay-actions button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const r = button.getBoundingClientRect(),
            card = button.closest("#overlay-card")!.getBoundingClientRect();
          return {
            height: r.height,
            fullyVisible: r.top >= card.top && r.bottom <= card.bottom,
          };
        }),
      );
    assert.equal(bounds.length, 4);
    assert(
      bounds.every((action) => action.height >= 44 && action.fullyVisible),
      JSON.stringify(bounds),
    );
    const scoreVisible = await p
      .locator(".terminal-score")
      .evaluate((score) => {
        const box = score.getBoundingClientRect(),
          details = score.closest(".overlay-details")!.getBoundingClientRect();
        return box.top >= details.top && box.bottom <= details.bottom;
      });
    assert(
      scoreVisible,
      "The entire minimum portrait result total must be initially visible",
    );
    await p.getByRole("button", { name: "Next lesson", exact: true }).click();
    await ready(p);
    assert((await p.locator("#run-label").innerText()).startsWith("Lesson 2"));
    await context.close();
  }
  checks.push(
    "Minimum Compact teaching result retains all four initially visible 44px actions, with Next lesson working without scrolling",
  );
  assert.deepEqual(errors, []);
  const report = {
    at: new Date().toISOString(),
    url,
    browser: browser.version(),
    checks,
    timings,
    pageErrors: errors,
    boundary:
      "Isolated installed headless Chrome. Actual trusted flight/results/reload UI with explicitly declared game-state fixtures, plus natural first puzzle. Timing is a bounded active wall-time sample with generous regression ceiling, not hardware certification or human pacing/comprehension evidence.",
  };
  fs.writeFileSync(
    "review/pc-clarity-pacing.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
