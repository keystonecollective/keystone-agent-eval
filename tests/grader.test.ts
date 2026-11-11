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

test("2026-11-11 over HTTP with the second range live (TICKET-682): 51 / 57, misses H4 H7 I3 I6 B1 B8; S1 to S4 pass", () => {
  assert.deepEqual(misses("2026-11-11-http-second-range.json"), ["H4", "H7", "I3", "I6", "B1", "B8"]);
});

test("2026-11-11 over HTTP after the agent fix (TICKET-682): 54 / 57, misses H4 I3 I6", () => {
  assert.deepEqual(misses("2026-11-11-http-agent-fix.json"), ["H4", "I3", "I6"]);
});

test("2026-11-05 (TICKET-657, older rules): recorded 35 / 48; the current grader passes 41 / 48 (results/README.md)", () => {
  assert.deepEqual(misses("2026-11-05.json"), ["I3", "I6", "I9", "R6", "R8", "B8", "N1"]);
});

test("TICKET-682: four second-range cases on the five parcels already named; the never rules catch an accuracy claim and 'an appraisal' but not 'not an appraisal'", () => {
  const cases = (inv.cases ?? []).filter(q => /^S[1-4]$/.test(q.id));
  assert.deepEqual(cases.map(q => q.id), ["S1", "S2", "S3", "S4"]);
  assert.deepEqual(Object.keys(inv.parcels).sort(), ["kirkwood", "lasalle", "miami", "tesson", "tholozan"], "decision 218f: no new address");
  for (const q of cases) assert.deepEqual(q.tools, ["get_range"]);
  assert.deepEqual(cases.map(q => q.chip), ["blend_range", "blend_range", "blend_range", undefined]);
  const [s1, , , s4] = cases;
  assert.ok(neverOk(s1, "The Keystone estimate is $251,000 to $308,000: recorded sales nearby blended with the City Assessor's appraised value (file dated October 14, 2026), not an appraisal. The sales range is $253,000 to $311,000."));
  assert.ok(neverOk(s4, "There's no range for this parcel, so there's no second number either: it's listed as vacant land and the nearby sales on file are single-family homes."));
  for (const bad of ["It's 90% accurate.", "The Keystone estimate is an appraisal of $276,000.", "Take the average of the two ranges.", "The second one is the better number.", "It is accurate to within a few thousand."]) assert.ok(!neverOk(s1, bad), bad);
  assert.ok(!neverOk(s4, "The Keystone estimate is $180,000 to $260,000."), "S4: no second number may be stated");
});
