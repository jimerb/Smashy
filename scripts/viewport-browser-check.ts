import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.SMASHY_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
p.setDefaultTimeout(10000);
const errors: string[] = [];
p.on("pageerror", (e) => errors.push(e.message));
const checks: string[] = [];
async function bounds(dialog = false) {
  return p.evaluate((dialog) => {
    const vv = visualViewport!,
      left = vv.offsetLeft,
      top = vv.offsetTop,
      w = vv.width,
      h = vv.height;
    const els = dialog
      ? [
          document.querySelector("#dialog")!,
          document.querySelector('#dialog [data-action="close-dialog"]')!,
          ...document.querySelectorAll("#dialog-foot button"),
        ]
      : [...document.querySelectorAll("#game .actions button")];
    return {
      left,
      top,
      w,
      h,
      rects: els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
      noFit: document
        .querySelector("#play-layout")!
        .classList.contains("no-fit"),
    };
  }, dialog);
}
function contained(r: Awaited<ReturnType<typeof bounds>>) {
  for (const b of r.rects)
    assert(
      b.x >= r.left - 0.1 &&
        b.y >= r.top - 0.1 &&
        b.x + b.w <= r.left + r.w + 0.1 &&
        b.y + b.h <= r.top + r.h + 0.1,
      JSON.stringify(r),
    );
}
try {
  await p.goto(base);
  await p.getByRole("button", { name: "Play Classic" }).click();
  await p.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
  const cdp = await p.context().newCDPSession(p);
  // The wider desktop arena now remains readable at 200%; use 300% to
  // exercise the actual below-half-scale fit boundary.
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 3 });
  await p.waitForTimeout(200);
  let r = await bounds();
  contained(r);
  assert.equal(r.noFit, true);
  await p.locator('#game [data-action="help"]').dispatchEvent("click");
  await p.locator("#dialog").waitFor({ state: "visible" });
  contained(await bounds(true));
  checks.push(
    "Synthetic 300% pinch scale preserves the run in needs-space and keeps essential commands/dialog inside visualViewport",
  );
  await p
    .getByRole("button", { name: "Close", exact: true })
    .dispatchEvent("click");
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(200);
  await p.addStyleTag({
    content:
      "#game{padding-left:20px!important;padding-right:20px!important;padding-bottom:21px!important}",
  });
  await p.evaluate(() => dispatchEvent(new Event("resize")));
  await p.waitForTimeout(200);
  r = await bounds();
  contained(r);
  checks.push(
    "Synthetic safe insets retain essential controls in the usable rectangle without changing the board",
  );
  await p.setViewportSize({ width: 360, height: 540 });
  await p.addStyleTag({
    content:
      "#game{padding:0!important}.hud .label{font-size:24px!important}.hud .score-value,.hud .stat-value{font-size:28px!important}",
  });
  await p.evaluate(() => dispatchEvent(new Event("resize")));
  await p.waitForTimeout(200);
  r = await bounds();
  contained(r);
  assert.equal(r.noFit, true);
  checks.push(
    "Larger HUD text is measured and produces preserved fit-pause instead of forcing undersized tiles",
  );
  await p.getByRole("button", { name: "How to play", exact: true }).click();
  await p.setViewportSize({ width: 390, height: 300 });
  await p.waitForTimeout(200);
  contained(await bounds(true));
  assert.equal(
    await p.locator('#dialog [data-action="close-dialog"]').isVisible(),
    true,
  );
  checks.push(
    "A reduced-height synthetic keyboard viewport keeps Help Close and navigation pinned and visible",
  );
  assert.deepEqual(errors, []);
  await p.screenshot({ path: ".local/smashy-viewport-dialog.png" });
  fs.writeFileSync(
    "review/viewport-browser-chrome.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        url: base,
        browser: browser.version(),
        boundary:
          "Desktop Chrome CDP pinch scaling, CSS-injected safe insets/larger text and resized viewport. Not actual browser Ctrl+zoom, OS keyboard, iOS safe areas or physical-device evidence.",
        checks,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(checks);
} catch (e) {
  await p.screenshot({ path: ".local/viewport-failure.png" });
  throw e;
} finally {
  await browser.close();
}
