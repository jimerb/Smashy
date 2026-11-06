import {
  cloneState,
  resolveShot,
  validateState,
  type GameState,
  type Resolution,
} from "./core";
export interface ShotEvent {
  angle: number;
  current: number;
  next: number;
  landing: { row: number; col: number };
}
export interface ShotReplay {
  version: 1;
  rulesVersion: number;
  contentVersion: number;
  start: GameState;
  events: ShotEvent[];
  assisted: boolean;
  truncated: boolean;
}
export const MAX_REPLAY_EVENTS = 512;
export function createReplay(
  state: GameState,
  contentVersion = 1,
  truncated = false,
): ShotReplay {
  return {
    version: 1,
    rulesVersion: state.version,
    contentVersion,
    start: cloneState(state),
    events: [],
    assisted: state.assisted,
    truncated,
  };
}
export function appendReplay(
  replay: ShotReplay,
  before: GameState,
  result: Resolution,
  angle: number,
): ShotReplay {
  if (result.error || !result.trace.landing)
    throw new Error("Only accepted shots belong in a replay.");
  const next =
    replay.events.length >= MAX_REPLAY_EVENTS
      ? createReplay(before, replay.contentVersion, true)
      : structuredClone(replay);
  next.events.push({
    angle,
    current: before.current,
    next: before.next,
    landing: { ...result.trace.landing },
  });
  next.assisted ||= result.state.assisted;
  return next;
}
export function undoReplay(replay: ShotReplay, state: GameState): ShotReplay {
  if (!replay.events.length)
    return createReplay(state, replay.contentVersion, true);
  const next = structuredClone(replay);
  next.events.pop();
  next.assisted ||= state.assisted;
  return next;
}
export function validateReplay(value: unknown): value is ShotReplay {
  const r = value as ShotReplay;
  return (
    !!r &&
    r.version === 1 &&
    Number.isSafeInteger(r.contentVersion) &&
    r.contentVersion > 0 &&
    Number.isSafeInteger(r.rulesVersion) &&
    r.rulesVersion === r.start?.version &&
    validateState(r.start) &&
    typeof r.assisted === "boolean" &&
    typeof r.truncated === "boolean" &&
    Array.isArray(r.events) &&
    r.events.length <= MAX_REPLAY_EVENTS &&
    r.events.every(
      (e) =>
        Number.isFinite(e.angle) &&
        e.angle >= 5 &&
        e.angle <= 175 &&
        Number.isInteger(e.current) &&
        e.current >= 0 &&
        e.current < 7 &&
        Number.isInteger(e.next) &&
        e.next >= 0 &&
        e.next < 7 &&
        Number.isInteger(e.landing?.row) &&
        e.landing.row >= 0 &&
        e.landing.row < r.start.config.rows &&
        Number.isInteger(e.landing?.col) &&
        e.landing.col >= 0 &&
        e.landing.col < r.start.config.columns,
    )
  );
}
/** Debug reconstruction only: no browser state, sounds, score writes or RNG outside core. */
export function replayShots(replay: ShotReplay): GameState {
  if (!validateReplay(replay)) throw new Error("Invalid shot report.");
  let state = cloneState(replay.start);
  for (const event of replay.events) {
    if (state.current !== event.current || state.next !== event.next)
      throw new Error("Piece sequence does not match.");
    const result = resolveShot(state, event.angle);
    if (
      result.error ||
      result.trace.landing?.row !== event.landing.row ||
      result.trace.landing?.col !== event.landing.col
    )
      throw new Error("Landing does not match.");
    state = result.state;
  }
  state.assisted ||= replay.assisted;
  return state;
}
