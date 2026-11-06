import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import {
  createScoreStore,
  categoryKey,
  decideScore,
  validateEnvelope,
  type ScoreCategory,
  type TerminalInput,
} from "../src/persistence/index";

const category: ScoreCategory = {
  mode: "classic",
  difficulty: "standard",
  layout: "standard",
  rulesVersion: "1",
  layoutVersion: "1",
  assisted: false,
  configId: "classic-standard",
};
const checkpoint = (score = 0) => ({
  board: [[0, 1, 2]],
  score,
  assisted: false,
});
const terminal = (
  runId: string,
  score: number,
  c = category,
): TerminalInput => ({
  runId,
  score,
  category: c,
  assisted: c.assisted,
  outcome: "loss",
});
function store(factory = new IDBFactory(), owner = "tab-a") {
  return createScoreStore<ReturnType<typeof checkpoint>>(owner, {
    indexedDB: factory,
    databaseName: "test-smashy",
    now: () => 1234,
    validateCheckpoint: (v: unknown): v is ReturnType<typeof checkpoint> =>
      !!v &&
      typeof v === "object" &&
      Number.isSafeInteger((v as ReturnType<typeof checkpoint>).score),
  });
}

test("positive terminal scores rank once, ties follow existing, tenth ties do not qualify", async () => {
  const s = store();
  assert.equal((await s.load()).ok, true);
  const scores = [
    1000, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 200, 1000,
  ];
  const decisions = [];
  for (let i = 0; i < scores.length; i++) {
    assert.equal((await s.beginRun(`run-${i}`, checkpoint())).ok, true);
    const result = await s.finalize(
      terminal(`run-${i}`, scores[i]),
      checkpoint(scores[i]),
    );
    assert.equal(result.ok, true);
    decisions.push(result.receipt!.decision);
  }
  assert.deepEqual(decisions[0], {
    kind: "new-best",
    rank: 1,
    previousBest: null,
  });
  assert.deepEqual(decisions[1], {
    kind: "tied-best",
    rank: 2,
    previousBest: 1000,
  });
  assert.deepEqual(decisions[10], {
    kind: "unranked",
    rank: null,
    previousBest: 1000,
  });
  assert.deepEqual(decisions[11], {
    kind: "tied-best",
    rank: 3,
    previousBest: 1000,
  });
  assert.equal(s.records(category).length, 10);
  assert.deepEqual(
    s
      .records(category)
      .slice(0, 3)
      .map((x) => x.runId),
    ["run-0", "run-1", "run-11"],
  );
  const repeated = await s.finalize(
    terminal("run-11", 99999),
    checkpoint(99999),
  );
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.receipt?.score, 1000);
  assert.equal(s.records(category).length, 10);
  assert.equal(s.state().active?.checkpoint.score, 1000);
  await s.close();
});

test("zero and tutorial scores never enter ordinary tables; category keys distinguish assistance and profile", async () => {
  const s = store();
  await s.load();
  await s.beginRun("zero", checkpoint());
  const zero = await s.finalize(terminal("zero", 0), checkpoint());
  assert.equal(zero.receipt?.decision.kind, "ineligible");
  const tutorial = { ...category, mode: "tutorial" as const };
  await s.beginRun("teaching", checkpoint());
  assert.equal(
    (await s.finalize(terminal("teaching", 200, tutorial), checkpoint(200)))
      .receipt?.decision.kind,
    "ineligible",
  );
  assert.deepEqual(s.records(category), []);
  assert.notEqual(
    categoryKey(category),
    categoryKey({ ...category, assisted: true }),
  );
  assert.notEqual(
    categoryKey(category),
    categoryKey({ ...category, layout: "compact" }),
  );
  await s.close();
});

test("reload uses terminal receipt independently of table membership and never reinserts", async () => {
  const factory = new IDBFactory();
  const a = store(factory);
  await a.load();
  await a.beginRun("low", checkpoint());
  const original = await a.finalize(terminal("low", 10), checkpoint(10));
  await a.close();
  const b = store(factory, "tab-b");
  await b.load();
  assert.equal(b.state().active?.status, "terminal");
  assert.deepEqual(b.state().receipts.low.decision, original.receipt?.decision);
  assert.equal(
    (await b.finalize(terminal("low", 10), checkpoint(10))).reason,
    "stale-owner",
  );
  await b.resume();
  const repeated = await b.finalize(terminal("low", 10), checkpoint(10));
  assert.equal(repeated.repeated, true);
  assert.equal(b.records(category).length, 1);
  await b.close();
});

