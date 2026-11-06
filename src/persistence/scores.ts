/** Original, browser-local personal records. No account or network service. */
export interface ScoreCategory {
  mode: "classic" | "puzzles" | "journey" | "custom" | "tutorial";
  difficulty:
    | "gentle"
    | "relaxed"
    | "standard"
    | "tricky"
    | "expert"
    | "custom";
  rulesVersion: string;
  layoutVersion: string;
  layout: "standard" | "compact";
  assisted: boolean;
  configId: string;
}

export type ScoreOutcome = "clear" | "loss";
export interface ScoreEntry {
  runId: string;
  category: ScoreCategory;
  score: number;
  outcome: ScoreOutcome;
  assisted: boolean;
  sequence: number;
  completedAt: number;
}
export interface ScoreDecision {
  kind: "new-best" | "tied-best" | "rank" | "unranked" | "ineligible";
  rank: number | null;
  previousBest: number | null;
}
export interface TerminalInput {
  runId: string;
  category: ScoreCategory;
  score: number;
  outcome: ScoreOutcome;
  assisted: boolean;
}
export interface TerminalReceipt extends TerminalInput {
  decision: ScoreDecision;
  sequence: number;
  completedAt: number;
}

const modes = ["classic", "puzzles", "journey", "custom", "tutorial"];
const difficulties = [
  "gentle",
  "relaxed",
  "standard",
  "tricky",
  "expert",
  "custom",
];
export function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !["__proto__", "prototype", "constructor"].includes(value) &&
    !/[\u0000-\u001f]/.test(value)
  );
}
export function isCategory(value: unknown): value is ScoreCategory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as ScoreCategory;
  return (
    modes.includes(c.mode) &&
    difficulties.includes(c.difficulty) &&
    ["standard", "compact"].includes(c.layout) &&
    typeof c.assisted === "boolean" &&
    validId(c.rulesVersion) &&
    validId(c.layoutVersion) &&
    validId(c.configId)
  );
}
export function categoryKey(category: ScoreCategory): string {
  if (!isCategory(category)) throw new Error("Invalid score category");
  return JSON.stringify([
    category.mode,
    category.difficulty,
    category.rulesVersion,
    category.layoutVersion,
    category.layout,
    category.assisted,
    category.configId,
  ]);
}
export function validTerminal(input: unknown): input is TerminalInput {
  if (!input || typeof input !== "object") return false;
  const i = input as TerminalInput;
  return (
    validId(i.runId) &&
    isCategory(i.category) &&
    typeof i.assisted === "boolean" &&
    i.category.assisted === i.assisted &&
    Number.isSafeInteger(i.score) &&
    i.score >= 0 &&
    (i.outcome === "clear" || i.outcome === "loss")
  );
}

/** Ties follow prior entries; a tie for tenth in a full table cannot enter. */
export function decideScore(
  entries: readonly ScoreEntry[],
  input: TerminalInput,
): ScoreDecision {
  if (!validTerminal(input)) throw new Error("Invalid terminal result");
  const previousBest = entries[0]?.score ?? null;
  if (!input.score || input.category.mode === "tutorial") {
    return { kind: "ineligible", rank: null, previousBest };
  }
  const position = entries.findIndex((entry) => entry.score < input.score);
  const rank = position < 0 ? entries.length + 1 : position + 1;
  const qualifies = rank <= 10;
  const kind =
    input.score > (previousBest ?? 0)
      ? "new-best"
      : input.score === previousBest
        ? "tied-best"
        : qualifies
          ? "rank"
          : "unranked";
  return { kind, rank: qualifies ? rank : null, previousBest };
}

export function insertScore(
  entries: readonly ScoreEntry[],
  input: TerminalInput,
  sequence: number,
  completedAt: number,
): { entries: ScoreEntry[]; receipt: TerminalReceipt } {
  const decision = decideScore(entries, input);
  const next = entries.map((entry) => structuredClone(entry));
  if (decision.rank !== null) {
    next.splice(decision.rank - 1, 0, {
      ...structuredClone(input),
      sequence,
      completedAt,
    });
    next.length = Math.min(10, next.length);
  }
  return {
    entries: next,
    receipt: { ...structuredClone(input), decision, sequence, completedAt },
  };
}
