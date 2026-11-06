import test from "node:test";
import assert from "node:assert/strict";
import {
  ANCHOR,
  createGame,
  getConfig,
  makeConfig,
  cellCenter,
  neighbors,
  slotKey,
  inBounds,
  traceShot,
  resolveShot,
  resolvePlacement,
  matchAward,
  dropAward,
  efficiencyAward,
  supportedCells,
  validateState,
  cloneState,
  undoState,
  pointOnTrace,
  nextRandom,
  isFloorFull,
  anchorEscapeRoutes,
  type Config,
  type Cell,
} from "../src/core/index.ts";

test("configured profiles preserve exact geometry and supported initial boards", () => {
  const standard = getConfig(),
    compact = getConfig("standard", "compact");
  assert.deepEqual(
    [standard.width, standard.height, standard.lossY, standard.launcher.y],
    [624, 960, 812, 900],
  );
  assert.deepEqual(
    [compact.width, compact.height, compact.lossY, compact.launcher.y],
    [528, 776, 644, 720],
  );
  for (const profile of ["standard", "compact"] as const)
    for (const difficulty of [
      "gentle",
      "relaxed",
      "standard",
      "tricky",
      "expert",
    ] as const) {
      const state = createGame({
        config: getConfig(difficulty, profile),
        seed: 511,
      });
      assert.equal(validateState(state), true);
      assert.equal(
        state.board.filter((cell) => cell.type === ANCHOR).length,
        state.config.anchors,
      );
      assert.equal(
        supportedCells(state.config, state.board).size,
        state.board.length,
      );
    }
  assert.throws(() => makeConfig({ ...standard, columns: 1 }));
  assert.throws(() => createGame({ board: [{ row: 1, col: 0, type: 0 }] }));
});

function verifyAnchorEscapeGeometry(config: Config, board: Cell[]): void {
  const result = anchorEscapeRoutes(config, board);
  const anchors = board
    .filter((cell) => cell.type === ANCHOR)
    .map((cell) => cellCenter(config, cell));
  assert.equal(result.blocked.length, 0);
  assert.equal(
    result.routes.length,
    board.filter((cell) => cell.type !== ANCHOR).length,
  );
  for (const route of result.routes) {
    assert.deepEqual(route.points[0], cellCenter(config, route.cell));
    assert.deepEqual(route.points.at(-1), config.launcher);
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1],
        b = route.points[i];
      for (const p of [a, b]) {
        assert(p.x >= 22 - 1e-7 && p.x <= config.width - 22 + 1e-7);
        assert(p.y >= 22 - 1e-7 && p.y <= config.launcher.y + 1e-7);
      }
      // Independent projection math verifies every returned witness edge; the
      // certificate's own pass/fail flag is not the geometric assertion.
      for (const anchor of anchors) {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          denominator = dx * dx + dy * dy;
        const t =
          denominator === 0
            ? 0
            : Math.max(
                0,
                Math.min(
                  1,
                  ((anchor.x - a.x) * dx + (anchor.y - a.y) * dy) / denominator,
                ),
              );
        const separation = Math.hypot(
          a.x + t * dx - anchor.x,
          a.y + t * dy - anchor.y,
        );
        assert(
          separation >= 44 - 1e-7,
          `escape penetrates an Anchor: ${separation}`,
        );
      }
    }
  }
}