test("conditional replacement checks the latest checkpoint atomically, not a stale tab cache", async () => {
  const factory = new IDBFactory();
  const a = store(factory, "a"),
    b = store(factory, "b");
  await a.load();
  await a.beginRun("original", checkpoint());
  await b.load(); // Tab B still sees a zero-score attempt.
  await a.checkpoint("original", checkpoint(20));
  const replaceIf = (saved: ReturnType<typeof checkpoint>) => saved.score === 0;
  const rejected = await b.beginRun("replacement", checkpoint(), { replaceIf });
  assert.equal(rejected.reason, "active-run-exists");
  await a.load(); // Inspect durable state, not B's deliberately stale cache.
  assert.equal(a.state().active?.runId, "original");
  assert.equal(a.state().active?.checkpoint.score, 20);
  await a.checkpoint("original", checkpoint());
  const accepted = await b.beginRun("replacement", checkpoint(), { replaceIf });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.envelope.active?.runId, "replacement");
  assert.equal(
    (await a.checkpoint("original", checkpoint(99))).reason,
    "stale-owner",
  );
  await a.close();
  await b.close();
});

test("explicit takeover rejects stale tab checkpoint and finalization, including same tab stale generation", async () => {
  const factory = new IDBFactory();
  const a = store(factory, "a"),
    b = store(factory, "b");
  await a.load();
  await a.beginRun("run", checkpoint());
  await a.checkpoint("run", checkpoint(20));
  await b.load();
  assert.equal(
    (await b.beginRun("accidental-new-run", checkpoint())).reason,
    "active-run-exists",
  );
  assert.equal((await b.resume(false)).reason, "stale-owner");
  assert.equal((await b.resume(true)).ok, true);
  assert.equal(
    (await a.checkpoint("run", checkpoint(999))).reason,
    "stale-owner",
  );
  assert.equal(
    (await a.finalize(terminal("run", 999), checkpoint(999))).reason,
    "stale-owner",
  );
  assert.equal(
    (await b.finalize(terminal("run", 20), checkpoint(20))).ok,
    true,
  );
  await a.load();
  assert.equal(a.records(category)[0].score, 20);
  await a.close();
  await b.close();
});

test("storage absence keeps in-memory game and result honest, without duplicate awards", async () => {
  const s = createScoreStore("tab", { indexedDB: null });
  assert.equal((await s.load()).reason, "storage-unavailable");
  const begin = await s.beginRun("memory-run", checkpoint());
  assert.equal(begin.ok, true);
  assert.equal(begin.durable, false);
  const first = await s.finalize(terminal("memory-run", 333), checkpoint(333));
  assert.equal(first.ok, true);
  assert.equal(first.durable, false);
  assert.equal(first.reason, "storage-unavailable");
  assert.equal(
    (await s.finalize(terminal("memory-run", 333), checkpoint(333))).repeated,
    true,
  );
  assert.equal(s.records(category).length, 1);
});

test("unknown/future or malformed storage cannot replace live state or overwrite durable envelope", async () => {
  const factory = new IDBFactory();
  const request = factory.open("test-smashy", 1);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = reject;
  });
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("state", "readwrite");
    tx.objectStore("state").put(
      { version: 999, secret: "preserved future state" },
      "envelope",
    );
    tx.oncomplete = () => resolve();
    tx.onerror = reject;
  });
  const s = store(factory);
  assert.equal((await s.load()).reason, "invalid-data");
  const run = await s.beginRun("fresh-memory", checkpoint());
  assert.equal(run.ok, true);
  assert.equal(run.durable, false);
  await s.finalize(terminal("fresh-memory", 10), checkpoint(10));
  const raw = await new Promise<unknown>((resolve, reject) => {
    const tx = database.transaction("state", "readonly");
    const get = tx.objectStore("state").get("envelope");
    get.onsuccess = () => resolve(get.result);
    get.onerror = reject;
  });
  assert.deepEqual(raw, { version: 999, secret: "preserved future state" });
  database.close();
  await s.close();
});

