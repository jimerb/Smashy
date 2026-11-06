import { getConfig, makeConfig, type Config, type Difficulty } from "./core";
/** New desktop runs use a hero-proportioned arena. Legacy saves keep their config. */
export function desktopArena(difficulty: Difficulty): Config {
  const base = getConfig(difficulty, "standard");
  const v = {
    gentle: [9, 4, 31],
    relaxed: [11, 5, 18],
    standard: [14, 6, 11],
    tricky: [14, 7, 11],
    expert: [14, 7, 9],
    custom: [14, 6, 11],
  }[difficulty];
  return makeConfig({
    ...base,
    rows: v[0],
    startRows: v[1],
    dangerThreshold: v[2],
  });
}
export const isWideDesktop = (id: string) => id.endsWith("-desktop-v2");
