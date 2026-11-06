import "./style.css";
import "./ui/help.css";
import "./ui/records.css";
import "./ui/puzzles.css";
import "./ui/home.css";
import "./ui/audio-flyout.css";
import { mountAudioFlyout } from "./ui/audio-flyout";
import { mountHelpDialog, type HelpDialogView } from "./ui/help";
import workshopArt from "../public/art/ready/workshop-night-ready-v1.webp";
import wordmarkArt from "../public/art/ready/smashy-wordmark-ready-v1.png";
import primaryLogoArt from "../public/art/ready/smashy-logo-primary-ready-v1.png";
import { PRODUCTION_CHARACTER_ART } from "./render/production-art";
import { randomId } from "./platform";
import { desktopArena, isWideDesktop } from "./desktop-arena";
import {
  createGame,
  getConfig,
  makeConfig,
  nextRandom,
  isFloorFull,
  traceShot,
  resolveShot,
  cellCenter,
  pointOnTrace,
  cloneState,
  validateState,
  TYPE_NAMES,
  type GameState,
  type Profile,
  type Resolution,
  type Trace,
  type Award,
  type Difficulty,
} from "./core";
import { LESSONS, lessonGame } from "./content/lessons";
import { applyUndo, canUndoShot, UNDO_PENALTY } from "./undo";
import { PUZZLES, puzzleGame, PUZZLE_CONTENT_VERSION } from "./content/puzzles";
import { version as appVersion } from "../package.json";
import {
  createProgress,
  validateProgress,
  isRunTerminal,
  advanceBoard,
  earnedPuzzleCompletion,
  type RunProgress,
} from "./progression";
import {
  createScoreStore,
  categoryKey,
  type ScoreCategory,
  type TerminalReceipt,
} from "./persistence";
import { createBoardRenderer } from "./render";
import { apparatusLayout } from "./render/layout";
import { flightPresentationSpeed } from "./render/flight";
import { SmashyAudio } from "./audio";
import { DROP_REWARD_CLIPS } from "./audio/reward-clips";
import { SmashyMusic, MUSIC_DEFAULT_VOLUME } from "./audio/music";
import { MUSIC_TRACKS } from "./audio/playlist";
import {
  createReplay,
  appendReplay,
  undoReplay,
  validateReplay,
  type ShotReplay,
} from "./replay";

const $ = <T extends HTMLElement = HTMLElement>(s: string) =>
  document.querySelector<T>(s)!;
