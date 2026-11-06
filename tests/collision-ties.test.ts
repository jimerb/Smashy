import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  getConfig,
  makeConfig,
  traceShot,
  resolveShot,
  validateState,
  type Cell,
} from "../src/core";

test("an analytic simultaneous ceiling/wall arrival attaches at either corner without a spurious bank", () => {
  const config = getConfig();
  for (const left of [true, false]) {
    const corner = { x: left ? 22 : config.width - 22, y: 22 };
    const state = createGame({
      config,
      board: [{ row: 0, col: left ? config.columns - 1 : 0, type: 1 }],
      current: 0,
      next: 2,
      seed: 91,
    });
    const angle =
      (Math.atan2(config.launcher.y - corner.y, corner.x - config.launcher.x) *
        180) /
      Math.PI;
    const trace = traceShot(state, angle);
    assert.equal(
      trace.points.length,
      2,
      "ceiling and wall arriving together must not add a zero-length rebound",
    );
    assert(Math.abs(trace.points[1].x - corner.x) < 1e-8);
    assert(Math.abs(trace.points[1].y - corner.y) < 1e-8);
    assert.deepEqual(trace.landing, {
      row: 0,
      col: left ? 0 : config.columns - 1,
    });
    const result = resolveShot(state, angle);
    assert.equal(result.error, undefined);
    assert.equal(result.state.shots, 1);
    assert.equal(result.matched.length, 0);
    assert(validateState(result.state));
  }
});

test("a symmetric two-proxy contact has the analytic impact and stable landing under reversed board enumeration", () => {
  const config = makeConfig({
    ...getConfig("standard", "compact"),
    columns: 12,
  });
  const pair: Cell[] = [
    { row: 0, col: 5, type: 1 },
    { row: 0, col: 6, type: 2 },
  ];
  const expectedY = 24 + Math.sqrt(44 ** 2 - 24 ** 2);
  for (const board of [pair, [...pair].reverse()]) {
    const state = createGame({ config, board, current: 0, next: 3, seed: 29 });
    const trace = traceShot(state, 90);
    assert.equal(trace.points.length, 2);
    assert(Math.abs(trace.points[1].x - 288) < 1e-8);
    assert(Math.abs(trace.points[1].y - expectedY) < 1e-8);
    assert.deepEqual(trace.landing, { row: 1, col: 5 });
    const result = resolveShot(state, 90);
    assert.equal(result.error, undefined);
    assert.equal(result.state.shots, 1);
    assert.equal(result.state.board.length, 3);
    assert(validateState(result.state));
  }
});
