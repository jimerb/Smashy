import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import {
  PUZZLES,
  PUZZLE_CONTENT_VERSION,
  puzzleCells,
  puzzleGame,
} from "../src/content/puzzles.ts";
import {
  resolveShot,
  resolvePlacement,
  traceShot,
  validateState,
  supportedCells,
  type GameState,
} from "../src/core/index.ts";

const profiles = ["standard", "compact"] as const;

test("fifty original puzzle identities provide fifty distinct occupied topologies, ten ordered chapters and explicit profile variants", () => {
  assert.equal(PUZZLES.length, 50);
  assert.equal(new Set(PUZZLES.map((p) => p.id)).size, 50);
  assert.equal(new Set(PUZZLES.map((p) => p.title)).size, 50);
  assert.equal(new Set(PUZZLES.map((p) => p.chapter)).size, 10);
  const topologies = new Set<string>();
  for (let index = 0; index < PUZZLES.length; index++) {
    const puzzle = PUZZLES[index],
      cells = puzzleCells(index, "compact");
    assert.equal(puzzle.id, `puzzle-${String(index + 1).padStart(2, "0")}`);
    assert.equal(puzzle.chapter, PUZZLES[Math.floor(index / 5) * 5].chapter);
    assert(puzzle.hint.length > 20);
    const left = Math.min(...cells.map((cell) => cell.col));
    topologies.add(
      cells
        .map((cell) => `${cell.row},${cell.col - left}`)
        .sort()
        .join(";"),
    );
    for (const profile of profiles) {
      assert(puzzle.variants[profile].rows.length > 0);
      assert.notEqual(puzzle.variants.standard, puzzle.variants.compact);
      assert.notEqual(
        puzzle.variants.standard.rows,
        puzzle.variants.compact.rows,
      );
      assert(puzzle.variants[profile].solution.length > 0);
    }
  }
  assert.equal(
    topologies.size,
    50,
    "translated or recolored copies of one topology do not count as distinct authored boards",
  );
});

test("all one hundred profile layouts are valid ceiling-supported original starts with honest per-board targets", () => {
  for (let index = 0; index < PUZZLES.length; index++)
    for (const profile of profiles) {
      const puzzle = PUZZLES[index],
        state = puzzleGame(index, profile);
      assert(validateState(state), `${puzzle.id}/${profile}`);
      assert.equal(state.config.profile, profile);
      assert.equal(state.config.target, puzzle.target);
      assert.equal(
        supportedCells(state.config, state.board).size,
        state.board.length,
      );
      assert.equal(state.status, "ready");
      assert.equal(state.assisted, false);
      assert.equal(puzzleGame(index, profile, true).assisted, true);
      assert(puzzle.target >= puzzle.variants[profile].solution.length);
      assert.deepEqual(
        puzzleGame(index, profile),
        state,
        "same puzzle has the same board and queue stream",
      );
    }
  assert.throws(() => puzzleGame(-1, "standard"));
  assert.throws(() => puzzleGame(50, "compact"));
});

test("every stored solution witness clears through the unchanged engine, including checkpoint round trips", () => {
  let supportCuts = 0,
    anchorDrops = 0,
    bankShots = 0;
  const shotCounts = new Set<number>();
  for (let index = 0; index < PUZZLES.length; index++)
    for (const profile of profiles) {
      const puzzle = PUZZLES[index],
        variant = puzzle.variants[profile];
      let state = puzzleGame(index, profile);
      for (const [shot, angle] of variant.solution.entries()) {
        assert.equal(
          state.status,
          "ready",
          `${puzzle.id}/${profile} has no superfluous post-clear shots`,
        );
        const result = resolveShot(JSON.parse(JSON.stringify(state)), angle);
        assert.equal(
          result.error,
          undefined,
          `${puzzle.id}/${profile}/shot${shot + 1}`,
        );
        assert(validateState(result.state));
        if (result.dropped.length >= 3) supportCuts++;
        if (result.dropped.some((cell) => cell.type === 7)) anchorDrops++;
        if (result.trace.points.length > 2) bankShots++;
        state = result.state;
      }
      assert.equal(state.status, "cleared", `${puzzle.id}/${profile}`);
      assert.equal(state.shots, variant.solution.length);
      shotCounts.add(state.shots);
    }
  assert(
    supportCuts >= 40,
    "the pack must reward support cuts rather than only color matching",
  );
  assert(
    anchorDrops >= 20,
    "neutral metal must have real gameplay consequences",
  );
  assert(bankShots >= 20, "wall craft must occur in the verified pack");
  assert(
    shotCounts.size >= 5,
    "the pack includes distinct single- and multi-decision boards",
  );
});

function assertNoDirectMatch(state: GameState, label: string): void {
  let directShots = 0;
  // A sampled content check, not a mathematical impossibility proof for all real-valued angles.
  for (let tenth = 50; tenth <= 1750; tenth++) {
    const trace = traceShot(state, tenth / 10);
    if (trace.points.length !== 2 || !trace.landing) continue;
    directShots++;
    assert.equal(
      resolvePlacement(state, trace.landing, trace).matched.length,
      0,
      `${label}: direct match at ${tenth / 10} degrees`,
    );
  }
  assert(
    directShots > 0,
    "a bank puzzle must still accept ordinary direct shots",
  );
}

test("all bank-labelled puzzles require a rebound for their opening match in the direct-angle corpus", () => {
  for (let index = 0; index < PUZZLES.length; index++) {
    const puzzle = PUZZLES[index];
    if (!puzzle.tactic.includes("bank")) continue;
    for (const profile of profiles) {
      const state = puzzleGame(index, profile),
        witness = puzzle.variants[profile].solution;
      assertNoDirectMatch(state, `${puzzle.id}/${profile}`);
      const first = resolveShot(state, witness[0]);
      assert(first.trace.points.length >= 3 && first.matched.length >= 3);
      if (puzzle.tactic === "double-bank") {
        assertNoDirectMatch(first.state, `${puzzle.id}/${profile}/second`);
        const second = resolveShot(first.state, witness[1]);
        assert(second.trace.points.length >= 3 && second.matched.length >= 3);
      }
    }
  }
});

test("machine-readable solvability evidence matches this catalog and its replayed outcomes", () => {
  const report = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/puzzle-validation.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(report.contentVersion, PUZZLE_CONTENT_VERSION);
  assert.equal(report.boardCount, 100);
  assert.equal(report.solved, 100);
  assert.equal(report.uniqueTopologies, 50);
  assert.equal(
    report.catalogDigest,
    createHash("sha256").update(JSON.stringify(PUZZLES)).digest("hex"),
  );
  assert.equal(report.boards.length, 100);
  for (const entry of report.boards) {
    const index = PUZZLES.findIndex((p) => p.id === entry.id);
    assert(index >= 0);
    let state = puzzleGame(index, entry.profile);
    assert.deepEqual(
      entry.solution,
      PUZZLES[index].variants[entry.profile as "standard" | "compact"].solution,
    );
    for (const angle of entry.solution) state = resolveShot(state, angle).state;
    assert.equal(state.status, entry.status);
    assert.equal(state.score, entry.score);
    assert.equal(state.shots, entry.shots);
    assert.equal(state.config.target, entry.target);
  }
});