const icons: Record<string, string> = {
  trophy:
    '<path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 1v6m-4 2h8"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.4 9a2.7 2.7 0 1 1 4.3 2.2c-1 .6-1.7 1-1.7 2.8m0 3h.01"/>',
  sound:
    '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 5 6m0-6-5 6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1"/>',
  gear: '<path d="M18.93 9.13L19.34 10.44L21.85 10.26L21.85 13.74L19.34 13.56L18.93 14.87L18.93 14.87L18.29 16.08L20.19 17.74L17.74 20.19L16.08 18.29L14.87 18.93L14.87 18.93L13.56 19.34L13.74 21.85L10.26 21.85L10.44 19.34L9.13 18.93L9.13 18.93L7.92 18.29L6.26 20.19L3.81 17.74L5.71 16.08L5.07 14.87L5.07 14.87L4.66 13.56L2.15 13.74L2.15 10.26L4.66 10.44L5.07 9.13L5.07 9.13L5.71 7.92L3.81 6.26L6.26 3.81L7.92 5.71L9.13 5.07L9.13 5.07L10.44 4.66L10.26 2.15L13.74 2.15L13.56 4.66L14.87 5.07L14.87 5.07L16.08 5.71L17.74 3.81L20.19 6.26L18.29 7.92L18.93 9.13Z"/><circle cx="12" cy="12" r="3.1"/>',
};
const svg = (name: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
const iconButton = (action: string, label: string, icon: string) =>
  `<button class="icon" data-action="${action}" aria-label="${label}" title="${label}">${svg(icon)}</button>`;
const commands = (home = false) =>
  `<div class="actions">${iconButton("records", "Personal bests", "trophy")}${iconButton("help", "How to play", "help")}${iconButton("sound", "Audio controls", "sound")}${iconButton(home ? "settings" : "pause", home ? "Settings" : "Pause", home ? "gear" : "pause")}</div>`;
$("#app").innerHTML = `
<section id="home"><header class="home-top"><span class="brand-small">smashy</span>${commands(true)}</header><main class="home-main"><div class="home-identity"><div class="eyebrow">A quiet night. One good shot.</div><h1 class="wordmark">smashy</h1><p class="home-tagline">One good shot. A whole lot of smash.</p></div><div class="home-copy"><div class="setup"><label>Difficulty<select id="difficulty"><option value="standard">Standard</option></select></label><label>Board layout<select id="profile"><option value="standard">Standard · desktop</option><option value="compact">Compact · smaller screens</option></select></label></div><p class="home-best" id="home-best"></p><div class="home-actions"><button class="primary home-start" data-action="play">New Classic game</button><button class="home-start quiet" data-action="resume-saved" id="resume-saved" hidden>Resume Classic</button></div><p class="home-resume-summary" id="resume-summary" hidden></p><div class="home-secondary"><button data-action="lessons">Learn by smashing</button></div><p id="home-storage" class="saved-notice" hidden></p></div><div class="home-art" aria-hidden="true"><div class="toy chip">••</div><div class="toy gum">••</div><div class="toy rivet">••</div><p class="art-caption">SMALL TOYS. BIG CHAIN REACTIONS.</p></div></main><footer class="home-foot"><span>v${appVersion} · Classic · Puzzles · Journey · Custom</span><span>Mouse to aim · Click to fire · Space to fire · Esc to pause</span></footer></section>
<section id="game" hidden aria-label="Smashy game"><div id="play-layout"><div class="stage-slot" id="stage"><div id="canvas-host"></div><span class="stage-label" id="next-caption" role="img" aria-label="Next toy">Next</span><span class="stage-label limit-caption" id="limit-caption">Limit</span><div class="input-surface" id="input" tabindex="0" role="application" aria-label="Aim with arrow keys, Shift for fine aim. Space fires. Escape pauses."></div><div class="touch-pad" id="touch-pad" aria-label="Drag to aim, release to fire"><span class="pad-caption">Slide to aim · release to fire</span></div><div class="announcement" id="announcement" hidden></div><div class="overlay" id="overlay" hidden><div class="overlay-card" id="overlay-card"></div></div></div><aside class="rail"><div class="rail-top"><span class="brand-small">smashy</span>${commands()}<div class="context run-label" id="run-label"></div></div><div class="hud"><div class="score"><span class="label">Score <span id="new-best" class="pill" hidden>New best</span></span><span class="score-value" id="score">0</span></div><div><span class="label">Best</span><span class="stat-value best-value" id="best">—</span></div><div><span class="label">Shots <span id="target-hint"></span></span><span class="stat-value" id="shots">0</span></div><div class="danger-block"><div class="danger-title"><span>Danger</span><span id="danger-value">0 / 8</span></div><div class="danger-meter" id="danger-meter"></div><div class="danger-note" id="danger-note"></div></div></div><div class="rail-bottom"><span id="assist-label" class="pill" hidden>Assisted</span><div class="status-line" id="status-line"></div><div class="rail-hint">Aim <span class="angle" id="angle">90°</span><br><span id="input-hint">Move to aim · Click to fire<br>Arrows + Shift for fine aim</span></div><div class="bottom-controls"><button data-action="guide" id="guide-button">Guide off</button><button data-action="undo" id="undo-button" disabled>Undo</button><button data-action="fire" id="fire-button">Fire</button></div><div class="cancel-strip" id="cancel-strip">Release here to cancel</div><div class="saved-notice" id="storage-note"></div></div></aside></div></section>
<dialog id="dialog"><div class="dialog-shell"><header class="dialog-head"><h2 id="dialog-title"></h2>${iconButton("close-dialog", "Close", "close")}</header><div class="dialog-body" id="dialog-body"></div><footer class="dialog-foot" id="dialog-foot"></footer></div></dialog><div class="sr-only" id="live" role="status" aria-live="polite"></div>`;

$("#home .wordmark").innerHTML =
  '<img src="' + primaryLogoArt + '" alt="Smashy">';
$("#home .home-art").innerHTML =
  PRODUCTION_CHARACTER_ART.slice(0, 3)
    .map(
      (a, i) =>
        '<img class="home-toy home-toy-' + i + '" src="' + a.url + '" alt="">',
    )
    .join("") + '<p class="art-caption">SMALL TOYS. BIG CHAIN REACTIONS.</p>';
const header = document.createElement("header");
header.className = "game-header";
header.innerHTML =
  '<img class="game-logo" src="' +
  wordmarkArt +
  '" alt="Smashy"><div class="game-heading"><div id="mode-title"></div></div>';
header.querySelector(".game-heading")!.appendChild($("#run-label"));
document.documentElement.style.setProperty(
  "--workshop-art",
  `url("${workshopArt}")`,
);
header.appendChild($("#game .actions"));
$("#play-layout").prepend(header);
$("#game .rail-top").hidden = true;
$("#undo-button").innerHTML =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 4 2 10l6 6M3 10h11a7 7 0 0 1 0 14"/></svg><span>Undo shot</span>';
$("#undo-button").setAttribute("aria-label", "Undo");
$("#fire-button").innerHTML =
  '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 20 15-15M9 5h10v10"/></svg><span>Fire</span>';
// The aiming surface lives outside the board, as in the touch screen designs.
// Keep it connected when changing orientation so pointer capture survives refits.
const touchDeck = document.createElement("div");
touchDeck.className = "touch-deck";
const touchPad = $("#touch-pad");
touchPad.innerHTML =
  '<svg class="aim-hand" viewBox="0 0 140 86" aria-hidden="true"><path d="M42 17H10m9-8-9 8 9 8m79-8h32m-9-8 9 8-9 8M63 50V23c0-10 12-10 12 0v20-7c0-8 11-8 11 0v9-5c0-8 11-8 11 0v10-3c0-8 11-8 11 0v13c0 16-10 23-23 23-12 0-18-6-24-14L48 52c-6-8 3-14 9-7l6 5Z"/></svg><strong>Drag to aim</strong><span class="pad-caption">Release to fire</span>';
touchDeck.append(touchPad);
const guideTools = $("#guide-button").parentElement!;
guideTools.classList.add("guide-tools");
const fireDock = document.createElement("div");
fireDock.className = "fire-dock";
const fireControls = document.createElement("div");
fireControls.className = "bottom-controls fire-controls";
fireControls.append($("#fire-button"));
fireDock.append(fireControls, $("#cancel-strip"));
$("#game .rail-bottom").append(fireDock);
$("#cancel-strip").innerHTML = svg("close") + "<span>Cancel</span>";
$("#cancel-strip").setAttribute("aria-label", "Release here to cancel");
$("#game .rail").append(touchDeck);
$("#game .hud").append($("#storage-note"));
$<HTMLSelectElement>("#difficulty").innerHTML = [
  "gentle",
  "relaxed",
  "standard",
  "tricky",
  "expert",
]
  .map(
    (d) =>
      `<option value="${d}" ${d === "standard" ? "selected" : ""}>${d[0].toUpperCase() + d.slice(1)}</option>`,
  )
  .join("");
$("#home .setup").insertAdjacentHTML(
  "beforebegin",
  '<div class="mode-tabs" aria-label="Game mode"><button data-mode="classic" aria-pressed="true">Classic</button><button data-mode="puzzles" aria-pressed="false">Puzzles</button><button data-mode="journey" aria-pressed="false">Journey</button><button data-mode="custom" aria-pressed="false">Custom</button></div><button id="mode-config" class="mode-config quiet" hidden></button><p id="mode-description" class="small muted"></p>',
);

$("#game .actions").insertAdjacentHTML(
  "afterbegin",
  '<span class="mobile-context" id="mobile-context"></span>',
);
interface Settings {
  undoPenalty: boolean;
  allowLockedPuzzles: boolean;
  muted: boolean;
  volume: number;
  musicMuted: boolean;
  musicVolume: number;
  reduced: boolean;
  reducedDecoration: boolean;
  guide: boolean;
  input: "release" | "fire";
  intensity: number;
  glyphs: boolean;
  brightness: number;
}
const defaults: Settings = {
  undoPenalty: true,
  allowLockedPuzzles: false,
  muted: false,
  volume: 0.35,
  musicMuted: false,
  musicVolume: MUSIC_DEFAULT_VOLUME,
  reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  reducedDecoration: false,
  guide: false,
  input: "release",
  intensity: 1,
  glyphs: false,
  brightness: 1,
};
let settings = { ...defaults };
try {
  const s = JSON.parse(localStorage.getItem("smashy.settings.v1") || "null");
  if (s && typeof s === "object") {
    for (const k of [
      "undoPenalty",
      "allowLockedPuzzles",
      "muted",
      "musicMuted",
      "reduced",
      "reducedDecoration",
      "guide",
      "glyphs",
    ] as const)
      if (typeof s[k] === "boolean") settings[k] = s[k];
    if (typeof s.volume === "number" && s.volume >= 0 && s.volume <= 1)
      settings.volume = s.volume;
    if (
      typeof s.musicVolume === "number" &&
      Number.isFinite(s.musicVolume) &&
      s.musicVolume >= 0 &&
      s.musicVolume <= 1
    )
      settings.musicVolume = s.musicVolume;
    if (s.input === "fire" || s.input === "release") settings.input = s.input;
    if (s.intensity >= 0.7 && s.intensity <= 1)
      settings.intensity = s.intensity;
    if (s.brightness >= 0.75 && s.brightness <= 1)
      settings.brightness = s.brightness;
  }
} catch {}
let game: GameState | null = null,
  initial: GameState | null = null,
  undo: GameState | null = null;
let runId = "",
  lesson: number | null = null,
  angle = 90,
  guide = settings.guide,
  paused = false,
  needsSpace = false,
  started = false,
  busy = false,
  stale = false;
let receipt: TerminalReceipt | undefined,
  forecast: Trace | null = null;
let lastAward: Award | null = null;
let terminalRevealAt = 0;
let settleRemaining = 0;
let replay: ShotReplay | null = null;
let flight: {
  angle: number;
  resolution: Resolution;
  distance: number;
  bounce: number;
  speed: number;
} | null = null;
let renderer: Awaited<ReturnType<typeof createBoardRenderer>> | null = null;
let helpView: HelpDialogView | null = null;
let helpPane = 0,
  previousFocus: HTMLElement | null = null,
  storageNotice = "",
  statusText = "",
  statusUntil = 0;
let recordView: "top" | "recent" = "top";
let recordCategory: ScoreCategory | null = null;
let gesture: {
  id: number;
  start: number;
  base: number;
  max: number;
  armed: boolean;
} | null = null;
let activePointers = new Set<number>();
let touchMode =
  navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
let suppressedTouchClick: { x: number; y: number; until: number } | null = null;
type PlayMode = "classic" | "puzzles" | "journey" | "custom";
let selectedMode: PlayMode = "classic";
let selectedPuzzle = 0;
let progress = createProgress("classic", "standard");
let initialProgress = structuredClone(progress);
let customValues = {
  columns: 11,
  rows: 15,
  startRows: 6,
  types: 5,
  anchors: 0,
  dangerThreshold: 8,
  target: 120,
};
let completed: Record<Profile, number> = { standard: 0, compact: 0 };
function homeProgress() {
  const p = createProgress(
    selectedMode,
    $<HTMLSelectElement>("#difficulty").value as Difficulty,
    selectedPuzzle,
    selectedMode === "puzzles" &&
      selectedPuzzle >
        completed[$<HTMLSelectElement>("#profile").value as Profile],
  );
  if (selectedMode === "custom") p.configId = customIdentity();
  if (
    $<HTMLSelectElement>("#profile").value === "standard" &&
    ["classic", "journey"].includes(p.mode)
  )
    p.configId += "-desktop-v2";
  return p;
}
function customIdentity() {
  return "custom-v1-" + Object.values(customValues).join("-");
}
interface Checkpoint {
  replay?: ShotReplay | null;
  contentVersion?: number;
  progress?: RunProgress;
  initialProgress?: RunProgress;
  lastAward?: Award | null;
  v: 1;
  game: GameState;
  initial: GameState;
  undo: GameState | null;
  runId: string;
  lesson: number | null;
  angle: number;
  guide: boolean;
}
const validCheckpoint = (v: unknown): v is Checkpoint => {
  const x = v as Checkpoint;
  return (
    !!x &&
    x.v === 1 &&
    (x.contentVersion === undefined ||
      x.contentVersion === PUZZLE_CONTENT_VERSION) &&
    validateState(x.game) &&
    validateState(x.initial) &&
    (x.undo === null || validateState(x.undo)) &&
    typeof x.runId === "string" &&
    x.runId.length > 0 &&
    (x.lesson === null ||
      (Number.isInteger(x.lesson) && x.lesson >= 0 && x.lesson < 3)) &&
    Number.isFinite(x.angle) &&
    x.angle >= 5 &&
    x.angle <= 175 &&
    typeof x.guide === "boolean" &&
    (x.progress === undefined || validateProgress(x.progress)) &&
    (x.initialProgress === undefined || validateProgress(x.initialProgress)) &&
    (x.replay == null ||
      (validateReplay(x.replay) &&
        x.replay.contentVersion === PUZZLE_CONTENT_VERSION)) &&
    (x.lastAward == null ||
      ["match", "drop", "clear", "efficiency", "total"].every(
        (k) =>
          Number.isSafeInteger(x.lastAward![k as keyof Award]) &&
          x.lastAward![k as keyof Award] >= 0,
      ))
  );
};
const owner = randomId();
const store = createScoreStore<Checkpoint>(owner, {
  validateCheckpoint: validCheckpoint,
});
const audio = new SmashyAudio(DROP_REWARD_CLIPS);
const music = new SmashyMusic(MUSIC_TRACKS, { onChange: updateMusicControls });
const audioFlyout = mountAudioFlyout({
  getMix: () => ({
    musicMuted: settings.musicMuted,
    musicVolume: settings.musicVolume,
    soundMuted: settings.muted,
    soundVolume: settings.volume,
    status:
      [
        music.state === "blocked"
          ? "Tap a control to start music."
          : music.state === "unavailable"
            ? "Music unavailable. Reload to retry."
            : music.state === "paused"
              ? started
                ? "Music paused with the game."
                : "Music starts when you play."
              : "",
        !audio.available
          ? "Sound effects unavailable."
          : audio.state === "blocked"
            ? "Tap a control to start sound effects."
            : "",
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  }),
  onMute: (channel) => {
    if (channel === "music") {
      const unmute = settings.musicMuted || settings.musicVolume === 0;
      settings.musicMuted = !unmute;
      if (unmute && settings.musicVolume === 0)
        settings.musicVolume = MUSIC_DEFAULT_VOLUME;
    } else {
      const unmute = settings.muted || settings.volume === 0;
      settings.muted = !unmute;
      if (unmute && settings.volume === 0) settings.volume = 0.35;
    }
    applySettings();
    music.startFromGesture();
    void unlockAudio();
  },
  onVolume: (channel, volume) => {
    if (channel === "music") settings.musicVolume = volume;
    else settings.volume = volume;
    applySettings();
    music.startFromGesture();
    void unlockAudio();
  },
});
music.setPaused(true); // Home and its dialogs are quiet until gameplay starts.
function applySettings() {
  const caption = document.querySelector(".pad-caption");
  if (caption)
    caption.textContent =
      settings.input === "fire" ? "Then press Fire" : "Release to fire";
  document.body.classList.toggle("reduced-motion", settings.reduced);
  document.body.classList.toggle("simple-backdrop", settings.reducedDecoration);
  $("#game").style.filter = `saturate(${settings.intensity})`;
  $("#canvas-host").style.filter = `brightness(${settings.brightness})`;
  audio.setMuted(settings.muted);
  audio.setVolume(settings.volume);
  music.setPreferences(settings.musicMuted, settings.musicVolume);
  updateSoundControls();
  syncAudioSettings();
  try {
    localStorage.setItem("smashy.settings.v1", JSON.stringify(settings));
  } catch {}
}
function updateMusicControls() {
  const status = document.querySelector("#music-status");
  if (status)
    status.textContent =
      music.state === "unavailable"
        ? "Music is unavailable right now. Reload to retry; gameplay still works."
        : music.state === "muted"
          ? "Music muted. Your place in the playlist is kept."
          : music.state === "locked" || music.state === "blocked"
            ? "Starts after your first tap or click."
            : music.state === "gap"
              ? `Five-second break · next: ${music.track.title}`
              : music.state === "paused"
                ? started && paused
                  ? "Music paused with the game."
                  : started
                    ? "Music paused while this tab is away."
                    : "Music starts when you play."
                : `${music.state === "loading" ? "Loading" : "Playing"}: ${music.track.title}`;
  const output = document.querySelector("#music-volume-value");
  if (output) output.textContent = `${Math.round(settings.musicVolume * 100)}%`;
  updateSoundControls();
}
function updateSoundControls() {
  const audible =
    (!settings.muted && settings.volume > 0 && audio.available) ||
    (!settings.musicMuted &&
      settings.musicVolume > 0 &&
      music.state !== "unavailable");
  document
    .querySelectorAll<HTMLButtonElement>('[data-action="sound"]')
    .forEach((button) => {
      const icon = audible ? "sound" : "mute";
      if (button.dataset.audioIcon !== icon) {
        button.innerHTML = svg(icon);
        button.dataset.audioIcon = icon;
      }
      button.setAttribute("aria-label", "Audio controls");
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "audio-flyout");
      if (!button.hasAttribute("aria-expanded"))
        button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-pressed");
      button.removeAttribute("aria-description");
      button.title = "Music and sound controls";
    });
  audioFlyout.update();
}
function syncAudioSettings() {
  const musicToggle =
    document.querySelector<HTMLInputElement>("#setting-music");
  if (musicToggle) musicToggle.checked = !settings.musicMuted;
  const soundToggle =
    document.querySelector<HTMLInputElement>("#setting-muted");
  if (soundToggle) soundToggle.checked = !settings.muted;
  const soundVolume =
    document.querySelector<HTMLInputElement>("#setting-volume");
  if (soundVolume) soundVolume.value = String(settings.volume);
  const musicVolume = document.querySelector<HTMLInputElement>(
    "#setting-music-volume",
  );
  if (musicVolume) musicVolume.value = String(settings.musicVolume);
}

async function unlockAudio() {
  const available = await audio.unlock();
  updateSoundControls();
  return available;
}
applySettings();
const category = (): ScoreCategory => ({
  mode: started ? progress.mode : selectedMode,
  difficulty:
    (started ? progress.mode : selectedMode) === "custom"
      ? "custom"
      : started
        ? progress.startDifficulty
        : ($<HTMLSelectElement>("#difficulty").value as Difficulty),
  rulesVersion: "1",
  layoutVersion: "1",
  layout:
    started && game
      ? game.config.profile
      : ($<HTMLSelectElement>("#profile").value as Profile),
  assisted:
    started && game
      ? game.assisted
      : settings.guide || !!homeProgress().puzzlePractice,
  configId: started ? progress.configId : homeProgress().configId,
});
const context = () => {
  const c = category();
  const title =
    c.mode === "tutorial"
      ? `Lesson ${(lesson ?? 0) + 1}`
      : c.mode[0].toUpperCase() + c.mode.slice(1);
  const config = started && game ? game.config : customValues;
  const extra =
    c.mode === "puzzles"
      ? ` · Starting puzzle ${(started ? progress.startPuzzleIndex : selectedPuzzle) + 1}${(started ? progress.puzzlePractice : homeProgress().puzzlePractice) ? " · Practice: no shelf unlocks" : ""}`
      : c.mode === "custom"
        ? ` · ${config.columns}×${config.rows}, ${config.startRows} starting rows, ${config.types} types, ${config.anchors} anchors, danger ${config.dangerThreshold}, target ${config.target}`
        : "";
  return `${title} · ${c.difficulty[0].toUpperCase() + c.difficulty.slice(1)} difficulty · ${c.layout === "compact" ? "Compact" : "Standard"} layout · ${c.assisted ? "Assisted" : "Unassisted"}${extra}${isWideDesktop(c.configId) ? " · Wide arena v2" : c.layout === "standard" && ["classic", "journey"].includes(c.mode) ? " · Legacy arena" : ""}`;
};
const checkpoint = (): Checkpoint => ({
  v: 1,
  contentVersion: PUZZLE_CONTENT_VERSION,
  game: cloneState(game!),
  initial: cloneState(initial!),
  undo: undo ? cloneState(undo) : null,
  runId,
  lesson,
  angle,
  guide,
  lastAward,
  progress: structuredClone(progress),
  initialProgress: structuredClone(initialProgress),
  replay: replay ? structuredClone(replay) : null,
});
function storageFeedback(r: { durable: boolean; reason?: string }) {
  completed = store.getPuzzleProgress();
  if (r.durable) {
    document.body.classList.remove("storage-failed");
    storageNotice = "";
    $("#storage-note").textContent = "";
    $("#home-storage").textContent = "";
  }
  if (r.reason === "stale-owner") {
    stale = true;
    pause();
    showStatus(
      "This board is active in another tab. Resume here to take control.",
      8000,
    );
    showOverlay();
  }
  if (!r.durable) {
    document.body.classList.add("storage-failed");
    storageNotice = "Scores aren't being saved in this browser right now.";
    $("#storage-note").textContent = storageNotice;
    $("#home-storage").textContent = storageNotice;
  }
  $("#home-storage").hidden = !storageNotice;
  if (started && game) updateHUD();
}
let writes = Promise.resolve();
function save() {
  if (!game || !initial || stale) return;
  const cp = checkpoint(),
    id = runId;
  writes = writes
    .then(async () => {
      storageFeedback(await store.checkpoint(id, cp, puzzleCompletion(cp)));
    })
    .catch(() => {
      storageNotice = "Scores aren't being saved in this browser right now.";
      $("#storage-note").textContent = storageNotice;
    });
}
function puzzleCompletion(cp: Checkpoint) {
  return cp.progress ? earnedPuzzleCompletion(cp.game, cp.progress) : undefined;
}
function showStatus(text: string, ms = 5000) {
  statusText = text;
  statusUntil = performance.now() + ms;
  $("#status-line").textContent = text;
  $("#live").textContent = text;
}
function updateHome() {
  if (selectedMode === "puzzles" && !settings.allowLockedPuzzles)
    selectedPuzzle = Math.min(
      selectedPuzzle,
      completed[$<HTMLSelectElement>("#profile").value as Profile],
      49,
    );
  const modeTitle = selectedMode[0].toUpperCase() + selectedMode.slice(1);
  $('[data-action="play"]').textContent = homeProgress().puzzlePractice
    ? `Practice puzzle ${selectedPuzzle + 1}`
    : `New ${modeTitle} game`;
  document
    .querySelectorAll<HTMLButtonElement>("[data-mode]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === selectedMode)),
    );
  $<HTMLSelectElement>("#difficulty").disabled =
    selectedMode === "puzzles" || selectedMode === "custom";
  $("#mode-description").textContent =
    selectedMode === "journey"
      ? "Keep your score as the difficulty climbs."
      : selectedMode === "puzzles"
        ? settings.allowLockedPuzzles
          ? "Locked puzzles are available for practice. Only earned clears unlock the shelf."
          : "Clear a puzzle to unlock the next. Padlocks mark puzzles not yet earned."
        : selectedMode === "custom"
          ? "Set your own board and pressure."
          : "No clock. Every shot is a chance to make room.";
  $("#mode-config").hidden =
    selectedMode !== "puzzles" && selectedMode !== "custom";
  $("#mode-config").textContent =
    selectedMode === "puzzles"
      ? `${selectedPuzzle > completed[$<HTMLSelectElement>("#profile").value as Profile] ? "Practice puzzle" : "Puzzle"} ${selectedPuzzle + 1} · ${PUZZLES[selectedPuzzle]?.title ?? "Choose a puzzle"}`
      : `Configure · ${customValues.columns} columns · ${customValues.types} types`;
  const best = store.getBest(category());
  $("#home-best").textContent =
    `Best ${best === null ? "—" : best.toLocaleString()} · ${category().assisted ? "Assisted" : "Unassisted"}`;
  $("#home-best").title = context();
  const saved = store.state().active?.checkpoint;
  const resumeButton = $("#resume-saved");
  resumeButton.hidden = !saved;
  $("#home").classList.toggle("home-has-save", !!saved);
  const finished =
    saved &&
    saved.game.status !== "ready" &&
    (!saved.progress || isRunTerminal(saved.game, saved.progress));
  const savedMode =
    saved?.progress?.mode ?? (saved?.lesson !== null ? "tutorial" : "classic");
  const savedName =
    savedMode === "puzzles"
      ? `${saved?.progress?.puzzlePractice ? "Practice puzzle" : "Puzzle"} ${(saved?.progress?.puzzleIndex ?? 0) + 1}`
      : savedMode === "tutorial"
        ? "lesson"
        : savedMode[0].toUpperCase() + savedMode.slice(1);
  resumeButton.textContent = finished
    ? "View last result"
    : `Resume ${savedName}`;
  resumeButton.title = finished
    ? "View the saved result. This does not start another game."
    : "Continue the saved board, score and toy order.";
  resumeButton.classList.toggle("primary", !!saved && !finished);
  $('[data-action="play"]').classList.toggle("primary", !saved || !!finished);
  $('[data-action="play"]').title =
    "Start a fresh game from the beginning. Resume continues your saved game instead.";
  $("#resume-summary").hidden = !saved;
  $("#resume-summary").textContent = saved
    ? `Saved ${savedName} · ${saved.game.score.toLocaleString()} points · ${saved.game.shots} shots`
    : "";
  try {
    localStorage.setItem(
      "smashy.home.v1",
      JSON.stringify({
        mode: selectedMode,
        profile: $<HTMLSelectElement>("#profile").value,
        difficulty: $<HTMLSelectElement>("#difficulty").value,
        puzzle: selectedPuzzle,
      }),
    );
  } catch {}
}
function selectMode(mode: PlayMode) {
  if (mode === "puzzles" && selectedMode !== "puzzles")
    selectedPuzzle = Math.min(
      completed[$<HTMLSelectElement>("#profile").value as Profile],
      49,
    );
  selectedMode = mode;
  if (mode === "puzzles")
    $<HTMLSelectElement>("#difficulty").value = "standard";
  updateHome();
  if (mode === "puzzles") showPuzzles();
  if (mode === "custom") showCustom();
}
async function showPuzzles() {
  if (started) pause();
  await writes;
  storageFeedback(await store.load());
  const profile = $<HTMLSelectElement>("#profile").value as Profile;
  const earned = completed[profile];
  openDialog(
    "The puzzle shelf",
    `<p class="shelf-progress"><strong>${earned} / 50 completed</strong> · ${profile === "compact" ? "Compact" : "Standard"}</p><p class="shelf-note">Clear each puzzle to unlock the next. Your earned progress is saved in this browser.</p>${settings.allowLockedPuzzles ? '<p class="shelf-practice">Practice access is on. Padlocked puzzles are playable, but do not earn unlocks.</p>' : '<p class="shelf-note">Grey padlocks mean locked. Settings can allow locked puzzles for practice.</p>'}${storageNotice ? '<p class="saved-notice">Puzzle progress is temporary in this session because storage is unavailable.</p>' : ""}<div class="puzzle-grid">${PUZZLES.map(
      (p, i) => {
        const locked = i > earned;
        return `<button class="puzzle-tile ${locked ? "is-locked" : i < earned ? "is-complete" : "is-next"}" data-puzzle="${i}" ${locked && !settings.allowLockedPuzzles ? "disabled" : ""} aria-label="Puzzle ${i + 1}: ${escapeHTML(p.title)}${locked ? (settings.allowLockedPuzzles ? ". Locked. Practice available" : ". Locked. Clear the previous puzzle first") : i < earned ? ". Completed" : ". Ready to play"}">${locked ? `<span class="puzzle-lock" aria-hidden="true">${svg("lock")}</span>` : i < earned ? '<span class="puzzle-check" aria-hidden="true">✓</span>' : '<span class="puzzle-next" aria-hidden="true">Next</span>'}<span class="puzzle-number">${i + 1}</span><small>${escapeHTML(p.title)}</small></button>`;
      },
    ).join("")}</div>`,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-puzzle]").forEach(
    (b) =>
      (b.onclick = () => {
        if (
          +b.dataset.puzzle! > completed[profile] &&
          !settings.allowLockedPuzzles
        )
          return;
        selectedPuzzle = +b.dataset.puzzle!;
        closeDialog();
        updateHome();
      }),
  );
}
function showCustom() {
  const fields: Record<keyof typeof customValues, [string, number, number]> = {
    columns: ["Long-row columns", 5, 19],
    rows: ["Maximum rows", 8, 24],
    startRows: ["Starting rows", 1, 21],
    types: ["Ordinary types", 2, 7],
    anchors: ["Anchors", 0, 100],
    dangerThreshold: ["Danger threshold", 1, 40],
    target: ["Efficiency target", 1, 1000],
  };
  openDialog(
    "Your workshop rules",
    `<p>Every value is checked before a new board begins. Large boards still need to fit the screen; a live board is never cropped.</p><form id="custom-form">${Object.entries(
      fields,
    )
      .map(
        ([key, [label, min, max]]) =>
          `<label class="setting-row"><span>${label}</span><input type="number" name="${key}" min="${min}" max="${max}" step="1" value="${customValues[key as keyof typeof customValues]}" required></label>`,
      )
      .join(
        "",
      )}<p id="custom-error" class="saved-notice" role="status"></p></form>`,
    `<button data-action="close-dialog">Cancel</button><button class="primary" id="custom-apply">Use these rules</button>`,
  );
  $("#custom-apply").onclick = () => {
    const form = $<HTMLFormElement>("#custom-form");
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(
      Object.keys(customValues).map((k) => [
        k,
        Number(new FormData(form).get(k)),
      ]),
    ) as typeof customValues;
    try {
      makeConfig({
        ...values,
        profile: $<HTMLSelectElement>("#profile").value as Profile,
        difficulty: "custom",
      });
      customValues = values;
      closeDialog();
      updateHome();
    } catch {
      $("#custom-error").textContent =
        "Leave at least three empty rows below the starting board. Anchors may occupy at most one third of starting slots. Check the other limits too.";
    }
  };
}
async function ensureRenderer() {
  if (!renderer) renderer = await createBoardRenderer($("#canvas-host"));
}
function currentSeed() {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  return seed === game?.seed ? (seed + 1) >>> 0 : seed;
}
async function newRun(
  which: number | null = null,
  retry = false,
  replace = false,
) {
  if (busy) return;
  if (!started) music.primeFromGesture();
  busy = true;
  try {
    await unlockAudio();
    await ensureRenderer();
    await writes;
    storageFeedback(await store.load());
    const profile =
      retry && initial
        ? initial.config.profile
        : ($<HTMLSelectElement>("#profile").value as Profile);
    if (
      !retry &&
      which === null &&
      selectedMode === "puzzles" &&
      !settings.allowLockedPuzzles
    )
      selectedPuzzle = Math.min(selectedPuzzle, completed[profile], 49);
    const nextProgress =
      retry && initial
        ? structuredClone(initialProgress)
        : createProgress(
            which !== null ? "tutorial" : selectedMode,
            $<HTMLSelectElement>("#difficulty").value as Difficulty,
            selectedPuzzle,
            which === null &&
              selectedMode === "puzzles" &&
              selectedPuzzle > completed[profile],
          );
    if (which !== null) {
      nextProgress.startDifficulty = "standard";
      nextProgress.configId = `lesson-${which}-v1`;
    }
    if (nextProgress.mode === "custom" && !retry)
      nextProgress.configId = customIdentity();
    if (
      !retry &&
      which === null &&
      profile === "standard" &&
      ["classic", "journey"].includes(nextProgress.mode)
    )
      nextProgress.configId += "-desktop-v2";
    const nextGame =
      retry && initial
        ? cloneState(initial)
        : which === null && nextProgress.mode === "puzzles"
          ? puzzleGame(nextProgress.puzzleIndex, profile, settings.guide)
          : which === null
            ? createGame({
                seed: currentSeed(),
                config:
                  nextProgress.mode === "custom"
                    ? makeConfig({
                        ...customValues,
                        profile,
                        difficulty: "custom",
                      })
                    : isWideDesktop(nextProgress.configId)
                      ? desktopArena(nextProgress.startDifficulty)
                      : getConfig(nextProgress.startDifficulty, profile),
                assisted: settings.guide,
              })
            : lessonGame(which, profile);
    const nextGuide = which !== null || settings.guide;
    nextGame.assisted = nextGuide || !!nextProgress.puzzlePractice;
    const id = randomId();
    const cp: Checkpoint = {
      v: 1,
      contentVersion: PUZZLE_CONTENT_VERSION,
      game: nextGame,
      initial: cloneState(nextGame),
      undo: null,
      runId: id,
      lesson: which,
      angle: 90,
      guide: nextGuide,
      progress: nextProgress,
      initialProgress: structuredClone(nextProgress),
      replay: createReplay(nextGame, PUZZLE_CONTENT_VERSION),
    };
    const r = await store.beginRun(id, cp, {
      takeover: replace,
      replaceIf: (saved) =>
        saved.game.status !== "ready" || saved.game.score === 0,
    });
    storageFeedback(r);
    if (!r.ok) {
      if (r.reason === "active-run-exists")
        confirmAction(
          retry ? "Restart this attempt?" : "Start a new board?",
          retry
            ? "This restarts the original layout and toy order from the beginning of this run. Your current attempt will be replaced; personal scores stay."
            : "A scored game is still in progress, possibly in another tab. This replaces that saved attempt; personal scores stay.",
          () => void newRun(which, retry, true),
          retry ? "Restart attempt" : "Replace saved game",
        );
      else
        openDialog(
          "Board could not start",
          "<p>Your saved board was preserved. Try Resume or reload this page.</p>",
        );
      return;
    }
    game = nextGame;
    replay = createReplay(nextGame, PUZZLE_CONTENT_VERSION);
    progress = nextProgress;
    initialProgress = structuredClone(nextProgress);
    initial = cloneState(nextGame);
    undo = null;
    runId = id;
    lesson = which;
    angle = 90;
    guide = nextGuide;
    flight = null;
    receipt = undefined;
    lastAward = null;
    terminalRevealAt = 0;
    settleRemaining = 0;
    stale = false;
    started = true;
    paused = false;
    music.setPaused(false);
    needsSpace = false;
    audio.cancelPresentation();
    renderer?.reset();
    cancelGesture();
    $("#home").hidden = true;
    $("#game").hidden = false;
    layout(false);
    updateForecast();
    updateHUD();
    showOverlay();
    $("#input").focus({ preventScroll: true });
    showStatus(
      which === null
        ? progress.mode === "puzzles"
          ? `Puzzle ${progress.puzzleIndex + 1}: ${PUZZLES[progress.puzzleIndex].hint}`
          : "Find a matching pair—or cut a support."
        : LESSONS[which].hint,
      which === null && progress.mode !== "puzzles" ? 10000 : Infinity,
    );
  } catch (e) {
    openDialog(
      "Unable to start",
      `<p>${escapeHTML(e instanceof Error ? e.message : "The graphics renderer could not start. Try an updated browser with graphics acceleration enabled.")}</p>`,
    );
  } finally {
    busy = false;
  }
}
async function resumeSaved() {
  if (busy) return;
  busy = true;
  try {
    await writes;
    const r = await store.resume(true);
    storageFeedback(r);
    const cp = r.envelope.active?.checkpoint;
    if (!r.ok || !cp || !validCheckpoint(cp)) return;
    await ensureRenderer();
    game = cloneState(cp.game);
    initial = cloneState(cp.initial);
    undo = cp.undo ? cloneState(cp.undo) : null;
    runId = cp.runId;
    lesson = cp.lesson;
    angle = cp.angle;
    guide = cp.guide;
    replay = cp.replay
      ? structuredClone(cp.replay)
      : createReplay(game, PUZZLE_CONTENT_VERSION, true);
    progress = cp.progress
      ? structuredClone(cp.progress)
      : createProgress(
          cp.lesson === null ? "classic" : "tutorial",
          cp.game.config.difficulty,
        );
    if (!cp.progress && cp.lesson !== null)
      progress.configId = `lesson-${cp.lesson}-v1`;
    initialProgress = cp.initialProgress
      ? structuredClone(cp.initialProgress)
      : structuredClone(progress);
    if (progress.mode !== "tutorial") selectedMode = progress.mode;
    selectedPuzzle = progress.puzzleIndex;
    $<HTMLSelectElement>("#difficulty").value =
      progress.startDifficulty === "custom"
        ? "standard"
        : progress.startDifficulty;
    receipt = r.envelope.receipts[runId];
    lastAward = cp.lastAward ?? null;
    terminalRevealAt = 0;
    settleRemaining = 0;
    flight = null;
    audio.cancelPresentation();
    renderer?.reset();
    stale = false;
    started = true;
    paused = true;
    music.setPaused(true);
    $("#home").hidden = true;
    $("#game").hidden = false;
    $<HTMLSelectElement>("#profile").value = game.config.profile;
    layout(false);
    updateForecast();
    updateHUD();
    showOverlay();
  } catch (error) {
    openDialog(
      "Unable to resume",
      `<p>${escapeHTML(error instanceof Error ? error.message : "The renderer could not start. Try another supported browser.")}</p>`,
    );
  } finally {
    busy = false;
  }
}
function updateForecast() {
  forecast = game && game.status === "ready" ? traceShot(game, angle) : null;
}
function setAngle(value: number) {
  angle = Math.max(5, Math.min(175, value));
  updateForecast();
  $("#angle").textContent = `${angle.toFixed(1)}°`;
}
function updateHUD() {
  if (!game) return;
  $("#mode-title").textContent =
    (progress.mode === "tutorial"
      ? "Learn"
      : progress.puzzlePractice
        ? "Puzzle practice"
        : progress.mode) +
    " / " +
    game.config.difficulty;
  $("#score").textContent = game.score.toLocaleString();
  $("#shots").textContent = String(game.shots);
  $("#target-hint").textContent = `· bonus goal ${game.config.target}`;
  $("#target-hint").title =
    "Bonus goal, not a shot limit. Clear to advance. Efficiency bonus: 100 × max(1, goal − shots), with a +100 minimum.";
  $("#next-caption").setAttribute(
    "aria-label",
    `Next toy: ${TYPE_NAMES[game.next]}`,
  );
  $("#input").setAttribute(
    "aria-label",
    `Current toy: ${TYPE_NAMES[game.current]}. Arrow keys aim, Shift for fine aim. Space fires, Escape pauses.`,
  );
  const best = store.getBest(category());
  $("#best").textContent = best === null ? "—" : best.toLocaleString();
  $("#best").title = context();
  $("#new-best").hidden = game.score <= (best ?? 0) || game.status !== "ready";
  $("#danger-value").textContent =
    `${game.danger} / ${game.config.dangerThreshold}`;
  $("#danger-meter").innerHTML = Array.from(
    { length: game.config.dangerThreshold },
    (_, i) => `<i class="${i < game!.danger ? "on" : ""}"></i>`,
  ).join("");
  $("#danger-note").textContent =
    game.danger === game.config.dangerThreshold
      ? "Full. Next shot descends unless drops relieve danger."
      : `${game.config.dangerThreshold - game.danger + 1} shots until descent, if nothing drops.`;
  $("#mobile-context").textContent =
    (storageNotice
      ? "Not saving scores"
      : (lesson !== null
          ? `Lesson ${lesson + 1}`
          : progress.puzzlePractice
            ? "Practice"
            : progress.mode) + ` · ${game.config.difficulty}`) +
    `
${game.config.profile} layout · ${game.assisted ? "Assisted" : "Unassisted"}`;
  $("#assist-label").hidden = !game.assisted;
  const layoutLabel =
    game.config.profile === "compact"
      ? "Compact"
      : isWideDesktop(progress.configId)
        ? "Desktop"
        : ["classic", "journey"].includes(progress.mode)
          ? "Legacy desktop"
          : "Standard";
  const assistedLabel = game.assisted ? "Assisted" : "Unassisted";
  const shortHeader = $("#play-layout").classList.contains("short-portrait");
  const portraitHeader = $("#play-layout").classList.contains("portrait-shell");
  const runName =
    progress.mode === "tutorial"
      ? "Lesson " + ((lesson ?? 0) + 1)
      : progress.mode === "puzzles"
        ? (progress.puzzlePractice ? "Practice " : "Puzzle ") +
          (progress.puzzleIndex + 1)
        : progress.mode[0].toUpperCase() + progress.mode.slice(1);
  $("#run-label").textContent = portraitHeader
    ? runName +
      " · " +
      game.config.difficulty +
      (shortHeader ? "\n" : " · ") +
      layoutLabel +
      " · " +
      assistedLabel
    : progress.mode === "puzzles"
      ? (progress.puzzlePractice ? "Practice puzzle " : "Puzzle ") +
        (progress.puzzleIndex + 1) +
        ": " +
        PUZZLES[progress.puzzleIndex].title +
        " · " +
        layoutLabel +
        " · " +
        assistedLabel
      : progress.mode === "tutorial"
        ? runName + " · " + layoutLabel + " · " + assistedLabel
        : layoutLabel +
          " · " +
          assistedLabel +
          (progress.mode === "journey"
            ? " · Board " + (progress.journeyStage + 1)
            : "");
  $("#run-label").title = context();
  $("#guide-button").innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v6m0 8v6M2 12h6m8 0h6"/></svg><span>' +
    (guide ? "Guide on" : "Guide off") +
    "</span>";
  $("#guide-button").setAttribute(
    "aria-label",
    guide ? "Guide on" : "Guide off",
  );
  $("#guide-button").setAttribute("aria-pressed", String(guide));
  const undoButton = $<HTMLButtonElement>("#undo-button");
  undoButton.disabled =
    !canUndoShot(undo, game, settings.undoPenalty) ||
    !!flight ||
    paused ||
    needsSpace ||
    busy ||
    stale ||
    $<HTMLDialogElement>("#dialog").open;
  undoButton.title = settings.undoPenalty
    ? "Undo costs 500 points. Restores the pre-shot score, then deducts 500. You need 500 points before that shot."
    : "Undo is free (penalty off). Restores the pre-shot score and marks this run Assisted.";
  undoButton.setAttribute("aria-description", undoButton.title);
  $<HTMLButtonElement>("#fire-button").disabled =
    paused ||
    needsSpace ||
    !!flight ||
    settleRemaining > 0 ||
    !!renderer?.settling ||
    game.status !== "ready";
  $("#angle").textContent = `${angle.toFixed(1)}°`;
  $("#input-hint").innerHTML =
    settings.input === "fire"
      ? "Aim, then press Fire<br>Arrows + Shift for fine aim"
      : "Move to aim · Click to fire<br>Touch: use the Drag to aim pad";
}
async function fire() {
  if (
    !game ||
    paused ||
    needsSpace ||
    flight ||
    game.status !== "ready" ||
    $<HTMLDialogElement>("#dialog").open ||
    busy ||
    stale ||
    settleRemaining > 0 ||
    renderer?.settling
  )
    return;
  void unlockAudio();
  const resolution = resolveShot(game, angle);
  if (resolution.error) {
    showStatus(
      "That shot could not settle safely. Try another angle. No shot was spent.",
    );
    console.warn("Smashy trajectory recovery", resolution.error);
    return;
  }
  undo = cloneState(game);
  flight = {
    resolution,
    distance: 0,
    bounce: 0,
    angle,
    speed: flightPresentationSpeed(resolution.trace.distance),
  };
  renderer?.recoil();
  audio.play("fire");
  cancelGesture();
  updateHUD();
}
function finishFlight() {
  if (!game || !flight) return;
  const old = game,
    r = flight.resolution,
    firedAngle = flight.angle;
  game = r.state;
  game.assisted ||= old.assisted;
  replay = appendReplay(
    replay ?? createReplay(old, PUZZLE_CONTENT_VERSION, true),
    old,
    r,
    firedAngle,
  );
  lastAward = r.award;
  flight = null;
  if (!r.matched.length) audio.play("attach");
  const toSprites = (cells: typeof r.matched) =>
    cells.map((c) => ({
      ...cellCenter(old.config, c, old.descent),
      type: c.type,
    }));
  if (r.matched.length) {
    renderer?.burst(toSprites(r.matched), "match");
    audio.playBreakage(r.matched.length, "match", {
      reduced: settings.reduced,
    });
  }
  if (r.dropped.length) {
    const landing = renderer?.burst(toSprites(r.dropped), "drop");
    audio.playBreakage(r.dropped.length, "floor", {
      delay: (landing?.impactDelayMs ?? 0) / 1000,
      reduced: settings.reduced,
    });
  }
  audio.playDropReward(r.dropped.length);
  if (r.descended) {
    settleRemaining = settings.reduced ? 0 : 220;
    renderer?.descend();
    audio.play("descend");
  } else if (game.danger === game.config.dangerThreshold) audio.play("danger");
  const text = r.dropped.length
    ? `${r.matched.length} matched · ${r.dropped.length} dropped · +${r.award.total.toLocaleString()}`
    : r.matched.length
      ? `${r.matched.length} matched · +${r.award.total.toLocaleString()}`
      : r.descended
        ? "Board descended. Look for a support cut."
        : "Attached. Set up your next match.";
  showStatus(text);
  $("#live").textContent =
    `${text} Score ${game.score.toLocaleString()}. Danger ${game.danger} of ${game.config.dangerThreshold}.${game.status === "cleared" ? " Board cleared." : game.status === "lost" ? " Out of room. Run over." : game.danger === game.config.dangerThreshold ? " Full meter. The next shot descends unless a drop relieves danger." : ""}`;
  if (r.award.match + r.award.drop > 0) {
    $("#announcement").textContent = r.dropped.length
      ? `${r.dropped.length} down!  +${r.award.match + r.award.drop}`
      : `+${r.award.match}`;
    $("#announcement").hidden = false;
    setTimeout(() => ($("#announcement").hidden = true), 650);
  }
  updateForecast();
  updateHUD();
  if (game.status !== "ready" && isRunTerminal(game, progress)) {
    undo = null;
    terminalRevealAt = performance.now() + (settings.reduced ? 160 : 820);
    audio.play(game.status === "cleared" ? "clear" : "loss");
    const cp = checkpoint(),
      cat = category(),
      id = runId;
    writes = writes.then(async () => {
      const result = await store.finalize(
        {
          runId: id,
          category: cat,
          score: cp.game.score,
          outcome: cp.game.status === "cleared" ? "clear" : "loss",
          assisted: cp.game.assisted,
        },
        cp,
        puzzleCompletion(cp),
      );
      storageFeedback(result);
      if (id === runId) {
        receipt = result.receipt;
        updateHUD();
        showOverlay();
      }
    });
    showOverlay();
  } else {
    if (game.status === "cleared") {
      undo = null;
      terminalRevealAt = performance.now() + (settings.reduced ? 160 : 820);
      audio.play("clear");
      showOverlay();
    }
    save();
  }
}
function nextBoard() {
  if (
    !game ||
    busy ||
    game.status !== "cleared" ||
    isRunTerminal(game, progress)
  )
    return;
  const nextSeed = nextRandom(
    ((initial?.seed ?? game.seed) ^
      Math.imul(progress.journeyStage + 1, 0x9e3779b9)) >>>
      0,
  ).state;
  const next = advanceBoard(game, progress, nextSeed);
  game = next.game;
  replay = createReplay(game, PUZZLE_CONTENT_VERSION);
  progress = next.progress;
  undo = null;
  lastAward = null;
  receipt = undefined;
  flight = null;
  angle = 90;
  terminalRevealAt = 0;
  settleRemaining = 0;
  paused = false;
  music.setPaused(false);
  audio.cancelPresentation();
  renderer?.reset();
  updateForecast();
  updateHUD();
  layout(false);
  showOverlay();
  save();
  $("#input").focus({ preventScroll: true });
  showStatus(
    progress.mode === "puzzles"
      ? PUZZLES[progress.puzzleIndex].hint
      : "A new board. Your score carries forward.",
    Infinity,
  );
}
function pause() {
  if (!started) return;
  paused = true;
  music.setPaused(true);
  cancelGesture();
  activePointers.clear();
  audio.suspend();
  updateHUD();
  showOverlay();
}
async function resume() {
  if (!game || needsSpace || $<HTMLDialogElement>("#dialog").open) return;
  if (stale) {
    await resumeSaved();
    if (stale || !game || game.status !== "ready" || needsSpace) return;
  }
  paused = false;
  music.setPaused(false);
  cancelGesture();
  // Restore controls and remove the pause card as one operation. Optional
  // browser audio must not leave an interactive, stale card over live play.
  void unlockAudio();
  updateHUD();
  showOverlay();
  $("#input").focus({ preventScroll: true });
}
function showOverlay() {
  const overlay = $("#overlay");
  if (!game) return;
  const terminal = game.status !== "ready";
  const wholeRun = progress.mode === "puzzles" || progress.mode === "journey";
  const awardDetails = lastAward
    ? lastAward.total
      ? `<p class="small score-breakdown"><strong>Last shot +${lastAward.total.toLocaleString()}</strong><br>Match +${lastAward.match.toLocaleString()} · Drop +${lastAward.drop.toLocaleString()}${game.status === "cleared" ? `<br>Board clear +${lastAward.clear.toLocaleString()} · Efficiency +${lastAward.efficiency.toLocaleString()}` : ""}</p>`
      : '<p class="small score-breakdown">No points on the last shot.</p>'
    : "";
  const decision = receipt?.decision;
  const ranked =
    decision?.rank !== null &&
    decision?.rank !== undefined &&
    decision.rank >= 1 &&
    decision.rank <= 10;
  const placement = ranked
    ? `${["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"][decision.rank! - 1]} best`
    : "";
  const record = ranked
    ? decision.kind === "new-best"
      ? "New personal best"
      : decision.kind === "tied-best"
        ? "Tied personal best"
        : placement
    : "";
  const recognition =
    terminal && isRunTerminal(game, progress) && lesson === null && record
      ? `<div class="result-record">${svg("trophy")}<span class="result-badge">${record}</span>${decision?.kind === "tied-best" ? `<span class="result-placement">${placement}</span>` : ""}</div>`
      : "";
  const resultScore = `<div class="label">${wholeRun ? "Run total" : "Total score"}</div><div class="terminal-score">${game.score.toLocaleString()}</div>${recognition}${awardDetails}`;
  const goalResult = `${game.shots} shots · bonus goal ${game.config.target}. ${game.shots < game.config.target ? `${game.config.target - game.shots} under the goal.` : game.shots === game.config.target ? "At the bonus goal." : `${game.shots - game.config.target} over the goal.`}`;
  const lossCopy = isFloorFull(game)
    ? "The lowest row is completely blocked. There is no room for another shot."
    : "A piece reached the limit. Try that board again.";
  if (
    terminal &&
    !paused &&
    !needsSpace &&
    !stale &&
    performance.now() < terminalRevealAt
  ) {
    overlay.hidden = true;
    return;
  }
  overlay.hidden = !paused && !needsSpace && !terminal && !stale;
  overlay.classList.toggle("result-overlay", terminal && !needsSpace && !stale);
  if (overlay.hidden) return;
  let html = "";
  let resultGuidance = "";
  if (needsSpace) {
    html =
      '<h2>A little more room</h2><p>This board is preserved. Reduce browser zoom, enlarge the window, rotate to a taller view, or start a new Compact board from Home.</p><button data-action="home">Home</button>';
  } else if (
    game.status === "cleared" &&
    !stale &&
    !isRunTerminal(game, progress)
  ) {
    if (progress.mode === "puzzles")
      resultGuidance = `${progress.puzzlePractice ? "Practice: no shelf unlocks." : "Clear unlocks the next puzzle."}<br>${game.shots} shots · bonus goal ${game.config.target}.<br>Efficiency bonus: at least +100.`;
    html = `<div class="eyebrow">${progress.mode === "puzzles" ? `${progress.puzzlePractice ? "Practice puzzle" : "Puzzle"} ${progress.puzzleIndex + 1} / 50` : `Journey · Board ${progress.journeyStage + 1}`}</div><h2>${progress.mode === "puzzles" ? "Puzzle cleared." : "Room to keep going."}</h2>${resultScore}<p>${progress.mode === "puzzles" ? escapeHTML(PUZZLES[progress.puzzleIndex].title) : "Board cleared. The next difficulty is waiting."}<br>${goalResult}</p>${progress.mode === "puzzles" ? `<p class="small">${progress.puzzlePractice ? "Practice does not change your earned puzzle unlocks." : "Clearing unlocks the next puzzle."} The bonus goal affects points, not progression; the efficiency bonus is always at least +100.</p>` : ""}<button class="primary" data-action="next-board">${progress.mode === "puzzles" ? (progress.puzzlePractice ? "Next practice puzzle" : "Next puzzle") : "Next board"}</button><button data-action="retry-confirm">Restart this run</button><button class="quiet" data-action="home">Home</button>`;
  } else if (terminal && !stale) {
    if (progress.mode === "classic")
      resultGuidance =
        "Retry: same layout and toy order.<br>New: a freshly generated random board.";
    html = `<div class="eyebrow">${lesson === null ? progress.mode : `Lesson ${(lesson ?? 0) + 1}`}</div><h2>${game.status === "cleared" ? "Beautifully smashed." : "Out of room."}</h2>${resultScore}<p>${game.status === "cleared" ? `${goalResult} ${lesson !== null ? "Try the next idea." : "One good shot makes room for another."}` : lossCopy}</p>${progress.mode === "classic" ? '<p class="small">Retry repeats this layout and toy order. A new board is randomly generated at the same difficulty and layout size.</p>' : ""}${lesson !== null && lesson < 2 && game.status === "cleared" ? '<button class="primary" data-action="next-lesson">Next lesson</button>' : ""}<button class="${lesson === null ? "primary" : ""}" data-action="retry">${progress.mode === "puzzles" || progress.mode === "journey" ? "Retry same run" : "Retry same board"}</button><button data-action="new-board">${progress.mode === "classic" ? "New random board" : "New Classic board"}</button><button class="quiet" data-action="home">Home</button>`;
  } else {
    html = `<h2>${stale ? "Board active elsewhere" : "Take a breath."}</h2><p>${stale ? "Resume here to take control. The other tab will pause when it next saves." : "Your board is waiting. No timer, no rush."}</p><button class="primary" data-action="resume">Resume${stale ? " here" : ""}</button><button data-action="settings">Settings</button><button data-action="retry-confirm">Restart this ${wholeRun ? "run" : "board"}</button><button class="quiet" data-action="home">Home</button>`;
  }
  const actionStart = html.indexOf("<button");
  if (actionStart >= 0)
    html = `<div class="overlay-details" role="region" aria-label="Board details" tabindex="0">${html.slice(0, actionStart)}</div><span class="overlay-scroll-cue" hidden aria-hidden="true">Scroll for more details ↕</span><div class="overlay-actions">${resultGuidance ? `<p class="result-guidance">${resultGuidance}</p>` : ""}${html.slice(actionStart)}</div>`;
  const focusedAction = (document.activeElement as HTMLElement | null)
    ?.closest("#overlay-card [data-action]")
    ?.getAttribute("data-action");
  $("#overlay-card").innerHTML = html;
  const details = $("#overlay-card .overlay-details");
  const cue = $("#overlay-card .overlay-scroll-cue");
  if (details && cue) {
    const scrollable = details.scrollHeight > details.clientHeight + 1;
    cue.hidden = !scrollable;
    details.setAttribute(
      "aria-label",
      scrollable ? "Board details. Scroll for more details." : "Board details",
    );
  }
  if (focusedAction)
    $("#overlay-card")
      .querySelector<HTMLElement>(`[data-action="${focusedAction}"]`)
      ?.focus({ preventScroll: true });
}
function goHome() {
  pause();
  $("#game").hidden = true;
  $("#home").hidden = false;
  started = false;
  music.setPaused(true);
  updateHome();
}
function confirmAction(
  title: string,
  message: string,
  action: () => void,
  confirmLabel = "Abandon and continue",
) {
  openDialog(
    title,
    `<p>${message}</p>`,
    `<button data-action="close-dialog">Keep board</button><button class="primary" id="confirm">${confirmLabel}</button>`,
  );
  $("#confirm").onclick = () => {
    closeDialog();
    action();
  };
}
function escapeHTML(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function openDialog(
  title: string,
  body: string,
  footer = '<button data-action="close-dialog">Done</button>',
) {
  audioFlyout.close(false);
  helpView?.dispose();
  helpView = null;
  syncViewportVariables();
  if (started) pause();
  cancelGesture();
  if (!$<HTMLDialogElement>("#dialog").open)
    previousFocus = document.activeElement as HTMLElement;
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  $("#dialog-foot").innerHTML = footer;
  const dialog = $<HTMLDialogElement>("#dialog");
  dialog.classList.remove("records-dialog");
  if (!dialog.open) dialog.showModal();
}
function closeDialog() {
  helpView?.dispose();
  helpView = null;
  const d = $<HTMLDialogElement>("#dialog");
  if (d.open) d.close();
  if (started) {
    paused = true;
    music.setPaused(true);
    showOverlay();
  }
  const target =
    previousFocus?.isConnected && !previousFocus.closest("dialog")
      ? previousFocus
      : started
        ? document.querySelector<HTMLElement>("[data-action=resume]")
        : null;
  target?.focus({ preventScroll: true });
}
function showHelp() {
  openDialog("How to play", "", "");
  helpView = mountHelpDialog($<HTMLDialogElement>("#dialog"), {
    initialPane: helpPane,
    onPaneChange: (index) => {
      helpPane = index;
    },
    onClose: closeDialog,
    siteAddress: location.origin,
  });
}
async function showRecords() {
  if (started) pause();
  await writes;
  storageFeedback(await store.load());
  const current = category(),
    selected = recordCategory ?? current;
  const envelope = store.state();
  const receipts = Object.values(envelope.receipts);
  const categories = [
    ...new Map(
      [
        current,
        ...Object.values(envelope.tables)
          .flat()
          .map((e) => e.category),
        ...receipts.map((r) => r.category),
      ].map((c) => [categoryKey(c), c]),
    ).values(),
  ];
  const entries =
    recordView === "top"
      ? await store.records(selected)
      : receipts
          .filter((r) => categoryKey(r.category) === categoryKey(selected))
          .sort((a, b) => b.sequence - a.sequence)
          .slice(0, 10);
  openDialog(
    "Personal bests",
    `<div class="records-filter"><label for="record-filter">Category</label><div class="records-select"><select id="record-filter" title="${escapeHTML(recordLabel(selected))}">${categories.map((c, i) => `<option value="${i}" ${categoryKey(c) === categoryKey(selected) ? "selected" : ""}>${escapeHTML(recordLabel(c))}</option>`).join("")}</select><span class="records-selected" aria-hidden="true">${escapeHTML(recordLabel(selected))}</span></div></div><div class="record-tabs" role="group" aria-label="Score lists"><button id="records-top" aria-pressed="${recordView === "top"}">Top ten</button><button id="records-recent" aria-pressed="${recordView === "recent"}">Recent results</button></div>${storageNotice ? `<p class="saved-notice">${storageNotice}</p>` : ""}${entries.length ? `<table class="score-table ${recordView === "top" ? "records-ranked" : "records-recent"}"><caption class="sr-only">${recordView === "top" ? "Your ten highest scores" : "Your ten most recent results"}</caption><thead><tr><th scope="col">${recordView === "top" ? "Rank" : "Recent"}</th><th scope="col">Score</th><th scope="col" class="record-outcome-column">Result</th><th scope="col">Date</th></tr></thead><tbody>${entries.map((e, i) => `<tr class="${recordView === "top" && i < 3 ? `record-place-${i + 1}` : ""}"><td><span class="record-rank" aria-label="${recordView === "top" ? "Rank" : "Recent result"} ${i + 1}">${recordView === "top" && i === 0 ? `${svg("trophy")}<span class="sr-only">1</span>` : i + 1}</span></td><td><strong class="record-score">${e.score.toLocaleString()}</strong><small class="record-mobile-outcome">${e.outcome === "clear" ? "Cleared" : "Out of room"}</small></td><td class="record-outcome-column"><span class="record-outcome ${e.outcome}">${e.outcome === "clear" ? "Cleared" : "Out of room"}</span></td><td><time datetime="${new Date(e.completedAt).toJSON() ?? ""}" title="${escapeHTML(new Date(e.completedAt).toLocaleString())}">${new Date(e.completedAt).toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "numeric" })}</time></td></tr>`).join("")}</tbody></table>` : `<div class="records-empty">${svg("trophy")}<h3>${recordView === "top" ? "Your first best is waiting." : "A fresh start."}</h3><p>${recordView === "top" ? "Finish a game with points to start your top ten." : "Your finished games will appear here."}</p></div>`}<p class="records-note" title="Clearing site data removes these scores. Scores are not synced to other browsers or devices.">Saved in this browser only.</p>`,
    `${storageNotice ? '<button data-action="retry-storage">Try saving again</button>' : ""}<button data-action="close-dialog">Done</button>`,
  );
  $("#dialog").classList.add("records-dialog");
  $("#dialog-title").innerHTML = `${svg("trophy")}<span>Personal bests</span>`;
  $<HTMLSelectElement>("#record-filter").onchange = async (e) => {
    recordCategory =
      categories[+(e.target as HTMLSelectElement).value] ?? current;
    await showRecords();
    $("#record-filter").focus();
  };
  $("#records-top").onclick = async () => {
    recordView = "top";
    await showRecords();
    $("#records-top").focus();
  };
  $("#records-recent").onclick = async () => {
    recordView = "recent";
    await showRecords();
    $("#records-recent").focus();
  };
}
function recordLabel(c: ScoreCategory) {
  let extra = "";
  const puzzle = c.configId.match(/^puzzles-start-(\d+)-v\d+(?:-practice)?$/);
  if (puzzle)
    extra = ` · Starting puzzle ${+puzzle[1] + 1}${c.configId.endsWith("-practice") ? " · Practice" : ""}`;
  const cfg = c.configId.match(
    /^custom-v1-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/,
  );
  if (cfg)
    extra = ` · ${cfg[1]}×${cfg[2]}, ${cfg[3]} starting rows, ${cfg[4]} types, ${cfg[5]} anchors, danger ${cfg[6]}, target ${cfg[7]}`;

  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return `${cap(c.mode)} · ${cap(c.difficulty)} · ${isWideDesktop(c.configId) ? "Wide" : c.layout === "standard" && ["classic", "journey"].includes(c.mode) ? "Legacy" : cap(c.layout)} · ${c.assisted ? "Assisted" : "Unassisted"}${isWideDesktop(c.configId) ? "" : extra}${c.rulesVersion === "1" ? "" : ` · Rules ${c.rulesVersion}`}`;
}
async function retrySaving() {
  await writes;
  const r = await store.retryStorage();
  storageFeedback(r);
  updateHUD();
  if (!started) updateHome();
  if (
    $<HTMLDialogElement>("#dialog").open &&
    $("#dialog-title").textContent === "Personal bests"
  )
    await showRecords();
}
function showSettings() {
  openDialog(
    "Make yourself comfortable",
    `<label class="setting-row"><span>Sound effects<small>Taps, breaking sounds and big-drop cheers.</small></span><input id="setting-muted" type="checkbox" ${!settings.muted ? "checked" : ""}></label><label class="setting-row"><span>Effects volume</span><input id="setting-volume" type="range" min="0" max="1" step="0.01" value="${settings.volume}"></label><label class="setting-row"><span>Music<small>Relaxed Pocket → Soft Pixel Play → Cozy Game Loop → Puzzle Pulse. Five seconds between songs; loops in order.</small></span><input id="setting-music" type="checkbox" ${!settings.musicMuted ? "checked" : ""}></label><label class="setting-row"><span>Music volume <output id="music-volume-value">${Math.round(settings.musicVolume * 100)}%</output><small>Low by default. Independent of sound effects.</small></span><input id="setting-music-volume" aria-label="Music volume" type="range" min="0" max="1" step="0.01" value="${settings.musicVolume}"></label><p id="music-status" class="small muted" role="status"></p><label class="setting-row"><span>Reduced motion<small>Less movement. Same rules and score.</small></span><input id="setting-reduced" type="checkbox" ${settings.reduced ? "checked" : ""}></label><label class="setting-row"><span>Simple backdrop<small>Remove workshop props and frame texture. Keep the toys, controls and motion.</small></span><input id="setting-decoration" type="checkbox" ${settings.reducedDecoration ? "checked" : ""}></label><label class="setting-row"><span>Full path guide<small>Marks an active continuing run Assisted permanently. After a finished run, applies to your next attempt.</small></span><input id="setting-guide" type="checkbox" ${(started ? guide : settings.guide) ? "checked" : ""}></label><label class="setting-row"><span>500-point Undo penalty<small>On by default. Undo removes the last shot’s points, then costs 500 pre-shot points. Turn off for free Undo.</small></span><input id="setting-undo-penalty" type="checkbox" ${settings.undoPenalty ? "checked" : ""}></label><label class="setting-row"><span>Allow Playing Locked Puzzles<small>Try locked puzzles as practice. Practice never earns shelf unlocks; earned progress stays saved.</small></span><input id="setting-locked-puzzles" type="checkbox" ${settings.allowLockedPuzzles ? "checked" : ""}></label><label class="setting-row"><span>Separate Fire button<small>Aiming touches never fire on release.</small></span><input id="setting-input" type="checkbox" ${settings.input === "fire" ? "checked" : ""}></label><label class="setting-row"><span>Color intensity</span><input id="setting-intensity" type="range" min="0.7" max="1" step="0.05" value="${settings.intensity}"></label><label class="setting-row"><span>Shape marks<small>Extra identity marks and stronger outlines.</small></span><input id="setting-glyphs" type="checkbox" ${settings.glyphs ? "checked" : ""}></label><label class="setting-row"><span>Board brightness</span><input id="setting-brightness" type="range" min="0.75" max="1" step="0.05" value="${settings.brightness}"></label><p class="small muted">Camera shake is off. Presentation settings keep the rules unchanged. The Undo penalty setting controls whether each successful Undo costs 500 points. Locked-puzzle access permits practice without earning unlocks.</p>`,
  );
  updateMusicControls();
  $<HTMLInputElement>("#setting-music").onchange = (e) => {
    settings.musicMuted = !(e.target as HTMLInputElement).checked;
    applySettings();
    if (!settings.musicMuted) music.startFromGesture();
  };
  $<HTMLInputElement>("#setting-music-volume").oninput = (e) => {
    settings.musicVolume = +(e.target as HTMLInputElement).value;
    applySettings();
    music.startFromGesture();
  };
  $<HTMLInputElement>("#setting-muted").onchange = (e) => {
    settings.muted = !(e.target as HTMLInputElement).checked;
    applySettings();
  };
  if (!audio.available || audio.state === "blocked") {
    const note = document.createElement("p");
    note.className = "saved-notice";
    note.textContent = !audio.available
      ? "Sound effects are unavailable. Play continues without effects; reload to retry. Music has separate controls."
      : "Sound effects are waiting for a tap. Play continues; tap an audio control to retry.";
    $("#dialog-body").prepend(note);
  }
  $<HTMLInputElement>("#setting-volume").oninput = (e) => {
    settings.volume = +(e.target as HTMLInputElement).value;
    applySettings();
  };
  $<HTMLInputElement>("#setting-reduced").onchange = (e) => {
    settings.reduced = (e.target as HTMLInputElement).checked;
    applySettings();
  };
  $<HTMLInputElement>("#setting-decoration").onchange = (e) => {
    settings.reducedDecoration = (e.target as HTMLInputElement).checked;
    applySettings();
  };
  $<HTMLInputElement>("#setting-guide").onchange = (e) => {
    toggleGuide((e.target as HTMLInputElement).checked);
  };
  $<HTMLInputElement>("#setting-undo-penalty").onchange = (e) => {
    settings.undoPenalty = (e.target as HTMLInputElement).checked;
    applySettings();
    updateHUD();
  };
  $<HTMLInputElement>("#setting-locked-puzzles").onchange = (e) => {
    settings.allowLockedPuzzles = (e.target as HTMLInputElement).checked;
    applySettings();
    updateHome();
  };
  $<HTMLInputElement>("#setting-input").onchange = (e) => {
    settings.input = (e.target as HTMLInputElement).checked
      ? "fire"
      : "release";
    applySettings();
    updateHUD();
  };
  $<HTMLInputElement>("#setting-glyphs").onchange = (e) => {
    settings.glyphs = (e.target as HTMLInputElement).checked;
    applySettings();
  };
  $<HTMLInputElement>("#setting-brightness").oninput = (e) => {
    settings.brightness = +(e.target as HTMLInputElement).value;
    applySettings();
  };
  $<HTMLInputElement>("#setting-intensity").oninput = (e) => {
    settings.intensity = +(e.target as HTMLInputElement).value;
    applySettings();
  };
}
function toggleGuide(value = !guide) {
  guide = value;
  settings.guide = value;
  const continuing = started && game && !isRunTerminal(game, progress);
  if (continuing && game && value) game.assisted = true;
  if (continuing && replay && value) replay.assisted = true;
  applySettings();
  updateForecast();
  updateHUD();
  if (continuing) save();
  else updateHome();
}
function showLessons() {
  openDialog(
    "Learn by smashing",
    `<p>Three tiny boards. One useful idea at a time. These practice results stay out of Classic records.</p><div class="lesson-list">${LESSONS.map((l, i) => `<button data-lesson="${i}">${l.title}<small>${l.hint}</small></button>`).join("")}</div>`,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-lesson]").forEach(
    (b) =>
      (b.onclick = () => {
        const l = +b.dataset.lesson!;
        closeDialog();
        void newRun(l);
      }),
  );
}
document.addEventListener("click", (event) => {
  const button = event
    .composedPath()
    .find(
      (node): node is HTMLButtonElement =>
        node instanceof HTMLButtonElement && node.hasAttribute("data-action"),
    );
  if (!button) return;
  const a = button.dataset.action;
  switch (a) {
    case "play":
      void newRun();
      break;
    case "resume-saved":
      void resumeSaved();
      break;
    case "help":
      helpPane = 0;
      showHelp();
      break;
    case "records":
      recordView = "top";
      recordCategory = null;
      void showRecords();
      break;
    case "retry-storage":
      void retrySaving();
      break;
    case "sound":
      void unlockAudio();
      audioFlyout.toggle(button);
      break;
    case "pause":
      pause();
      break;
    case "resume":
      void resume();
      break;
    case "settings":
      showSettings();
      break;
    case "close-dialog":
      closeDialog();
      break;
    case "lessons":
      showLessons();
      break;
    case "guide":
      toggleGuide();
      break;
    case "undo":
      if (
        game &&
        canUndoShot(undo, game, settings.undoPenalty) &&
        !flight &&
        !paused &&
        !needsSpace &&
        !busy &&
        !stale &&
        !$<HTMLDialogElement>("#dialog").open
      ) {
        const cost = settings.undoPenalty ? UNDO_PENALTY : 0;
        game = applyUndo(undo, game, settings.undoPenalty);
        replay = undoReplay(
          replay ?? createReplay(game, PUZZLE_CONTENT_VERSION, true),
          game,
          cost,
        );
        undo = null;
        audio.cancelPresentation();
        renderer?.reset();
        settleRemaining = 0;
        lastAward = null;
        guide = guide || lesson !== null;
        audio.play("undo");
        updateForecast();
        updateHUD();
        save();
        showStatus(
          cost
            ? "One shot undone. −500 points. This attempt is Assisted."
            : "One shot undone for free. This attempt is Assisted.",
        );
      }
      break;
    case "fire":
      void fire();
      break;
    case "next-board":
      nextBoard();
      break;
    case "retry":
      void newRun(lesson, true);
      break;
    case "retry-confirm":
      void newRun(lesson, true);
      break;
    case "new-board":
      if (game && progress.mode === "classic") {
        $<HTMLSelectElement>("#profile").value = game.config.profile;
        $<HTMLSelectElement>("#difficulty").value = game.config.difficulty;
      }
      selectedMode = "classic";
      void newRun();
      break;
    case "next-lesson":
      void newRun((lesson ?? 0) + 1);
      break;
    case "home":
      if (game?.status === "ready" && game.score > 0)
        confirmAction(
          "Leave the board?",
          "Your current board stays saved for Resume. A new attempt will replace it only after confirmation.",
          goHome,
          "Save and go Home",
        );
      else goHome();
      break;
  }
});
$<HTMLDialogElement>("#dialog").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDialog();
});
$<HTMLSelectElement>("#profile").onchange = updateHome;
$<HTMLSelectElement>("#difficulty").onchange = updateHome;
document
  .querySelectorAll<HTMLButtonElement>("[data-mode]")
  .forEach((b) => (b.onclick = () => selectMode(b.dataset.mode as PlayMode)));
