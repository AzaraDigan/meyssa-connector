import { test } from "node:test";
import assert from "node:assert/strict";

import { salaryInputs, formatSalary, structuredSalary } from "../src/mapping/salary.js";

// Signed-off salary format (Azara, 12 Jun 2026): period-aware, three cases, fail-closed.

test("salaryInputs collects the five source values off a job", () => {
  assert.deepEqual(
    salaryInputs({
      salaryDisclosed: true, salaryMin: 200000, salaryMax: 250000,
      salaryCurrency: "USD", salaryPeriod: "Annual",
    }),
    { disclosed: true, min: 200000, max: 250000, currency: "USD", period: "Annual" },
  );
});

test("formatSalary case 2 — disclosed band with a real max → range, period-aware", () => {
  assert.equal(
    formatSalary({ disclosed: true, min: 200000, max: 250000, currency: "USD", period: "Annual" }),
    "USD 200,000 - 250,000 per year",
  );
  assert.equal(
    formatSalary({ disclosed: true, min: 50000, max: 65000, currency: "AED", period: "Monthly" }),
    "AED 50,000 - 65,000 per month",
  );
});

test("formatSalary case 1 — Max = 5,000,000 sentinel → open-ended +", () => {
  assert.equal(
    formatSalary({ disclosed: true, min: 200000, max: 5000000, currency: "USD", period: "Annual" }),
    "USD 200,000+ per year",
  );
  assert.equal(
    formatSalary({ disclosed: true, min: 50000, max: 5000000, currency: "AED", period: "Monthly" }),
    "AED 50,000+ per month",
  );
});

test("formatSalary case 3 — not disclosed (or flag empty) → negotiable line", () => {
  assert.equal(formatSalary({ disclosed: false }), "Negotiable");
  assert.equal(
    formatSalary({ disclosed: false, min: 200000, max: 250000, currency: "USD", period: "Annual" }),
    "Negotiable",
  );
  assert.equal(formatSalary({}), "Negotiable");
  assert.equal(formatSalary(null), "Negotiable");
});

test("formatSalary fail-closed — disclosed but data missing/invalid → null", () => {
  const base = { disclosed: true, min: 200000, max: 250000, currency: "USD", period: "Annual" };
  assert.equal(formatSalary({ ...base, currency: null }), null, "missing currency");
  assert.equal(formatSalary({ ...base, min: null }), null, "missing min");
  assert.equal(formatSalary({ ...base, min: 0 }), null, "min must be > 0");
  assert.equal(formatSalary({ ...base, period: "Weekly" }), null, "unrecognised period");
  assert.equal(formatSalary({ ...base, period: null }), null, "missing period");
  assert.equal(formatSalary({ ...base, max: 100000 }), null, "max below min");
  assert.equal(formatSalary({ ...base, max: null }), null, "max missing and not the sentinel");
});

test("formatSalary tolerates currency whitespace and period casing", () => {
  assert.equal(
    formatSalary({ disclosed: true, min: 110000, max: 5000000, currency: " GBP ", period: "annual" }),
    "GBP 110,000+ per year",
  );
});

// Structured salary (v2) — the JobPosting baseSalary parts. Same gates as formatSalary,
// period returned as schema.org unitText "MONTH" / "YEAR". Fail-closed → all-null.

const ALL_NULL = { min: null, max: null, currency: null, period: null };

test("structuredSalary case 2 — disclosed range → numeric parts + unitText", () => {
  assert.deepEqual(
    structuredSalary({ disclosed: true, min: 50000, max: 70000, currency: "AED", period: "Monthly" }),
    { min: 50000, max: 70000, currency: "AED", period: "MONTH" },
  );
  assert.deepEqual(
    structuredSalary({ disclosed: true, min: 200000, max: 250000, currency: "USD", period: "Annual" }),
    { min: 200000, max: 250000, currency: "USD", period: "YEAR" },
  );
});

test("structuredSalary case 1 — sentinel max → min only, never the sentinel number", () => {
  assert.deepEqual(
    structuredSalary({ disclosed: true, min: 50000, max: 5000000, currency: "AED", period: "Monthly" }),
    { min: 50000, max: null, currency: "AED", period: "MONTH" },
  );
});

test("structuredSalary case 3 — not disclosed → all null (embed omits baseSalary)", () => {
  assert.deepEqual(structuredSalary({ disclosed: false }), ALL_NULL);
  assert.deepEqual(
    structuredSalary({ disclosed: false, min: 50000, max: 70000, currency: "AED", period: "Monthly" }),
    ALL_NULL,
  );
  assert.deepEqual(structuredSalary({}), ALL_NULL);
  assert.deepEqual(structuredSalary(null), ALL_NULL);
});

test("structuredSalary fail-closed — disclosed but data missing/invalid → all null", () => {
  const base = { disclosed: true, min: 50000, max: 70000, currency: "AED", period: "Monthly" };
  assert.deepEqual(structuredSalary({ ...base, currency: null }), ALL_NULL, "unmapped currency");
  assert.deepEqual(structuredSalary({ ...base, min: null }), ALL_NULL, "missing min");
  assert.deepEqual(structuredSalary({ ...base, min: 0 }), ALL_NULL, "min must be > 0");
  assert.deepEqual(structuredSalary({ ...base, period: "Weekly" }), ALL_NULL, "unrecognised period");
  assert.deepEqual(structuredSalary({ ...base, period: null }), ALL_NULL, "missing period");
  assert.deepEqual(structuredSalary({ ...base, max: 40000 }), ALL_NULL, "max below min");
  assert.deepEqual(structuredSalary({ ...base, max: null }), ALL_NULL, "max missing and not the sentinel");
});

test("structuredSalary mirrors formatSalary's gates for disclosed roles", () => {
  // Where formatSalary returns a string, structuredSalary is populated; where formatSalary
  // returns null (disclosed-but-invalid), structuredSalary is all-null. (The not-disclosed
  // case is the one deliberate divergence: "Negotiable" string vs empty structured.)
  const disclosedCases = [
    { disclosed: true, min: 50000, max: 70000, currency: "AED", period: "Monthly" },
    { disclosed: true, min: 50000, max: 5000000, currency: "AED", period: "Monthly" },
    { disclosed: true, min: 50000, max: 40000, currency: "AED", period: "Monthly" },
    { disclosed: true, min: 0, max: 70000, currency: "AED", period: "Monthly" },
    { disclosed: true, min: 50000, max: 70000, currency: null, period: "Monthly" },
  ];
  for (const c of disclosedCases) {
    const parts = structuredSalary(c);
    const partsEmpty = parts.min === null && parts.currency === null && parts.period === null;
    assert.equal(partsEmpty, formatSalary(c) === null, JSON.stringify(c));
  }
});

test("structuredSalary tolerates currency whitespace and period casing", () => {
  assert.deepEqual(
    structuredSalary({ disclosed: true, min: 110000, max: 5000000, currency: " GBP ", period: "annual" }),
    { min: 110000, max: null, currency: "GBP", period: "YEAR" },
  );
});
