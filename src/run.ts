import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { quantile, reasons, score, type InventoryQuestion, type Pov } from "./grader.js";
import { allQuestions, loadInventory, ROOT, type Row, type Run } from "./records.js";

/* Run the fixture against a live agent and score it.

   The Keystone app's agent is reached over HTTP, the way its own ask box
   reaches it: POST <AGENT_URL> with `{ plan, messages }` and a device id
   header, answered as a UI message stream (Vercel AI SDK) whose parts are
   `data-status` (a tool just ran), `data-draft` (the sentence so far) and
   one `data-answer` (the validated answer). This is the only adapter today.
   There is no public endpoint: AGENT_URL is the app running on your own
   machine from its (private) repo, or an endpoint of your own that speaks
   this shape. See README, "Running it live".

     AGENT_URL=http://localhost:3000/api/ask npm run run -- --out results/local-<date>.json

   Each question is sent under a fresh device id, because the app allows a
   device 20 questions a minute and the fixture asks 49 in about two.
   Flags: --only H1,I4 · --no-cases (the 48 only) · --concurrency 3 ·
   --model <label> (for the record; the model is the endpoint's) · --out.
   The endpoint does not report tokens or cost: those columns stay empty
   over HTTP (the app's own runner, inside its repo, has them from the
   gateway). Timing: whole answer from request to the answer part; first
   token at the first non-empty draft; tools done at the last status part. */

const flag = (name: string): string | undefined => {
  const a = process.argv.slice(2); const i = a.findIndex(x => x === `--${name}` || x.startsWith(`--${name}=`));
  if (i < 0) return undefined; if (a[i].includes("=")) return a[i].slice(a[i].indexOf("=") + 1); return a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : "";
};

/* The app's default blocks per point of view (its lib/blocks/defaultPlans.ts): what is on screen when the question is asked. The shared top (photo, address, range) is always drawn and not listed. */
const DEFAULT_BLOCKS: Record<Pov, string[]> = {
  homeowner: [],
  investor: ["property_card", "owner_lock", "assessor_view", "tax_bills", "buyers_sample"],
  realtor: ["sales_map", "property_card", "tax_bills", "assessor_view"],
};

type Answer = { answer: string; sources: { label: string; data_as_of: string }[]; data_as_of: string; fallback: string; deep_link?: { block_id: string } };

async function askHttp(url: string, device: string, q: InventoryQuestion, subject: { address: string; parcelId: string }): Promise<{ answer: Answer | null; called: string[]; ms: number; firstTokenMs: number | null; toolsMs: number | null; refused?: string }> {
  const plan = { address: subject.address, parcelId: subject.parcelId, pov: q.pov, blocks: (q.pov ? DEFAULT_BLOCKS[q.pov] : []).map(id => ({ id, state: "expanded" })) };
  const body = { plan, messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: q.question }] }], session_id: randomUUID().replace(/-/g, ""), turn_id: randomUUID(), turn: 1 };
  const t0 = performance.now();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-kb-device": device, origin: new URL(url).origin }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) return { answer: null, called: [], ms: Math.round(performance.now() - t0), firstTokenMs: null, toolsMs: null, refused: `${r.status} ${(await r.text()).slice(0, 200)}` };
  const called: string[] = []; let answer: Answer | null = null; let firstTokenMs: number | null = null; let toolsMs: number | null = null;
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim(); if (payload === "[DONE]") continue;
      let part: { type?: string; data?: unknown }; try { part = JSON.parse(payload); } catch { continue; }
      if (part.type === "data-status") { toolsMs = Math.round(performance.now() - t0); called.push(String((part.data as { tool?: string })?.tool)); }
      else if (part.type === "data-draft" && firstTokenMs === null && (part.data as { text?: string })?.text) firstTokenMs = Math.round(performance.now() - t0);
      else if (part.type === "data-answer") answer = part.data as Answer;
    }
  }
  return { answer, called: [...new Set(called)], ms: Math.round(performance.now() - t0), firstTokenMs, toolsMs };
}

async function main() {
  const url = process.env.AGENT_URL;
  if (!url) throw new Error("AGENT_URL is not set. There is no public endpoint for the Keystone agent today; run the app locally or point this at an endpoint of your own that speaks its ask stream (README, \"Running it live\").");
  const inv = loadInventory();
  const only = flag("only")?.split(",").filter(Boolean);
  const queue = (process.argv.includes("--no-cases") ? inv.questions : allQuestions(inv)).filter(q => !only?.length || only.includes(q.id));
  /* A fresh device id per question: the app counts 20 questions a minute per device, and the fixture asks 49 in about two. */
  const device = () => `eval-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const concurrency = Number(flag("concurrency") ?? 3);
  const today = new Date().toISOString().slice(0, 10);
  const out = flag("out") ?? join(ROOT, "results", `local-${today}.json`);
  const rows: Row[] = [];
  const worker = async () => {
    for (;;) {
      const q = queue.shift(); if (!q) return;
      const p = inv.parcels[q.parcel];
      if (!p.address) throw new Error(`fixture parcel ${q.parcel} has no address`);
      const r = await askHttp(url, device(), q, { address: p.address, parcelId: p.id });
      const a = r.answer;
      const row: Row = {
        id: q.id, parcel: q.parcel, called: r.called,
        answer: a?.answer ?? (r.refused ? `(refused: ${r.refused})` : "(no answer part)"), fallback: a?.fallback ?? "none", chip: a?.deep_link?.block_id ?? null,
        sources: a?.sources ?? [], data_as_of: a?.data_as_of ?? "", degraded: !a,
        tools_ms: r.toolsMs, first_token_ms: r.firstTokenMs, ms: r.ms, tokens: null, usd: null,
      };
      rows.push(row);
      const v = score(q, row, inv.parcels[q.parcel].range);
      console.log(`${q.id.padEnd(4)} ${v.pass ? "pass" : "FAIL"}  first ${String(r.firstTokenMs ?? "n/a").padStart(5)} ms  ${String(r.ms).padStart(6)} ms  ${r.called.join(",") || "no tool"}${v.pass ? "" : `  (${reasons(q, row, v).join("; ")})`}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const order = new Map(allQuestions(inv).map((q, i) => [q.id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const run: Run = { run: `local-${today}`, label: `local run over HTTP against ${new URL(url).host}`, model: flag("model") ?? "(the endpoint's model)", questions: rows.length, grader_version: "current", concurrency, timed_from: "this machine", rows };
  mkdirSync(join(ROOT, "results"), { recursive: true });
  writeFileSync(out, JSON.stringify(run, null, 1));
  const scored = rows.map(row => ({ row, v: score(allQuestions(inv).find(q => q.id === row.id) as InventoryQuestion, row, inv.parcels[row.parcel].range) }));
  const ms = rows.map(r => r.ms).filter((v): v is number => v !== null), first = rows.map(r => r.first_token_ms).filter((v): v is number => typeof v === "number");
  console.log(`\n${scored.filter(s => s.v.pass).length} / ${rows.length} fully pass · whole p50 ${quantile(ms, 0.5)} ms p95 ${quantile(ms, 0.95)} ms · first token p50 ${quantile(first, 0.5)} ms · cost n/a over HTTP · ${out}`);
  console.log(`score it again any time: npm run score -- ${out}`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