$("#mode-config").onclick = () =>
  selectedMode === "puzzles" ? showPuzzles() : showCustom();
function cancelGesture() {
  const previous = gesture;
  gesture = null;
  if (previous) {
    try {
      $("#touch-pad").releasePointerCapture(previous.id);
    } catch {}
  }
  $("#play-layout").classList.remove("aiming");
}
function moveTouchGesture(e: PointerEvent) {
  if (!gesture || gesture.id !== e.pointerId) return;
  if (e.cancelable) e.preventDefault();
  const dx = e.clientX - gesture.start;
  gesture.max = Math.max(gesture.max, Math.abs(dx));
  gesture.armed ||= gesture.max > 8;
  setAngle(gesture.base - dx * 0.5);
}
function finishTouchGesture(e: PointerEvent) {
  if (!gesture || gesture.id !== e.pointerId) return;
  moveTouchGesture(e);
  const valid =
    gesture.armed &&
    !inside(e.clientX, e.clientY, $("#cancel-strip").getBoundingClientRect());
  suppressedTouchClick = {
    x: e.clientX,
    y: e.clientY,
    until: performance.now() + 450,
  };
  cancelGesture();
  if (e.cancelable) e.preventDefault();
  if (valid && settings.input === "release") void fire();
}
function beginTouchGesture(e: PointerEvent) {
  if (
    !game ||
    game.status !== "ready" ||
    $<HTMLDialogElement>("#dialog").open ||
    paused ||
    flight ||
    needsSpace ||
    gesture ||
    activePointers.size > 1 ||
    (e.currentTarget === $("#input") && overPreview(e))
  )
    return;
  gesture = {
    id: e.pointerId,
    start: e.clientX,
    base: angle,
    max: 0,
    armed: false,
  };
  try {
    $("#touch-pad").setPointerCapture(e.pointerId);
  } catch {
    // Document handlers retain the drag if a browser declines capture.
  }
  $("#play-layout").classList.add("aiming");
  e.preventDefault();
}
function inside(x: number, y: number, rect: DOMRect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}
function overPreview(e: PointerEvent) {
  if (!game) return false;
  if (inside(e.clientX, e.clientY, $("#next-caption").getBoundingClientRect()))
    return true;
  const r = $("#stage").getBoundingClientRect();
  const x = ((e.clientX - r.left) * game.config.width) / r.width;
  const y = ((e.clientY - r.top) * game.config.height) / r.height;
  if (game.config.width < 336)
    return (
      x >= game.config.width - 78 &&
      y >= game.config.lossY + 3 &&
      y <= game.config.lossY + 76
    );
  return (
    x >= game.config.width - 110 &&
    y >= game.config.launcher.y - 55 &&
    y <= game.config.launcher.y + 44
  );
}
function mouseAim(e: PointerEvent) {
  if (!game || paused || needsSpace || flight || e.pointerType !== "mouse")
    return;
  const r = $("#stage").getBoundingClientRect(),
    x = ((e.clientX - r.left) * game.config.width) / r.width,
    y = ((e.clientY - r.top) * game.config.height) / r.height;
  setAngle(
    (Math.atan2(game.config.launcher.y - y, x - game.config.launcher.x) * 180) /
      Math.PI,
  );
}
$("#input").addEventListener("pointermove", mouseAim);
$("#input").addEventListener("pointerdown", (e) => {
  if (overPreview(e)) return;
  if (e.pointerType === "mouse" && e.button === 0) {
    mouseAim(e);
    $("#input").focus({ preventScroll: true });
    void fire();
  } else if (
    settings.input === "fire" &&
    game &&
    !paused &&
    !flight &&
    !needsSpace
  ) {
    const r = $("#stage").getBoundingClientRect();
    setAngle(
      (Math.atan2(
        game.config.launcher.y -
          ((e.clientY - r.top) * game.config.height) / r.height,
        ((e.clientX - r.left) * game.config.width) / r.width -
          game.config.launcher.x,
      ) *
        180) /
        Math.PI,
    );
  }
  if (e.pointerType !== "mouse") beginTouchGesture(e);
});
$("#touch-pad").addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  beginTouchGesture(e);
});
document.addEventListener("pointermove", moveTouchGesture, {
  capture: true,
  passive: false,
});
document.addEventListener("pointerup", finishTouchGesture, {
  capture: true,
  passive: false,
});
$("#touch-pad").addEventListener("pointercancel", cancelGesture);
$("#touch-pad").addEventListener("lostpointercapture", (e) => {
  if (gesture?.id === e.pointerId) {
    activePointers.delete(e.pointerId);
    cancelGesture();
  }
});
// iOS browser chrome must not turn a captured aim into page panning/callout.
document.addEventListener(
  "touchmove",
  (e) => {
    if (gesture && e.cancelable) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener(
  "touchend",
  (e) => {
    if (
      (gesture ||
        (suppressedTouchClick &&
          performance.now() < suppressedTouchClick.until)) &&
      e.cancelable
    )
      e.preventDefault();
  },
  { passive: false },
);
document.addEventListener(
  "click",
  (e) => {
    const suppressed = suppressedTouchClick;
    if (
      suppressed &&
      e.detail !== 0 &&
      performance.now() < suppressed.until &&
      Math.abs(e.clientX - suppressed.x) < 12 &&
      Math.abs(e.clientY - suppressed.y) < 12
    ) {
      suppressedTouchClick = null;
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true,
);
$("#touch-pad").addEventListener("contextmenu", (e) => {
  if (gesture || touchMode) e.preventDefault();
});
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!document.hidden && e.isTrusted) music.startFromGesture();
    touchMode = e.pointerType !== "mouse";
    suppressedTouchClick = null;
    activePointers.add(e.pointerId);
    if (activePointers.size > 1) cancelGesture();
  },
  true,
);
document.addEventListener(
  "pointerup",
  (e) => activePointers.delete(e.pointerId),
  true,
);
document.addEventListener(
  "pointercancel",
  (e) => activePointers.delete(e.pointerId),
  true,
);
document.addEventListener(
  "click",
  (e) => {
    if (!document.hidden && e.isTrusted) {
      music.startFromGesture();
      void unlockAudio();
    }
  },
  true,
);
document.addEventListener(
  "touchend",
  (e) => {
    if (!document.hidden && e.isTrusted) {
      music.startFromGesture();
      void unlockAudio();
    }
  },
  { capture: true, passive: true },
);
document.addEventListener("keydown", (e) => {
  if (!document.hidden && e.isTrusted && !e.repeat) {
    music.startFromGesture();
    void unlockAudio();
  }
  if (audioFlyout.isOpen) return;
  if ($<HTMLDialogElement>("#dialog").open) return;
  if (
    e.key.toLowerCase() === "m" &&
    !["INPUT", "SELECT"].includes((e.target as Element).tagName)
  ) {
    settings.muted = !settings.muted;
    applySettings();
    return;
  }
  if (!started) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (!paused) pause();
    return;
  }
  if (paused || needsSpace || flight || game?.status !== "ready") return;
  if ((e.target as Element).closest("button,input,select")) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    setAngle(
      angle + (e.key === "ArrowLeft" ? 1 : -1) * (e.shiftKey ? 0.25 : 2),
    );
  }
  if ((e.code === "Space" || e.key === "Enter") && !e.repeat) {
    e.preventDefault();
    void fire();
  }
});
window.addEventListener("blur", () => {
  if (started && !touchMode) pause();
});
window.addEventListener("pageshow", () => music.setHidden(document.hidden));
window.addEventListener("pagehide", () => {
  audioFlyout.close(false);
  music.setHidden(true);
  if (started) pause();
});
document.addEventListener("visibilitychange", () => {
  music.setHidden(document.hidden);
  if (document.hidden) audioFlyout.close(false);
  if (document.hidden && started) pause();
});
let lastW = 0,
  lastH = 0;
