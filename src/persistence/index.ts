import {
  categoryKey,
  insertScore,
  isCategory,
  validId,
  validTerminal,
  type ScoreCategory,
  type ScoreEntry,
  type TerminalInput,
  type TerminalReceipt,
} from "./scores";
export * from "./scores";

export interface ActiveRun<T> {
  runId: string;
  ownerId: string;
  generation: number;
  status: "active" | "terminal";
  checkpoint: T;
}
export interface PuzzleProgress {
  standard: number;
  compact: number;
}
export interface ScoreEnvelope<T> {
  version: 1;
  generation: number;
  sequence: number;
  active: ActiveRun<T> | null;
  lastResultRunId: string | null;
  tables: Record<string, ScoreEntry[]>;
  receipts: Record<string, TerminalReceipt>;
  /** Optional only for backwards compatibility with existing version-one saves. */
  puzzleProgress?: PuzzleProgress;
}
export type FailureReason =
  | "stale-owner"
  | "storage-unavailable"
  | "invalid-data"
  | "active-run-exists"
  | "no-active-run";
export interface StoreResult<T> {
  ok: boolean;
  durable: boolean;
  reason?: FailureReason;
  envelope: ScoreEnvelope<T>;
  receipt?: TerminalReceipt;
  repeated?: boolean;
}
export interface StoreOptions<T> {
  indexedDB?: IDBFactory | null;
  databaseName?: string;
  validateCheckpoint?: (value: unknown) => value is T;
  now?: () => number;
}

const emptyEnvelope = <T>(): ScoreEnvelope<T> => ({
  version: 1,
  generation: 0,
  sequence: 0,
  active: null,
  lastResultRunId: null,
  tables: {},
  receipts: {},
  puzzleProgress: { standard: 0, compact: 0 },
});
const copy = <T>(value: T): T => structuredClone(value);
const safeCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

function validPuzzleProgress(
  value: unknown,
  partial = false,
): value is Partial<PuzzleProgress> {
  if (
    !record(value) ||
    Object.keys(value).some((key) => key !== "standard" && key !== "compact")
  )
    return false;
  return (["standard", "compact"] as const).every(
    (profile) =>
      (partial && !own(value, profile)) ||
      (safeCount(value[profile]) && value[profile] <= 50),
  );
}
function mergePuzzleProgress<T>(
  envelope: ScoreEnvelope<T>,
  progress?: Partial<PuzzleProgress>,
): void {
  const previous = envelope.puzzleProgress ?? { standard: 0, compact: 0 };
  envelope.puzzleProgress = {
    standard: Math.max(previous.standard, progress?.standard ?? 0),
    compact: Math.max(previous.compact, progress?.compact ?? 0),
  };
}

/** Checkpoints must be finite, acyclic plain JSON data, never executable values. */
export function isPlainData(value: unknown, depth = 0): boolean {
  if (depth > 60) return false;
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= 100000 && value.every((v) => isPlainData(v, depth + 1))
    );
  return (
    record(value) &&
    Object.keys(value).length <= 10000 &&
    Object.values(value).every((v) => isPlainData(v, depth + 1))
  );
}