test("generated Custom seed6 repairs the permanently sealed ordinary roof without reducing Anchor count", () => {
  const config = makeConfig({
    columns: 5,
    rows: 14,
    startRows: 8,
    anchors: 10,
    dangerThreshold: 8,
    target: 120,
    types: 3,
    profile: "standard",
    difficulty: "custom",
  });
  const unsafe: Cell[] = [];
  for (let row = 0; row < config.startRows; row++)
    for (let col = 0; col < config.columns - (row & 1); col++)
      unsafe.push({
        row,
        col,
        type: row === 1 ? ANCHOR : (((row + col) % 3) as 0 | 1 | 2),
      });
  const trapped = anchorEscapeRoutes(config, unsafe);
  assert.equal(
    trapped.blocked.filter((cell) => cell.row === 0).length,
    5,
    "a full neutral row cannot be treated as a reachable roof",
  );
  const generated = createGame({ config, seed: 6 });
  assert.equal(
    generated.board.filter((cell) => cell.type === ANCHOR).length,
    10,
  );
  assert(
    generated.board.some((cell) => cell.type === ANCHOR && cell.row >= 2),
    "repair retains the full count across multiple rows instead of limiting metal to the top row",
  );
  verifyAnchorEscapeGeometry(config, generated.board);
  assert.deepEqual(
    createGame({ config, seed: 6 }),
    generated,
    "repair and its future queue stay deterministic",
  );
  assert.deepEqual(
    cloneState(generated),
    generated,
    "same-board retry retains the repaired board and RNG",
  );
});

test("Anchor generation retains the full validated density and dimension ranges with independently clear escape routes", () => {
  for (const profile of ["standard", "compact"] as const)
    for (const columns of [5, 6, 9, 13, 19])
      for (const rows of [8, 14, 24])
        for (const startRows of [1, rows - 3]) {
          const config = makeConfig({
            columns,
            rows,
            startRows,
            anchors: Math.floor((startRows * (columns - 1)) / 3),
            types: 7,
            dangerThreshold: 40,
            target: 1000,
            profile,
            difficulty: "custom",
          });
          const game = createGame({ config, seed: 0x5f3759df });
          assert(validateState(game));
          assert.equal(
            game.board.filter((cell) => cell.type === ANCHOR).length,
            config.anchors,
          );
          verifyAnchorEscapeGeometry(config, game.board);
        }
});

test("ordinary preset generation and explicit authored Anchor layouts keep their separate deterministic contracts", () => {
  for (const profile of ["standard", "compact"] as const)
    for (const difficulty of ["tricky", "expert"] as const)
      for (const seed of [1, 6, 47, 0x5f3759df]) {
        const config = getConfig(difficulty, profile),
          game = createGame({ config, seed });
        assert.equal(
          game.board.filter((cell) => cell.type === ANCHOR).length,
          config.anchors,
        );
        verifyAnchorEscapeGeometry(config, game.board);
        assert.deepEqual(createGame({ config, seed }), game);
      }
  const explicit: Cell[] = [
    { row: 0, col: 4, type: ANCHOR },
    { row: 1, col: 4, type: 0 },
    { row: 2, col: 4, type: 0 },
  ];
  const authored = createGame({
    board: explicit,
    current: 0,
    next: 0,
    seed: 6,
  });
  assert.deepEqual(
    authored.board,
    explicit,
    "authored levels are never repaired or regenerated",
  );
});

