import {
  createGame,
  getConfig,
  validateState,
  type Difficulty,
  type GameState,
} from "../core";
import { PUZZLES, puzzleGame } from "../content/puzzles";
import { desktopArena, isWideDesktop } from "../desktop-arena";

export type RunMode = "classic" | "puzzles" | "journey" | "custom" | "tutorial";
export type JourneyDifficulty = Exclude<Difficulty, "custom">;
export const JOURNEY_DIFFICULTIES: readonly JourneyDifficulty[] = [
  "gentle",
  "relaxed",
  "standard",
  "tricky",
  "expert",
];

/** Starting context remains fixed while the current board advances. */
export interface RunProgress {
  mode: RunMode;
  startDifficulty: Difficulty;
  puzzleIndex: number;
  startPuzzleIndex: number;
  journeyStage: number;
  configId: string;
}

const MODES: readonly RunMode[] = [
  "classic",
  "puzzles",
  "journey",
  "custom",
  "tutorial",
];
const safeCounter = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const difficultyValid = (value: unknown): value is Difficulty =>
  [...JOURNEY_DIFFICULTIES, "custom"].includes(value as Difficulty);

export function validateProgress(value: unknown): value is RunProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as RunProgress;
  if (
    !MODES.includes(p.mode) ||
    !difficultyValid(p.startDifficulty) ||
    !safeCounter(p.puzzleIndex) ||
    !safeCounter(p.startPuzzleIndex) ||
    p.startPuzzleIndex > p.puzzleIndex ||
    p.puzzleIndex >= PUZZLES.length ||
    !safeCounter(p.journeyStage) ||
    typeof p.configId !== "string" ||
    p.configId.length === 0 ||
    p.configId.length > 240 ||
    /[\u0000-\u001f]/.test(p.configId)
  )
    return false;
  if (p.mode !== "puzzles" && (p.puzzleIndex !== 0 || p.startPuzzleIndex !== 0))
    return false;
  if (p.mode !== "journey" && p.journeyStage !== 0) return false;
  if (p.mode === "journey" && p.startDifficulty === "custom") return false;
  return true;
}

export function createProgress(
  mode: RunMode,
  startDifficulty: Difficulty,
  puzzleIndex = 0,
): RunProgress {
  const progress: RunProgress = {
    mode,
    startDifficulty,
    puzzleIndex: mode === "puzzles" ? puzzleIndex : 0,
    startPuzzleIndex: mode === "puzzles" ? puzzleIndex : 0,
    journeyStage: 0,
    configId:
      mode === "journey"
        ? `journey-start-${startDifficulty}-v1`
        : mode === "puzzles"
          ? `puzzles-start-${puzzleIndex}-v1`
          : mode === "classic"
            ? "classic-v1"
            : mode === "custom"
              ? "custom-v1"
              : "lesson-v1",
  };
  if (!validateProgress(progress))
    throw new Error("Run progression is invalid.");
  return progress;
}

export function journeyDifficulty(progress: RunProgress): JourneyDifficulty {
  if (!validateProgress(progress) || progress.mode !== "journey")
    throw new Error("Journey progression is required.");
  const start = JOURNEY_DIFFICULTIES.indexOf(
    progress.startDifficulty as JourneyDifficulty,
  );
  return JOURNEY_DIFFICULTIES[
    Math.min(JOURNEY_DIFFICULTIES.length - 1, start + progress.journeyStage)
  ];
}

/** Intermediate Journey/Puzzle clears do not finalize personal records. */
export function isRunTerminal(game: GameState, progress: RunProgress): boolean {
  if (!validateProgress(progress))
    throw new Error("Run progression is invalid.");
  if (game.status === "lost") return true;
  if (game.status !== "cleared") return false;
  if (progress.mode === "journey") return false;
  return (
    progress.mode !== "puzzles" || progress.puzzleIndex === PUZZLES.length - 1
  );
}

/** Build a fresh board without mutating its predecessor or awarding points twice. */
export function advanceBoard(
  game: GameState,
  progress: RunProgress,
  seed: number,
): { game: GameState; progress: RunProgress } {
  if (!validateProgress(progress) || !validateState(game))
    throw new Error("Cannot advance invalid run data.");
  if (game.status !== "cleared" || isRunTerminal(game, progress))
    throw new Error("Only an intermediate cleared board may advance.");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error("A valid board seed is required.");
  const next = { ...progress };
  let board: GameState;
  if (next.mode === "puzzles") {
    next.puzzleIndex++;
    board = puzzleGame(next.puzzleIndex, game.config.profile, game.assisted);
  } else {
    if (next.journeyStage === Number.MAX_SAFE_INTEGER)
      throw new Error("Journey stage limit reached.");
    next.journeyStage++;
    board = createGame({
      seed,
      config: isWideDesktop(next.configId)
        ? desktopArena(journeyDifficulty(next))
        : getConfig(journeyDifficulty(next), game.config.profile),
      assisted: game.assisted,
    });
  }
  board.score = game.score;
  return { game: board, progress: next };
}

export function modeContext(progress: RunProgress): string {
  if (!validateProgress(progress))
    throw new Error("Run progression is invalid.");
  if (progress.mode === "puzzles")
    return `Puzzle ${progress.puzzleIndex + 1} of ${PUZZLES.length}`;
  if (progress.mode === "journey")
    return `Journey · Board ${progress.journeyStage + 1}`;
  return progress.mode === "classic"
    ? "Classic"
    : progress.mode === "custom"
      ? "Custom"
      : "Practice";
}