export function validateEnvelope<T>(
  value: unknown,
  validateCheckpoint: (v: unknown) => boolean = isPlainData,
): value is ScoreEnvelope<T> {
  if (
    !record(value) ||
    value.version !== 1 ||
    !safeCount(value.generation) ||
    !safeCount(value.sequence) ||
    !record(value.tables) ||
    !record(value.receipts) ||
    !(
      value.puzzleProgress === undefined ||
      validPuzzleProgress(value.puzzleProgress)
    ) ||
    !(value.lastResultRunId === null || validId(value.lastResultRunId))
  )
    return false;
  const envelope = value as unknown as ScoreEnvelope<T>;
  if (envelope.active !== null) {
    const a = envelope.active;
    if (
      !record(a) ||
      !validId(a.runId) ||
      !validId(a.ownerId) ||
      !safeCount(a.generation) ||
      a.generation !== envelope.generation ||
      !["active", "terminal"].includes(a.status) ||
      !isPlainData(a.checkpoint) ||
      !validateCheckpoint(a.checkpoint)
    )
      return false;
  }
  const globalIds = new Set<string>();
  const sequences = new Set<number>();
  for (const [key, entries] of Object.entries(envelope.tables)) {
    if (!Array.isArray(entries) || entries.length > 10) return false;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (
        !validTerminal(entry) ||
        entry.score <= 0 ||
        entry.category.mode === "tutorial" ||
        !safeCount(entry.sequence) ||
        entry.sequence === 0 ||
        entry.sequence > envelope.sequence ||
        !safeCount(entry.completedAt) ||
        categoryKey(entry.category) !== key ||
        globalIds.has(entry.runId) ||
        sequences.has(entry.sequence)
      )
        return false;
      globalIds.add(entry.runId);
      sequences.add(entry.sequence);
      const previous = entries[i - 1];
      if (
        previous &&
        (entry.score > previous.score ||
          (entry.score === previous.score &&
            entry.sequence <= previous.sequence))
      )
        return false;
    }
  }
  for (const [id, receipt] of Object.entries(envelope.receipts)) {
    if (
      !validTerminal(receipt) ||
      receipt.runId !== id ||
      !safeCount(receipt.sequence) ||
      receipt.sequence === 0 ||
      receipt.sequence > envelope.sequence ||
      !safeCount(receipt.completedAt) ||
      !record(receipt.decision)
    )
      return false;
    const d = receipt.decision;
    if (
      !["new-best", "tied-best", "rank", "unranked", "ineligible"].includes(
        d.kind,
      ) ||
      !(
        d.rank === null ||
        (safeCount(d.rank) && d.rank >= 1 && d.rank <= 10)
      ) ||
      !(
        d.previousBest === null ||
        (safeCount(d.previousBest) && d.previousBest > 0)
      )
    )
      return false;
    if ((d.kind === "ineligible" || d.kind === "unranked") && d.rank !== null)
      return false;
    if (
      d.kind === "new-best" &&
      (d.rank !== 1 || receipt.score <= (d.previousBest ?? 0))
    )
      return false;
    if (d.kind === "tied-best" && receipt.score !== d.previousBest)
      return false;
    if (d.kind === "rank" && d.rank === null) return false;
  }
  for (const entries of Object.values(envelope.tables))
    for (const entry of entries) {
      if (!own(envelope.receipts, entry.runId)) return false;
      const receipt = envelope.receipts[entry.runId];
      if (
        receipt.score !== entry.score ||
        receipt.sequence !== entry.sequence ||
        categoryKey(receipt.category) !== categoryKey(entry.category)
      )
        return false;
    }
  if (
    envelope.lastResultRunId &&
    !own(envelope.receipts, envelope.lastResultRunId)
  )
    return false;
  if (
    envelope.active?.status === "terminal" &&
    !own(envelope.receipts, envelope.active.runId)
  )
    return false;
  return true;
}

class MutationError extends Error {
  constructor(public reason: FailureReason) {
    super(reason);
  }
}
type Mutation<T> = (
  envelope: ScoreEnvelope<T>,
) => { receipt?: TerminalReceipt; repeated?: boolean } | void;