function syncViewportVariables() {
  const vv = visualViewport;
  const style = document.documentElement.style;
  style.setProperty("--view-width", `${vv?.width ?? innerWidth}px`);
  style.setProperty("--view-height", `${vv?.height ?? innerHeight}px`);
  style.setProperty("--view-left", `${vv?.offsetLeft ?? 0}px`);
  style.setProperty("--view-top", `${vv?.offsetTop ?? 0}px`);
}
function layout(shouldPause = true, preserveTouchGesture = false) {
  if (!game || !started) return;
  if (!preserveTouchGesture) cancelGesture();
  const vv = visualViewport;
  $("#game").style.width = `${vv?.width ?? innerWidth}px`;
  $("#game").style.height = `${vv?.height ?? innerHeight}px`;
  $("#game").style.left = `${vv?.offsetLeft ?? 0}px`;
  $("#game").style.top = `${vv?.offsetTop ?? 0}px`;
  const root = $("#game").getBoundingClientRect();
  const gameStyle = getComputedStyle($("#game"));
  // The fixed root includes safe-area padding. Fit inside its content box;
  // subtracting only the outer viewport would let the stage widen the grid.
  const w =
      root.width -
      parseFloat(gameStyle.paddingLeft) -
      parseFloat(gameStyle.paddingRight),
    h =
      root.height -
      parseFloat(gameStyle.paddingTop) -
      parseFloat(gameStyle.paddingBottom);
  const portrait = w <= h;
  const shortLandscape = !portrait && h < 500;
  const playLayout = $("#play-layout");
  playLayout.classList.toggle("portrait-shell", portrait);
  playLayout.classList.toggle("desktop-shell", !portrait);
  playLayout.classList.toggle("short-landscape", shortLandscape);
  playLayout.classList.toggle("tight-desktop", !portrait && h < 700);
  const shortPortrait = portrait && h < 600;
  playLayout.classList.toggle("short-portrait", shortPortrait);
  const touchUI = touchMode || navigator.maxTouchPoints > 0 || portrait;
  playLayout.classList.toggle("touch-shell", touchUI);
  playLayout.classList.remove("side-tools");
  playLayout.style.gridTemplateColumns = "";
  // Only command groups move; the captured pad remains in its external deck.
  const toolHost = touchUI && portrait ? $("#stage") : $("#game .rail-bottom");
  if (guideTools.parentElement !== toolHost) toolHost.append(guideTools);
  const fireHost = touchUI ? touchDeck : $("#game .rail-bottom");
  if (fireDock.parentElement !== fireHost) fireHost.append(fireDock);
  // Fit the current HUD, not the previous result's wider score/best labels.
  // no-fit hides the HUD, so remove it while measuring; restore below if needed.
  playLayout.classList.remove("no-fit");
  updateHUD();
  const pad = portrait ? 8 : 14,
    padY = shortLandscape ? 1 : shortPortrait ? 4 : pad,
    gap = shortPortrait ? 4 : portrait ? 6 : 12;
  const rail = portrait
    ? 0
    : shortLandscape
      ? 320
      : h < 700
        ? 200
        : Math.max(224, Math.min(280, w * 0.2));
  const headerHeight = portrait
    ? shortPortrait
      ? 44
      : 66
    : shortLandscape
      ? 88
      : 64;
  const hudHeight = portrait
    ? Math.max(44, $("#game .hud").getBoundingClientRect().height)
    : 0;
  const footerHeight = portrait
    ? Math.max(
        44,
        Math.min(
          104,
          h -
            padY * 2 -
            headerHeight -
            hudHeight -
            gap * 3 -
            game.config.height * 0.5,
        ),
      )
    : 0;
  const aw = Math.max(1, w - pad * 2 - (portrait ? 0 : rail + gap));
  const ah = Math.max(
    1,
    h -
      padY * 2 -
      (shortLandscape ? 0 : headerHeight + gap) -
      (portrait ? hudHeight + footerHeight + gap * 2 : 0),
  );
  const scale = Math.max(
    0.01,
    Math.min(aw / game.config.width, ah / game.config.height),
  );
  needsSpace = scale < 0.5;
  const stageW = needsSpace ? aw : game.config.width * scale;
  const stageH = needsSpace ? ah : game.config.height * scale;
  const sideTools = touchUI && portrait && stageW < 248;
  playLayout.classList.toggle("side-tools", sideTools);
  if (sideTools) {
    playLayout.style.gridTemplateColumns = "minmax(0, 1fr) 44px";
    if (guideTools.parentElement !== playLayout) playLayout.append(guideTools);
  }
  playLayout.style.setProperty("--rail-width", rail + "px");
  playLayout.style.setProperty("--stage-height", stageH + "px");
  playLayout.style.width = portrait
    ? "100%"
    : Math.min(w, stageW + rail + gap + pad * 2) + "px";
  playLayout.style.gridTemplateRows = portrait
    ? // Short lesson/puzzle arenas need a compact header as well as a scaled board.
      headerHeight +
      "px " +
      hudHeight +
      "px minmax(0,1fr) " +
      footerHeight +
      "px"
    : headerHeight + "px minmax(0,1fr)";
  playLayout.classList.toggle(
    "compact-shell",
    !portrait && stageW + rail + gap + pad * 2 < 650,
  );
  playLayout.classList.toggle("no-fit", needsSpace);
  $("#stage").style.width = Math.max(1, stageW) + "px";
  $("#stage").style.height = Math.max(1, stageH) + "px";
  $("#stage").classList.toggle("narrow-stage", game.config.width * scale < 220);
  playLayout.style.setProperty("--touch-deck-height", footerHeight + "px");
  playLayout.classList.toggle(
    "roomy-touch-deck",
    portrait && footerHeight >= 80,
  );
  renderer?.resize(game.config.width * scale, game.config.height * scale);
  const apparatus = apparatusLayout(
    game.config.width,
    game.config.lossY,
    game.config.launcher.y,
  );
  $("#next-caption").style.left = `${apparatus.label.x * scale}px`;
  $("#next-caption").style.top =
    `${Math.max(apparatus.label.y * scale, game.config.lossY * scale + 7)}px`;
  $("#limit-caption").style.left = `${game.config.width * scale - 12}px`;
  $("#limit-caption").style.top = `${game.config.lossY * scale - 9}px`;
  if (
    !portrait &&
    $("#game .rail").scrollHeight > $("#game .rail").clientHeight + 1
  )
    playLayout.classList.add("tight-desktop");
  if (needsSpace || (shouldPause && (lastW !== w || lastH !== h))) pause();
  lastW = w;
  lastH = h;
  updateHUD();
  showOverlay();
}
let resizeTimer: ReturnType<typeof setTimeout>;
const onResize = () => {
  syncViewportVariables();
  if (!touchMode) {
    cancelGesture();
    if (started) pause();
  }
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => layout(!touchMode, touchMode), 100);
};
window.addEventListener("resize", onResize);
visualViewport?.addEventListener("resize", onResize);
visualViewport?.addEventListener("scroll", onResize);
let previous = performance.now(),
  accumulator = 0;
