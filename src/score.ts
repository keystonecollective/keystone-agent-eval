import { basename } from "node:path";
import { mean, pct, quantile, reasons, usd } from "./grader.js";
import { loadInventory, loadRun, scoreRun, type Run } from "./records.js";

/* Re-score recorded runs with the current grader and print each run's
   table. No key, no network, no database.

     npm run score -- results/2026-11-06.json
     npm run score:all            (the three recorded runs, with --check)

   --check: exit 1 if a row's verdict differs from the one the run's own
   grader recorded (the `recorded` columns), except where the run says its
   grader was an older one (`grader_version` not "current"), where the
   difference is printed and allowed. --quiet prints the summary only. */

const args = process.argv.slice(2);
const check = args.includes("--check");
const quiet = args.includes("--quiet");
const files = args.filter(a => !a.startsWith("--"));
if (!files.length) { console.error("usage: npm run score -- [--check] [--quiet] results/<run>.json ..."); process.exit(2); }

const inv = loadInventory();
let failed = false;

export function summary(run: Run, scored: ReturnType<typeof scoreRun>) {
  const n = scored.length;
  const inventoryIds = new Set(inv.questions.map(q => q.id));
  const invRows = scored.filter(s => inventoryIds.has(s.q.id));
  const count = (f: (s: (typeof scored)[number]) => boolean) => scored.filter(f).length;
  const nums = (f: (s: (typeof scored)[number]) => number | null | undefined) => scored.map(f).filter((v): v is number => typeof v === "number");
  const spent = nums(s => s.row.usd).reduce((a, b) => a + b, 0);
  return {
    n, pass: count(s => s.v.pass), passInventory: invRows.filter(s => s.v.pass).length, ofInventory: invRows.length,
    toolsOk: pct(count(s => s.v.toolsOk), n), sourcesOk: pct(count(s => s.v.sourcesOk), n), asOfOk: pct(count(s => s.v.asOfOk), n), fallbackOk: pct(count(s => s.v.fallbackOk), n),
    unparsed: count(s => !s.v.parsed),
    wholeP50: quantile(nums(s => s.row.ms), 0.5), wholeP95: quantile(nums(s => s.row.ms), 0.95),
    firstP50: quantile(nums(s => s.row.first_token_ms), 0.5), firstP95: quantile(nums(s => s.row.first_token_ms), 0.95), firstN: nums(s => s.row.first_token_ms).length,
    tokens: Math.round(mean(nums(s => s.row.tokens))), spent, perAnswer: n ? spent / n : 0,
  };
}

for (const file of files) {
  const run = loadRun(file);
  const scored = scoreRun(inv, run);
  const s = summary(run, scored);
  const current = !run.grader_version || /\(current\)/.test(run.grader_version);
  console.log(`\n# ${run.run} — ${run.label}`);
  console.log(`model ${run.model}${run.publication ? ` · publication ${run.publication}` : ""} · ${s.n} questions · grader: ${run.grader_version ?? "current"}`);
  console.log(`**Fully passing (current grader): ${s.pass} / ${s.n}**${s.ofInventory !== s.n ? ` (inventory's 48: ${s.passInventory} / ${s.ofInventory})` : ""} · tools ${s.toolsOk} · sources ${s.sourcesOk} · data-as-of ${s.asOfOk} · fallback ${s.fallbackOk} · unparsed ${s.unparsed}`);
  console.log(`whole answer p50 ${s.wholeP50} ms, p95 ${s.wholeP95} ms${s.firstN ? ` · first token p50 ${s.firstP50} ms, p95 ${s.firstP95} ms` : ""} · mean tokens ${s.tokens} · total ${usd(s.spent)} · per answer ${usd(s.perAnswer)}`);
  if (run.recorded) console.log(`recorded by the run's own grader: ${run.recorded.pass} / ${run.recorded.of}${run.recorded.usd_total !== undefined ? ` · ${usd(Number(run.recorded.usd_total))}` : ""}`);
  const diffs: string[] = [];
  for (const { q, row, v } of scored) {
    if (row.recorded) {
      const recPass = row.recorded.tools_ok && row.recorded.fallback_ok && row.sources_ok !== false && row.as_of_ok !== false && !row.degraded && (q.chip === undefined || row.chip === q.chip);
      if (recPass !== v.pass || row.recorded.tools_ok !== v.toolsOk || row.recorded.fallback_ok !== v.fallbackOk) diffs.push(`${q.id}: recorded tools ${row.recorded.tools_ok} fallback ${row.recorded.fallback_ok} pass ${recPass}; current grader tools ${v.toolsOk} fallback ${v.fallbackOk} pass ${v.pass}`);
    }
  }
  if (!quiet) {
    console.log("\n| # | Question | Tools called | Tools ok | Fallback (expected) | Pass | First token ms | ms | $ |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const { q, row, v } of scored) console.log(`| ${q.id} | ${q.question.replace(/\|/g, "\\|")} | ${row.called.join(", ") || "none"} | ${v.toolsOk ? "yes" : "**no**"} | ${row.fallback} (${v.expectedFallback.join(" or ")}) | ${v.pass ? "yes" : "**no**"} | ${row.first_token_ms ?? "n/a"} | ${row.ms ?? "n/a"} | ${row.usd === undefined || row.usd === null ? "n/a" : usd(row.usd)} |`);
    const fails = scored.filter(x => !x.v.pass);
    console.log(`\n## Misses (${fails.length})\n`);
    for (const { q, row, v } of fails) console.log(`- **${q.id}** “${q.question}” — ${reasons(q, row, v).join("; ")}. Answer: “${row.answer}”`);
  }
  if (diffs.length) {
    console.log(`\n${current ? "DIFFERENCES from the recorded verdicts" : "Differences from the run's older grader (expected)"}:`);
    for (const d of diffs) console.log(`- ${d}`);
    if (check && current) failed = true;
  } else if (run.rows.some(r => r.recorded)) console.log("\nEvery verdict matches the one the run recorded.");
}
if (failed) { console.error("\n--check: a current-grader run does not reproduce its recorded verdicts."); process.exit(1); }
