export interface AudioMix {
  musicMuted: boolean;
  musicVolume: number;
  soundMuted: boolean;
  soundVolume: number;
  status?: string;
}
interface Options {
  getMix: () => AudioMix;
  onMute: (channel: "music" | "sound") => void;
  onVolume: (channel: "music" | "sound", value: number) => void;
}
const speaker =
  '<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>';
const muted = '<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 5 6m0-6-5 6"/>';
const svg = (path: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;

export function mountAudioFlyout(options: Options) {
  const panel = document.createElement("section");
  panel.id = "audio-flyout";
  panel.className = "audio-flyout";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Audio controls");
  panel.innerHTML = `<header class="audio-flyout-head"><strong>Audio</strong><button class="audio-flyout-close" type="button" aria-label="Close audio controls">${svg('<path d="m6 6 12 12M18 6 6 18"/>')}</button></header>${(["music", "sound"] as const).map((channel) => `<div class="audio-flyout-row"><label class="audio-channel-label" for="audio-${channel}-volume">${channel === "music" ? "Music" : "Sound"}</label><button id="audio-${channel}-mute" class="audio-channel-mute" type="button"></button><input id="audio-${channel}-volume" type="range" min="0" max="1" step="0.01" aria-label="${channel === "music" ? "Music" : "Sound effects"} volume"><output class="audio-channel-level" id="audio-${channel}-level" for="audio-${channel}-volume"></output></div>`).join("")}<p id="audio-flyout-status" role="status" hidden></p>`;
  document.body.append(panel);
  let trigger: HTMLElement | null = null;
  let swallowClickUntil = 0;
  const controls = () => [
    ...panel.querySelectorAll<HTMLElement>("button,input"),
  ];
  const expanded = (open: boolean) =>
    document
      .querySelectorAll('[data-action="sound"]')
      .forEach((b) =>
        b.setAttribute("aria-expanded", String(open && b === trigger)),
      );
  function position() {
    if (panel.hidden || !trigger) return;
    const vv = visualViewport;
    const left = vv?.offsetLeft ?? 0,
      top = vv?.offsetTop ?? 0;
    const width = vv?.width ?? innerWidth,
      height = vv?.height ?? innerHeight;
    panel.style.width = `${Math.min(330, width - 16)}px`;
    const anchor = trigger.getBoundingClientRect(),
      box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(left + 8, Math.min(anchor.right - box.width, left + width - box.width - 8))}px`;
    const below = anchor.bottom + 6;
    panel.style.top = `${Math.max(top + 8, Math.min(below + box.height <= top + height - 8 ? below : anchor.top - box.height - 6, top + height - box.height - 8))}px`;
  }
  function update() {
    const mix = options.getMix();
    for (const channel of ["music", "sound"] as const) {
      const isMuted =
        mix[channel === "music" ? "musicMuted" : "soundMuted"] ||
        mix[channel === "music" ? "musicVolume" : "soundVolume"] === 0;
      const volume = mix[channel === "music" ? "musicVolume" : "soundVolume"];
      const button = panel.querySelector<HTMLButtonElement>(
        `#audio-${channel}-mute`,
      )!;
      const label = `${isMuted ? "Unmute" : "Mute"} ${channel === "music" ? "music" : "sound effects"}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      if (button.getAttribute("aria-pressed") !== String(isMuted))
        button.innerHTML = svg(isMuted ? muted : speaker);
      button.setAttribute("aria-pressed", String(isMuted));
      panel.querySelector<HTMLInputElement>(`#audio-${channel}-volume`)!.value =
        String(volume);
      panel.querySelector<HTMLOutputElement>(`#audio-${channel}-level`)!.value =
        `${Math.round(volume * 100)}%`;
    }
    const status = panel.querySelector<HTMLElement>("#audio-flyout-status")!;
    status.hidden = !mix.status;
    if (status.textContent !== (mix.status ?? ""))
      status.textContent = mix.status ?? "";
    position();
  }
  function close(restoreFocus = true) {
    const wasOpen = !panel.hidden;
    panel.hidden = true;
    expanded(false);
    if (wasOpen && restoreFocus && trigger?.isConnected)
      trigger.focus({ preventScroll: true });
  }
  for (const channel of ["music", "sound"] as const) {
    panel.querySelector<HTMLButtonElement>(`#audio-${channel}-mute`)!.onclick =
      () => options.onMute(channel);
    panel.querySelector<HTMLInputElement>(`#audio-${channel}-volume`)!.oninput =
      (e) => options.onVolume(channel, +(e.target as HTMLInputElement).value);
  }
  panel.querySelector<HTMLButtonElement>(".audio-flyout-close")!.onclick = () =>
    close();
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (
        panel.hidden ||
        panel.contains(e.target as Node) ||
        (e.target as Element).closest('[data-action="sound"]')
      )
        return;
      close(false);
      if (!(e.target as Element).closest("button,input,select,a")) {
        swallowClickUntil = performance.now() + 800;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (performance.now() < swallowClickUntil) {
        swallowClickUntil = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (panel.hidden) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
      if (e.key === "Tab") {
        const list = controls(),
          first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    true,
  );
  window.addEventListener("resize", position);
  visualViewport?.addEventListener("resize", position);
  visualViewport?.addEventListener("scroll", position);
  return {
    get isOpen() {
      return !panel.hidden;
    },
    toggle(anchor: HTMLElement) {
      if (!panel.hidden && anchor === trigger) {
        close();
        return;
      }
      trigger = anchor;
      panel.hidden = false;
      expanded(true);
      update();
      panel
        .querySelector<HTMLInputElement>("#audio-music-volume")!
        .focus({ preventScroll: true });
    },
    close,
    update,
  };
}