function frame(now: number) {
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  if (started && game && renderer) {
    if (
      !paused &&
      !needsSpace &&
      !$<HTMLDialogElement>("#dialog").open &&
      flight
    ) {
      accumulator += dt;
      while (accumulator >= 1 / 120 && flight) {
        accumulator -= 1 / 120;
        flight.distance += flight.speed / 120;
        let traveled = 0;
        const points = flight.resolution.trace.points;
        for (let i = 1; i < points.length - 1; i++) {
          traveled += Math.hypot(
            points[i].x - points[i - 1].x,
            points[i].y - points[i - 1].y,
          );
          if (flight.distance >= traveled && flight.bounce < i) {
            audio.play("bounce");
            renderer.bounce(points[i]);
            flight.bounce = i;
          }
        }
        if (flight.distance >= flight.resolution.trace.distance) finishFlight();
      }
    } else accumulator = 0;
    if (
      settleRemaining > 0 &&
      !paused &&
      !needsSpace &&
      !$<HTMLDialogElement>("#dialog").open
    ) {
      settleRemaining = Math.max(0, settleRemaining - dt * 1000);
      if (!settleRemaining) updateHUD();
    }
    if (
      game.status !== "ready" &&
      $("#overlay").hidden &&
      now >= terminalRevealAt
    )
      showOverlay();
    const f = flight;
    const projectile = f
      ? { ...pointOnTrace(f.resolution.trace, f.distance), type: game.current }
      : undefined;
    renderer.render({
      domLabels: true,
      width: game.config.width,
      height: game.config.height,
      lossY: game.config.lossY,
      ceilingY: game.descent,
      striker: game.config.launcher,
      cells: game.board.map((c) => ({
        ...cellCenter(game!.config, c, game!.descent),
        type: c.type,
      })),
      current: game.current,
      next: game.next,
      angle: (angle * Math.PI) / 180,
      guide:
        guide && !f && !settleRemaining && !renderer.settling
          ? forecast?.points
          : undefined,
      landing:
        guide &&
        !f &&
        !settleRemaining &&
        !renderer.settling &&
        forecast?.landing
          ? cellCenter(game.config, forecast.landing, game.descent)
          : undefined,
      projectile,
      firing: !!f,
      reducedMotion: settings.reduced,
      reducedDecoration: settings.reducedDecoration,
      highContrast: settings.glyphs,
      paused: paused || needsSpace,
    });
    // Renderer and UI share the pause-aware descent clock. Reconcile after
    // rendering so a clock crossing during a getter cannot strand Fire off.
    const fireDisabled =
      paused ||
      needsSpace ||
      !!flight ||
      settleRemaining > 0 ||
      renderer.settling ||
      game.status !== "ready" ||
      busy ||
      stale ||
      $<HTMLDialogElement>("#dialog").open;
    const fireButton = $<HTMLButtonElement>("#fire-button");
    if (fireButton.disabled !== fireDisabled)
      fireButton.disabled = fireDisabled;
    if (statusText && now > statusUntil) {
      statusText = "";
      $("#status-line").textContent = "";
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
async function boot() {
  syncViewportVariables();
  const r = await store.load();
  storageFeedback(r);
  let preferred: Record<string, unknown> = {};
  try {
    const value = JSON.parse(localStorage.getItem("smashy.home.v1") || "null");
    if (value && typeof value === "object" && !Array.isArray(value))
      preferred = value;
  } catch {}
  const saved = store.state().active?.checkpoint;
  const profile = ["standard", "compact"].includes(String(preferred.profile))
    ? (preferred.profile as Profile)
    : (saved?.game.config.profile ??
      (innerWidth < 600 ? "compact" : "standard"));
  $<HTMLSelectElement>("#profile").value = profile;
  const mode = preferred.mode ?? saved?.progress?.mode;
  if (["classic", "puzzles", "journey", "custom"].includes(String(mode)))
    selectedMode = mode as PlayMode;
  if (
    ["gentle", "relaxed", "standard", "tricky", "expert"].includes(
      String(preferred.difficulty),
    )
  )
    $<HTMLSelectElement>("#difficulty").value = String(preferred.difficulty);
  if (selectedMode === "puzzles")
    $<HTMLSelectElement>("#difficulty").value = "standard";
  selectedPuzzle =
    Number.isInteger(preferred.puzzle) &&
    Number(preferred.puzzle) >= 0 &&
    Number(preferred.puzzle) < 50
      ? Number(preferred.puzzle)
      : Math.min(completed[profile], 49);
  updateHome();
}
void boot();
