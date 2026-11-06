import relaxed from "../../public/music/01-relaxed-pocket-aac.m4a?url";
import soft from "../../public/music/02-soft-pixel-play-aac.m4a?url";
import cozy from "../../public/music/03-cozy-game-loop-aac.m4a?url";
import pulse from "../../public/music/04-puzzle-pulse-aac.m4a?url";

export const MUSIC_TRACKS = [
  { title: "Relaxed Pocket", url: relaxed },
  { title: "Soft Pixel Play", url: soft },
  { title: "Cozy Game Loop", url: cozy },
  { title: "Puzzle Pulse", url: pulse },
] as const;
