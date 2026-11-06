# Smashy assets and sound

Smashy's characters, expressions, logo, workshop artwork, animations, teaching boards and puzzle layouts were created for this project. Raster artwork was produced with generative image tools and prepared into individual transparent runtime assets. The renderer adds local facial animation, squash, tumbling and restrained debris effects.

## Images

- `public/art/ready/` contains the individual runtime character bodies, face plates, background and logos imported by the game.
- `public/favicon.svg` is the mallet-and-block app icon.
- `assets/readme/smashy-social.png` is the project owner's supplied promotional artwork. It is presented as promotional art, not as a literal gameplay screenshot.
- The README gallery uses captures of the running game, rather than illustrative interface concepts.

The production build imports an explicit set of assets; it does not copy an entire artwork folder into the player.

## Audio

Game sound effects are synthesized by Smashy's own Web Audio code. Background music is a separate, prerecorded soundtrack supplied by the project owner.

| Source | Purpose |
| --- | --- |
| `src/audio/index.ts` | Oscillator-based launch, rebound, attachment, danger, clear, loss and interface cues; mixing, mute and cancellation |
| `src/audio/breakage.ts` | Deterministic cosmetic crack/debris noise generated into audio buffers, varied by the number of pieces and presentation style |

Sound uses cosmetic state and never determines the board, queue, scoring or gameplay randomness.

### Music

Browser-ready AAC copies of the four supplied songs are explicitly imported from `public/music/` and play in this order:

| Order | Song | Runtime source |
| --- | --- | --- |
| 1 | Relaxed Pocket | `public/music/01-relaxed-pocket-aac.m4a` |
| 2 | Soft Pixel Play | `public/music/02-soft-pixel-play-aac.m4a` |
| 3 | Cozy Game Loop | `public/music/03-cozy-game-loop-aac.m4a` |
| 4 | Puzzle Pulse | `public/music/04-puzzle-pulse-aac.m4a` |

The playlist returns to the first song after the fourth. There is a five-second silent gap after each song, including before the loop repeats. Music starts after the first user interaction at a quiet 8% default volume. Settings has independent music volume and mute controls; music continues in menus and Settings, and pauses when the page is hidden. Music preferences are remembered in this browser.

The supplied recordings are distinct from the synthesized sound effects. The AAC playback copies preserve the songs while providing a browser-ready audio format. The build audit permits exactly the four named music assets and checks their packaged bytes against the curated AAC runtime sources.

## Dependency notices

Open-source dependencies retain their own licenses. The build emits their notices in `dist/LICENSES.txt`; keep that file alongside the published static player. The narrowly scoped fallback notice is described in [licenses/README.md](../licenses/README.md).

No open-source license has been selected for Smashy's own code or artwork. Dependency licenses do not grant a separate license to the Smashy brand or artwork.
