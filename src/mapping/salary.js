// Salary pipeline — read-plumbing + a STUBBED formatter.
//
// The connector reads the five source values (disclose flag, min, max, currency, period)
// off the normalized job and passes them to formatSalary(). formatSalary is INTENTIONALLY
// stubbed: it returns null until the salary format spec is reconciled and signed off
// (Omar mapping-spec.md §6 vs Yusra's brief — see the reconciliation pack in Team Updates).
//
// Founder rule #5 (fail closed, not fail silent): while stubbed, the Webflow Salary field
// is left EMPTY for every role. No salary string is ever guessed or written. When the
// reconciled format is signed off, implement formatSalary() and mapJob will populate
// FIELD_SLUGS.salary automatically — no other wiring required.

/**
 * Collect the salary source values off a normalized job into a single object.
 * @param {object} job - a normalized RecruitCrmJob (see client.normalizeJob)
 */
export function salaryInputs(job) {
  return {
    disclosed: job?.salaryDisclosed === true,
    min: job?.salaryMin ?? null,
    max: job?.salaryMax ?? null,
    currency: job?.salaryCurrency ?? null,
    period: job?.salaryPeriod ?? null,
  };
}

/**
 * Format the salary display string for the Webflow Salary field.
 *
 * STUB — do not implement until the reconciled format is signed off (reconciliation pack
 * points #3 format, #4 not-disclosed handling, #5 bonus). Returning null leaves the field
 * empty (fail-closed). When signed, implement the agreed format here.
 *
 * @returns {string|null} the display string, or null to leave the field empty
 */
// eslint-disable-next-line no-unused-vars
export function formatSalary(inputs) {
  return null;
}
