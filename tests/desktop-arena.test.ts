import test from "node:test";
import assert from "node:assert/strict";
import { desktopArena } from "../src/desktop-arena";
import { createGame, getConfig, validateState } from "../src/core";
import { advanceBoard, createProgress } from "../src/progression";
import { randomId } from "../src/platform";

test("wide desktop arenas preserve the collision pitch and approximate no-drop pressure budget", () => {
  const budget = (c: ReturnType<typeof getConfig>) =>
    Math.ceil((c.lossY - (24 + 42 * (c.startRows - 1) + 22)) / 42) *
    (c.dangerThreshold + 1);
  for (const difficulty of [
    "gentle",
    "relaxed",
    "standard",
    "tricky",
    "expert",
  ] as const) {
    const old = getConfig(difficulty),
      wide = desktopArena(difficulty);
    assert(Math.abs(budget(old) - budget(wide)) <= 5);
    assert(wide.width / wide.height > 0.79 && wide.width / wide.height < 0.88);
    assert(validateState(createGame({ config: wide, seed: 83 })));
    assert.equal(wide.target, old.target);
  }
  assert.deepEqual(
    [
      desktopArena("standard").columns,
      desktopArena("standard").rows,
      desktopArena("standard").startRows,
    ],
    [13, 14, 6],
  );
});
test("wide Journey continues wide while legacy Journey retains its original geometry", () => {
  for (const wide of [false, true]) {
    const p = createProgress("journey", "standard");
    if (wide) p.configId += "-desktop-v2";
    const config = wide ? desktopArena("standard") : getConfig();
    const game = createGame({ config, board: [], seed: 9 });
    const next = advanceBoard(game, p, 10);
    assert.equal(next.game.config.rows, wide ? 14 : 19);
    assert.equal(next.progress.configId, p.configId);
  }
});
test("LAN UUID fallback uses getRandomValues and produces distinct valid version-four IDs", () => {
  const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const values = Array.from({ length: 100 }, () => randomId(source));
  assert.equal(new Set(values).size, 100);
  for (const value of values)
    assert.match(
      value,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});
