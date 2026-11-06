import test from "node:test";
import assert from "node:assert/strict";
import { createGame, resolveShot, undoState } from "../src/core";
import {
  createReplay,
  appendReplay,
  undoReplay,
  replayShots,
  validateReplay,
  MAX_REPLAY_EVENTS,
} from "../src/replay";
test("accepted shot reports reconstruct queue, RNG, board, score and assistance through JSON reload and undo", () => {
  let game = createGame({ seed: 429 }),
    report = createReplay(game);
  let before = game;
  for (let i = 0; i < 25 && game.status === "ready"; i++) {
    before = structuredClone(game);
    const angle = 50 + i * 2;
    const r = resolveShot(game, angle);
    if (r.error) continue;
    report = appendReplay(report, before, r, angle);
    game = r.state;
  }
  assert.deepEqual(replayShots(JSON.parse(JSON.stringify(report))), game);
  game = undoState(before, game);
  report = undoReplay(report, game);
  assert.deepEqual(replayShots(report), game);
});
test("shot reports reject altered piece promises, invalid shots and malformed data", () => {
  const state = createGame({ seed: 43 });
  const r = resolveShot(state, 90),
    report = appendReplay(createReplay(state), state, r, 90);
  const wrong = structuredClone(report);
  wrong.events[0].current = (wrong.events[0].current + 1) % 7;
  assert.throws(() => replayShots(wrong), /sequence/);
  assert.equal(
    validateReplay({
      ...report,
      events: [{ ...report.events[0], angle: NaN }],
    }),
    false,
  );
  assert.throws(
    () => appendReplay(createReplay(state), state, resolveShot(state, 0), 0),
    /accepted/,
  );
});
test("bounded reports explicitly move their starting snapshot rather than keeping an unreplayable partial history", () => {
  const state = createGame({ seed: 9 });
  const report = createReplay(state);
  report.events = Array(MAX_REPLAY_EVENTS).fill({
    angle: 90,
    current: state.current,
    next: state.next,
    landing: { row: 0, col: 0 },
  });
  const r = resolveShot(state, 90);
  const rolled = appendReplay(report, state, r, 90);
  assert.equal(rolled.truncated, true);
  assert.equal(rolled.events.length, 1);
  assert.deepEqual(replayShots(rolled), r.state);
});
