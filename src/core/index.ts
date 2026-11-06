/** Smashy's deterministic rules. No browser, renderer, or wall clock is used here. */
export const RULES_VERSION = 1;
export const ANCHOR = 7 as const;
export const TYPE_NAMES = [
  "Chip",
  "Gum",
  "Rivet",
  "Wisp",
  "Bash",
  "Loop",
  "Peb",
  "Anchor",
] as const;
export type PieceType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type OrdinaryType = Exclude<PieceType, 7>;
export type Profile = "standard" | "compact";
export type Difficulty =
  | "gentle"
  | "relaxed"
  | "standard"
  | "tricky"
  | "expert"
  | "custom";
export interface Point {
  x: number;
  y: number;
}
export interface Slot {
  row: number;
  col: number;
}
export interface Cell extends Slot {
  type: PieceType;
}
export interface Config {
  profile: Profile;
  difficulty: Difficulty;
  columns: number;
  rows: number;
  startRows: number;
  anchors: number;
  dangerThreshold: number;
  target: number;
  types: number;
  width: number;
  height: number;
  lossY: number;
  launcher: Point;
}
export interface GameState {
  version: number;
  config: Config;
  seed: number;
  rng: number;
  board: Cell[];
  descent: number;
  current: OrdinaryType;
  next: OrdinaryType;
  shots: number;
  score: number;
  danger: number;
  status: "ready" | "cleared" | "lost";
  assisted: boolean;
}
export interface Trace {
  points: Point[];
  landing: Slot | null;
  distance: number;
  reason?: string;
}
export interface Award {
  match: number;
  drop: number;
  clear: number;
  efficiency: number;
  total: number;
}
export interface Resolution {
  state: GameState;
  trace: Trace;
  matched: Cell[];
  dropped: Cell[];
  award: Award;
  descended: boolean;
  error?: string;
}
export const GEOMETRY = {
  pitch: 48,
  rowPitch: 42,
  radius: 22,
  speed: 1100,
  step: 1 / 120,
} as const;
const EPS = 1e-7;
const distanceSq = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const slotKey = (cell: Slot) => `${cell.row},${cell.col}`;

export function getConfig(
  difficulty: Difficulty = "standard",
  profile: Profile = "standard",
): Config {
  const standard = {
    gentle: [9, 14, 4, 0, 16, 75, 4],
    relaxed: [11, 14, 5, 0, 12, 100, 5],
    standard: [13, 19, 8, 0, 8, 150, 7],
    tricky: [13, 19, 8, 6, 7, 200, 7],
    expert: [13, 19, 9, 9, 6, 300, 7],
  };
  const compact = {
    ...standard,
    standard: [11, 15, 6, 0, 8, 120, 7],
    tricky: [11, 15, 7, 4, 7, 160, 7],
    expert: [11, 15, 8, 6, 6, 240, 7],
  };
  const [columns, rows, startRows, anchors, dangerThreshold, target, types] = (
    profile === "compact" ? compact : standard
  )[difficulty === "custom" ? "standard" : difficulty];
  return makeConfig({
    profile,
    difficulty,
    columns,
    rows,
    startRows,
    anchors,
    dangerThreshold,
    target,
    types,
  });
}

/** Validate user/content input before deriving physical dimensions. */
export function makeConfig(
  input: Omit<Config, "width" | "height" | "lossY" | "launcher">,
): Config {
  const {
    columns,
    rows,
    startRows,
    anchors,
    dangerThreshold,
    target,
    types,
    profile,
    difficulty,
  } = input;
  for (const value of [
    columns,
    rows,
    startRows,
    anchors,
    dangerThreshold,
    target,
    types,
  ])
    if (!Number.isSafeInteger(value))
      throw new Error("Configuration values must be integers.");
  if (
    columns < 5 ||
    columns > 19 ||
    rows < 8 ||
    rows > 24 ||
    startRows < 1 ||
    startRows >= rows - 2 ||
    anchors < 0 ||
    anchors > Math.floor((startRows * (columns - 1)) / 3) ||
    dangerThreshold < 1 ||
    dangerThreshold > 40 ||
    target < 1 ||
    target > 1000 ||
    types < 2 ||
    types > 7 ||
    !["standard", "compact"].includes(profile) ||
    !["gentle", "relaxed", "standard", "tricky", "expert", "custom"].includes(
      difficulty,
    )
  )
    throw new Error("Configuration is outside supported limits.");
  const width = columns * 48,
    lossY = rows * 42 + 14;
  return {
    ...input,
    width,
    lossY,
    height: lossY + (profile === "compact" ? 132 : 148),
    launcher: { x: width / 2, y: lossY + (profile === "compact" ? 76 : 88) },
  };
}

