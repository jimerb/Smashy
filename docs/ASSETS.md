# Smashy assets and sound

Smashy's characters, expressions, logo, workshop artwork, animations, teaching boards and puzzle layouts were created for this project. Raster artwork was produced with generative image tools and prepared into individual transparent runtime assets. The renderer adds local facial animation, squash, tumbling and restrained debris effects.

## Images

- `public/art/ready/` contains the individual runtime character bodies, face plates, background and logos imported by the game.
- `public/favicon.svg` is the mallet-and-block app icon.
- `assets/readme/smashy-social.png` is the project owner's supplied promotional artwork. It is presented as promotional art, not as a literal gameplay screenshot.
- The README gallery uses captures of the running game, rather than illustrative interface concepts.

The production build imports an explicit set of assets; it does not copy an entire artwork folder into the player.

## Audio

All current game sound effects are synthesized by Smashy's own Web Audio code. No prerecorded audio files are loaded.

| Source | Purpose |
| --- | --- |
| `src/audio/index.ts` | Oscillator-based launch, rebound, attachment, danger, clear, loss and interface cues; mixing, mute and cancellation |
| `src/audio/breakage.ts` | Deterministic cosmetic crack/debris noise generated into audio buffers, varied by the number of pieces and presentation style |

Sound uses cosmetic state and never determines the board, queue, scoring or gameplay randomness. Music is not included in this version.

## Dependency notices

Open-source dependencies retain their own licenses. The build emits their notices in `dist/LICENSES.txt`; keep that file alongside the published static player. The narrowly scoped fallback notice is described in [licenses/README.md](../licenses/README.md).

No open-source license has been selected for Smashy's own code or artwork. Dependency licenses do not grant a separate license to the Smashy brand or artwork.
