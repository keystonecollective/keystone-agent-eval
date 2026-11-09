# Recorded runs

Three runs of the 48-question fixture against the Keystone agent (Claude Sonnet 5.5 through the Vercel AI Gateway, the six `pub` tools over the live publication `2026-11-05.2`), imported row by row from the app's own eval documents. Each JSON file is one run: the run's metadata, the per-question rows (tools called, fallback, the answer sentence, chip, timings, tokens, dollars) and the verdict columns the run's own grader wrote. Owner names never appear in these answers: the agent cannot read ownership, and the fixture's four parcels are public addresses.

Timings were taken from a laptop in St. Louis, three questions at a time. Dollars are what the gateway reported for each turn.

| Run | What changed | Pass | Whole answer p50 / p95 | First token p50 / p95 | Mean tokens | Cost (48) | Per answer |
|---|---|---|---|---|---|---|---|
| [2026-11-05](2026-11-05.json) | First eval (TICKET-657): four model steps allowed, structured-object answer, untrimmed tool results | **35 / 48** (41 / 48 with the current grader, see below) | 5,773 / 11,003 ms | not measured | 19,345 | $0.84 | $0.0176 |
| [2026-11-06](2026-11-06.json) | TICKET-665: one tool round then the answer, trimmed tool results, server-written sources, low effort | **44 / 48** | 3,147 / 5,344 ms | 3,138 / 5,333 ms (equal to the whole answer: the sentence sat inside the object) | 7,154 | $0.23 | $0.0048 |
| [2026-11-06-streaming](2026-11-06-streaming.json) | TICKET-659b: the sentence streams as plain text ahead of the object; the answer is its own call after the tool round | **45 / 48** (46 / 49 with case L1) | 2,473 / 4,054 ms | 1,694 / 3,356 ms | 6,915 | $0.23 (49) | $0.0046 |

| [2026-11-09-http](2026-11-09-http.json) | The same agent on site main 68c2c84, run from this repo over HTTP (`src/run.ts`) against the app on a laptop, tools on the live `pub` as an `explorer_public` login | **44 / 48** (45 / 49 with case L1) | 2,651 / 4,963 ms (2,521 / 4,072 without the dev server's three cold-start answers) | 1,795 / 3,861 ms | not on the wire | not on the wire | not on the wire |

Re-score any of them with `npm run score -- results/<run>.json`; `npm run score:all` checks that the current grader reproduces every recorded verdict of the 2026-11-06 runs; the 2026-11-09 run was scored by this repo's grader in the first place.

## The grader changed between the first run and the second

The 2026-11-05 run was scored with TICKET-657's rules: a tool call the fixture did not list was a failure, and the "widened" wording had to say so in fewer ways. TICKET-665 (decision 135) changed both: calling one tool more than expected is not a failure, and an answer that says the single-family range "doesn't apply" counts as widened. Scored with today's grader the first run passes **41 / 48**: H1, H3, H4, H6, B3 and N7 pass on the new rules, and seven still fail: I3, R8 and B8 (a not-held answer without the phrase "that's not something I have"), I6 (the same, plus no tax rows), I9 and N1 (tool choice), and R6 (the object did not parse). The recorded 35 stands as what was measured that night; the 41 is what the same answers are worth under the rules that have applied since.

## What the columns mean

`called` the distinct tools the turn ran · `fallback` what the answer claimed (`none`, `widened`, `not_held`, `coming`) · `expected_fallback_as_recorded` what that run's grader accepted · `chip` the block the answer pointed at · `sources_ok` / `as_of_ok` the run's verdict (the source lists themselves were not kept in the eval documents) · `degraded` the model's object did not parse twice · `steps` model calls · `tools_ms` when the tool round was over · `first_token_ms` the first words of the sentence handed to the page · `ms` the whole answer · `recorded.tools_ok` / `recorded.fallback_ok` the verdicts as written that day.

## The 2026-11-09 run over HTTP

The first run made from this repo rather than from inside the app. `src/run.ts` posted each question to the app's ask route on the same laptop (`npm run dev`, site main 68c2c84), the app's tools read the live publication as a login that holds `explorer_public` only, and the answers were scored as they arrived. Same misses as the streaming run minus H10 (now a clean not-held answer with no tool) plus two: I6 (a not-held answer that never says "that's not something I have") and N7 (read `tax_bills` only, not `assessments`). Tokens and dollars are not on the wire, so those columns are empty; the app's own runner has them. The three questions sent first (H1–H3) carry the dev server's cold start (6.5–7.1 s); the warm numbers are given beside the raw ones.

## Not included

The 2026-11-06 turn-log run (TICKET-662), which ran against a local copy of the database with synthetic sales to prove transcript storage: its pass count is not comparable and it is left out.
