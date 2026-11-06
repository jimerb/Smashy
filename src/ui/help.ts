/** Visual help content and modal controller. No game, audio or persistence dependencies. */
import chipArt from "../../public/art/ready/chip-sprite-ready-v1.png";
import gumArt from "../../public/art/ready/gum-sprite-ready-v1.png";
import rivetArt from "../../public/art/ready/rivet-sprite-ready-v1.png";
import wispArt from "../../public/art/ready/wisp-sprite-ready-v1.png";
import bashArt from "../../public/art/ready/bash-sprite-ready-v1.png";
import loopArt from "../../public/art/ready/loop-sprite-ready-v1.png";
import pebArt from "../../public/art/ready/peb-sprite-ready-v1.png";
import anchorArt from "../../public/art/ready/anchor-sprite-ready-v1.png";

const ART = {
  chip: chipArt,
  gum: gumArt,
  rivet: rivetArt,
  wisp: wispArt,
  bash: bashArt,
  loop: loopArt,
  peb: pebArt,
  anchor: anchorArt,
};
type ToyName = keyof typeof ART;
export const HELP_PANES = [
  {
    key: "match",
    label: "Match",
    title: "Three touching toys. One satisfying smash.",
    lead: "Connect 3 or more of the same type. A match can bend around a corner.",
  },
  {
    key: "drop",
    label: "Drops",
    title: "Find the support. Bring the rest down.",
    lead: "Every toy needs a chain of neighbors back to the ceiling. Cut that chain and everything below drops.",
  },
  {
    key: "danger",
    label: "Danger",
    title: "Take your time. Make each shot count.",
    lead: "There is no timer. Danger changes only when a shot settles: +1 per shot, −2 for every toy dropped.",
  },
  {
    key: "aim",
    label: "Aim",
    title: "Slide. Line it up. Let go.",
    lead: "Touch: use the separate Drag to aim panel below or beside the board. Drag left or right, then release to fire.",
  },
  {
    key: "score",
    label: "Scores",
    title: "Small matches. Big chain reactions.",
    lead: "Dropping a group is worth more than matching it. Look for the few toys holding up the many.",
  },
];

const escape = (value = "") =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const toy = (name: ToyName = "chip", x = 0, y = 0, extra = "") =>
  `<img class="help-toy ${extra}" src="${escape(ART[name])}" alt="" style="--x:${x}px;--y:${y}px" draggable="false">`;
const heading = (index = 0) =>
  `<div class="help-kicker">THE SMALL GUIDE · ${index + 1} / 5</div><h2 id="help-panel-title">${HELP_PANES[index].title}</h2><p class="help-lead">${HELP_PANES[index].lead}</p>`;

