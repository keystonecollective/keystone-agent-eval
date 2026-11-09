# keystone-agent-eval

The eval for the Keystone property agent: the ask box on a St. Louis property page that answers questions like "What's my house worth?", "Are they behind on taxes?" or "Who owns it?" from the public record and nothing else. This repo holds the **fixture** (48 questions, written the way homeowners, investors, realtors, buyers and neighbors actually ask them, on four public parcels), the **grader** (what counts as a pass), the **recorded runs** with their numbers, and a plain account of **what the agent gets wrong**.

It is published so that anyone can read the questions, check the grading rules, re-score the recorded answers, and see the misses without taking our word for it. The agent itself (its prompt, its six tools, the database reader) lives in a private repo and is not here; the README says exactly what you can and cannot run today.

## What is here

```
fixture/inventory.json   48 questions + 1 added case, 4 parcels, expected tools and fallbacks
src/grader.ts            the scoring rules, pure functions
src/score.ts             re-score a recorded run (no key, no network)
src/run.ts               run the fixture against a live agent over HTTP (see "Running it live")
results/                 the recorded runs as JSON, one row per question, and their summary tables
tests/                   the grader's tests, including "the recorded runs re-score to their recorded verdicts"
```

## Results

Model `anthropic/claude-sonnet-5.5` through the Vercel AI Gateway, tools reading the live publication `2026-11-05.2`; timed from a laptop in St. Louis, three questions at a time; dollars as the gateway reported them. Full tables and the column key: [`results/README.md`](results/README.md).

| Run | Pass rate | Whole answer p50 / p95 | First token p50 / p95 | Cost per answer | Cost, 48 |
|---|---|---|---|---|---|
| 2026-11-05 — first eval | 35 / 48 (41 / 48 with the current grader) | 5,773 / 11,003 ms | not measured | $0.0176 | $0.84 |
| 2026-11-06 — one tool round, trimmed results | **44 / 48** | 3,147 / 5,344 ms | 3,138 / 5,333 ms | $0.0048 | $0.23 |
| 2026-11-06 — first sentence streamed | **45 / 48** (46 / 49 with case L1) | 2,473 / 4,054 ms | 1,694 / 3,356 ms | $0.0046 | $0.23 |

Every number above is reproduced by `npm run score:all` from the JSON in `results/`.

## What it gets wrong

Each miss is graded on the fixture's expectations, mostly **which tool the agent chose**; the answers themselves were honest. Read them and decide whether the grader or the agent is right.

**The four misses of 2026-11-06 (44 / 48):**

- **H4** "How does mine compare to the one that sold down the street?" (452 Magnolia Ave, Kirkwood, a County parcel typed vacant land): called `get_record` and `sales_by_area`, not `get_range`; said fallback `none` where the fixture wants `widened` for a parcel with no single-family range. The street search also returned City "Magnolia Ave" sales miles away, which the agent noticed and said. A typing problem in the data (the crosswalk calls it vacant) more than a reasoning one.
- **H5** "Is that my house? That's pointing at my neighbor.": called no tool and told the person to type their address; the fixture expects `resolve_address`.
- **H10** "Who'd buy a house like mine?": gave the right not-held line, but read the property record first; the fixture expects no tool.
- **I3** "How long have they owned it?": gave the not-held line with no tool; the fixture expects `get_record`, whose last sale date is the only legitimate hint.

**The three misses of the streaming run (45 / 48):** H4, H10 and I3 again, for the same reasons. H5 now passes: it read `get_record`, answered, and logged the photo complaint as an issue.

**The slow one.** N7, "Why are my neighbor's taxes lower than mine?", is the slowest tool round in both 2026-11-06 runs: 5,607 ms and 5,501 ms whole, with the first token at 4,438 ms in the streaming run. Two tools (`tax_bills` and `assessments`) that answer in a few hundred milliseconds together; most of the time is the model's first step choosing them. It passed both times. The project's decision log calls this "the 7-second outlier"; the tables say 5.5–5.6 s, and the one 7.9 s row in the 665 run was R1 ("What does the public record say: beds, baths, sq ft, year built?"), a one-off wait on the gateway side.