export function inBounds(config: Config, slot: Slot): boolean {
  return (
    Number.isInteger(slot.row) &&
    Number.isInteger(slot.col) &&
    slot.row >= 0 &&
    slot.row < config.rows &&
    slot.col >= 0 &&
    slot.col < config.columns - (slot.row & 1)
  );
}
export function cellCenter(config: Config, slot: Slot, descent = 0): Point {
  return {
    x: 24 + slot.col * 48 + (slot.row & 1) * 24,
    y: 24 + slot.row * 42 + descent,
  };
}
export function neighbors(config: Config, slot: Slot): Slot[] {
  const { row, col } = slot,
    left = col - (row & 1 ? 0 : 1),
    right = left + 1;
  return [
    { row, col: col - 1 },
    { row, col: col + 1 },
    { row: row - 1, col: left },
    { row: row - 1, col: right },
    { row: row + 1, col: left },
    { row: row + 1, col: right },
  ].filter((cell) => inBounds(config, cell));
}

/** xorshift32 v1, state explicit. Cosmetic code must not call this RNG. */
export function nextRandom(state: number): { state: number; value: number } {
  let x = state >>> 0 || 0x6d2b79f5;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return { state: x >>> 0, value: (x >>> 0) / 0x100000000 };
}
export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}
export function ordinaryTypes(board: Cell[]): OrdinaryType[] {
  return [
    ...new Set(
      board
        .filter((cell) => cell.type !== ANCHOR)
        .map((cell) => cell.type as OrdinaryType),
    ),
  ].sort((a, b) => a - b);
}
/** Exact terminal capacity rule: the final logical row has no empty slot.
 * This is independent of the physical loss line, which intentionally leaves a
 * ten-unit visual gap. Never infer global loss from a single failed aim trace.
 */
export function isFloorFull(
  state: Pick<GameState, "config" | "board">,
): boolean {
  const row = state.config.rows - 1;
  const occupied = new Set(
    state.board.filter((cell) => cell.row === row).map((cell) => cell.col),
  );
  for (let col = 0; col < state.config.columns - (row & 1); col++)
    if (!occupied.has(col)) return false;
  return true;
}
function choose(state: GameState): OrdinaryType {
  const types = ordinaryTypes(state.board);
  if (!types.length) return 0;
  const random = nextRandom(state.rng);
  state.rng = random.state;
  return types[Math.floor(random.value * types.length)];
}
export interface NewGameOptions {
  seed?: number;
  config?: Config;
  board?: Cell[];
  current?: OrdinaryType;
  next?: OrdinaryType;
  assisted?: boolean;
}

export interface AnchorEscapeRoute {
  cell: Slot;
  points: Point[];
}
export interface AnchorEscapeReport {
  routes: AnchorEscapeRoute[];
  blocked: Cell[];
}

/** A one-sided geometric certificate, not a puzzle solver.
 * Ordinary pieces are treated as removable; only permanent Anchor disks block
 * these paths. Every accepted edge is checked against the actual combined
 * projectile/Anchor radius. A missing graph path rejects a candidate, never
 * proves it impossible. Returned paths let tests independently verify safety.
 */