export function renderHelpPanel(
  index = 0,
  options: { siteAddress?: string } = {},
) {
  index = Number.isFinite(index)
    ? Math.min(4, Math.max(0, Math.trunc(index)))
    : 0;
  const address = escape(options.siteAddress ?? "");
  const panels = [
    `<figure class="help-figure"><div class="help-example-label">CONCEPT EXAMPLE · CONNECTED, NOT A ROW</div><div class="help-board help-match" role="img" aria-label="Three Chip toys connect in a bent group. Three separated Gum toys do not match.">
      <svg class="help-lines" viewBox="0 0 320 184" aria-hidden="true"><path d="M64 51H116L142 96"/></svg>
      ${toy("chip", 38, 25, "help-connected")}${toy("chip", 90, 25, "help-connected")}${toy("chip", 116, 70, "help-connected")}
      ${toy("gum", 176, 25)}${toy("gum", 254, 25)}${toy("gum", 228, 115)}
      <span class="help-board-tag help-good">3 touching · yes</span><span class="help-board-tag help-no">Separated · no</span>
    </div><figcaption>Follow the neighbors, even around a bend.</figcaption></figure>
    <div class="help-tip"><strong>Recognize the shape.</strong> Each type has its own silhouette and face. Color is another clue.</div>`,
    `<figure class="help-figure"><div class="help-example-label">CONCEPT EXAMPLE · BEFORE / AFTER</div><div class="help-board help-support" role="img" aria-label="Three connected Chips support Gum, Rivet and Anchor. Removing the Chips leaves all three unsupported.">
      <div class="help-ceiling">CEILING</div><svg class="help-lines" viewBox="0 0 320 208" aria-hidden="true"><path d="M134 10V46H186L212 91M186 46L160 91M160 91L134 136M212 91L186 136"/></svg>
      ${toy("chip", 108, 20, "help-support-piece")}${toy("chip", 160, 20, "help-support-piece")}${toy("chip", 186, 65, "help-support-piece")}
      ${toy("gum", 134, 65, "help-falling")}${toy("rivet", 108, 110, "help-falling")}${toy("anchor", 160, 110, "help-falling")}
      <span class="help-cut-label">Match this support</span><span class="help-drop-result" hidden>3 different toys drop ↓</span>
    </div><figcaption id="help-support-caption">One support holds up three different types.</figcaption>
    <button class="help-demo-button" type="button" data-demo="support" aria-pressed="false">Show the support cut <span aria-hidden="true">↓</span></button></figure>
    <div class="help-tip help-anchor-tip">${toy("anchor")}<p><strong>Meet Anchor.</strong> The charcoal obstacle never fires or matches. You can still drop it.</p></div>`,
    `<figure class="help-figure help-danger-demo"><div class="help-example-label">CONCEPT EXAMPLE · NO DROPS</div><div class="help-meter-heading"><strong id="help-danger-value">6 / 8</strong><span id="help-danger-caption">Two safe steps before overflow.</span></div><div class="help-meter" role="meter" aria-label="Example danger" aria-valuemin="0" aria-valuemax="8" aria-valuenow="6">${Array.from({ length: 8 }, (_, i) => `<span class="${i < 6 ? "filled" : ""}"></span>`).join("")}</div>
    <div class="help-danger-steps" aria-hidden="true"><span>6</span><i>→</i><span>7</span><i>→</i><span>8 · full</span><i>→</i><span>↓ descent</span></div>
    <button class="help-demo-button" type="button" data-demo="danger">Settle one shot <span aria-hidden="true">+1</span></button><figcaption id="help-danger-result" aria-live="polite">Example starts at 6 of 8. Nothing drops.</figcaption></figure>
    <div class="help-tip"><strong>Full is a warning, not a descent.</strong> At 8/8, the next shot descends only if drops do not bring danger back to 8 or lower. Descent resets it to zero.</div>
    <p class="help-small">Drops count across all types, including Anchors. Danger never goes below zero. A clear resolves first; otherwise reaching the limit line or filling the bottom row ends the run.</p>`,
    `<figure class="help-figure"><div class="help-example-label">TOUCH · DRAG TO AIM PANEL</div><div class="help-aim-art" role="img" aria-label="A horizontal drag changes the aim angle. Releasing over the marked Cancel strip cancels the shot."><svg viewBox="0 0 320 150" aria-hidden="true"><path class="help-bank-wall" d="M32 18V124M288 18V124"/><path class="help-aim-line" d="M160 136L32 66L105 26"/><path class="help-swipe" d="M112 110H208m-12-8 12 8-12 8m-72-16-12 8 12 8"/><circle cx="160" cy="110" r="15"/></svg><span class="help-drag-label">← drag left or right →</span><div class="help-cancel-strip">Release here to cancel</div></div><figcaption>Bank off a wall. Ricochets are normal shots, with no power-up needed.</figcaption></figure>
    <div class="help-control-grid"><div><strong>Keep your finger moving</strong><p>Start on the Drag to aim panel. Aim continues wherever your finger goes until you lift. A small tap does not fire.</p></div><div><strong>Cancel on release</strong><p>Release over the marked Cancel strip. Crossing it while dragging keeps your aim.</p></div></div>
    <details class="help-details"><summary>Mouse, keyboard &amp; other touch options</summary><p>Mouse: move to aim, click to fire. Keyboard: ← / → aim, Shift makes fine adjustments, Space or Enter fires once. Esc pauses; M mutes sound effects. The header speaker opens Music and Sound controls, each with its own mute button and volume slider.</p><p>Settings → Separate Fire button lets you aim, then tap Fire. A second touch or a system-canceled gesture cancels quietly.</p><p>On touch, a page that stays visible and readable keeps playing through focus changes, scrolling and browser-bar resizing. Switching away pauses it. On desktop, losing focus or resizing pauses.</p></details>
    <div class="help-tip"><strong>Want to see the whole path?</strong> Full Guide previews wall rebounds. Enabling it marks this run Assisted permanently.</div>`,
    `<figure class="help-figure help-score-example"><div class="help-example-label">ONE SHOT · BEFORE CLEAR BONUSES</div><div class="help-score-sum"><div><div class="help-mini-toys">${toy("chip")}${toy("chip")}${toy("chip")}</div><span>3 matched</span><strong>10</strong></div><b>+</b><div><div class="help-mini-toys">${toy("gum")}${toy("rivet")}${toy("anchor")}${toy("peb")}</div><span>4 dropped together</span><strong>160</strong></div><b>=</b><div class="help-total"><span>points</span><strong>170</strong></div></div></figure>
    <div class="help-control-grid"><div><strong>Clear bonus · +1,000</strong><p>Clear all ordinary toys. Anchors can drop too.</p></div><div><strong>Efficiency · at least +100</strong><p>100 × max(1, target − shots). Target 10, finish in 7: +300.</p></div></div>
    <p class="help-tip"><strong>The bonus goal is not a shot limit.</strong> Clear a puzzle to unlock the next, even if you go over the goal. Finishing farther below the bonus goal earns a larger efficiency bonus. Every clear earns at least +100 efficiency points.</p>
    <div class="help-tip"><strong>Undo costs 500 points by default.</strong> Undo restores the previous shot's board, queue and score, then deducts 500 points. You need at least 500 points in the score from before that shot; its earned points are removed too. Settings → 500-point Undo penalty turns the cost off for free Undo. A successful Undo always marks the run Assisted.</div>
    <details class="help-details"><summary>Puzzle locks, exact scoring &amp; assistance</summary><p>Grey padlocks mark puzzles not yet earned. Settings → Allow Playing Locked Puzzles is off by default. It permits locked puzzles as practice. Practice never earns shelf unlocks, including after resuming or turning the setting off. Standard and Compact keep separate earned progress in this browser.</p><p>Match n ≥ 3: min(n² + 1, 10,000). Drop d in one resolution: min(10 × d², 10,000). Each cap is separate. All disconnected groups dropped by that shot count together.</p><p>Full Guide or a successful Undo marks the run Assisted permanently, even with the Undo penalty off. Turning Guide off does not remove the marker. Assisted runs have their own records.</p></details>
    <details class="help-details"><summary>Choose your kind of game</summary><dl class="help-modes"><dt>Classic</dt><dd>Clear one randomized board. Retry same board repeats its layout and toy order; New random board generates a fresh random layout and toy order at the same difficulty and layout size.</dd><dt>Puzzles</dt><dd>50 authored boards. Clear to advance; the bonus goal rewards efficient shots without blocking progress.</dd><dt>Journey</dt><dd>Clear boards through five difficulties, then repeat Expert until loss. Score carries on.</dd><dt>Custom</dt><dd>Choose the board, toy types, Anchors, danger and efficiency target.</dd></dl><p>Learn by smashing offers three teaching boards: match, support and bank shots. Replacing an unfinished game with a positive score asks for confirmation. Finished and zero-score games can be replaced directly.</p></details>
    <details class="help-details"><summary>Your personal top ten</summary><p>Positive finished runs can enter your local top ten. Classic ends on clear or loss; Journey and Puzzles save the whole run, not each intermediate board. Abandoning saves no record.</p><p>Records are separate by mode, difficulty, rules, layout and assistance. They belong only to this browser profile at this exact site address:</p><p class="help-site-address">${address || "Site address supplied by the game"}</p><p>Another browser, profile or site address has separate records. Clearing site data removes them. No account or cloud backup.</p></details>`,
  ];
  return `<article class="help-panel" role="tabpanel" id="help-panel" aria-labelledby="help-tab-${index}" tabindex="0">${heading(index)}${panels[index]}</article>`;
}

