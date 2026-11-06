# Smashy assets and sound

Smashy's characters, expressions, logo, workshop artwork, animations, teaching boards and puzzle layouts were created for this project. Raster artwork was produced with generative image tools and prepared into individual transparent runtime assets. The renderer adds local facial animation, squash, tumbling and restrained debris effects.

## Images

- `public/art/ready/` contains the individual runtime character bodies, face plates, background and logos imported by the game.
- `public/favicon.svg` is the mallet-and-block app icon.
- `assets/readme/smashy-social.png` is the project owner's supplied promotional artwork. It is presented as promotional art, not as a literal gameplay screenshot.
- The README gallery uses captures of the running game, rather than illustrative interface concepts.

The production build imports an explicit set of assets; it does not copy an entire artwork folder into the player.

## Audio

Core gameplay sound effects are synthesized by Smashy's own Web Audio code. Reward voice clips and the separate background soundtrack were supplied by the project owner.

| Source | Purpose |
| --- | --- |
| `src/audio/index.ts` | Oscillator-based launch, rebound, attachment, danger, clear, loss and interface cues; mixing, mute and cancellation |
| `src/audio/breakage.ts` | Deterministic cosmetic crack/debris noise generated into audio buffers, varied by the number of pieces and presentation style |

Sound uses cosmetic state and never determines the board, queue, scoring or gameplay randomness.

### Reward voice clips

The three supplied MP3 recordings are imported explicitly from `public/sounds/`:

| Dropped support pieces in one shot | Voice reward | Runtime source |
| --- | --- | --- |
| 0–6 | None | — |
| 7–9 | One randomly chosen Wheeee | `public/sounds/wheeee-1.mp3` or `public/sounds/wheeee-2.mp3` |
| 10 or more | Ooo-Smashy, without a Wheeee clip | `public/sounds/ooo-smashy.mp3` |

Only unsupported pieces that **drop** count toward these thresholds. Pieces removed by the matching group do not count. Each qualifying shot selects one reward clip; it never stacks the two reward tiers.

Reward voices share the same **Sound** mute and volume controls as other sound effects. Music remains independently controlled. Playback balances the clips' levels without rewriting the supplied MP3 files. The build audit requires exactly these three named clips and verifies that their packaged bytes match the curated runtime inputs.

### Music

Browser-ready AAC copies of the four supplied songs are explicitly imported from `public/music/` and play in this order:

| Order | Song | Runtime source |
| --- | --- | --- |
| 1 | Relaxed Pocket | `public/music/01-relaxed-pocket-aac.m4a` |
| 2 | Soft Pixel Play | `public/music/02-soft-pixel-play-aac.m4a` |
| 3 | Cozy Game Loop | `public/music/03-cozy-game-loop-aac.m4a` |
| 4 | Puzzle Pulse | `public/music/04-puzzle-pulse-aac.m4a` |

The playlist returns to the first song after the fourth. There is a five-second silent gap after each song, including before the loop repeats. Music starts after the first user interaction at a quiet 8% default volume. The header speaker opens independent Music and Sound rows, each with a mute button and volume slider; Settings shares these preferences. A completed tap or click retries browser-blocked startup without resetting your preferences; music continues in menus and Settings, and pauses when the page is hidden. Music preferences are remembered in this browser.

The supplied recordings are distinct from the synthesized sound effects. The AAC playback copies preserve the songs while providing a browser-ready audio format. The build audit permits exactly the four named music assets and checks their packaged bytes against the curated AAC runtime sources.

## Dependency notices

Open-source dependencies retain their own licenses. The build emits their notices in `dist/LICENSES.txt`; keep that file alongside the published static player. The narrowly scoped fallback notice is described in [licenses/README.md](../licenses/README.md).

No open-source license has been selected for Smashy's own code or artwork. Dependency licenses do not grant a separate license to the Smashy brand or artwork.
