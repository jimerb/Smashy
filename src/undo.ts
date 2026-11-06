import { undoState, type GameState } from "./core";

export const UNDO_PENALTY = 500;

/** Undo removes the last shot's awards before paying its cost. */
export function canUndoShot(
  previous: GameState | null,
  current: GameState,
  penaltyEnabled = true,
): previous is GameState {
  return (
    !!previous &&
    previous.status === "ready" &&
    current.status === "ready" &&
    current.shots === previous.shots + 1 &&
    (!penaltyEnabled ||
      (previous.score >= UNDO_PENALTY && current.score >= UNDO_PENALTY))
  );
}

export function applyUndo(
  previous: GameState,
  current: GameState,
  penaltyEnabled = true,
): GameState {
  if (!canUndoShot(previous, current, penaltyEnabled))
    throw new Error(
      "Undo needs a completed shot and 500 pre-shot points when the penalty is on.",
    );
  const restored = undoState(previous, current);
  restored.score -= penaltyEnabled ? UNDO_PENALTY : 0;
  return restored;
}