export function anchorEscapeRoutes(
  config: Config,
  board: Cell[],
): AnchorEscapeReport {
  const ordinary = board.filter((cell) => cell.type !== ANCHOR);
  const anchors = board
    .filter((cell) => cell.type === ANCHOR)
    .map((cell) => cellCenter(config, cell));
  if (!anchors.length)
    return {
      routes: ordinary.map((cell) => ({
        cell: { row: cell.row, col: cell.col },
        points: [cellCenter(config, cell), { ...config.launcher }],
      })),
      blocked: [],
    };
  const lastOccupied = Math.max(0, ...board.map((cell) => cell.row));
  const lastGraphRow = Math.min(config.rows - 1, lastOccupied + 2);
  const escapeY = cellCenter(config, { row: lastGraphRow, col: 0 }).y;
  const anchorSlots = new Set(
    board.filter((cell) => cell.type === ANCHOR).map(slotKey),
  );
  const nodes = new Map<string, Slot>();
  for (let row = 0; row <= lastGraphRow; row++)
    for (let col = 0; col < config.columns - (row & 1); col++) {
      const slot = { row, col };
      if (!anchorSlots.has(slotKey(slot))) nodes.set(slotKey(slot), slot);
    }
  const clearSegment = (a: Point, b: Point) =>
    [a, b].every(
      (p) =>
        p.x >= 22 - EPS &&
        p.x <= config.width - 22 + EPS &&
        p.y >= 22 - EPS &&
        p.y <= config.launcher.y + EPS,
    ) &&
    anchors.every((anchor) => segmentDistanceSq(a, b, anchor) >= 44 ** 2 - EPS);
  const clearRoute = (points: Point[]) =>
    points.slice(1).every((point, i) => clearSegment(points[i], point));
  const parent = new Map<string, string | null>();
  const exits = new Map<string, Point[]>();
  const queue: string[] = [];
  for (const [key, slot] of nodes) {
    const p = cellCenter(config, slot);
    const sides = [22, config.width - 22].sort(
      (a, b) => Math.abs(a - p.x) - Math.abs(b - p.x),
    );
    for (const side of sides) {
      // The shallow outward escape also handles tiny clear bays beside an
      // Anchor staircase without pretending adjacent grid edges are all open.
      const turn = {
        x: side,
        y: Math.min(escapeY, p.y + Math.abs(side - p.x) * 0.1),
      };
      const route = [p, turn, { x: side, y: escapeY }, { ...config.launcher }];
      if (clearRoute(route)) {
        parent.set(key, null);
        exits.set(key, route);
        queue.push(key);
        break;
      }
      if (slot.row === 0) {
        const ceiling = [
          p,
          { x: p.x, y: 22 },
          { x: side, y: 22 },
          { x: side, y: escapeY },
          { ...config.launcher },
        ];
        if (clearRoute(ceiling)) {
          parent.set(key, null);
          exits.set(key, ceiling);
          queue.push(key);
          break;
        }
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i],
      slot = nodes.get(key)!;
    for (const adjacent of neighbors(config, slot)) {
      const next = slotKey(adjacent);
      if (!nodes.has(next) || parent.has(next)) continue;
      if (
        clearSegment(cellCenter(config, slot), cellCenter(config, adjacent))
      ) {
        parent.set(next, key);
        queue.push(next);
      }
    }
  }
  const routes: AnchorEscapeRoute[] = [],
    blocked: Cell[] = [];
  for (const cell of ordinary) {
    let key = slotKey(cell);
    if (!parent.has(key)) {
      blocked.push({ ...cell });
      continue;
    }
    const points: Point[] = [cellCenter(config, cell)];
    while (parent.get(key) !== null) {
      key = parent.get(key)!;
      points.push(cellCenter(config, nodes.get(key)!));
    }
    points.push(
      ...exits
        .get(key)!
        .slice(1)
        .map((point) => ({ ...point })),
    );
    routes.push({ cell: { row: cell.row, col: cell.col }, points });
  }
  return { routes, blocked };
}

/** Preserve scatter where certified; bounded deterministic repair has a
 * constructive open-sided fallback and always retains the requested count.
 */
function placeGeneratedAnchors(state: GameState): void {
  const { config } = state;
  if (!config.anchors) return;
  const ordinary = state.board.map((cell) => ({ ...cell }));
  const randomIndex = (length: number) => {
    const random = nextRandom(state.rng);
    state.rng = random.state;
    return Math.floor(random.value * length);
  };
  const accept = () =>
    anchorEscapeRoutes(config, state.board).blocked.length === 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    state.board = ordinary.map((cell) => ({ ...cell }));
    const positions = ordinary.map((_, i) => i);
    for (let i = 0; i < config.anchors; i++) {
      const pick = i + randomIndex(positions.length - i);
      [positions[i], positions[pick]] = [positions[pick], positions[i]];
      state.board[positions[i]].type = ANCHOR;
    }
    if (accept()) return;
  }
  // Dense random scatter may have no certificate. Layer the exact requested
  // count from the ceiling downward, with the final partial row mirrored by
  // the seeded stream. No ordinary roof is left above an unmatchable canopy.
  // This can span several full rows (126 Anchors span seven rows), not merely
  // a decorative top-row limit. Typical safe low-density scatter is unchanged.
  const mirror = randomIndex(2) === 1;
  const chosen = new Set<string>();
  for (const cell of ordinary.slice(0, config.anchors))
    chosen.add(
      slotKey({
        row: cell.row,
        col: mirror ? config.columns - (cell.row & 1) - 1 - cell.col : cell.col,
      }),
    );
  state.board = ordinary.map((cell) => ({
    ...cell,
    type: chosen.has(slotKey(cell)) ? ANCHOR : cell.type,
  }));
  // Retain the geometric certificate even for the constructive fallback: a
  // future geometry change must fail explicitly rather than bypass the guard.
  if (!accept()) throw new Error("Could not construct an open Anchor layout.");
}

