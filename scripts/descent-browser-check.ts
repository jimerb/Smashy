import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createGame, getConfig, resolveShot } from "../src/core";
const base = process.env.SMASHY_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const p = await context.newPage();
p.setDefaultTimeout(10000);
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
try {
  await p.goto(base);
  await p.getByRole("button", { name: "New Classic game" }).click();
  await p.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  const state = createGame({
    config: getConfig(),
    seed: 241,
    board: [
      { row: 0, col: 6, type: 0 },
      { row: 0, col: 7, type: 1 },
    ],
    current: 2,
    next: 3,
  });
  state.danger = 8;
  await p.evaluate(async (state) => {
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
          initial: structuredClone(state),
          undo: null,
          angle: 90,
          guide: false,
        });
        os.put(e, "envelope");
      };
      t.oncomplete = () => resolve();
      t.onabort = () => reject(t.error);
    });
    db.close();
  }, state);
  await p.reload();
  await p.locator('[data-action="resume-saved"]').click();
  await p.locator("#game").waitFor({ state: "visible" });
  await p.getByRole("button", { name: "Resume", exact: true }).click();
  await p.keyboard.press("Space");
  await p.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "1",
  );
  assert.equal(await p.locator("#fire-button").isDisabled(), true);
  await p.getByRole("button", { name: "Pause", exact: true }).click();
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: "Resume", exact: true }).click();
  assert.equal(
    await p.locator("#fire-button").isDisabled(),
    true,
    "A pause must retain the unfinished descent lock",
  );
  await p.keyboard.press("Space");
  assert.equal(await p.locator("#shots").innerText(), "1");
  await p.waitForFunction(
    () =>
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  await p.screenshot({ path: ".local/smashy-descent-settled.png" });
  await p.locator("#input").focus();
  await p.keyboard.press("Space");
  await p.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "2",
  );
  const actual = await p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("smashy-personal-v1");
      r.onsuccess = () => resolve(r.result);
    });
    return await new Promise<any>((resolve) => {
      const t = db.transaction("state"),
        r = t.objectStore("state").get("envelope");
      r.onsuccess = () => resolve(r.result.active.checkpoint.game);
      t.oncomplete = () => db.close();
    });
  });
  const expected = resolveShot(resolveShot(state, 90).state, 90).state;
  assert.deepEqual(actual, expected);
  assert.deepEqual(errors, []);
  const report = {
    at: new Date().toISOString(),
    url: base,
    browser: browser.version(),
    boundary:
      "Actual desktop headless Chrome with an authored danger-overflow checkpoint fixture; source/clock tests complement this readiness observation, not a human motion-comfort pass.",
    checks: [
      "Strict overflow begins a descent-only input lock",
      "Pause longer than descent duration retains unfinished lock on Resume",
      "Space during settling does not fire; settled next shot matches pure trajectory/state",
      "Moving ceiling rail screenshot captured after descent",
    ],
    pageErrors: errors,
  };
  fs.writeFileSync(
    "review/descent-browser-chrome.json",
    JSON.stringify(report, null, 2),
  );
  console.log(report.checks);
} catch (e) {
  await p.screenshot({ path: ".local/descent-failure.png" });
  throw e;
} finally {
  await browser.close();
}