test("dense fallback avoids topologically open but launch-occluded curtains around isolated ordinary targets", () => {
  const cases = [
    { columns: 19, rows: 24, startRows: 21, anchors: 126, seed: 2857658386 },
    { columns: 5, rows: 14, startRows: 8, anchors: 10, seed: 577575188 },
  ];
  let verifiedTargets = 0;
  for (const values of cases) {
    const config = makeConfig({
      ...values,
      types: 7,
      dangerThreshold: 40,
      target: 1000,
      profile: "standard",
      difficulty: "custom",
    });
    const generated = createGame({ config, seed: values.seed });
    const anchors = generated.board.filter((cell) => cell.type === ANCHOR);
    if (values.anchors === 126)
      assert(Math.max(...anchors.map((cell) => cell.row)) >= 6);
    for (const target of generated.board.filter(
      (cell) => cell.type !== ANCHOR,
    )) {
      const candidates = [...anchors, target],
        supported = supportedCells(config, candidates);
      if (!supported.has(slotKey(target))) continue; // Already droppable if the other ordinary supports go.
      const state = {
        ...generated,
        board: candidates.filter((cell) => supported.has(slotKey(cell))),
        current: target.type as 0 | 1 | 2 | 3 | 4 | 5 | 6,
        next: target.type as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      };
      assert(validateState(state));
      const adjacent = new Set(neighbors(config, target).map(slotKey)),
        angles = new Set<number>();
      for (const slot of [target, ...neighbors(config, target)]) {
        const point = cellCenter(config, slot),
          span = config.width - 44;
        for (let wallImage = -12; wallImage <= 12; wallImage++)
          for (const x of [
            22 + 2 * wallImage * span + point.x - 22,
            22 + 2 * wallImage * span - (point.x - 22),
          ]) {
            const angle =
              (Math.atan2(config.launcher.y - point.y, x - config.launcher.x) *
                180) /
              Math.PI;
            for (const delta of [0, -0.1, 0.1])
              if (angle + delta >= 5 && angle + delta <= 175)
                angles.add(angle + delta);
          }
      }
      for (let angle = 5; angle <= 175; angle++) angles.add(angle);
      const witness = [...angles]
        .sort((a, b) => Math.abs(a - 90) - Math.abs(b - 90))
        .find((angle) => {
          const trace = traceShot(state, angle);
          return trace.landing && adjacent.has(slotKey(trace.landing));
        });
      assert.notEqual(
        witness,
        undefined,
        `no actual launch to ordinary ${slotKey(target)} in ${config.columns}-column fallback`,
      );
      verifiedTargets++;
    }
  }
  assert(
    verifiedTargets >= 20,
    "the regression covers real supported late-board targets, not only pieces that would already drop",
  );
});

test("staggered six-neighbor relation is symmetric at every wall and parity", () => {
  const config = getConfig();
  for (let row = 0; row < config.rows; row++)
    for (let col = 0; col < config.columns - (row & 1); col++) {
      const slot = { row, col },
        keys = neighbors(config, slot).map(slotKey);
      assert.equal(new Set(keys).size, keys.length);
      for (const adjacent of neighbors(config, slot)) {
        assert(inBounds(config, adjacent));
        assert(
          neighbors(config, adjacent).some(
            (back) => slotKey(back) === slotKey(slot),
          ),
        );
        const a = cellCenter(config, slot),
          b = cellCenter(config, adjacent);
        assert(Math.hypot(a.x - b.x, a.y - b.y) >= 44);
      }
    }
  assert.equal(neighbors(config, { row: 6, col: 6 }).length, 6);
});

test("awards use independent caps and efficiency minimum", () => {
  assert.equal(matchAward(2), 0);
  assert.equal(matchAward(3), 10);
  assert.equal(matchAward(4), 17);
  assert.equal(matchAward(150), 10000);
  assert.equal(dropAward(0), 0);
  assert.equal(dropAward(4), 160);
  assert.equal(dropAward(150), 10000);
  assert.equal(efficiencyAward(5, 50), 100);
});

test("support cut combines disconnected drops including Anchor into one squared award", () => {
  const board: Cell[] = [
    { row: 0, col: 0, type: 0 },
    { row: 0, col: 1, type: 0 },
    { row: 0, col: 5, type: 2 },
    { row: 1, col: 1, type: 1 },
    { row: 2, col: 1, type: 3 },
    { row: 2, col: 2, type: ANCHOR },
    { row: 3, col: 1, type: 4 },
  ];
  const before = createGame({ board, current: 0, next: 1 });
  before.danger = 8;
  const result = resolvePlacement(before, { row: 1, col: 0 });
  assert.equal(result.matched.length, 3);
  assert.equal(result.dropped.length, 4);
  assert.equal(result.award.total, 170);
  assert.equal(result.state.score, 170);
  assert.equal(result.state.danger, 1);
  assert.equal(result.descended, false);
  assert.equal(result.state.board.length, 1);
  assert.equal(before.board.length, 7, "pure resolution must not mutate input");
});