export function createGame(options: NewGameOptions = {}): GameState {
  const config = structuredClone(options.config ?? getConfig());
  const derived = makeConfig(config);
  if (
    config.width !== derived.width ||
    config.height !== derived.height ||
    config.lossY !== derived.lossY ||
    config.launcher.x !== derived.launcher.x ||
    config.launcher.y !== derived.launcher.y
  )
    throw new Error("Configuration geometry is inconsistent.");
  const seed = options.seed === undefined ? 0x734d4153 : options.seed >>> 0;
  const state: GameState = {
    version: RULES_VERSION,
    config,
    seed,
    rng: seed || 0x6d2b79f5,
    board: [],
    descent: 0,
    current: 0,
    next: 0,
    shots: 0,
    score: 0,
    danger: 0,
    status: "ready",
    assisted: !!options.assisted,
  };
  if (options.board) state.board = options.board.map((cell) => ({ ...cell }));
  else {
    for (let row = 0; row < config.startRows; row++)
      for (let col = 0; col < config.columns - (row & 1); col++) {
        const random = nextRandom(state.rng);
        state.rng = random.state;
        state.board.push({
          row,
          col,
          type: Math.floor(random.value * config.types) as OrdinaryType,
        });
      }
    placeGeneratedAnchors(state);
  }
  validateBoard(config, state.board);
  if (supportedCells(config, state.board).size !== state.board.length)
    throw new Error("Starting board must be ceiling-supported.");
  if (!ordinaryTypes(state.board).length) {
    state.status = "cleared";
    return state;
  }
  state.current = options.current ?? choose(state);
  state.next = options.next ?? choose(state);
  if (
    ![state.current, state.next].every(
      (type) => Number.isInteger(type) && type >= 0 && type <= 6,
    )
  )
    throw new Error("Only ordinary types may be launched.");
  if (isFloorFull(state)) state.status = "lost";
  return state;
}

