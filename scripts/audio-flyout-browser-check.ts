import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { chromium, type Page } from "playwright-core";

const base = process.env.SMASHY_URL;
if (!base) throw Error("Supply SMASHY_URL for the already built candidate");
const reportPath =
  process.env.SMASHY_REPORT_PATH || "review/audio-flyout-chrome.json";
const hash = (bytes: Buffer) =>
  crypto.createHash("sha256").update(bytes).digest("hex");
const servedHash = async () => {
  const response = await fetch(base!);
  assert(response.ok, `Candidate HTTP ${response.status}`);
  return hash(Buffer.from(await response.arrayBuffer()));
};
const htmlAtStart = await servedHash();
assert.equal(
  htmlAtStart,
  hash(fs.readFileSync("dist/index.html")),
  "SMASHY_URL must serve this checkout's current dist",
);
const browser = await chromium.launch({
  channel: process.env.SMASHY_BROWSER || "chrome",
  headless: true,
});
const checks: string[] = [];
const errors: string[] = [];
const geometry: unknown[] = [];
const policyCases: unknown[] = [];
let verified = false;
let failure: string | undefined;

// Instrument native audio, without replacing media playback or decoded audio.
// The optional policy deliberately denies pointerdown activation. Pending
// resume() calls remain pending until app code retries during a completed tap.
async function instrument(
  page: Page,
  gated = false,
  saved?: Record<string, unknown>,
) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.setDefaultTimeout(12000);
  await page.addInitScript(
    ({ gated, saved }) => {
      const w = window as any;
      // tsx preserves nested function/class names using this serialization helper.
      // It must live in the browser realm along with the init-script callback.
      w.__name = (target: unknown) => target;
      if (saved && !sessionStorage.getItem("flyout-test-seeded")) {
        localStorage.setItem("smashy.settings.v1", JSON.stringify(saved));
        sessionStorage.setItem("flyout-test-seeded", "true");
      }
      w.flyoutAudio = {
        events: [],
        contexts: [],
        musicGain: null,
        musicContext: null,
      };
      let activeEvent: Event | null = null;
      const currentGesture = () =>
        activeEvent?.eventPhase ? activeEvent.type : "";
      for (const name of ["pointerdown", "touchend", "click", "keydown"]) {
        window.addEventListener(
          name,
          (event) => {
            if (!event.isTrusted) return;
            activeEvent = event;
          },
          true,
        );
      }
      const allowed = () =>
        ["touchend", "click", "keydown"].includes(currentGesture());
      const Native = window.AudioContext;
      let nextId = 0;
      let rejectedSfxOnce = false;
      w.AudioContext = class extends Native {
        policyUnlocked = !gated;
        policyId = ++nextId;
        observedGains: GainNode[] = [];
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          super(...args);
          w.flyoutAudio.contexts.push(this);
        }
        get state(): AudioContextState {
          return this.policyUnlocked ? super.state : "suspended";
        }
        createGain() {
          const node = super.createGain();
          this.observedGains.push(node);
          return node;
        }
        resume() {
          const accepted = !gated || allowed();
          const transientSfxRejection =
            gated &&
            accepted &&
            this !== w.flyoutAudio.musicContext &&
            !rejectedSfxOnce;
          w.flyoutAudio.events.push({
            operation: "resume",
            context: this.policyId,
            gesture: currentGesture(),
            accepted: accepted && !transientSfxRejection,
            reason: transientSfxRejection
              ? "one-shot SFX NotAllowedError"
              : undefined,
          });
          if (!accepted) return new Promise<void>(() => {});
          if (transientSfxRejection) {
            rejectedSfxOnce = true;
            return Promise.reject(
              new DOMException("Retryable SFX activation", "NotAllowedError"),
            );
          }
          this.policyUnlocked = true;
          return super.resume();
        }
        createMediaElementSource(element: HTMLMediaElement) {
          const node = super.createMediaElementSource(element);
          const connect = node.connect.bind(node);
          (node as any).connect = (destination: any, ...rest: any[]) => {
            w.flyoutAudio.musicGain = destination;
            w.flyoutAudio.musicContext = this;
            return (connect as any)(destination, ...rest);
          };
          return node;
        }
      };
      const nativePlay = HTMLMediaElement.prototype.play;
      const unlockedMedia = new WeakSet<HTMLMediaElement>();
      HTMLMediaElement.prototype.play = function () {
        const accepted = !gated || allowed() || unlockedMedia.has(this);
        w.flyoutAudio.events.push({
          operation: "play",
          gesture: currentGesture(),
          accepted,
          previouslyUnlocked: unlockedMedia.has(this),
          gain: w.flyoutAudio.musicGain?.gain.value,
        });
        if (!accepted)
          return Promise.reject(
            new DOMException(
              "Completed trusted gesture required",
              "NotAllowedError",
            ),
          );
        unlockedMedia.add(this);
        return nativePlay.call(this);
      };
    },
    { gated, saved },
  );
}

