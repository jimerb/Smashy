import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  getConfig,
  validateState,
  type Difficulty,
  type GameState,
  type Profile,
} from "../src/core";
import { PUZZLES, puzzleGame } from "../src/content/puzzles";
import {
  advanceBoard,
  createProgress,
  isRunTerminal,
  journeyDifficulty,
  modeContext,
  validateProgress,
} from "../src/progression";

function cleared(
  difficulty: Difficulty = "standard",
  profile: Profile = "standard",
  score = 1234,
): GameState {
  const game = createGame({
    config: getConfig(difficulty, profile),
    board: [],
    assisted: true,
    seed: 1,
  });
  game.score = score;
  game.shots = 17;
  game.danger = 3;
  game.descent = 42;
  assert.equal(validateState(game), true);
  return game;
}

test("terminal policy records only end-of-run outcomes, including every loss", () => {
  for (const mode of ["classic", "custom", "tutorial"] as const) {
    const p = createProgress(mode, mode === "custom" ? "custom" : "standard");
    assert.equal(isRunTerminal(cleared(), p), true);
    assert.equal(isRunTerminal(createGame(), p), false);
  }
  const journey = createProgress("journey", "standard");
  const puzzles = createProgress("puzzles", "standard");
  assert.equal(isRunTerminal(cleared(), journey), false);
  assert.equal(isRunTerminal(cleared(), puzzles), false);
  assert.equal(
    isRunTerminal(cleared(), { ...puzzles, puzzleIndex: PUZZLES.length - 1 }),
    true,
  );
  for (const p of [journey, puzzles, createProgress("classic", "standard")]) {
    assert.equal(isRunTerminal({ ...cleared(), status: "lost" }, p), true);
  }
});

test("Journey advances from selected difficulty and repeats Expert, preserving original record category", () => {
  for (const profile of ["standard", "compact"] as const) {
    let progress = createProgress("journey", "relaxed");
    const originalId = progress.configId;
    const expected = ["standard", "tricky", "expert", "expert", "expert"];
    let game = cleared("relaxed", profile);
    for (let i = 0; i < expected.length; i++) {
      const previousGame = structuredClone(game),
        previousProgress = structuredClone(progress);
      const result = advanceBoard(game, progress, 21 + i);
      assert.equal(result.game.config.difficulty, expected[i]);
      assert.equal(journeyDifficulty(result.progress), expected[i]);
      assert.equal(result.progress.startDifficulty, "relaxed");
      assert.equal(result.progress.configId, originalId);
      assert.equal(result.progress.journeyStage, i + 1);
      assert.equal(result.game.config.profile, profile);
      assert.equal(result.game.score, 1234);
      assert.equal(result.game.assisted, true);
      assert.equal(result.game.shots, 0);
      assert.equal(result.game.danger, 0);
      assert.equal(result.game.descent, 0);
      assert.equal(result.game.status, "ready");
      assert.equal(validateState(result.game), true);
      assert.equal(result.game.seed, 21 + i);
      assert.deepEqual(game, previousGame);
      assert.deepEqual(progress, previousProgress);
      game = { ...result.game, status: "cleared", board: [] };
      progress = result.progress;
    }
  }
});

test("Journey starting at Expert stays Expert and deterministic seeds reproduce the new board", () => {
  const progress = createProgress("journey", "expert");
  const game = cleared("expert");
  assert.deepEqual(
    advanceBoard(game, progress, 99),
    advanceBoard(game, progress, 99),
  );
  assert.notDeepEqual(
    advanceBoard(game, progress, 99).game.board,
    advanceBoard(game, progress, 100).game.board,
  );
  assert.equal(
    advanceBoard(game, progress, 99).game.config.difficulty,
    "expert",
  );
});

test("Puzzle advancement uses authored next profile variant and accumulates score without re-awarding clear", () => {
  assert.equal(PUZZLES.length, 50);
  for (const profile of ["standard", "compact"] as const) {
    const progress = createProgress("puzzles", "standard", 12),
      initial = cleared("standard", profile, 9876);
    const next = advanceBoard(initial, progress, 999);
    const authored = puzzleGame(13, profile, true);
    authored.score = 9876;
    assert.deepEqual(next.game, authored);
    assert.equal(next.progress.puzzleIndex, 13);
    assert.equal(next.progress.startPuzzleIndex, 12);
    assert.equal(next.progress.configId, progress.configId);
    assert.equal(next.game.shots, 0);
    assert.equal(next.game.danger, 0);
    assert.equal(isRunTerminal(next.game, next.progress), false);
    assert.equal(modeContext(next.progress), "Puzzle 14 of 50");
  }
});

test("A complete puzzle run reaches board 50 exactly once with the original starting category", () => {
  for (const profile of ["standard", "compact"] as const) {
    let progress = createProgress("puzzles", "standard");
    let game = puzzleGame(0, profile, false);
    for (let index = 0; index < PUZZLES.length; index++) {
      game = {
        ...game,
        board: [],
        status: "cleared",
        score: (index + 1) * 170,
      };
      assert.equal(progress.puzzleIndex, index);
      assert.equal(progress.startPuzzleIndex, 0);
      assert.equal(progress.configId, "puzzles-start-0-v1");
      assert.equal(isRunTerminal(game, progress), index === 49);
      if (index === 49) {
        assert.throws(() => advanceBoard(game, progress, 1));
      } else {
        const next = advanceBoard(game, progress, index + 1);
        assert.equal(next.game.score, (index + 1) * 170);
        assert.equal(next.game.assisted, false);
        assert.equal(next.game.config.profile, profile);
        assert.equal(validateState(next.game), true);
        game = next.game;
        progress = next.progress;
      }
    }
  }
});

test("Progress validation rejects invalid modes, impossible counters, mixed-mode fields and empty identity", () => {
  const good = createProgress("journey", "gentle");
  assert.equal(validateProgress(good), true);
  for (const bad of [
    null,
    [],
    {},
    { ...good, mode: "bad" },
    { ...good, journeyStage: -1 },
    { ...good, journeyStage: Infinity },
    { ...good, startDifficulty: "custom" },
    { ...good, configId: "" },
    { ...good, configId: "bad\nidentity" },
    { ...good, puzzleIndex: 1 },
    { ...good, mode: "classic", journeyStage: 1 },
    { ...createProgress("puzzles", "standard"), puzzleIndex: 50 },
    {
      ...createProgress("puzzles", "standard"),
      puzzleIndex: 2,
      startPuzzleIndex: 3,
    },
  ]) {
    assert.equal(validateProgress(bad), false, JSON.stringify(bad));
  }
  assert.throws(() => createProgress("journey", "custom"));
  assert.throws(() => createProgress("puzzles", "standard", -1));
});

test("Only valid intermediate clears can advance; no extra board after final puzzle or loss", () => {
  const progress = createProgress("journey", "standard");
  assert.throws(() => advanceBoard(createGame(), progress, 1));
  assert.throws(() =>
    advanceBoard({ ...cleared(), status: "lost" }, progress, 1),
  );
  assert.throws(() =>
    advanceBoard(cleared(), createProgress("classic", "standard"), 1),
  );
  assert.throws(() =>
    advanceBoard(cleared(), createProgress("puzzles", "standard", 49), 1),
  );
  assert.throws(() => advanceBoard(cleared(), progress, -1));
  assert.throws(() => advanceBoard(cleared(), progress, NaN));
  assert.throws(() =>
    advanceBoard({ ...cleared(), score: Infinity }, progress, 1),
  );
});
