import {
  createGame,
  getConfig,
  type Cell,
  type GameState,
  type Profile,
} from "../core";
export const LESSONS = [
  {
    id: "match",
    title: "01 · Make a match",
    hint: "Connect Chip to both ochre blocks. Three touching pieces clear—even in a bend.",
  },
  {
    id: "support",
    title: "02 · Cut the support",
    hint: "Find the ochre support. Clear it and the other shapes lose their ceiling connection.",
  },
  {
    id: "bank",
    title: "03 · Find the bank",
    hint: "Try a side wall. The dotted practice path and landing ring use the same geometry as your shot.",
  },
] as const;
export function lessonGame(index: number, profile: Profile): GameState {
  const config = getConfig("standard", profile),
    c = Math.floor(config.columns / 2);
  const boards: Cell[][] = [
    [
      { row: 0, col: c, type: 0 },
      { row: 0, col: c + 1, type: 0 },
    ],
    [
      { row: 0, col: c, type: 0 },
      { row: 0, col: c + 1, type: 0 },
      { row: 1, col: c + 1, type: 1 },
      { row: 2, col: c + 1, type: 2 },
      { row: 2, col: c + 2, type: 3 },
      { row: 3, col: c + 1, type: 7 },
    ],
    [
      { row: 0, col: 0, type: 2 },
      { row: 0, col: 1, type: 2 },
      { row: 1, col: 1, type: 4 },
      { row: 2, col: 1, type: 4 },
      { row: 2, col: 2, type: 5 },
      { row: 3, col: 1, type: 6 },
    ],
  ];
  return createGame({
    seed: 8400 + index,
    config,
    board: boards[index],
    current: index === 2 ? 2 : 0,
    next: index === 2 ? 4 : 1,
    assisted: true,
  });
}
