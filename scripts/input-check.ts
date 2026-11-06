import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.SMASHY_URL || "http://127.0.0.1:5173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
const checks: string[] = [];
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Play Classic" }).click();
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  const pad = await page.locator("#touch-pad").boundingBox();
  assert(pad);
  const x = pad.x + pad.width * 0.4,
    y = pad.y + pad.height * 0.45;
  const cdp = await context.newCDPSession(page);
  const touch = async (
    type: string,
    points: { x: number; y: number; id?: number }[],
  ) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p) => ({ ...p, radiusX: 2, radiusY: 2 })),
    });
  };
  const count = async () => +(await page.locator("#shots").innerText());
  await touch("touchStart", [{ x, y }]);
  await touch("touchEnd", []);
  assert.equal(await count(), 0);
  checks.push("Trusted touch tap never arms or fires");
  await touch("touchStart", [{ x, y }]);
  for (let i = 0; i < 12; i++)
    await touch("touchMove", [{ x: x + (i % 2 ? 5 : -5), y }]);
  await touch("touchEnd", []);
  assert.equal(await count(), 0);
  checks.push("Repeated sub-deadzone tremor does not accumulate arming");
  const retainedAngle = parseFloat(await page.locator("#angle").innerText());
  await touch("touchStart", [{ x, y }]);
  await touch("touchMove", [{ x: x + 24, y }]);
  await touch("touchMove", [{ x, y }]);
  await touch("touchEnd", []);
  await page.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "1",
  );
  assert.equal(
    parseFloat(await page.locator("#angle").innerText()),
    retainedAngle,
  );
  checks.push(
    "Armed out-and-back gesture repeats retained angle and fires exactly once",
  );
  await page.waitForFunction(
    () =>
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  await touch("touchStart", [{ x, y }]);
  await touch("touchMove", [{ x: x + 24, y }]);
  const cancel = await page.locator("#cancel-strip").boundingBox();
  assert(cancel);
  await touch("touchMove", [
    { x: cancel.x + cancel.width / 2, y: cancel.y + 22 },
  ]);
  await touch("touchEnd", []);
  assert.equal(await count(), 1);
  checks.push("Visible cancel strip cancels captured gesture");
  await touch("touchStart", [{ x, y }]);
  await touch("touchMove", [{ x: x + 24, y }]);
  await touch("touchMove", [{ x: x + 24, y: pad.y - 20 }]);
  await touch("touchEnd", []);
  await page.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "2",
  );
  assert.equal(await page.locator("#overlay").isVisible(), false);
  checks.push(
    "Captured drag continues above the low pad and releases one shot",
  );
  await page.waitForFunction(
    () =>
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  await touch("touchStart", [{ x, y, id: 0 }]);
  await touch("touchMove", [{ x: x + 24, y, id: 0 }]);
  await touch("touchStart", [
    { x: x + 24, y, id: 0 },
    { x: x + 70, y, id: 1 },
  ]);
  await touch("touchEnd", []);
  assert.equal(await count(), 2);
  checks.push("A second contact cancels the entire gesture");
  await touch("touchStart", [{ x, y }]);
  await touch("touchMove", [{ x: x + 24, y }]);
  await touch("touchCancel", []);
  assert.equal(await count(), 2);
  checks.push("OS pointer cancellation never fires");
  const stage = await page.locator("#stage").boundingBox();
  assert(stage);
  const config = { width: 528, height: 776, sy: 720 };
  const nx = stage.x + (stage.width * (528 - 64)) / 528,
    ny = stage.y + (stage.height * 720) / 776;
  await touch("touchStart", [{ x: nx, y: ny }]);
  await touch("touchMove", [{ x: nx - 25, y: ny }]);
  await touch("touchEnd", []);
  assert.equal(await count(), 2);
  checks.push("Next-piece tray is excluded from the firing surface");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator("#setting-input").check();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await touch("touchStart", [{ x, y }]);
  await touch("touchMove", [{ x: x + 24, y }]);
  await touch("touchEnd", []);
  assert.equal(await count(), 2);
  await page.getByRole("button", { name: "Fire", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector("#shots")!.textContent === "3",
  );
  checks.push(
    "Separate Fire mode aims on touch release and fires only through its button",
  );
  await page.screenshot({ path: ".local/smashy-touch-ready.png" });
  assert.deepEqual(errors, []);
  fs.mkdirSync("review", { recursive: true });
  fs.writeFileSync(
    "review/input-chrome.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        browser: browser.version(),
        boundary:
          "Trusted synthetic Chromium touch events through CDP on desktop; not a physical iOS/Android usability or OS integration pass.",
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (e) {
  await page.screenshot({ path: ".local/input-failure.png" });
  throw e;
} finally {
  await browser.close();
}