test("two separated islands share the combined drop award", () => {
  const board: Cell[] = [
    { row: 0, col: 1, type: 0 },
    { row: 0, col: 2, type: 0 },
    { row: 0, col: 6, type: 2 },
    { row: 1, col: 0, type: 1 },
    { row: 1, col: 2, type: 3 },
  ];
  const state = createGame({ board, current: 0 });
  const result = resolvePlacement(state, { row: 0, col: 0 });
  assert.equal(result.matched.length, 3);
  assert.equal(result.dropped.length, 2);
  assert.equal(result.award.drop, 40);
});

test("danger equality is safe; strict overflow descends without adding a row", () => {
  const original = createGame({
    board: [{ row: 0, col: 0, type: 1 }],
    current: 0,
    next: 0,
  });
  original.danger = 7;
  const full = resolvePlacement(original, { row: 1, col: 0 });
  assert.equal(full.state.danger, 8);
  assert.equal(full.state.descent, 0);
  assert.equal(full.descended, false);
  const overflow = resolvePlacement(full.state, { row: 2, col: 0 });
  assert.equal(overflow.state.danger, 0);
  assert.equal(overflow.state.descent, 42);
  assert.equal(overflow.descended, true);
  assert.equal(overflow.state.board.length, 3);
});

test("clearing ordinary pieces wins with supported Anchors and before danger overflow", () => {
  const state = createGame({
    board: [
      { row: 0, col: 0, type: 0 },
      { row: 0, col: 1, type: 0 },
      { row: 0, col: 8, type: ANCHOR },
    ],
    current: 0,
  });
  state.danger = 8;
  const result = resolvePlacement(state, { row: 1, col: 0 });
  assert.equal(result.state.status, "cleared");
  assert.equal(result.descended, false);
  assert.equal(result.state.board.length, 1);
  assert.equal(result.state.board[0].type, ANCHOR);
  assert.equal(result.award.clear, 1000);
  assert.equal(result.award.efficiency, 14900);
  assert.equal(result.state.shots, 1);
  assert(validateState(result.state));
});

test("descent loses when a supported proxy crosses the limit without deleting nonmatching pieces", () => {
  const board: Cell[] = [];
  for (let row = 0; row < 19; row++)
    board.push({ row, col: 0, type: row & 1 ? 1 : 2 });
  const state = createGame({ board, current: 0 });
  state.danger = 8;
  const result = resolvePlacement(state, { row: 0, col: 1 });
  assert.equal(result.state.status, "lost");
  assert.equal(result.state.descent, 42);
  assert.equal(result.state.board.length, 20);
});

test("a fully occupied final logical row is terminal capacity rather than a perpetual retry", () => {
  for (const profile of ["standard", "compact"] as const)
    for (const difficulty of ["gentle", "standard"] as const) {
      const config = getConfig(difficulty, profile),
        board: Cell[] = [];
      for (let row = 0; row < config.rows; row++)
        for (let col = 0; col < config.columns - (row & 1); col++)
          board.push({ row, col, type: ((row + col) % 3) as 0 | 1 | 2 });
      const state = createGame({ config, board, current: 6, next: 1 });
      assert(isFloorFull(state));
      assert.equal(state.status, "lost");
      assert(validateState(state));
      assert.equal(validateState({ ...state, status: "ready" }), false);
      assert.equal(
        state.shots,
        0,
        "classifying existing capacity fabricates no shot",
      );
      assert.equal(state.score, 0);
    }
});

test("the last legal placement loses at capacity without consuming a second piece or RNG draw", () => {
  for (const profile of ["standard", "compact"] as const) {
    const config = getConfig("standard", profile),
      board: Cell[] = [],
      hole = Math.floor(config.columns / 2);
    for (let row = 0; row < config.rows; row++)
      for (let col = 0; col < config.columns - (row & 1); col++)
        if (row !== config.rows - 1 || col !== hole)
          board.push({ row, col, type: ((row + col) % 3) as 0 | 1 | 2 });
    const before = createGame({ config, board, current: 6, next: 1 });
    assert.equal(before.status, "ready");
    const result = resolveShot(before, 90);
    assert.equal(result.error, undefined);
    assert.equal(result.state.status, "lost");
    assert(isFloorFull(result.state));
    assert(validateState(result.state));
    assert.equal(result.state.shots, 1);
    assert.equal(result.state.danger, 1);
    assert.equal(result.award.total, 0);
    assert.equal(result.state.score, 0);
    assert.equal(result.state.current, before.current);
    assert.equal(result.state.next, before.next);
    assert.equal(result.state.rng, before.rng);
  }
});