export interface HelpDialogOptions {
  /** Host owns pause, gesture cancellation, close and focus restoration. */
  onClose: () => void;
  initialPane?: number;
  onPaneChange?: (index: number) => void;
  /** Origin where scores are actually stored. Rendered as text, never a URL action. */
  siteAddress?: string;
}

export interface HelpDialogView {
  setPane: (index: number, focusPanel?: boolean) => void;
  /** Call before the shared dialog is reused; also runs on its native close event. */
  dispose: () => void;
}

/** Mount after the host opens its existing dialog through the normal pause path.
 * Does not show/close the native dialog, touch game state or start a lesson.
 * Required existing children: .dialog-shell/head/body/foot, #dialog-title,
 * and the host's [data-action="close-dialog"] header button.
 */
export function mountHelpDialog(
  dialog: HTMLDialogElement,
  options: HelpDialogOptions,
): HelpDialogView {
  const required = <T extends HTMLElement>(selector: string) => {
    const element = dialog.querySelector<T>(selector);
    if (!element) throw new Error(`Help dialog is missing ${selector}`);
    return element;
  };
  const shell = required<HTMLElement>(".dialog-shell");
  const head = required<HTMLElement>(".dialog-head");
  const body = required<HTMLElement>(".dialog-body");
  const foot = required<HTMLElement>(".dialog-foot");
  const title = required<HTMLElement>("#dialog-title");
  const close = required<HTMLButtonElement>(
    '.dialog-head [data-action="close-dialog"]',
  );
  const controller = new AbortController();
  const signal = controller.signal;
  let disposed = false;
  let pane = 0;
  let danger = 6;
  let descended = false;
  dialog.classList.add("help-redesign");
  shell.classList.add("help-shell");
  head.classList.add("help-head");
  body.classList.add("help-body-shell");
  foot.classList.add("help-footer");
  close.classList.add("help-close");
  const headingGroup = document.createElement("div");
  const brand = document.createElement("span");
  brand.className = "help-wordmark";
  brand.textContent = "smashy";
  brand.setAttribute("aria-hidden", "true");
  title.before(headingGroup);
  headingGroup.append(brand, title);
  body.innerHTML = `<nav class="help-tabs" role="tablist" aria-label="Help topics">${HELP_PANES.map((item, index) => `<button role="tab" id="help-tab-${index}" aria-controls="help-panel" type="button"><span class="help-tab-number">0${index + 1}</span>${item.label}</button>`).join("")}</nav><div class="help-scroll"></div>`;
  foot.innerHTML =
    '<button id="help-back" type="button">← Back</button><span class="help-progress" aria-live="polite"></span><button id="help-next" class="help-primary" type="button">Next →</button>';
  const tabs = required<HTMLElement>(".help-tabs");
  const scroll = required<HTMLElement>(".help-scroll");
  const back = required<HTMLButtonElement>("#help-back");
  const next = required<HTMLButtonElement>("#help-next");
  const progress = required<HTMLElement>(".help-progress");

  function setPane(index: number, focusPanel = false) {
    if (disposed) return;
    pane = Number.isFinite(index)
      ? Math.min(4, Math.max(0, Math.trunc(index)))
      : 0;
    scroll.innerHTML = renderHelpPanel(pane, {
      siteAddress: options.siteAddress,
    });
    tabs.querySelectorAll<HTMLButtonElement>("button").forEach((button, i) => {
      button.setAttribute("aria-selected", String(i === pane));
      button.tabIndex = i === pane ? 0 : -1;
    });
    back.disabled = pane === 0;
    next.textContent = pane === 4 ? "Done ✓" : "Next →";
    progress.textContent = `${pane + 1} of 5`;
    scroll.scrollTop = 0;
    danger = 6;
    descended = false;
    if (focusPanel)
      required<HTMLElement>("#help-panel").focus({ preventScroll: true });
    options.onPaneChange?.(pane);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    dialog.classList.remove("help-redesign");
    shell.classList.remove("help-shell");
    head.classList.remove("help-head");
    body.classList.remove("help-body-shell");
    foot.classList.remove("help-footer");
    close.classList.remove("help-close");
    headingGroup.replaceWith(title);
  }

  tabs.addEventListener(
    "click",
    (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>(
        '[role="tab"]',
      );
      if (button) setPane(Number(button.id.split("-").at(-1)));
    },
    { signal },
  );
  tabs.addEventListener(
    "keydown",
    (event) => {
      const key = event.key;
      let index: number | undefined;
      if (key === "ArrowRight") index = (pane + 1) % 5;
      if (key === "ArrowLeft") index = (pane + 4) % 5;
      if (key === "Home") index = 0;
      if (key === "End") index = 4;
      if (index === undefined) return;
      event.preventDefault();
      setPane(index);
      required<HTMLButtonElement>(`#help-tab-${index}`).focus();
    },
    { signal },
  );
  dialog.addEventListener(
    "keydown",
    (event) => {
      // The host's document-level game handler must also retain its open-dialog guard.
      event.stopPropagation();
      if (event.key !== "Tab") return;
      const stops = [
        ...dialog.querySelectorAll<HTMLElement>("button, summary, [tabindex]"),
      ].filter(
        (element) =>
          !(element as HTMLButtonElement).disabled &&
          element.tabIndex >= 0 &&
          element.getClientRects().length,
      );
      const first = stops[0],
        last = stops.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    { signal },
  );
  back.addEventListener("click", () => setPane(pane - 1, true), { signal });
  next.addEventListener(
    "click",
    () => (pane === 4 ? options.onClose() : setPane(pane + 1, true)),
    { signal },
  );
  scroll.addEventListener(
    "click",
    (event) => {
      const demo = (event.target as Element).closest<HTMLButtonElement>(
        "[data-demo]",
      );
      if (!demo) return;
      if (demo.dataset.demo === "support") {
        const cut = demo.getAttribute("aria-pressed") !== "true";
        demo.setAttribute("aria-pressed", String(cut));
        required<HTMLElement>(".help-support").classList.toggle("is-cut", cut);
        required<HTMLElement>(".help-drop-result").hidden = !cut;
        required<HTMLElement>("#help-support-caption").textContent = cut
          ? "No ceiling connection remains. Gum, Rivet and Anchor all drop."
          : "One support holds up three different types.";
        demo.innerHTML = cut
          ? 'Reset example <span aria-hidden="true">↺</span>'
          : 'Show the support cut <span aria-hidden="true">↓</span>';
        return;
      }
      if (descended) {
        danger = 6;
        descended = false;
      } else if (++danger > 8) {
        danger = 0;
        descended = true;
      }
      required<HTMLElement>("#help-danger-value").textContent = `${danger} / 8`;
      required<HTMLElement>(".help-meter").setAttribute(
        "aria-valuenow",
        String(danger),
      );
      scroll
        .querySelectorAll(".help-meter span")
        .forEach((segment, i) =>
          segment.classList.toggle("filled", i < danger),
        );
      required<HTMLElement>("#help-danger-caption").textContent = descended
        ? "Overflow → descend → reset."
        : danger === 8
          ? "Full. The board has not descended."
          : danger === 7
            ? "Still safe. One step to full."
            : "Two safe steps before overflow.";
      required<HTMLElement>("#help-danger-result").textContent = descended
        ? "9 is greater than 8. The board descends and danger resets to zero."
        : danger === 8
          ? "8 equals the threshold. One drop on the next shot would reduce danger to 7."
          : `Example: ${danger} of 8. Nothing drops.`;
      demo.innerHTML = descended
        ? 'Reset example <span aria-hidden="true">↺</span>'
        : 'Settle one shot <span aria-hidden="true">+1</span>';
    },
    { signal },
  );
  dialog.addEventListener("close", dispose, { once: true, signal });
  setPane(options.initialPane ?? 0);
  return { setPane, dispose };
}
