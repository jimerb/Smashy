import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createGame, getConfig, type Cell } from "../src/core";
import { replayShots } from "../src/replay";
const base = process.env.SMASHY_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  }),
  p = await context.newPage();
p.setDefaultTimeout(10000);
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
const checks: string[] = [];
async function read() {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    return await new Promise<any>((resolve) => {
      const t = db.transaction("state"),
        r = t.objectStore("state").get("envelope");
      r.onsuccess = () => resolve(r.result);
      t.oncomplete = () => db.close();
    });
  });
}
async function ready() {
  await p.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
try {
  await p.goto(base);
  await p.locator("#profile").selectOption("compact");
  await p.getByRole("button", { name: "Play Classic" }).click();
  await ready();
  // Desktop shoots directly on the board. The separate touch card is displayed
  // on touch/portrait layouts and has its own input continuity coverage.
  const pad = await p.locator("#input").boundingBox();
  assert(pad);
  for (const button of [1, 2])
    await p.locator("#input").dispatchEvent("pointerdown", {
      pointerType: "mouse",
      button,
      clientX: pad.x + pad.width * 0.3,
      clientY: pad.y + pad.height * 0.4,
    });
  assert.equal(await p.locator("#shots").innerText(), "0");
  checks.push(
    "Middle and secondary mouse buttons on the desktop board spend no shot",
  );
  for (const score of [123, 0]) {
    const config = getConfig("standard", "compact"),
      col = Math.floor(config.columns / 2),
      board: Cell[] = [];
    for (let row = 0; row < config.rows; row++)
      for (let c = 0; c < config.columns - (row & 1); c++)
        if (row !== config.rows - 1 || c !== col)
          board.push({ row, col: c, type: 0 });
    const state = createGame({ config, seed: 342, board, current: 6, next: 1 });
    state.score = score;
    await p.evaluate(async (state) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("smashy-personal-v1");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve) => {
        const t = db.transaction("state", "readwrite"),
          os = t.objectStore("state"),
          r = os.get("envelope");
        r.onsuccess = () => {
          const e = r.result;
          Object.assign(e.active.checkpoint, {
            game: state,
            undo: null,
            angle: 90,
            guide: false,
            replay: null,
          });
          os.put(e, "envelope");
        };
        t.oncomplete = () => resolve();
      });
      db.close();
    }, state);
    await p.reload();
    await p.locator('[data-action="resume-saved"]').click();
    await p.locator("#game").waitFor({ state: "visible" });
    await p.getByRole("button", { name: "Resume", exact: true }).click();
    await p.keyboard.press("Space");
    await p.waitForFunction(
      () =>
        !(document.querySelector("#overlay") as HTMLElement).hidden &&
        document
          .querySelector("#overlay-card")!
          .textContent!.includes("The lowest row is completely blocked."),
    );
    const saved = await read();
    assert.equal(saved.active.status, "terminal");
    assert.equal(saved.active.checkpoint.game.shots, 1);
    assert.equal(saved.active.checkpoint.game.score, score);
    assert.deepEqual(
      replayShots(saved.active.checkpoint.replay),
      saved.active.checkpoint.game,
    );
    if (score) {
      const newBoard = p.locator('#overlay-card [data-action="new-board"]');
      assert.equal(await newBoard.innerText(), "New random board");
      await newBoard.click();
      await ready();
    }
  }
  checks.push(
    "Last legal floor attachment ends as capacity loss after one actual shot, preserving score and avoiding perpetual retry",
  );
  checks.push(
    "Persisted accepted-angle/current/next/landing report reconstructs actual terminal game exactly",
  );
  await p.getByRole("button", { name: "Personal bests", exact: true }).click();
  await p.locator(".score-table").waitFor({ state: "visible" });
  assert.equal(await p.locator(".score-table tbody tr").count(), 1);
  await p.getByRole("button", { name: "Recent results", exact: true }).click();
  await p
    .locator("#records-recent[aria-pressed=true]")
    .waitFor({ state: "visible" });
  assert.equal(await p.locator(".score-table tbody tr").count(), 2);
  assert.equal(
    await p
      .locator(".score-table tbody tr")
      .first()
      .locator("td")
      .nth(1)
      .innerText(),
    "0",
  );
  await p.getByRole("button", { name: "Top ten", exact: true }).click();
  await p
    .locator("#records-top[aria-pressed=true]")
    .waitFor({ state: "visible" });
  assert.equal(await p.locator(".score-table tbody tr").count(), 1);
  checks.push(
    "Recent results include zero nonqualifying terminal runs while Top ten stays positive-only",
  );
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await p.locator('#overlay-card [data-action="new-board"]').click();
  await ready();
  await p.locator("#input").focus();
  await p.keyboard.press("Space");
  await p.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "1",
  );
  await ready();
  await p.getByRole("button", { name: "Pause", exact: true }).click();
  await p.locator('#overlay-card [data-action="settings"]').click();
  await p.locator("#setting-undo-penalty").uncheck();
  await p.getByRole("button", { name: "Done", exact: true }).click();
  await p.locator('#overlay-card [data-action="resume"]').click();
  await p.getByRole("button", { name: "Undo", exact: true }).click();
  await p.setViewportSize({ width: 360, height: 640 });
  await p.waitForTimeout(180);
  await p.locator("#run-label").waitFor({ state: "visible" });
  assert.match(
    await p.locator("#run-label").innerText(),
    /Classic.*standard.*Compact.*Assisted/,
  );
  await p.getByRole("button", { name: "Resume", exact: true }).click();
  await p.screenshot({ path: ".local/smashy-assisted-mobile.png" });
  checks.push(
    "Narrow HUD retains mode, difficulty, layout and Assisted after Guide-off undo",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "review/records-browser-chrome.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        url: base,
        browser: browser.version(),
        boundary:
          "Actual headless desktop Chrome UI with documented near-capacity checkpoints and a synthetic narrow viewport; no human/device comfort claim.",
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(checks);
} catch (e) {
  await p.screenshot({ path: ".local/records-failure.png" });
  throw e;
} finally {
  await browser.close();
}