test("matching reopens the floor before capacity loss, and ordinary clear wins over supported Anchor capacity", () => {
  const config = getConfig(),
    board: Cell[] = [],
    hole = 6;
  for (let row = 0; row < config.rows; row++)
    for (let col = 0; col < config.columns - (row & 1); col++)
      if (row !== config.rows - 1 || col !== hole)
        board.push({
          row,
          col,
          type:
            row === config.rows - 1 && [hole - 1, hole + 1].includes(col)
              ? 0
              : 1,
        });
  const before = createGame({ config, board, current: 0, next: 3 });
  const result = resolveShot(before, 90);
  assert.equal(result.matched.length, 3);
  assert.equal(result.state.status, "ready");
  assert.equal(isFloorFull(result.state), false);
  assert.equal(result.award.match, 10);
  assert(validateState(result.state));

  const anchors = board.map((cell) => ({ ...cell, type: ANCHOR }));
  anchors.push({ row: config.rows - 1, col: hole, type: ANCHOR });
  const cleared = createGame({ config, board: anchors });
  assert(isFloorFull(cleared));
  assert.equal(cleared.status, "cleared");
  assert(validateState(cleared));
});

test("single-hole closed frontiers remain playable instead of using an approximate no-angle loss heuristic", () => {
  for (const profile of ["standard", "compact"] as const) {
    const config = getConfig("standard", profile);
    for (let hole = 0; hole < config.columns; hole++) {
      const board: Cell[] = [];
      for (let row = 0; row < config.rows; row++)
        for (let col = 0; col < config.columns - (row & 1); col++)
          if (row !== config.rows - 1 || col !== hole)
            board.push({ row, col, type: ((row + col) % 3) as 0 | 1 | 2 });
      const state = createGame({ config, board, current: 6, next: 1 });
      assert.equal(state.status, "ready");
      assert.equal(isFloorFull(state), false);
      // An existence witness proves this state is playable. The search is never
      // used by production rules to declare loss when a coarse corpus misses.
      let witness: number | null = null;
      for (let tenth = 50; tenth <= 1750 && witness === null; tenth++)
        if (traceShot(state, tenth / 10).landing) witness = tenth / 10;
      assert.notEqual(witness, null, `${profile} hole ${hole}`);
      assert.equal(resolveShot(state, witness!).error, undefined);
    }
  }
});

test("preview stays promised after its last board representative is cleared", () => {
  const state = createGame({
    board: [
      { row: 0, col: 0, type: 0 },
      { row: 0, col: 1, type: 0 },
      { row: 0, col: 5, type: 2 },
    ],
    current: 0,
    next: 0,
  });
  const result = resolvePlacement(state, { row: 1, col: 0 });
  assert.equal(result.state.current, 0);
  assert.equal(result.state.next, 2);
});

test("guide and live resolution agree over direct, multi-bank and dense-board angles", () => {
  for (const profile of ["standard", "compact"] as const)
    for (let seed = 1; seed <= 8; seed++) {
      const state = createGame({
        seed,
        config: getConfig("standard", profile),
      });
      for (let angle = 5; angle <= 175; angle += 2.5) {
        const trace = traceShot(state, angle),
          resolution = resolveShot(state, angle);
        assert(trace.landing, `missing landing ${profile}/${seed}/${angle}`);
        assert.deepEqual(resolution.trace, trace);
        assert.equal(resolution.error, undefined);
        assert.equal(resolution.state.shots, 1);
        assert.equal(validateState(resolution.state), true);
        assert.deepEqual(pointOnTrace(trace, 0), state.config.launcher);
        assert.deepEqual(
          pointOnTrace(trace, trace.distance + 1),
          trace.points.at(-1),
        );
      }
    }
});

