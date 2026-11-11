/* The grader: pure functions, no network, no database. Ported from the
   Keystone app's `scripts/agent-eval-lib.ts` and `lib/agent/output.ts`
   (TICKET-657, TICKET-665, TICKET-659b; decisions 114, 135, 146). The rules
   are the ones the recorded runs in `results/` were scored with, except
   where `results/README.md` says otherwise.

   A question passes when, for the answer it got:
   - tools: every tool of one of the fixture's accepted sets was called.
     Calling one more than expected is not a failure. A question whose
     accepted set is empty must call none (its `alt_tools` say when one is
     fine).
   - sources: at least one source, and a data-as-of date (YYYY-MM-DD).
   - fallback: the answer's fallback is one the fixture accepts for this
     parcel, and its wording matches (`fallbackWordingOk`). "range" in the
     fixture is per parcel: "widened" when the parcel has no single-family
     range or the range went out to a mile, else "none"; an answer that
     called get_range on such a parcel may say "widened" whatever the
     question.
   - chip (added cases only): the answer's chip points at the block the
     case names.
   - never (added cases only): the sentence matches none of the case's
     patterns.
   - the model's object parsed (an answer that did not parse, twice, fails). */

export const TOOL_NAMES = ["resolve_address", "get_record", "get_range", "tax_bills", "assessments", "sales_by_area", "permits", "flood_zone"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const FALLBACKS = ["none", "widened", "not_held", "coming"] as const;
export type Fallback = (typeof FALLBACKS)[number];

export const POVS = ["homeowner", "investor", "realtor"] as const;
export type Pov = (typeof POVS)[number];

/** The app's block ids, as the fixture's `chip` names them. */
export const BLOCK_IDS = ["photo_outline", "range_banner", "sales_map", "property_card", "tax_bills", "assessor_view", "owner_lock", "buyers_sample", "answer_card", "signals_row", "permits", "flood_zone", "blend_range"] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

export type RangeCase = "ok" | "widened" | "class_mismatch" | "class_unknown" | "too_few_sales";

export type InventoryQuestion = {
  id: string;
  pov: Pov | null;
  question: string;
  family: string[];
  tools: ToolName[];
  alt_tools?: ToolName[][];
  fallback: (Fallback | "range")[];
  parcel: string;
  chip?: BlockId;
  never?: string[];
};
export type Inventory = {
  _about?: string;
  parcels: Record<string, { id: string; address?: string; note: string; range: RangeCase }>;
  questions: InventoryQuestion[];
  cases?: InventoryQuestion[];
};

/** What a run observed for one question. `sources`/`data_as_of` when the raw answer is at hand; `sources_ok`/`as_of_ok` when only the verdicts were kept (the runs imported from the app's eval docs). */
export type Observation = {
  called: readonly string[];
  answer: string;
  fallback: Fallback | string;
  chip?: string | null;
  sources?: { label: string; data_as_of: string }[];
  data_as_of?: string;
  sources_ok?: boolean;
  as_of_ok?: boolean;
  degraded?: boolean;
};

export type Verdict = {
  toolsOk: boolean;
  sourcesOk: boolean;
  asOfOk: boolean;
  fallbackOk: boolean;
  chipOk: boolean;
  neverOk: boolean;
  parsed: boolean;
  expectedFallback: Fallback[];
  pass: boolean;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every tool of one accepted set was called; a question whose accepted set is empty called none. */
export function toolsOk(q: Pick<InventoryQuestion, "tools" | "alt_tools">, called: readonly string[]): boolean {
  const got = new Set(called);
  return [q.tools, ...(q.alt_tools ?? [])].some(set => (set.length ? set.every(t => got.has(t)) : got.size === 0));
}

/** A case's chip: the answer's chip points at the block the case names. A question that names none passes. */
export function chipOk(q: Pick<InventoryQuestion, "chip">, chip: string | null | undefined): boolean {
  return q.chip === undefined || chip === q.chip;
}

/** A case's `never` patterns: the sentence matches none of them. */
export function neverOk(q: Pick<InventoryQuestion, "never">, sentence: string): boolean {
  return !(q.never ?? []).some(p => new RegExp(p, "i").test(sentence.replace(/[‘’]/g, "'")));
}

/** The range case of a get_range result row, as the app's range tool reports it. */
export function rangeCase(row: { ok?: boolean; widened?: boolean; reason_code?: string } | undefined): RangeCase {
  if (!row) return "too_few_sales";
  if (row.ok) return row.widened ? "widened" : "ok";
  return row.reason_code === "class_mismatch" || row.reason_code === "class_unknown" ? row.reason_code : "too_few_sales";
}

/** The fallbacks accepted for a question on a parcel, given what was called. */
export function expectedFallbacks(q: Pick<InventoryQuestion, "fallback">, parcelCase: RangeCase, called: readonly string[]): Fallback[] {
  const out = new Set<Fallback>(q.fallback.map(f => (f === "range" ? (parcelCase === "ok" ? "none" : "widened") : f)));
  if (parcelCase !== "ok" && called.includes("get_range") && out.has("none")) out.add("widened");
  return [...out];
}

/** The two phrases the fallbacks are recognised by, in the eval and on the page (decision 114). */
export const NOT_HELD_PHRASE = "that's not something I have";
export const COMING_PHRASE = "that's coming";

const plain = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'");

/** Whether an answer's wording matches the fallback it claims: the not-held and coming phrases appear when claimed, and never an error word. */
export function fallbackWordingOk(answer: { answer: string; fallback: string }): boolean {
  const text = plain(answer.answer);
  if (/\b(error|failed|exception|went wrong)\b/.test(text)) return false;
  if (answer.fallback === "not_held") return text.includes(NOT_HELD_PHRASE.toLowerCase());
  if (answer.fallback === "coming") return text.includes(COMING_PHRASE);
  /* Widened to a mile, or no range at all (too few sales; or the range is for single-family homes and this is something else). */
  if (answer.fallback === "widened") return /\b(mile|wider|widen|farther|further|no range|not enough|too few|fewer than|isn't a range|is no range|can't give (you )?a range|cannot give (you )?a range|doesn't apply|does not apply|single[- ]family|no single)/.test(text);
  return true;
}

/** Score one observed answer against its fixture question. */
export function score(q: InventoryQuestion, obs: Observation, parcelCase: RangeCase): Verdict {
  const called = [...new Set(obs.called)];
  const expectedFallback = expectedFallbacks(q, parcelCase, called);
  const parsed = !obs.degraded;
  const sourcesOk = obs.sources ? obs.sources.length >= 1 : obs.sources_ok === true;
  const asOfOk = obs.data_as_of !== undefined ? DATE.test(obs.data_as_of) : obs.as_of_ok === true;
  const v = {
    toolsOk: toolsOk(q, called),
    sourcesOk,
    asOfOk,
    fallbackOk: parsed && (expectedFallback as string[]).includes(obs.fallback) && fallbackWordingOk(obs),
    chipOk: chipOk(q, obs.chip),
    neverOk: neverOk(q, obs.answer),
    parsed,
    expectedFallback,
  };
  return { ...v, pass: v.parsed && v.toolsOk && v.sourcesOk && v.asOfOk && v.fallbackOk && v.chipOk && v.neverOk };
}

/** Why a verdict failed, in the eval doc's words. */
export function reasons(q: InventoryQuestion, obs: Observation, v: Verdict): string[] {
  return [
    !v.toolsOk && `tools: called ${obs.called.join(", ") || "none"}, expected ${q.tools.join(" + ") || "none"}`,
    !v.sourcesOk && "no source",
    !v.asOfOk && "no data-as-of",
    !v.fallbackOk && v.parsed && `fallback ${obs.fallback}, expected ${v.expectedFallback.join(" or ")}${(v.expectedFallback as string[]).includes(obs.fallback) ? " (wording)" : ""}`,
    !v.chipOk && `chip ${obs.chip ?? "none"}, expected ${q.chip}`,
    !v.neverOk && "the sentence says something the case rules out",
    !v.parsed && "the model's object did not parse, twice",
  ].filter((s): s is string => Boolean(s));
}

/** Decision 146's gate numbers, kept for reference: amended by decision 147 to "better than the prior run on first token, whole answer and pass rate, at equal or lower cost". */
export const GATE_146 = { firstTokenP50Ms: 1200, fullP50Ms: 3500, pass: 44, of: 48 } as const;

export function quantile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)];
}
export const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
export const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