export function validateBoard(config: Config, board: Cell[]): void {
  const seen = new Set<string>();
  if (!Array.isArray(board) || board.length > config.columns * config.rows)
    throw new Error("Invalid board.");
  for (const cell of board) {
    if (
      !cell ||
      !inBounds(config, cell) ||
      !Number.isInteger(cell.type) ||
      cell.type < 0 ||
      cell.type > 7 ||
      seen.has(slotKey(cell))
    )
      throw new Error("Invalid or duplicate cell.");
    seen.add(slotKey(cell));
  }
}
export function validateState(value: unknown): value is GameState {
  try {
    if (!value || typeof value !== "object") return false;
    const state = value as GameState;
    if (state.version !== RULES_VERSION || !state.config) return false;
    const derived = makeConfig(state.config);
    if (
      state.config.width !== derived.width ||
      state.config.height !== derived.height ||
      state.config.lossY !== derived.lossY ||
      state.config.launcher.x !== derived.launcher.x ||
      state.config.launcher.y !== derived.launcher.y
    )
      return false;
    validateBoard(state.config, state.board);
    if (supportedCells(state.config, state.board).size !== state.board.length)
      return false;
    if (
      ![state.seed, state.rng].every(
        (n) => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff,
      )
    )
      return false;
    if (
      ![state.shots, state.score, state.danger, state.descent].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      state.score > 1e12 ||
      state.shots > 1e7 ||
      state.descent % 42 ||
      state.descent > state.config.lossY ||
      state.danger > state.config.dangerThreshold
    )
      return false;
    if (
      ![state.current, state.next].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 6,
      ) ||
      typeof state.assisted !== "boolean" ||
      !["ready", "cleared", "lost"].includes(state.status)
    )
      return false;
    const ordinary = ordinaryTypes(state.board).length > 0;
    const loss =
      isFloorFull(state) ||
      state.board.some(
        (cell) =>
          cellCenter(state.config, cell, state.descent).y + 22 >=
          state.config.lossY,
      );
    return state.status === "cleared"
      ? !ordinary
      : ordinary && (state.status === "lost" ? loss : !loss);
  } catch {
    return false;
  }
}

export function supportedCells(config: Config, board: Cell[]): Set<string> {
  const occupied = new Map(board.map((cell) => [slotKey(cell), cell]));
  const visited = new Set<string>(),
    queue = board.filter((cell) => cell.row === 0);
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i],
      key = slotKey(cell);
    if (visited.has(key)) continue;
    visited.add(key);
    for (const neighbor of neighbors(config, cell)) {
      const found = occupied.get(slotKey(neighbor));
      if (found && !visited.has(slotKey(found))) queue.push(found);
    }
  }
  return visited;
}
export function connectedGroup(
  config: Config,
  board: Cell[],
  start: Cell,
): Cell[] {
  const occupied = new Map(board.map((cell) => [slotKey(cell), cell])),
    visited = new Set<string>(),
    result: Cell[] = [],
    queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i],
      key = slotKey(cell);
    if (visited.has(key) || cell.type !== start.type) continue;
    visited.add(key);
    result.push(cell);
    for (const neighbor of neighbors(config, cell)) {
      const found = occupied.get(slotKey(neighbor));
      if (found && found.type === start.type && !visited.has(slotKey(found)))
        queue.push(found);
    }
  }
  return result;
}

function segmentDistanceSq(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return distanceSq({ x: a.x + dx * t, y: a.y + dy * t }, p);
}

/** The short grid placement is checked from the incoming side, never behind a contacted piece. */
function snap(
  state: GameState,
  impact: Point,
  direction: Point,
  contacts: Cell[],
  ceiling: boolean,
  incomingPath: Point[],
): Slot | null {
  const { config, descent, board } = state,
    occupied = new Set(board.map(slotKey)),
    candidates = new Map<string, Slot>();
  const flightLength = incomingPath.reduce(
    (sum, point, i) =>
      sum + (i ? Math.sqrt(distanceSq(point, incomingPath[i - 1])) : 0),
    0,
  );
  const retreat = Math.min(48, flightLength);
  const approaches = [
    0,
    retreat / 4,
    retreat / 2,
    (retreat * 3) / 4,
    retreat,
  ].map((back) =>
    pointOnTrace(
      { points: incomingPath, landing: null, distance: flightLength },
      flightLength - back,
    ),
  );
  if (ceiling)
    for (let col = 0; col < config.columns; col++)
      candidates.set(`0,${col}`, { row: 0, col });
  for (const cell of contacts)
    for (const neighbor of neighbors(config, cell))
      candidates.set(slotKey(neighbor), neighbor);
  const legal = [...candidates.values()].filter((candidate) => {
    if (occupied.has(slotKey(candidate))) return false;
    const center = cellCenter(config, candidate, descent);
    if (distanceSq(center, impact) > 74 ** 2) return false;
    if (center.y + 22 > config.launcher.y - 22) return false;
    // A contact-side hemisphere test rejects an attachment on the far side.
    if (
      contacts.length &&
      contacts.every((cell) => {
        const c = cellCenter(config, cell, descent);
        return (
          (center.x - c.x) * (impact.x - c.x) +
            (center.y - c.y) * (impact.y - c.y) <=
          EPS
        );
      })
    )
      return false;
    // The validated flight has already reached impact without obstruction.
    // Prefer the direct local settle path. If its chord grazes the contacted
    // proxy, a bounded retreat along that same validated polyline can provide a
    // clear approach. Follow actual wall turns, never a fictitious extension
    // outside the arena. No proxy is omitted from the final corridor check.
    return approaches.some((approach) => {
      return board.every(
        (cell) =>
          segmentDistanceSq(
            approach,
            center,
            cellCenter(config, cell, descent),
          ) >=
          44 ** 2 - EPS,
      );
    });
  });
  legal.sort((a, b) => {
    const ca = cellCenter(config, a, descent),
      cb = cellCenter(config, b, descent);
    const distance = distanceSq(ca, impact) - distanceSq(cb, impact);
    if (Math.abs(distance) > EPS) return distance;
    const alignment = (cb.x - ca.x) * direction.x + (cb.y - ca.y) * direction.y;
    return Math.abs(alignment) > EPS
      ? alignment
      : a.row - b.row || a.col - b.col;
  });
  return legal[0] ?? null;
}