export class ScoreStore<T> {
  private memory = emptyEnvelope<T>();
  private lease: { runId: string; generation: number } | null = null;
  private db: Promise<IDBDatabase> | null = null;
  private factory: IDBFactory | null;
  private durable = true;
  private invalidStorage = false;
  private pending: Mutation<T>[] = [];
  private queue = Promise.resolve();
  readonly databaseName: string;
  constructor(
    readonly ownerId: string,
    private options: StoreOptions<T> = {},
  ) {
    if (!validId(ownerId)) throw new Error("Invalid tab owner ID");
    this.factory =
      options.indexedDB === undefined
        ? (globalThis.indexedDB ?? null)
        : options.indexedDB;
    this.databaseName = options.databaseName ?? "smashy-personal-v1";
  }
  state(): ScoreEnvelope<T> {
    return copy(this.memory);
  }
  records(category: ScoreCategory): ScoreEntry[] {
    return copy(this.memory.tables[categoryKey(category)] ?? []);
  }
  getBest(category: ScoreCategory): number | null {
    return this.records(category)[0]?.score ?? null;
  }
  getPuzzleProgress(): PuzzleProgress {
    return copy(this.memory.puzzleProgress ?? { standard: 0, compact: 0 });
  }
  private validCheckpoint(value: unknown): value is T {
    return (
      isPlainData(value) && (this.options.validateCheckpoint?.(value) ?? true)
    );
  }
  private open(): Promise<IDBDatabase> {
    if (!this.factory)
      return Promise.reject(new Error("IndexedDB unavailable"));
    if (this.db) return this.db;
    this.db = new Promise((resolve, reject) => {
      const request = this.factory!.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("state"))
          request.result.createObjectStore("state");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("Local records database is blocked"));
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.db = null;
        };
        resolve(database);
      };
    });
    this.db.catch(() => {
      this.db = null;
    });
    return this.db;
  }
  private async transaction(mutate?: Mutation<T>): Promise<{
    envelope: ScoreEnvelope<T>;
    receipt?: TerminalReceipt;
    repeated?: boolean;
  }> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = database.transaction("state", mutate ? "readwrite" : "readonly");
      } catch (error) {
        reject(error);
        return;
      }
      let next: ScoreEnvelope<T>;
      let extra: ReturnType<Mutation<T>>;
      let failure: unknown;
      const objectStore = tx.objectStore("state");
      const request = objectStore.get("envelope");
      request.onsuccess = () => {
        try {
          const raw: unknown = request.result;
          if (
            raw !== undefined &&
            !validateEnvelope<T>(raw, (v) => this.validCheckpoint(v))
          )
            throw new MutationError("invalid-data");
          next =
            raw === undefined
              ? emptyEnvelope<T>()
              : copy(raw as ScoreEnvelope<T>);
          // Normalize legacy version-one saves in memory; persist on the next write.
          mergePuzzleProgress(next);
          extra = mutate?.(next);
          if (mutate) {
            if (!validateEnvelope<T>(next, (v) => this.validCheckpoint(v)))
              throw new MutationError("invalid-data");
            objectStore.put(next, "envelope");
          }
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve({ envelope: next!, ...(extra ?? {}) });
      tx.onerror = () => {
        failure ??= tx.error;
      };
      tx.onabort = () =>
        reject(
          failure ?? tx.error ?? new Error("Local records transaction aborted"),
        );
    });
  }
  private result(
    ok: boolean,
    reason?: FailureReason,
    extra: { receipt?: TerminalReceipt; repeated?: boolean } = {},
  ): StoreResult<T> {
    return {
      ok,
      durable: this.durable && !this.invalidStorage,
      ...(reason ? { reason } : {}),
      envelope: this.state(),
      ...copy(extra),
    };
  }
  /** Serialize calls from this tab as IndexedDB serializes calls from other tabs. */
  private async serial<R>(work: () => Promise<R>): Promise<R> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
  async load(): Promise<StoreResult<T>> {
    return this.serial(async () => {
      // Refreshing records must preserve an unsaved playable result. Reconcile
      // failed writes through retryStorage before accepting older durable data.
      if (this.pending.length) return this.result(true, "storage-unavailable");
      try {
        this.memory = (await this.transaction()).envelope;
        this.durable = true;
        return this.result(true);
      } catch (error) {
        this.durable = false;
        if (error instanceof MutationError)
          this.invalidStorage = error.reason === "invalid-data";
        return this.result(
          false,
          this.invalidStorage ? "invalid-data" : "storage-unavailable",
        );
      }
    });
  }
  private async update(mutate: Mutation<T>): Promise<StoreResult<T>> {
    return this.serial(async () => {
      if (this.durable && !this.invalidStorage) {
        try {
          const result = await this.transaction(mutate);
          this.memory = result.envelope;
          return this.result(true, undefined, result);
        } catch (error) {
          if (error instanceof MutationError && error.reason !== "invalid-data")
            return this.result(false, error.reason);
          this.invalidStorage ||=
            error instanceof MutationError && error.reason === "invalid-data";
          this.durable = false;
        }
      }
      const candidate = this.state();
      try {
        const extra = mutate(candidate);
        if (!validateEnvelope<T>(candidate, (v) => this.validCheckpoint(v)))
          return this.result(false, "invalid-data");
        this.memory = candidate;
        if (!this.invalidStorage) this.pending.push(mutate);
        return this.result(
          true,
          this.invalidStorage ? "invalid-data" : "storage-unavailable",
          extra ?? {},
        );
      } catch (error) {
        return this.result(
          false,
          error instanceof MutationError ? error.reason : "invalid-data",
        );
      }
    });
  }
  private requireOwner(
    envelope: ScoreEnvelope<T>,
    runId: string,
  ): ActiveRun<T> {
    const active = envelope.active;
    if (
      !active ||
      active.runId !== runId ||
      active.ownerId !== this.ownerId ||
      this.lease?.runId !== runId ||
      this.lease.generation !== active.generation
    )
      throw new MutationError("stale-owner");
    return active;
  }
  async beginRun(
    runId: string,
    checkpoint: T,
    options: {
      takeover?: boolean;
      /** Synchronous policy checked against the latest checkpoint atomically. */
      replaceIf?: (checkpoint: T) => boolean;
    } = {},
  ): Promise<StoreResult<T>> {
    if (!validId(runId) || !this.validCheckpoint(checkpoint))
      return this.result(false, "invalid-data");
    const snapshot = copy(checkpoint);
    const result = await this.update((envelope) => {
      if (own(envelope.receipts, runId))
        throw new MutationError("invalid-data");
      if (
        envelope.active?.status === "active" &&
        !options.takeover &&
        !options.replaceIf?.(copy(envelope.active.checkpoint))
      )
        throw new MutationError("active-run-exists");
      if (envelope.generation >= Number.MAX_SAFE_INTEGER)
        throw new MutationError("invalid-data");
      envelope.generation++;
      envelope.active = {
        runId,
        ownerId: this.ownerId,
        generation: envelope.generation,
        status: "active",
        checkpoint: copy(snapshot),
      };
    });
    if (result.ok)
      this.lease = { runId, generation: result.envelope.generation };
    return result;
  }
  async resume(takeover = true): Promise<StoreResult<T>> {
    const result = await this.update((envelope) => {
      if (!envelope.active) throw new MutationError("no-active-run");
      if (envelope.active.ownerId !== this.ownerId && !takeover)
        throw new MutationError("stale-owner");
      if (envelope.generation >= Number.MAX_SAFE_INTEGER)
        throw new MutationError("invalid-data");
      envelope.generation++;
      envelope.active.ownerId = this.ownerId;
      envelope.active.generation = envelope.generation;
    });
    if (result.ok && result.envelope.active)
      this.lease = {
        runId: result.envelope.active.runId,
        generation: result.envelope.generation,
      };
    return result;
  }
  async checkpoint(
    runId: string,
    checkpoint: T,
    progress?: Partial<PuzzleProgress>,
  ): Promise<StoreResult<T>> {
    if (
      !this.validCheckpoint(checkpoint) ||
      (progress !== undefined && !validPuzzleProgress(progress, true))
    )
      return this.result(false, "invalid-data");
    const snapshot = copy(checkpoint);
    const completion = progress === undefined ? undefined : copy(progress);
    return this.update((envelope) => {
      const active = this.requireOwner(envelope, runId);
      if (active.status !== "active") throw new MutationError("stale-owner");
      active.checkpoint = copy(snapshot);
      mergePuzzleProgress(envelope, completion);
    });
  }
  async finalize(
    input: TerminalInput,
    checkpoint: T,
    progress?: Partial<PuzzleProgress>,
  ): Promise<StoreResult<T>> {
    if (
      !validTerminal(input) ||
      !this.validCheckpoint(checkpoint) ||
      (progress !== undefined && !validPuzzleProgress(progress, true))
    )
      return this.result(false, "invalid-data");
    const finalInput = copy(input),
      snapshot = copy(checkpoint);
    const completion = progress === undefined ? undefined : copy(progress);
    const completedAt = this.options.now?.() ?? Date.now();
    return this.update((envelope) => {
      const active = this.requireOwner(envelope, finalInput.runId);
      if (own(envelope.receipts, finalInput.runId)) {
        return {
          receipt: copy(envelope.receipts[finalInput.runId]),
          repeated: true,
        };
      }
      if (active.status !== "active" || !safeCount(completedAt))
        throw new MutationError("invalid-data");
      if (envelope.sequence >= Number.MAX_SAFE_INTEGER)
        throw new MutationError("invalid-data");
      const key = categoryKey(finalInput.category);
      const next = insertScore(
        envelope.tables[key] ?? [],
        finalInput,
        ++envelope.sequence,
        completedAt,
      );
      if (next.entries.length) envelope.tables[key] = next.entries;
      envelope.receipts[finalInput.runId] = next.receipt;
      envelope.lastResultRunId = finalInput.runId;
      active.status = "terminal";
      active.checkpoint = copy(snapshot);
      mergePuzzleProgress(envelope, completion);
      this.pruneReceipts(envelope);
      return { receipt: copy(next.receipt), repeated: false };
    });
  }
  private pruneReceipts(envelope: ScoreEnvelope<T>): void {
    const keep = new Set(
      Object.values(envelope.receipts)
        .sort((a, b) => b.sequence - a.sequence)
        .slice(0, 256)
        .map((r) => r.runId),
    );
    for (const entries of Object.values(envelope.tables))
      for (const entry of entries) keep.add(entry.runId);
    if (envelope.lastResultRunId) keep.add(envelope.lastResultRunId);
    if (envelope.active) keep.add(envelope.active.runId);
    for (const id of Object.keys(envelope.receipts))
      if (!keep.has(id)) delete envelope.receipts[id];
  }
  /** Caller must obtain explicit confirmation. Active checkpoint and settings survive. */
  async resetScores(): Promise<StoreResult<T>> {
    return this.update((envelope) => {
      envelope.tables = {};
      this.pruneReceipts(envelope);
    });
  }
  /** Reapply failed session mutations against latest durable data, checking ownership and receipts. */
  async retryStorage(): Promise<StoreResult<T>> {
    return this.serial(async () => {
      if (this.invalidStorage) return this.result(false, "invalid-data");
      const pending = [...this.pending];
      try {
        const result = await this.transaction((envelope) => {
          for (const mutate of pending) mutate(envelope);
        });
        this.memory = result.envelope;
        this.pending = [];
        this.durable = true;
        if (this.memory.active?.ownerId === this.ownerId)
          this.lease = {
            runId: this.memory.active.runId,
            generation: this.memory.generation,
          };
        return this.result(true);
      } catch (error) {
        return this.result(
          false,
          error instanceof MutationError ? error.reason : "storage-unavailable",
        );
      }
    });
  }
  async close(): Promise<void> {
    try {
      (await this.db)?.close();
    } catch {
      /* unavailable */
    }
    this.db = null;
  }
}
export function createScoreStore<T>(
  ownerId: string,
  options: StoreOptions<T> = {},
): ScoreStore<T> {
  return new ScoreStore(ownerId, options);
}
