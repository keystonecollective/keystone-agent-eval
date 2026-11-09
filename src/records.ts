import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { score, type Fallback, type Inventory, type InventoryQuestion, type RangeCase, type Verdict } from "./grader.js";

/* The results file: one run, one row per question. `results/*.json` are
   the recorded runs; `src/run.ts` writes new ones in the same shape. */

export type Row = {
  id: string;
  parcel: string;
  called: string[];
  answer: string;
  fallback: Fallback | string;
  chip?: string | null;
  sources?: { label: string; data_as_of: string }[];
  data_as_of?: string;
  sources_ok?: boolean;
  as_of_ok?: boolean;
  degraded?: boolean;
  steps?: number | null;
  tools_ms?: number | null;
  first_token_ms?: number | null;
  ms: number | null;
  tokens?: number | null;
  usd?: number | null;
  /** The verdict columns as the run's own grader wrote them, when the run was imported from an eval doc. */
  recorded?: { tools_ok: boolean; fallback_ok: boolean };
  expected_fallback_as_recorded?: string[];
};

export type Run = {
  run: string;
  label: string;
  model: string;
  gateway?: string;
  publication?: string;
  data_as_of?: string;
  questions: number;
  grader_version?: string;
  concurrency?: number;
  timed_from?: string;
  source_doc?: string;
  /** The range case of each fixture parcel in this run, when it differed from the fixture. */
  parcel_cases?: Record<string, RangeCase>;
  recorded?: Record<string, number | string>;
  rows: Row[];
};

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..");

export const loadInventory = (): Inventory => JSON.parse(readFileSync(join(ROOT, "fixture/inventory.json"), "utf8")) as Inventory;
export const loadRun = (file: string): Run => JSON.parse(readFileSync(file, "utf8")) as Run;

export const allQuestions = (inv: Inventory): InventoryQuestion[] => [...inv.questions, ...(inv.cases ?? [])];

/** Every row of a run scored with the current grader. */
export function scoreRun(inv: Inventory, run: Run): { q: InventoryQuestion; row: Row; v: Verdict }[] {
  const byId = new Map(allQuestions(inv).map(q => [q.id, q]));
  return run.rows.map(row => {
    const q = byId.get(row.id);
    if (!q) throw new Error(`${run.run}: row ${row.id} is not in the fixture`);
    const parcelCase = run.parcel_cases?.[q.parcel] ?? inv.parcels[q.parcel].range;
    return { q, row, v: score(q, row, parcelCase) };
  });
}