const trigger = (page: Page) =>
  page.locator('[data-action="sound"]:visible').first();
const mix = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("smashy.settings.v1") || "null"),
  );
async function setRange(page: Page, selector: string, value: string) {
  await page.locator(selector).fill(value);
  await page.locator(selector).dispatchEvent("input");
}
async function playing(page: Page) {
  await page.waitForFunction(() => {
    const a = document.querySelector<HTMLAudioElement>(
      "audio[data-smashy-music]",
    );
    return a && !a.paused && a.currentTime > 0.04 && a.readyState >= 2;
  });
}
async function gain(page: Page, expected: number) {
  await page.waitForFunction(
    (expected) =>
      Math.abs((window as any).flyoutAudio.musicGain?.gain.value - expected) <
      0.001,
    expected,
  );
}
async function effectsGain(page: Page, expected: number) {
  await page.waitForFunction((expected) => {
    const data = (window as any).flyoutAudio;
    const effects = data.contexts.find(
      (context: unknown) => context !== data.musicContext,
    );
    return (
      effects &&
      Math.abs(effects.observedGains[0]?.gain.value - expected) < 0.001
    );
  }, expected);
}
async function startClassic(page: Page, touch = false) {
  assert.equal(
    await page.locator('[data-mode="classic"]').getAttribute("aria-pressed"),
    "true",
  );
  const play = page.locator('[data-action="play"]');
  if (touch) await play.tap();
  else await play.click();
  await page.waitForFunction(
    () =>
      !(document.querySelector("#game") as HTMLElement).hidden &&
      !(document.querySelector("#fire-button") as HTMLButtonElement).disabled,
  );
}
async function noShotOrPause(page: Page, shots = "0") {
  await page.waitForTimeout(120);
  assert.equal(await page.locator("#shots").innerText(), shots);
  assert.equal(await page.locator("#overlay").isVisible(), false);
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await instrument(page);
  await page.goto(base);
  assert.equal(await page.locator("audio[data-smashy-music]").count(), 0);
  await trigger(page).click();
  assert(await page.locator("#audio-flyout").isVisible());
  assert.equal(await page.locator(".audio-flyout-row").count(), 2);
  assert.equal(await trigger(page).getAttribute("aria-expanded"), "true");
  assert.equal(await page.locator("#audio-music-volume").inputValue(), "0.08");
  assert.equal(await page.locator("#audio-sound-volume").inputValue(), "0.35");
  assert.equal(await page.locator("#audio-music-level").innerText(), "8%");
  assert.equal(await page.locator("#audio-sound-level").innerText(), "35%");
  for (const channel of ["music", "sound"])
    assert.equal(
      await page.locator(`#audio-${channel}-mute`).getAttribute("aria-pressed"),
      "false",
    );
  await playing(page);
  await gain(page, 0.08);
  await effectsGain(page, 0.35);
  checks.push(
    "Two-row flyout opens without toggling either channel; defaults are music 8% and effects 35%, with native music playing at gain 0.08",
  );

  await page.locator("#audio-music-mute").click();
  assert.equal((await mix(page)).musicMuted, true);
  assert.equal((await mix(page)).muted, false);
  await page.locator("#audio-sound-mute").click();
  assert.equal((await mix(page)).muted, true);
  await page.locator("#audio-music-mute").click();
  assert.equal((await mix(page)).musicMuted, false);
  assert.equal((await mix(page)).muted, true);
  await setRange(page, "#audio-music-volume", "0.19");
  await setRange(page, "#audio-sound-volume", "0.47");
  assert.equal((await mix(page)).musicVolume, 0.19);
  assert.equal((await mix(page)).volume, 0.47);
  assert.equal((await mix(page)).muted, true);
  await gain(page, 0.19);
  await effectsGain(page, 0);
  await page.locator("#audio-sound-mute").click();
  await effectsGain(page, 0.47);
  assert.equal((await mix(page)).musicVolume, 0.19);
  assert.equal((await mix(page)).musicMuted, false);
  checks.push(
    "Music/effects mute and volumes change independently; adjusting a muted effects slider preserves its mute",
  );

  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#audio-flyout").isVisible(), false);
  assert.equal(await trigger(page).getAttribute("aria-expanded"), "false");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.locator("#setting-music-volume").inputValue(),
    "0.19",
  );
  assert.equal(await page.locator("#setting-volume").inputValue(), "0.47");
  assert(await page.locator("#setting-muted").isChecked());
  await page.locator("#setting-music").uncheck();
  await setRange(page, "#setting-music-volume", "0.13");
  await setRange(page, "#setting-volume", "0.55");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await trigger(page).click();
  assert.equal(await page.locator("#audio-music-volume").inputValue(), "0.13");
  assert.equal(await page.locator("#audio-sound-volume").inputValue(), "0.55");
  assert.equal(
    await page.locator("#audio-music-mute").getAttribute("aria-pressed"),
    "true",
  );
  await page.reload();
  assert.equal(await page.locator("audio[data-smashy-music]").count(), 0);
  await trigger(page).click();
  assert.equal(await page.locator("#audio-music-volume").inputValue(), "0.13");
  assert.equal(await page.locator("#audio-sound-volume").inputValue(), "0.55");
  assert.equal(
    await page.locator("#audio-music-mute").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page.locator("#audio-sound-mute").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(await page.locator("audio[data-smashy-music]").count(), 0);
  checks.push(
    "Settings and flyout synchronize in both directions, reload preserves independent levels/mutes, and saved music mute prevents media creation",
  );
  await page.locator("#audio-music-mute").click();
  await playing(page);
  await page.keyboard.press("Escape");
  await startClassic(page);
  await trigger(page).click();
  const angle = await page.locator("#angle").innerText();
  const musicSlider = page.locator("#audio-music-volume");
  await musicSlider.focus();
  for (const key of ["ArrowRight", "ArrowLeft", "Space", "Enter", "m"])
    await musicSlider.press(key);
  assert.equal(await page.locator("#angle").innerText(), angle);
  await noShotOrPause(page);
  await page.locator("#audio-sound-volume").focus();
  await page.keyboard.press("Tab");
  assert(
    await page
      .locator(".audio-flyout-close")
      .evaluate((el) => el === document.activeElement),
  );
  await page.keyboard.press("Shift+Tab");
  assert(
    await page
      .locator("#audio-sound-volume")
      .evaluate((el) => el === document.activeElement),
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#audio-flyout").isVisible(), false);
  await noShotOrPause(page);
  assert(await trigger(page).evaluate((el) => el === document.activeElement));
  await trigger(page).click();
  const board = await page.locator("#input").boundingBox();
  assert(board);
  await page.mouse.click(
    board.x + board.width * 0.45,
    board.y + board.height * 0.45,
  );
  assert.equal(await page.locator("#audio-flyout").isVisible(), false);
  await noShotOrPause(page);
  await page.locator("#fire-button").click();
  await page.waitForFunction(
    () => document.querySelector("#shots")?.textContent === "1",
  );
  checks.push(
    "Slider arrows/Space/Enter/m do not aim, shoot or pause; Tab wraps; Escape restores trigger focus without pausing; outside-board dismissal does not shoot, and subsequent Fire still works",
  );

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 664 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await trigger(page).click();
    const measured = await page.locator("#audio-flyout").evaluate((panel) => ({
      panel: panel.getBoundingClientRect().toJSON(),
      scrollWidth: panel.scrollWidth,
      clientWidth: panel.clientWidth,
      controls: [...panel.querySelectorAll("button,input")].map((el) => ({
        id: el.id || el.className,
        rect: el.getBoundingClientRect().toJSON(),
      })),
    }));
    const rect = measured.panel;
    assert(
      rect.x >= 0 &&
        rect.y >= 0 &&
        rect.right <= viewport.width + 1 &&
        rect.bottom <= viewport.height + 1,
      `Flyout bounds ${JSON.stringify(viewport)}`,
    );
    assert(
      measured.scrollWidth <= measured.clientWidth + 1,
      "No horizontal flyout overflow",
    );
    for (const item of measured.controls) {
      assert(
        item.rect.width >= 44 && item.rect.height >= 44,
        `44px target ${item.id}`,
      );
      assert(
        item.rect.x >= rect.x &&
          item.rect.right <= rect.right + 1 &&
          item.rect.y >= rect.y &&
          item.rect.bottom <= rect.bottom + 1,
        `Visible control ${item.id}`,
      );
    }
    geometry.push({ viewport, ...measured });
    await page.keyboard.press("Escape");
  }
  checks.push(
    "Six emulated viewport geometries keep the flyout and all 44px controls in view without horizontal overflow",
  );
  await context.close();

  for (const scenario of [
    { name: "fresh-default", saved: undefined },
    {
      name: "saved-mutes",
      saved: { musicMuted: true, musicVolume: 0.19, muted: true, volume: 0.27 },
    },
    {
      name: "saved-zero-volume",
      saved: { musicMuted: false, musicVolume: 0, muted: false, volume: 0 },
    },
  ]) {
    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 664 },
      hasTouch: true,
      isMobile: true,
    });
    const touchPage = await touchContext.newPage();
    await instrument(touchPage, true, scenario.saved);
    await touchPage.goto(base);
    assert.equal(
      await touchPage.locator("audio[data-smashy-music]").count(),
      0,
    );
    await startClassic(touchPage, true);
    const preferences = await mix(touchPage);
    if (!scenario.saved) {
      await playing(touchPage);
      await gain(touchPage, 0.08);
      assert.equal(preferences.musicMuted, false);
      assert.equal(preferences.muted, false);
      assert.equal(preferences.musicVolume, 0.08);
      assert.equal(preferences.volume, 0.35);
      const events = await touchPage.evaluate(
        () => (window as any).flyoutAudio.events,
      );
      assert(
        events.some(
          (e: any) =>
            e.operation === "resume" &&
            e.gesture === "pointerdown" &&
            !e.accepted,
        ),
        "Policy rejects pointerdown resume",
      );
      assert(
        events.some(
          (e: any) =>
            e.operation === "play" &&
            e.gesture === "pointerdown" &&
            !e.accepted,
        ),
        "Policy rejects pointerdown media play",
      );
      assert(
        events.some(
          (e: any) =>
            e.operation === "resume" &&
            ["touchend", "click"].includes(e.gesture) &&
            e.accepted,
        ),
        "Completed first tap retries pending resume",
      );
      const firstPlay = events.find(
        (e: any) => e.operation === "play" && e.accepted,
      );
      assert(firstPlay && ["touchend", "click"].includes(firstPlay.gesture));
      assert(Math.abs(firstPlay.gain - 0.08) < 0.001);
      await touchPage.waitForFunction(() => {
        const data = (window as any).flyoutAudio;
        return (
          data.contexts.length >= 2 &&
          data.contexts.every(
            (context: AudioContext) => context.state === "running",
          )
        );
      });
      const recovered = await touchPage.evaluate(() => {
        const data = (window as any).flyoutAudio;
        return data.contexts
          .filter((context: any) => context !== data.musicContext)
          .map((context: any) => ({
            id: context.policyId,
            state: context.state,
          }));
      });
      assert(
        recovered.length >= 1,
        "First completed tap unlocks SFX as well as music",
      );
      await effectsGain(touchPage, 0.35);
      for (const context of recovered)
        assert(
          events.some(
            (event: any) =>
              event.operation === "resume" &&
              event.context === context.id &&
              ["touchend", "click"].includes(event.gesture) &&
              event.accepted,
          ),
          "SFX resume occurs synchronously inside completed trusted tap",
        );
      assert(
        events.some(
          (event: any) => event.reason === "one-shot SFX NotAllowedError",
        ),
        "Fixture exercises a retryable SFX activation rejection",
      );
    } else {
      for (const [key, value] of Object.entries(scenario.saved))
        assert.equal(preferences[key], value, `Preserve ${key}`);
      assert.equal(
        await touchPage.locator("audio[data-smashy-music]").count(),
        0,
      );
      await effectsGain(touchPage, 0);
    }
    await trigger(touchPage).tap();
    assert(await touchPage.locator("#audio-flyout").isVisible());
    await noShotOrPause(touchPage);
    await touchPage.locator(".audio-flyout-close").tap();
    await noShotOrPause(touchPage);
    policyCases.push({
      name: scenario.name,
      preferences,
      events: await touchPage.evaluate(
        () => (window as any).flyoutAudio.events,
      ),
      contextStates: await touchPage.evaluate(() =>
        (window as any).flyoutAudio.contexts.map((context: any) => ({
          id: context.policyId,
          state: context.state,
          music: context === (window as any).flyoutAudio.musicContext,
        })),
      ),
      media: await touchPage
        .locator("audio[data-smashy-music]")
        .evaluateAll((elements) =>
          elements.map((element) => ({
            paused: (element as HTMLAudioElement).paused,
            time: (element as HTMLAudioElement).currentTime,
          })),
        ),
    });
    await touchContext.close();
  }
  checks.push(
    "Trusted emulated touch opens/closes the flyout without a shot; completed first Home Classic tap starts native music at 8% under a pointerdown-denying resume/media policy and recovers SFX after one injected NotAllowedError, while saved mutes and zero volumes remain silent",
  );
  assert.deepEqual(errors, []);
  assert.equal(
    await servedHash(),
    htmlAtStart,
    "Served HTML stayed frozen during checks",
  );
  verified = true;
} catch (error) {
  failure =
    error instanceof Error ? error.stack || error.message : String(error);
  throw error;
} finally {
  fs.mkdirSync("review", { recursive: true });
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        verified,
        at: new Date().toISOString(),
        base,
        browser: browser.version(),
        htmlSha256: htmlAtStart,
        checks,
        geometry,
        policyCases,
        errors,
        failure,
      boundary:
        "Headless installed Chrome, native AudioContext/media, trusted Playwright mouse/keyboard/touch input, emulated viewport geometry, an injected stricter completed-gesture policy and a one-shot SFX NotAllowedError. This does not certify physical iOS/Safari, physical touchscreen interaction, speaker/headphone output, or subjective audio comfort.",
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify({ verified, checks, reportPath }, null, 2));