test("receipt retention protects current, best entries, and latest 256 finalized runs", async () => {
  const s = store();
  await s.load();
  for (let i = 0; i < 280; i++) {
    await s.beginRun(`run-${i}`, checkpoint());
    await s.finalize(terminal(`run-${i}`, i === 0 ? 10000 : i), checkpoint(i));
  }
  const state = s.state();
  assert.ok(state.receipts["run-0"]);
  assert.ok(state.receipts["run-279"]);
  assert.equal(state.receipts["run-1"], undefined);
  assert.equal(Object.keys(state.receipts).length, 257);
  assert.equal(validateEnvelope(state), true);
  assert.equal(
    (await s.finalize(terminal("run-1", 1), checkpoint())).reason,
    "stale-owner",
  );
  await s.close();
});

test("validation rejects corrupt order, duplicate IDs, nonfinite scores and non-plain checkpoints", async () => {
  const s = store();
  await s.load();
  await s.beginRun("valid", checkpoint());
  await s.finalize(terminal("valid", 100), checkpoint(100));
  const envelope = s.state();
  const key = categoryKey(category);
  const duplicate = structuredClone(envelope);
  duplicate.tables[key].push(duplicate.tables[key][0]);
  assert.equal(validateEnvelope(duplicate), false);
  const badScore = structuredClone(envelope);
  badScore.tables[key][0].score = Infinity;
  assert.equal(validateEnvelope(badScore), false);
  const future = { ...envelope, version: 2 };
  assert.equal(validateEnvelope(future), false);
  assert.equal(
    (await s.beginRun("bad", { ...checkpoint(), score: NaN })).reason,
    "invalid-data",
  );
  assert.throws(() => categoryKey({ ...category, mode: "bogus" } as never));
  assert.throws(() =>
    decideScore([], terminal("unsafe", Number.MAX_SAFE_INTEGER + 1)),
  );
  assert.equal(
    (await s.beginRun("__proto__", checkpoint())).reason,
    "invalid-data",
  );
  await s.close();
});

test("score reset retains checkpoint and original result receipt", async () => {
  const s = store();
  await s.load();
  await s.beginRun("done", checkpoint());
  await s.finalize(terminal("done", 100), checkpoint(100));
  assert.equal((await s.resetScores()).ok, true);
  assert.deepEqual(s.records(category), []);
  assert.equal(s.state().active?.checkpoint.score, 100);
  const repeated = await s.finalize(terminal("done", 100), checkpoint(100));
  assert.equal(repeated.repeated, true);
  assert.deepEqual(s.records(category), []);
  await s.close();
});

test("aborted terminal write preserves previous durable checkpoint and retries score once", async () => {
  const factory = new IDBFactory();
  const s = store(factory);
  await s.load();
  await s.beginRun("atomic", checkpoint(10));
  await s.checkpoint("atomic", checkpoint(10), { standard: 3, compact: 2 });
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    const request = originalPut.apply(this, args);
    this.transaction.abort();
    return request;
  };
  try {
    const failed = await s.finalize(terminal("atomic", 500), checkpoint(500), {
      standard: 4,
    });
    assert.equal(failed.ok, true);
    assert.equal(failed.durable, false);
    assert.equal(failed.reason, "storage-unavailable");
    assert.equal(failed.receipt?.decision.kind, "new-best");
    assert.deepEqual(failed.envelope.puzzleProgress, {
      standard: 4,
      compact: 2,
    });
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  const observer = store(factory, "observer");
  await observer.load();
  assert.equal(observer.state().active?.checkpoint.score, 10);
  assert.equal(observer.state().active?.status, "active");
  assert.deepEqual(observer.records(category), []);
  assert.equal(observer.state().receipts.atomic, undefined);
  assert.deepEqual(observer.getPuzzleProgress(), { standard: 3, compact: 2 });
  const refreshed = await s.load();
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.durable, false);
  assert.equal(s.state().active?.checkpoint.score, 500);
  assert.equal(s.records(category).length, 1);
  assert.deepEqual(s.getPuzzleProgress(), { standard: 4, compact: 2 });
  assert.equal((await s.retryStorage()).ok, true);
  await observer.load();
  assert.equal(observer.state().active?.checkpoint.score, 500);
  assert.equal(observer.records(category).length, 1);
  assert.equal(observer.state().receipts.atomic.score, 500);
  assert.deepEqual(observer.getPuzzleProgress(), { standard: 4, compact: 2 });
  assert.equal(
    (await s.finalize(terminal("atomic", 500), checkpoint(500))).repeated,
    true,
  );
  await s.close();
  await observer.close();
});