/** Exact ray-circle sweep; returned polyline is shared by guide and live flight. */
export function traceShot(state: GameState, angleDegrees: number): Trace {
  const start = { ...state.config.launcher },
    points = [start];
  if (
    !Number.isFinite(angleDegrees) ||
    angleDegrees < 5 ||
    angleDegrees > 175 ||
    state.status !== "ready"
  )
    return { points, landing: null, distance: 0, reason: "Shot unavailable." };
  const radians = (angleDegrees * Math.PI) / 180;
  let direction = { x: Math.cos(radians), y: -Math.sin(radians) },
    position = start,
    total = 0;
  const { config, board, descent } = state;
  for (let bounce = 0; bounce < 64; bounce++) {
    const side =
      direction.x > EPS
        ? (config.width - 22 - position.x) / direction.x
        : direction.x < -EPS
          ? (22 - position.x) / direction.x
          : Infinity;
    const ceiling = (22 + descent - position.y) / direction.y;
    let travel = ceiling >= -EPS ? Math.max(0, ceiling) : Infinity,
      kind: "ceiling" | "wall" | "piece" = "ceiling";
    if (side >= -EPS && side < travel - EPS) {
      travel = Math.max(0, side);
      kind = "wall";
    }
    let contacts: Cell[] = [];
    for (const cell of board) {
      const center = cellCenter(config, cell, descent),
        dx = position.x - center.x,
        dy = position.y - center.y;
      const b = dx * direction.x + dy * direction.y,
        c = dx * dx + dy * dy - 44 * 44,
        discriminant = b * b - c;
      if (discriminant < -EPS || b > EPS) continue;
      const hit = -b - Math.sqrt(Math.max(0, discriminant));
      if (hit < -EPS) continue;
      if (hit < travel - EPS) {
        travel = Math.max(0, hit);
        kind = "piece";
        contacts = [cell];
      } else if (Math.abs(hit - travel) <= EPS && kind === "piece")
        contacts.push(cell);
      else if (Math.abs(hit - travel) <= EPS && kind !== "piece") {
        kind = "piece";
        contacts = [cell];
      }
    }
    if (!Number.isFinite(travel) || total + travel > 14000)
      return {
        points,
        landing: null,
        distance: total,
        reason: "Flight exceeded its safety guard.",
      };
    total += travel;
    position = {
      x: position.x + direction.x * travel,
      y: position.y + direction.y * travel,
    };
    points.push(position);
    if (kind === "wall") {
      direction = { x: -direction.x, y: direction.y };
      continue;
    }
    const landing = snap(
      state,
      position,
      direction,
      contacts,
      kind === "ceiling",
      points,
    );
    return {
      points,
      landing,
      distance: total,
      ...(!landing ? { reason: "No reachable empty attachment cell." } : {}),
    };
  }
  return {
    points,
    landing: null,
    distance: total,
    reason: "Too many wall contacts.",
  };
}

