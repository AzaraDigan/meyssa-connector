import { test } from "node:test";
import assert from "node:assert/strict";

import { salaryInputs, formatSalary } from "../src/mapping/salary.js";

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