**The first run (35 / 48)** had thirteen misses under the stricter rules of the day: extra tool calls counted against the answer, and "widened" had fewer accepted wordings. Six of those thirteen pass under today's rules; the seven that still fail are three not-held answers that never used the phrase "that's not something I have", one that also had no tax rows to show, two tool-choice misses, and one answer whose object did not parse (the person saw "I didn't catch that one. Mind asking it another way?"). Details in [`results/README.md`](results/README.md).

## Running it

### Re-score the recorded runs (anyone, no key)

```
npm install
npm run score:all          # the three runs, checked against their recorded verdicts
npm run score -- results/2026-11-06-streaming.json
npm test
```

Node 22 or newer. `score` prints each run's summary, a per-question table and the misses with the grader's reason for each.

### Running it live

`src/run.ts` runs the fixture against an agent that speaks the Keystone app's ask stream: `POST $AGENT_URL` with `{ plan, messages }` and an `x-kb-device` header, answered as a Vercel AI SDK UI message stream whose parts are `data-status` (a tool ran), `data-draft` (the sentence so far) and one `data-answer` (the validated answer object). It scores each answer as it arrives and writes a results file in the same shape as `results/*.json`.

```
AGENT_URL=http://localhost:3000/api/ask npm run run -- --out results/local-$(date +%F).json
```

**There is no public endpoint today**, so a stranger cannot run the live eval from this README alone. What it would take:

1. **The agent.** Its prompt, six tools and answer parser are in the app's private repo (the app runs locally with `npm run dev`, and `AGENT_URL` above is that). A hosted eval endpoint that speaks the stream, with its own gateway key and a rate limit, would remove this step; so would publishing the agent module.
2. **A public read-only `pub` reader.** The tools read the published property record as a database role that can only `SELECT` the `pub` views (`explorer_public`). That role exists; a pooled, rate-limited connection string for it has not been published. Until it is, the tools reach the database only from the app's own deployment or a local copy.
3. **A model key.** Your own Vercel AI Gateway key (or any provider the agent is pointed at); the recorded runs cost $0.23 for 48 questions on Sonnet 5.5.

Over HTTP the runner records tools, fallback, sentence, chip, sources, data-as-of and timings; tokens and dollars are not on the wire, so those columns stay empty (the app's own runner, inside its repo, has them from the gateway).

## How grading works

For each question the fixture names the tools expected (`tools`, and `alt_tools` for other sets that answer it), the fallbacks accepted (`none`, `widened`, `not_held`, `coming`; `range` means "whatever this parcel's range case implies"), and the parcel on screen. An answer passes when every tool of one accepted set was called (one more than expected is fine; a question that expects none must call none), it carries at least one source and a data-as-of date, its fallback is accepted for that parcel and worded the way the page recognises (`that's not something I have`, `that's coming`, a widened range says so), and, for added cases, the chip points at the named block and the sentence contains none of the forbidden claims (L1: "Who owns this?" must never say who). The rules are at the top of [`src/grader.ts`](src/grader.ts) and in the fixture's `_about`.

## Not yet in the harness

Two tasks are named and not built:

- **Address-resolution accuracy.** A set of addresses as people type them (misspelt, missing the direction, unit numbers, "the corner of") against the parcel each should resolve to, scored exact / wrong / none. Today the eval only checks that `resolve_address` was called when it should be.
- **Comp accuracy against the 575 set.** Ten St. Louis sales whose price and date are known for certain (the project's comps review, TICKET-575) against the agent's range for each, scored by whether the sale falls inside the range and how wide the range was. Today the eval checks the range's fallback, not its number.

## Not here, on purpose

No secrets, no production URL, no owner data, no site source beyond what the grader needs. The fixture's four parcels are public addresses; the recorded answers contain no owner names because the agent cannot read ownership.

## License

MIT.