export const matchAward = (n: number) =>
  n >= 3 ? Math.min(n * n + 1, 10000) : 0;
export const dropAward = (n: number) => Math.min(10 * n * n, 10000);
export const efficiencyAward = (target: number, shots: number) =>
  100 * Math.max(1, target - shots);
const noAward = (): Award => ({
  match: 0,
  drop: 0,
  clear: 0,
  efficiency: 0,
  total: 0,
});

/** Resolves a complete accepted shot once; callers animate this returned result. */
export function resolveShot(
  original: GameState,
  angleDegrees: number,
): Resolution {
  const trace = traceShot(original, angleDegrees);
  if (!trace.landing)
    return {
      state: cloneState(original),
      trace,
      matched: [],
      dropped: [],
      award: noAward(),
      descended: false,
      error: trace.reason ?? "No attachment.",
    };
  return resolvePlacement(original, trace.landing, trace);
}

/** Exposed for authored fixtures. Runtime firing must use resolveShot. */
export function resolvePlacement(
  original: GameState,
  landing: Slot,
  trace: Trace = { points: [], distance: 0, landing },
): Resolution {
  const state = cloneState(original),
    award = noAward();
  if (
    state.status !== "ready" ||
    !inBounds(state.config, landing) ||
    state.board.some((cell) => slotKey(cell) === slotKey(landing)) ||
    (landing.row !== 0 &&
      !neighbors(state.config, landing).some((neighbor) =>
        state.board.some((cell) => slotKey(cell) === slotKey(neighbor)),
      ))
  )
    return {
      state,
      trace,
      matched: [],
      dropped: [],
      award,
      descended: false,
      error: "Illegal attachment.",
    };
  const attached: Cell = { ...landing, type: state.current };
  state.board.push(attached);
  state.shots++;
  const group = connectedGroup(state.config, state.board, attached),
    matched = group.length >= 3 ? group : [];
  const matchedKeys = new Set(matched.map(slotKey));
  state.board = state.board.filter((cell) => !matchedKeys.has(slotKey(cell)));
  const support = supportedCells(state.config, state.board),
    dropped = state.board.filter((cell) => !support.has(slotKey(cell)));
  state.board = state.board.filter((cell) => support.has(slotKey(cell)));
  award.match = matchAward(matched.length);
  award.drop = dropAward(dropped.length);
  state.danger = Math.max(0, state.danger + 1 - dropped.length * 2);
  let descended = false;
  if (!ordinaryTypes(state.board).length) {
    award.clear = 1000;
    award.efficiency = efficiencyAward(state.config.target, state.shots);
    state.status = "cleared";
    // Terminal state still has a valid persisted danger value.
    state.danger = Math.min(state.danger, state.config.dangerThreshold);
  } else {
    if (state.danger > state.config.dangerThreshold) {
      state.danger = 0;
      state.descent += 42;
      descended = true;
    }
    if (
      isFloorFull(state) ||
      state.board.some(
        (cell) =>
          cellCenter(state.config, cell, state.descent).y + 22 >=
          state.config.lossY,
      )
    )
      state.status = "lost";
    else {
      state.current = state.next;
      state.next = choose(state);
    }
  }
  award.total = award.match + award.drop + award.clear + award.efficiency;
  state.score += award.total;
  return { state, trace, matched, dropped, award, descended };
}

export function undoState(previous: GameState, current: GameState): GameState {
  const restored = cloneState(previous);
  restored.assisted = true;
  return restored;
}

/** Sample along the exact swept flight. Useful for fixed-step presentation. */
export function pointOnTrace(trace: Trace, distance: number): Point {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < trace.points.length; i++) {
    const a = trace.points[i - 1],
      b = trace.points[i],
      length = Math.sqrt(distanceSq(a, b));
    if (remaining <= length)
      return {
        x: a.x + ((b.x - a.x) * remaining) / (length || 1),
        y: a.y + ((b.y - a.y) * remaining) / (length || 1),
      };
    remaining -= length;
  }
  return { ...trace.points[trace.points.length - 1] };
}