test("puzzle completion counts merge monotonically inside stable checkpoint writes", async () => {
  const s = store();
  await s.load();
  await s.beginRun("puzzle-run", checkpoint());
  assert.deepEqual(s.getPuzzleProgress(), { standard: 0, compact: 0 });
  await s.checkpoint("puzzle-run", checkpoint(170), { standard: 1 });
  await s.checkpoint("puzzle-run", checkpoint(340), { compact: 5 });
  await s.checkpoint("puzzle-run", checkpoint(510), {
    standard: 0,
    compact: 3,
  });
  assert.deepEqual(s.getPuzzleProgress(), { standard: 1, compact: 5 });
  await s.finalize(terminal("puzzle-run", 510), checkpoint(510), {
    standard: 50,
  });
  assert.deepEqual(s.getPuzzleProgress(), { standard: 50, compact: 5 });
  const duplicate = await s.finalize(
    terminal("puzzle-run", 999),
    checkpoint(999),
    { compact: 50 },
  );
  assert.equal(duplicate.repeated, true);
  assert.deepEqual(s.getPuzzleProgress(), { standard: 50, compact: 5 });
  await s.resetScores();
  assert.deepEqual(s.getPuzzleProgress(), { standard: 50, compact: 5 });
  await s.close();
});

test("failed checkpoint cannot durably unlock a puzzle without its matching stable boundary", async () => {
  const factory = new IDBFactory(),
    s = store(factory);
  await s.load();
  await s.beginRun("puzzle-atomic", checkpoint());
  await s.checkpoint("puzzle-atomic", checkpoint(170), { compact: 1 });
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (
    ...args: Parameters<IDBObjectStore["put"]>
  ) {
    const request = originalPut.apply(this, args);
    this.transaction.abort();
    return request;
  };
  try {
    const failed = await s.checkpoint("puzzle-atomic", checkpoint(340), {
      compact: 2,
    });
    assert.equal(failed.ok, true);
    assert.equal(failed.durable, false);
    assert.equal(s.getPuzzleProgress().compact, 2);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  const observer = store(factory, "observer");
  await observer.load();
  assert.equal(observer.state().active?.checkpoint.score, 170);
  assert.deepEqual(observer.getPuzzleProgress(), { standard: 0, compact: 1 });
  assert.equal((await s.retryStorage()).ok, true);
  assert.equal((await s.retryStorage()).ok, true);
  await observer.load();
  assert.equal(observer.state().active?.checkpoint.score, 340);
  assert.deepEqual(observer.getPuzzleProgress(), { standard: 0, compact: 2 });
  await s.close();
  await observer.close();
});

test("stale owners cannot unlock puzzles through checkpoint or terminal callbacks", async () => {
  const factory = new IDBFactory(),
    a = store(factory, "a"),
    b = store(factory, "b");
  await a.load();
  await a.beginRun("puzzle-owner", checkpoint());
  await a.checkpoint("puzzle-owner", checkpoint(170), { standard: 1 });
  await b.load();
  await b.resume();
  assert.equal(
    (await a.checkpoint("puzzle-owner", checkpoint(340), { standard: 2 }))
      .reason,
    "stale-owner",
  );
  assert.equal(
    (
      await a.finalize(terminal("puzzle-owner", 500), checkpoint(500), {
        compact: 50,
      })
    ).reason,
    "stale-owner",
  );
  await b.load();
  assert.deepEqual(b.getPuzzleProgress(), { standard: 1, compact: 0 });
  assert.equal(b.state().active?.checkpoint.score, 170);
  assert.equal(b.state().active?.status, "active");
  await a.close();
  await b.close();
});

test("legacy version-one envelopes load without puzzle progress and migrate on the next transaction", async () => {
  const factory = new IDBFactory(),
    a = store(factory);
  await a.load();
  await a.beginRun("legacy", checkpoint(17));
  const legacy = a.state();
  delete legacy.puzzleProgress;
  assert.equal(validateEnvelope(legacy), true);
  await a.close();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open("test-smashy", 1);
    r.onsuccess = () => resolve(r.result);
    r.onerror = reject;
  });
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction("state", "readwrite");
    tx.objectStore("state").put(legacy, "envelope");
    tx.oncomplete = () => resolve();
    tx.onabort = reject;
  });
  const b = store(factory, "b");
  assert.equal((await b.load()).ok, true);
  assert.equal(b.state().active?.checkpoint.score, 17);
  assert.deepEqual(b.state().puzzleProgress, { standard: 0, compact: 0 });
  await b.resume();
  await b.checkpoint("legacy", checkpoint(34), { standard: 7 });
  const durable = await new Promise<any>((resolve, reject) => {
    const tx = database.transaction("state", "readonly"),
      r = tx.objectStore("state").get("envelope");
    r.onsuccess = () => resolve(r.result);
    r.onerror = reject;
  });
  assert.equal(durable.version, 1);
  assert.deepEqual(durable.puzzleProgress, { standard: 7, compact: 0 });
  assert.equal(durable.active.checkpoint.score, 34);
  database.close();
  await b.close();
});

