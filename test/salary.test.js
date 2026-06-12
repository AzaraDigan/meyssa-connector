import { test } from "node:test";
import assert from "node:assert/strict";

import { salaryInputs, formatSalary } from "../src/mapping/salary.js";

// Scaffolding for the salary pipeline. formatSalary is STUBBED (returns null) until the
// format spec is reconciled and signed off. These tests lock in the fail-closed behaviour
// now, and are the home for the formatted-output assertions once the spec lands (TODOs).

const disclosedRole = {
  salaryDisclosed: true,
  salaryMin: 200000,
  salaryMax: 250000,
  salaryCurrency: "USD",
  salaryPeriod: "Annual",
};

const confidentialRole = {
  salaryDisclosed: false,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
};

test("salaryInputs collects the five source values off a job", () => {
  assert.deepEqual(salaryInputs(disclosedRole), {
    disclosed: true, min: 200000, max: 250000, currency: "USD", period: "Annual",
  });
  assert.deepEqual(salaryInputs(confidentialRole), {
    disclosed: false, min: null, max: null, currency: null, period: null,
  });
});

test("formatSalary is stubbed → null for BOTH disclosed and confidential (fail-closed)", () => {
  // Until the reconciled spec is signed off, nothing is written for either case.
  assert.equal(formatSalary(salaryInputs(disclosedRole)), null);
  assert.equal(formatSalary(salaryInputs(confidentialRole)), null);

  // TODO(post-sign-off): replace these with the agreed format, e.g.
  //   disclosed    -> "USD 200,000 - 250,000 per year"   (exact per reconciliation #3)
  //   confidential -> null (field empty; template renders the discretion line, per #4)
});
