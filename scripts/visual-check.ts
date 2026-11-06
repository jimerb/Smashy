import { chromium, type Page } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.SMASHY_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors: string[] = [];
const samples: unknown[] = [];
const captures: string[] = [];
const contexts: unknown[] = [];
const checks: string[] = [];

function luminance(channels: number[]) {
  const linear = channels.slice(0, 3).map((value) => {
    const component = value / 255;
    return component <= 0.04045
      ? component / 12.92
      : ((component + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}
function ratio(fg: number[], bg: number[]) {
  const a = luminance(fg),
    b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
function rgb(value: string) {
  return (value.match(/[\d.]+/g) ?? []).map(Number);
}

async function sample(
  page: Page,
  label: string,
  selector: string,
  threshold = 4.5,
  property = "color",
) {
  const computed = await page
    .locator(selector)
    .first()
    .evaluate((element, property) => {
      const style = getComputedStyle(element);
      const backgroundCandidates: string[] = [];
      let backgroundMethod = "nearest opaque CSS background";
      // The offset focus ring is outside the button fill, against its parent.
      let current: Element | null =
        property === "outline-color" ? element.parentElement : element;
      while (current) {
        const parentStyle = getComputedStyle(current);
        const color = parentStyle.backgroundColor;
        const parts = (color.match(/[\d.]+/g) ?? []).map(Number);
        if (parentStyle.backgroundImage !== "none") {
          const stops =
            parentStyle.backgroundImage.match(/rgba?\([^)]*\)/g) ?? [];
          const opaque = stops.filter((stop) => {
            const parts = (stop.match(/[\d.]+/g) ?? []).map(Number);
            return parts.length === 3 || parts[3] === 1;
          });
          if (opaque.length) {
            backgroundCandidates.push(...opaque);
            backgroundMethod =
              "minimum ratio over opaque computed gradient-stop palette; conservative bound, not a pixel sample";
            break;
          }
        }
        if (parts.length === 3 || parts[3] === 1) {
          backgroundCandidates.push(color);
          break;
        }
        current = current.parentElement;
      }
      if (!backgroundCandidates.length)
        backgroundCandidates.push("rgb(16,22,27)");
      return {
        foreground: style.getPropertyValue(property),
        backgroundCandidates,
        backgroundMethod,
        text: element.textContent?.trim().slice(0, 110),
        opacity: style.opacity,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        ...(property === "outline-color"
          ? {
              outlineStyle: style.outlineStyle,
              outlineWidth: style.outlineWidth,
              focusVisible: element.matches(":focus-visible"),
            }
          : {}),
      };
    }, property);
  const foreground = rgb(computed.foreground);
  const ratios = computed.backgroundCandidates.map((color) =>
    ratio(foreground, rgb(color)),
  );
  const minimum = Math.min(...ratios);
  samples.push({
    label,
    selector,
    property,
    ...computed,
    ratio: Number(minimum.toFixed(3)),
    threshold,
    passed: minimum >= threshold,
  });
  assert.ok(
    minimum >= threshold,
    `${label}: ${minimum.toFixed(2)} < ${threshold}`,
  );
}

async function ready(page: Page) {
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function snapshot(page: Page, name: string) {
  const path = `.local/${name}.png`;
  await page.screenshot({ path });
  captures.push(path);
}
async function fit(page: Page, expectedTile: number, logicalWidth = 528) {
  const geometry = await page.evaluate(() => {
    const stage = document.querySelector("#stage")!.getBoundingClientRect();
    const buttons = [
      ...document.querySelectorAll<HTMLElement>(
        "#game .actions button,#game .bottom-controls button",
      ),
    ]
      .filter((element) => element.offsetParent !== null)
      .map((element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      stage: {
        x: stage.x,
        y: stage.y,
        width: stage.width,
        height: stage.height,
      },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      buttons,
      fit: !document
        .querySelector("#play-layout")!
        .classList.contains("no-fit"),
      context: document.querySelector("#run-label")!.textContent,
      mobileContext: document.querySelector("#mobile-context")!.textContent,
    };
  });
  assert.equal(geometry.fit, true);
  assert.ok(
    geometry.scroll.width <= geometry.viewport.width &&
      geometry.scroll.height <= geometry.viewport.height,
  );
  assert.ok(
    geometry.stage.x >= 0 &&
      geometry.stage.y >= 0 &&
      geometry.stage.x + geometry.stage.width <=
        geometry.viewport.width + 0.2 &&
      geometry.stage.y + geometry.stage.height <=
        geometry.viewport.height + 0.2,
  );
  for (const button of geometry.buttons)
    assert.ok(
      button.width >= 43.9 &&
        button.height >= 43.9 &&
        button.x >= 0 &&
        button.y >= 0 &&
        button.x + button.width <= geometry.viewport.width + 0.2 &&
        button.y + button.height <= geometry.viewport.height + 0.2,
    );
  const tile = (geometry.stage.width / logicalWidth) * 48;
  assert.ok(
    Math.abs(tile - expectedTile) < 0.15,
    `Expected tile ${expectedTile}, got ${tile}`,
  );
  contexts.push({ ...geometry, tileCSS: tile });
}

async function captions(page: Page, scenario: string) {
  const result = await page.evaluate(() => {
    const stage = document.querySelector("#stage")!.getBoundingClientRect();
    return [
      ...document.querySelectorAll<HTMLElement>("#next-caption,#limit-caption"),
    ].map((element) => {
      const style = getComputedStyle(element),
        box = element.getBoundingClientRect();
      return {
        id: element.id,
        text: element.textContent,
        fontSize: parseFloat(style.fontSize),
        visibility: style.visibility,
        display: style.display,
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
        bounds: {
          x: box.x - stage.x,
          y: box.y - stage.y,
          width: box.width,
          height: box.height,
        },
        stage: { width: stage.width, height: stage.height },
      };
    });
  });
  assert.equal(result.length, 2);
  for (const caption of result) {
    assert.ok(caption.fontSize >= 10, `${scenario}: ${caption.id} font size`);
    assert.notEqual(caption.visibility, "hidden");
    assert.notEqual(caption.display, "none");
    assert.ok(caption.bounds.width > 0 && caption.bounds.height >= 9.9);
    assert.ok(
      caption.bounds.x >= 0 &&
        caption.bounds.y >= 0 &&
        caption.bounds.x + caption.bounds.width <= caption.stage.width + 0.2 &&
        caption.bounds.y + caption.bounds.height <= caption.stage.height + 0.2,
      `${scenario}: ${caption.id} must remain within whole stage`,
    );
  }
  const next = result.find((caption) => caption.id === "next-caption")!;
  assert.equal(next.role, "img");
  assert.match(
    next.ariaLabel ?? "",
    /^Next toy: (Chip|Gum|Rivet|Wisp|Bash|Loop|Peb)$/,
  );
  contexts.push({ captionScenario: scenario, captions: result });
}

async function padCaptionClearance(
  page: Page,
  logicalWidth: number,
  scenario: string,
) {
  const result = await page.evaluate(
    ({ logicalWidth }) => {
      const stage = document.querySelector("#stage")!.getBoundingClientRect();
      const element = document.querySelector(".pad-caption")!;
      const caption = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      const scale = stage.width / logicalWidth;
      // Both tested configurations are Compact, fifteen rows, striker Y=720.
      const face = {
        left: stage.x + (logicalWidth / 2) * scale - 12 * scale,
        right: stage.x + (logicalWidth / 2) * scale + 12 * scale,
        top: stage.y + 710 * scale,
        bottom: stage.y + 732 * scale,
      };
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        caption.width > 0 &&
        caption.height > 0;
      const overlaps =
        visible &&
        caption.left < face.right &&
        caption.right > face.left &&
        caption.top < face.bottom &&
        caption.bottom > face.top;
      return {
        visible,
        overlaps,
        caption: {
          x: caption.x,
          y: caption.y,
          width: caption.width,
          height: caption.height,
        },
        face,
      };
    },
    { logicalWidth },
  );
  contexts.push({ padCaptionScenario: scenario, ...result });
  assert.equal(
    result.overlaps,
    false,
    `${scenario}: decorative touch instruction must not obscure the loaded toy face`,
  );
}

try {
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await desktop.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await sample(page, "Home primary action text", '[data-action="play"]');
  await sample(page, "Home secondary action text", '[data-action="lessons"]');
  await page.getByRole("button", { name: "New Classic game" }).click();
  await ready(page);
  await sample(page, "Score cream value", "#score");
  await sample(page, "Best ochre value", "#best");
  await sample(page, "Small category and assistance context", "#run-label");
  await sample(page, "HUD labels", "#game .label");
  await sample(page, "Danger rule note", "#danger-note");
  await sample(page, "Direction hint", "#input-hint");
  await sample(page, "Secondary command text", "#guide-button");
  await sample(page, "Sound control icon", '#game [data-action="sound"]', 3);
  await sample(page, "Unscaled Next caption", "#next-caption");
  await sample(page, "Unscaled Limit caption", "#limit-caption");
  await page.locator("#guide-button").focus();
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    () =>
      document.activeElement?.id === "fire-button" &&
      document.activeElement.matches(":focus-visible") &&
      getComputedStyle(document.activeElement).outlineStyle === "solid",
  );
  await sample(
    page,
    "Keyboard focus outline",
    "#fire-button",
    3,
    "outline-color",
  );
  const active = await page.evaluate(() => {
    const inactive = document.querySelector("#danger-meter i")!;
    const test = document.createElement("i");
    test.className = "on";
    inactive.parentElement!.appendChild(test);
    const palettes: string[][] = [];
    for (const element of [test, inactive]) {
      const style = getComputedStyle(element);
      const stops = style.backgroundImage.match(/rgba?\([^)]*\)/g) ?? [];
      palettes.push(stops.length ? stops : [style.backgroundColor]);
    }
    const values = { active: palettes[0], inactive: palettes[1] };
    test.remove();
    return values;
  });
  const activeRatio = Math.min(
    ...active.active.flatMap((a) =>
      active.inactive.map((b) => ratio(rgb(a), rgb(b))),
    ),
  );
  samples.push({
    label: "Active danger fill versus inactive segment",
    method:
      "minimum ratio across all computed opaque gradient-stop pairs in temporary rendered CSS states; conservative palette bound, not a gameplay event or pixel sample",
    foreground: active.active,
    background: active.inactive,
    ratio: Number(activeRatio.toFixed(3)),
    threshold: 3,
    passed: activeRatio >= 3,
  });
  assert.ok(activeRatio >= 3);
  await snapshot(page, "smashy-production-color-desktop");
  await page.locator("#guide-button").click();
  await sample(page, "Assisted badge", "#assist-label");
  assert.match(
    await page.locator("#run-label").innerText(),
    /Desktop.*Assisted/,
  );
  await page.addStyleTag({
    content: "#game { filter: grayscale(1) !important; }",
  });
  await snapshot(page, "smashy-production-grayscale-desktop");
  await page.locator('#game [data-action="help"]').click();
  await page.locator("#dialog").waitFor({ state: "visible" });
  await sample(page, "Help heading", "#dialog-title");
  await sample(page, "Help prose", "#dialog-body p");
  await sample(page, "Help example label", "#dialog .help-example-label");
  await sample(page, "Help example caption", "#dialog .help-figure figcaption");
  checks.push(
    "Sampled enabled text colors meet 4.5:1; icon, focus and active danger palette samples meet 3:1 using computed CSS pairs and conservative gradient-stop bounds.",
  );
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 360, height: 540 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const phone = await mobile.newPage();
  phone.on("pageerror", (error) => errors.push(error.message));
  await phone.goto(base);
  await phone.locator("#profile").selectOption("compact");
  await phone.getByRole("button", { name: "New Classic game" }).click();
  await ready(phone);
  await fit(phone, 24);
  await captions(phone, "Minimum Compact Standard 360 × 540");
  await padCaptionClearance(phone, 528, "Minimum Compact Standard");
  await sample(phone, "Minimum Compact Next caption", "#next-caption");
  await sample(phone, "Minimum Compact Limit caption", "#limit-caption");
  await snapshot(phone, "smashy-production-minimum-compact-color");
  await phone.locator("#guide-button").click();
  assert.match(
    await phone.locator("#run-label").innerText(),
    /Classic.*standard.*Compact.*Assisted/s,
  );
  const envelope = await phone.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("smashy-personal-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise<any>((resolve, reject) => {
      const tx = db.transaction("state");
      const request = tx.objectStore("state").get("envelope");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  });
  const presentTypes = [
    ...new Set<number>(
      envelope.active.checkpoint.game.board.map(
        (cell: { type: number }) => cell.type,
      ),
    ),
  ].sort();
  assert.equal(
    presentTypes.length,
    7,
    "Minimum identity capture should contain all seven ordinary types",
  );
  await phone.addStyleTag({
    content: "#game { filter: grayscale(1) !important; }",
  });
  await snapshot(phone, "smashy-production-minimum-compact-grayscale");
  contexts.push({
    minimumCaptureTypes: presentTypes,
    grayscaleMethod:
      "Temporary browser CSS filter applied to actual production game; no image postprocessing.",
  });
  checks.push(
    "Actual Compact Standard board fits a 360 × 540 desktop-emulated viewport with 24 CSS-pixel tile pitch and visible 44 CSS-pixel essential commands. All seven ordinary types are present.",
  );
  checks.push(
    "Desktop and minimum Compact grayscale captures render the actual production Pixi canvas; current/Next and category/Assisted context retained. Human visual inspection recorded separately.",
  );
  await mobile.close();

  const narrow = await browser.newContext({
    viewport: { width: 360, height: 540 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  const custom = await narrow.newPage();
  custom.on("pageerror", (error) => errors.push(error.message));
  await custom.goto(base);
  await custom.locator("#profile").selectOption("compact");
  await custom.locator('[data-mode="custom"]').click();
  await custom.locator('[name="columns"]').fill("5");
  await custom.locator('[name="rows"]').fill("15");
  await custom
    .getByRole("button", { name: "Use these rules", exact: true })
    .click();
  await custom.getByRole("button", { name: "New Custom game" }).click();
  await ready(custom);
  await fit(custom, 24, 240);
  await captions(custom, "Narrow 240-unit Custom, Compact 360 × 540");
  await snapshot(custom, "smashy-production-narrow-custom-color");
  await padCaptionClearance(custom, 240, "Narrow Custom");
  await custom.addStyleTag({
    content: "#game { filter: grayscale(1) !important; }",
  });
  await snapshot(custom, "smashy-production-narrow-custom-grayscale");
  checks.push(
    "Unscaled Next and Limit DOM captions are at least 10 CSS pixels, visible and wholly inside both minimum Compact and 240-unit-wide Custom stages; Next has the real toy name in its image-role accessible label.",
  );
  await narrow.close();
  assert.deepEqual(errors, []);
} finally {
  fs.mkdirSync("review", { recursive: true });
  fs.writeFileSync(
    "review/contrast-chrome.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        url: base,
        browser: "Installed Chrome via playwright-core, headless",
        boundary:
          "Bounded computed-palette contrast sample and desktop-emulated layout/captures. Not a full WCAG audit, physical mobile test, human-fun test, perceptual audio review or whole-canvas pixel contrast certification.",
        disabledControls:
          "Disabled Undo text excluded from normal enabled-text criterion.",
        checks,
        samples,
        contexts,
        captures,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
console.log(
  `Visual checks passed: ${samples.length} palette samples; ${captures.length} production captures.`,
);
