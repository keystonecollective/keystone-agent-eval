import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { expectedFallbacks, fallbackWordingOk, neverOk, toolsOk } from "../src/grader.js";
import { loadInventory, loadRun, ROOT, scoreRun } from "../src/records.js";

const inv = loadInventory();
const misses = (file: string) => scoreRun(inv, loadRun(join(ROOT, "results", file))).filter(s => !s.v.pass).map(s => s.q.id);

test("the fixture is the 48 inventory questions plus the added cases, on five public parcels", () => {
  assert.equal(inv.questions.length, 48);
  assert.deepEqual(Object.keys(inv.parcels).sort(), ["kirkwood", "lasalle", "miami", "tesson", "tholozan"]);
  for (const q of [...inv.questions, ...(inv.cases ?? [])]) assert.ok(inv.parcels[q.parcel], `${q.id} names parcel ${q.parcel}`);
});

test("tools: one accepted set, extra calls allowed, none means none", () => {
  const q = { tools: ["tax_bills", "sales_by_area"] as const, alt_tools: [["tax_bills"]] as const };
  assert.ok(toolsOk({ tools: [...q.tools], alt_tools: q.alt_tools.map(s => [...s]) }, ["tax_bills"]));
  assert.ok(toolsOk({ tools: [...q.tools] }, ["tax_bills", "sales_by_area", "get_record"]));
  assert.ok(!toolsOk({ tools: [...q.tools] }, ["tax_bills"]));
  assert.ok(toolsOk({ tools: [] }, []));
  assert.ok(!toolsOk({ tools: [] }, ["get_record"]));
});

test("fallback: range is per parcel, and get_range on an odd parcel may say widened", () => {
  assert.deepEqual(expectedFallbacks({ fallback: ["range"] }, "ok", ["get_range"]), ["none"]);
  assert.deepEqual(expectedFallbacks({ fallback: ["range"] }, "class_mismatch", []), ["widened"]);
  assert.deepEqual(expectedFallbacks({ fallback: ["none"] }, "widened", ["get_range"]), ["none", "widened"]);
  assert.ok(fallbackWordingOk({ answer: "That's not something I have.", fallback: "not_held" }));
  assert.ok(!fallbackWordingOk({ answer: "I don't hold that.", fallback: "not_held" }));
  assert.ok(!fallbackWordingOk({ answer: "Something went wrong.", fallback: "none" }));
});

test("never: an ownership claim fails L1", () => {
  const l1 = inv.cases?.find(q => q.id === "L1");
  assert.ok(l1);
  assert.ok(!neverOk(l1, "It's owned by a trust."));
  assert.ok(neverOk(l1, "That's not something I have."));
});

test("2026-11-06 (TICKET-665): 44 / 48, misses H4 H5 H10 I3", () => {
  assert.deepEqual(misses("2026-11-06.json"), ["H4", "H5", "H10", "I3"]);
});

test("2026-11-06 streaming (TICKET-659b): 46 / 49, misses H4 H10 I3; L1 passes", () => {
  assert.deepEqual(misses("2026-11-06-streaming.json"), ["H4", "H10", "I3"]);
});

test("2026-11-09 over HTTP (this repo's runner): 45 / 49, misses H4 I3 I6 N7", () => {
  assert.deepEqual(misses("2026-11-09-http.json"), ["H4", "I3", "I6", "N7"]);
});

test("2026-11-10 over HTTP (TICKET-677, eight tools): 49 / 53, misses H4 H7 I3 B8; the four new cases pass", () => {
  assert.deepEqual(misses("2026-11-10-http.json"), ["H4", "H7", "I3", "B8"]);
});

test("2026-11-11 over HTTP (after 683 and 684, publication 2026-11-10.2): 50 / 53, misses H4 I3 I6", () => {
  assert.deepEqual(misses("2026-11-11-http.json"), ["H4", "I3", "I6"]);
});

test("2026-11-05 (TICKET-657, older rules): recorded 35 / 48; the current grader passes 41 / 48 (results/README.md)", () => {
  assert.deepEqual(misses("2026-11-05.json"), ["I3", "I6", "I9", "R6", "R8", "B8", "N1"]);
});
