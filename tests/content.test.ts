import test from "node:test";
import assert from "node:assert/strict";
import { LESSONS, lessonGame } from "../src/content/lessons.ts";
import {
  resolveShot,
  traceShot,
  validateState,
  supportedCells,
} from "../src/core/index.ts";

test("three original teaching boards have explicit supported variants for each profile", () => {
  assert.equal(LESSONS.length, 3);
  for (const profile of ["standard", "compact"] as const)
    for (let index = 0; index < LESSONS.length; index++) {
      const state = lessonGame(index, profile);
      assert(
        validateState(state),
        `${profile}/${index} must be a valid stable starting state`,
      );
      assert.equal(
        supportedCells(state.config, state.board).size,
        state.board.length,
      );
      assert.equal(state.config.profile, profile);
      assert.equal(state.assisted, true);
      assert.deepEqual(
        lessonGame(index, profile),
        state,
        "authored lesson and queue must replay identically",
      );
    }
});

test("lesson one rewards a broad direct connected match in both profiles", () => {
  for (const profile of ["standard", "compact"] as const) {
    const state = lessonGame(0, profile);
    for (const angle of [87, 90, 93]) {
      const result = resolveShot(state, angle);
      assert.equal(result.matched.length, 3, `${profile}/${angle}`);
      assert.equal(result.dropped.length, 0);
      assert.equal(result.trace.points.length, 2);
      assert.equal(result.state.status, "cleared");
    }
  }
});

test("lesson two clearly rewards a three-match support cut with four dissimilar drops", () => {
  for (const profile of ["standard", "compact"] as const) {
    const result = resolveShot(lessonGame(1, profile), 92);
    assert.equal(result.matched.length, 3);
    assert.equal(result.dropped.length, 4);
    assert.equal(new Set(result.dropped.map((cell) => cell.type)).size, 4);
    assert.equal(result.award.match + result.award.drop, 170);
    assert.equal(result.state.status, "cleared");
    assert.equal(result.state.danger, 0);
  }
});

test("lesson three has a meaningful one-wall win and no direct-shot match in the angle corpus", () => {
  for (const profile of ["standard", "compact"] as const) {
    const state = lessonGame(2, profile),
      winningAngle = profile === "standard" ? 49 : 48.4;
    const result = resolveShot(state, winningAngle);
    assert.equal(
      result.trace.points.length,
      3,
      "one wall bounce plus launch and impact",
    );
    assert.equal(result.matched.length, 3);
    assert.equal(result.dropped.length, 4);
    assert.equal(result.state.status, "cleared");
    // This corpus is a content review, not a mathematical proof for all angles.
    for (let tenth = 50; tenth <= 1750; tenth++) {
      const angle = tenth / 10,
        trace = traceShot(state, angle);
      if (trace.points.length === 2 && trace.landing)
        assert.equal(
          resolveShot(state, angle).matched.length,
          0,
          `${profile}/${angle} must teach a bank rather than a direct clear`,
        );
    }
  }
});

test("near-left-wall settling does not reject a valid local corridor after a bank", () => {
  const state = lessonGame(2, "standard");
  const trace = traceShot(state, 110);
  assert.equal(trace.points.length, 3);
  assert.deepEqual(trace.landing, { row: 1, col: 0 });
  assert.equal(resolveShot(state, 110).matched.length, 3);
});
