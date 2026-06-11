import { test } from "node:test";
import assert from "node:assert/strict";

import { RunReport } from "../src/lib/logger.js";

test("RunReport.summary() counts held jobs (unresolved Options) separately from benign skips", () => {
  const r = new RunReport();
  r.recordCreated("1", "item1");
  r.recordUpdated("2", "item2", ["name"]);
  // A genuine hold: a required Option could not be resolved.
  r.recordSkipped("34", {
    unmapped: [{ field: "practice-setting", raw: "(not set in RecruitCRM)" }],
    findings: [],
  });
  // A benign skip: nothing changed this cycle. NOT a hold.
  r.recordSkipped("9", { reason: "no changes" });

  const s = r.summary();
  assert.equal(s.skipped, 2, "both skips still counted in skipped");
  assert.equal(s.held, 1, "only the unmapped skip is a hold");
  assert.equal(s.details.held.length, 1);
  assert.equal(s.details.held[0].jobId, "34");
  assert.equal(s.details.held[0].reason.unmapped[0].field, "practice-setting");
});

test("RunReport.summary() reports zero held when only benign skips occur", () => {
  const r = new RunReport();
  r.recordSkipped("9", { reason: "no changes" });
  r.recordSkipped("10", { reason: "no changes" });

  const s = r.summary();
  assert.equal(s.skipped, 2);
  assert.equal(s.held, 0, "a quiet sync must not be flagged as held");
  assert.equal(s.details.held.length, 0);
});

test("RunReport.summary() counts every unresolved-Option skip as held", () => {
  const r = new RunReport();
  r.recordSkipped("34", { unmapped: [{ field: "practice-setting", raw: "" }], findings: [] });
  r.recordSkipped("35", { unmapped: [{ field: "location", raw: "Mars" }], findings: [] });

  const s = r.summary();
  assert.equal(s.held, 2);
  assert.deepEqual(s.details.held.map((h) => h.jobId).sort(), ["34", "35"]);
});

test("RunReport: a hold ONLY on full-description is backlog, not actionable", () => {
  const r = new RunReport();
  r.recordSkipped("30", {
    unmapped: [{ field: "full-description", raw: "description did not contain all three required headings" }],
    findings: [],
  });

  const s = r.summary();
  assert.equal(s.held, 1);
  assert.equal(s.heldActionable, 0, "description-only hold must not be actionable");
  assert.equal(s.heldBacklog, 1);
  assert.equal(s.details.heldActionable.length, 0);
});

test("RunReport: a hold on practice-setting is actionable (even alongside a backlog field)", () => {
  const r = new RunReport();
  // Blank PP/In-House dropdown — the signal we DO want to fail/email on.
  r.recordSkipped("40", { unmapped: [{ field: "practice-setting", raw: "(not set in RecruitCRM)" }], findings: [] });
  // Held on both a backlog field and an actionable one — still actionable.
  r.recordSkipped("41", {
    unmapped: [
      { field: "full-description", raw: "headings" },
      { field: "location", raw: "" },
    ],
    findings: [],
  });
  // Pure backlog — not actionable.
  r.recordSkipped("42", { unmapped: [{ field: "full-description", raw: "headings" }], findings: [] });

  const s = r.summary();
  assert.equal(s.held, 3);
  assert.equal(s.heldActionable, 2, "practice-setting and location holds are actionable");
  assert.equal(s.heldBacklog, 1, "the description-only hold is backlog");
  assert.deepEqual(s.details.heldActionable.map((h) => h.jobId).sort(), ["40", "41"]);
});
