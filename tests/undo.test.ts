import test from "node:test";
import assert from "node:assert/strict";
import { createGame, resolveShot, validateState } from "../src/core";
import { applyUndo, canUndoShot, UNDO_PENALTY } from "../src/undo";
import {
  appendReplay,
  createReplay,
  replayShots,
  undoReplay,
} from "../src/replay";

function shot(score: number) {
  const before = createGame({ seed: 429 });
  before.score = score;
  const result = resolveShot(before, 90);
  assert(!result.error && result.state.status === "ready");
  return { before, result };
}
test("paid Undo charges exactly 500 after restoring the pre-shot score and all geometry/RNG", () => {
  const { before, result } = shot(750);
  const copy = structuredClone({ before, current: result.state });
  assert.equal(UNDO_PENALTY, 500);
  const restored = applyUndo(before, result.state);
  assert.deepEqual(restored, { ...before, score: 250, assisted: true });
  assert(validateState(restored));
  assert.deepEqual({ before, current: result.state }, copy);
  assert.equal(canUndoShot(null, restored), false);
  assert.equal(canUndoShot(before, restored), false);
});
test("500-point boundary, insufficient funds and last-shot awards cannot finance their own undo", () => {
  const exact = shot(500),
    low = shot(499);
  assert.equal(applyUndo(exact.before, exact.result.state).score, 0);
  assert.equal(canUndoShot(low.before, low.result.state), false);
  assert.throws(() => applyUndo(low.before, low.result.state), /500/);
  low.result.state.score = 1500;
  assert.equal(canUndoShot(low.before, low.result.state), false);
  const lost = { ...exact.result.state, status: "lost" as const };
  assert.equal(canUndoShot(exact.before, lost), false);
});
test("explicit free Undo restores a zero-score attempt and still marks assistance", () => {
  const { before, result } = shot(0);
  assert.equal(canUndoShot(before, result.state, false), true);
  assert.deepEqual(applyUndo(before, result.state, false), {
    ...before,
    assisted: true,
  });
});
test("paid Undo and later shots replay and serialize with the penalty retained", () => {
  const { before, result } = shot(1000);
  let report = appendReplay(createReplay(before), before, result, 90);
  const restored = applyUndo(before, result.state);
  report = undoReplay(report, restored, 500);
  assert(report.truncated);
  assert.deepEqual(replayShots(JSON.parse(JSON.stringify(report))), restored);
  const next = resolveShot(restored, 92);
  report = appendReplay(report, restored, next, 92);
  assert.deepEqual(replayShots(report), next.state);
  const again = applyUndo(restored, next.state);
  assert.equal(again.score, 0);
  assert.deepEqual(replayShots(undoReplay(report, again, 500)), again);
});