test("swept flight agrees with independent analytic direct and reflected wall intersections", () => {
  const straight = createGame({
    board: [{ row: 0, col: 6, type: 1 }],
    current: 0,
  });
  const direct = traceShot(straight, 90);
  assert(Math.abs(direct.distance - 832) < 1e-8);
  assert(Math.abs(direct.points[1].x - 312) < 1e-8);
  assert(Math.abs(direct.points[1].y - 68) < 1e-8);
  assert.deepEqual(
    direct.landing,
    { row: 1, col: 5 },
    "symmetric nearest-slot tie uses row then column",
  );

  const ceiling = createGame({
    board: [{ row: 0, col: 0, type: 1 }],
    current: 0,
  });
  const bank = traceShot(ceiling, 60),
    radians = Math.PI / 3;
  assert.equal(bank.points.length, 3);
  assert(Math.abs(bank.points[1].x - 602) < 1e-8);
  assert(Math.abs(bank.points[1].y - (900 - 290 * Math.tan(radians))) < 1e-8);
  assert(Math.abs(bank.distance - 878 / Math.sin(radians)) < 1e-8);
  assert(Math.abs(bank.points[2].y - 22) < 1e-8);
  const unfoldedX = 312 + 878 / Math.tan(radians);
  assert(Math.abs(bank.points[2].x - (2 * 602 - unfoldedX)) < 1e-8);
});

test("deterministic accepted shot replay survives checkpoints and different presentation sampling", () => {
  let first = createGame({ seed: 762341 }),
    second = cloneState(first);
  for (let shot = 0; shot < 80 && first.status === "ready"; shot++) {
    const angle = 12 + ((shot * 47) % 157);
    const trace = traceShot(first, angle);
    for (const frame of [0, 1, 4, 9, 16, 25, 80])
      pointOnTrace(trace, frame * 11);
    first = resolveShot(first, angle).state;
    second = resolveShot(JSON.parse(JSON.stringify(second)), angle).state;
    assert.deepEqual(first, second);
  }
});

test("wall-adjacent settling follows the reflected incoming path rather than an out-of-bounds extension", () => {
  let state = createGame({ seed: 47 }),
    rng = 47;
  for (let shot = 0; shot < 16; shot++) {
    const random = nextRandom(rng);
    rng = random.state;
    const result = resolveShot(state, 5 + random.value * 170);
    assert.equal(result.error, undefined, `regression shot ${shot}`);
    assert(validateState(result.state));
    state = result.state;
  }
});

test("invalid shot restores entire state without score, danger, queue or RNG consumption", () => {
  const original = createGame({ seed: 3 }),
    before = cloneState(original);
  for (const angle of [NaN, Infinity, -10, 4, 176]) {
    const result = resolveShot(original, angle);
    assert(result.error);
    assert.deepEqual(result.state, before);
  }
  const occupied = resolvePlacement(original, { row: 0, col: 0 });
  assert(occupied.error);
  assert.deepEqual(occupied.state, before);
});

test("undo restores queue and RNG with permanent assisted status", () => {
  const original = createGame({ seed: 6 }),
    result = resolveShot(original, 90);
  const restored = undoState(original, result.state);
  assert.deepEqual({ ...restored, assisted: false }, original);
  assert.equal(restored.assisted, true);
});

test("malformed, duplicate, unsupported and future save data are rejected", () => {
  const good = createGame({ seed: 8 });
  assert(validateState(good));
  const variants = [
    { ...good, version: 999 },
    { ...good, score: NaN },
    { ...good, rng: -1 },
    { ...good, descent: 5 },
    { ...good, current: 7 },
    { ...good, status: "flying" },
    { ...good, board: [...good.board, good.board[0]] },
    { ...good, board: [{ row: 18, col: 0, type: 0 }] },
  ];
  for (const value of variants) assert.equal(validateState(value), false);
});