test("invalid puzzle counters are rejected before writes and malformed loaded fields fail validation", async () => {
  const s = store();
  await s.load();
  await s.beginRun("safe-progress", checkpoint());
  const previous = s.state();
  for (const invalid of [
    { standard: -1 },
    { compact: 51 },
    { standard: 1.5 },
    { compact: NaN },
    { standard: undefined },
    { phone: 3 },
    null,
    [],
  ]) {
    assert.equal(
      (await s.checkpoint("safe-progress", checkpoint(100), invalid as never))
        .reason,
      "invalid-data",
    );
    assert.equal(
      (
        await s.finalize(
          terminal("safe-progress", 100),
          checkpoint(100),
          invalid as never,
        )
      ).reason,
      "invalid-data",
    );
    assert.deepEqual(s.state(), previous);
  }
  for (const invalid of [
    {},
    { standard: 1 },
    { standard: 0, compact: 51 },
    { standard: -1, compact: 0 },
    { standard: 0, compact: 0, extra: 1 },
    null,
    [],
  ]) {
    assert.equal(
      validateEnvelope({ ...previous, puzzleProgress: invalid }),
      false,
    );
  }
  await s.close();
});

test("retry after failed write rejects a newer tab owner without corrupting its checkpoint", async () => {
  const factory = new IDBFactory();
  const a = store(factory, "a"),
    b = store(factory, "b");
  await a.load();
  await a.beginRun("race", checkpoint());
  await b.load();
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () {
    throw new DOMException("quota", "QuotaExceededError");
  };
  try {
    assert.equal((await a.checkpoint("race", checkpoint(50))).durable, false);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  await b.resume();
  await b.checkpoint("race", checkpoint(20));
  assert.equal((await a.retryStorage()).reason, "stale-owner");
  await b.load();
  assert.equal(b.state().active?.checkpoint.score, 20);
  await a.close();
  await b.close();
});

test("parallel callbacks from one tab serialize into one receipt and one insertion", async () => {
  const s = store();
  await s.load();
  await s.beginRun("parallel", checkpoint());
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      s.finalize(terminal("parallel", 100), checkpoint(100)),
    ),
  );
  assert.equal(results.filter((r) => r.repeated === false).length, 1);
  assert.equal(results.filter((r) => r.repeated === true).length, 7);
  assert.equal(s.records(category).length, 1);
  assert.equal(s.state().sequence, 1);
  await s.close();
});
