// Salary pipeline — read-plumbing + the signed-off formatter.
//
// Reconciles Yusra's brief and Omar's mapping-spec.md §6; signed off by Azara (12 Jun 2026).
// The connector writes a single formatted string into the Webflow "Salary" plain-text field.
//
// Founder rule #5 (fail closed, not fail silent): when a DISCLOSED role is missing the data
// needed to format (currency / a positive min / a recognised period), formatSalary returns
// null and mapJob leaves the Salary field empty + logs a warning. No value is ever guessed.

// "No max disclosed" is signalled by this sentinel in the Max Salary field.
const NO_MAX_SENTINEL = 5000000;

// Salary Period → display suffix. Aliased for tolerance; canonical values are Annual/Monthly.
const PERIOD_LABEL = {
  annual: "per year", annually: "per year", yearly: "per year", year: "per year",
  monthly: "per month", month: "per month",
};

// Thousands separators for integers, no locale/ICU dependency: 200000 -> "200,000".
function formatThousands(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

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
 * Format the Salary display string (signed-off spec, period-aware).
 *
 *   1. Disclosed + Max === 5,000,000 sentinel  -> "[Cur] [Min]+ per [period]"
 *   2. Disclosed + real Max                     -> "[Cur] [Min] - [Max] per [period]"
 *   3. Not disclosed (or flag empty)            -> "Package negotiable"
 *
 * The surfaces (card / detail page) add their own "Salary:" label; this returns the value only.
 *
 * Fail-closed: a disclosed role with missing/invalid currency, min, period, or a malformed
 * max returns null (mapJob leaves the field empty + warns). Never guesses.
 *
 * @returns {string|null} the display string, or null to leave the field empty
 */
export function formatSalary(inputs) {
  // Case 3: not disclosed -> a deliberate negotiable value (not empty).
  if (!inputs || inputs.disclosed !== true) return "Package negotiable";

  const { min, max, currency, period } = inputs;
  const periodLabel = PERIOD_LABEL[String(period ?? "").trim().toLowerCase()];
  const cur = typeof currency === "string" ? currency.trim() : "";
  const minOk = Number.isInteger(min) && min > 0;

  // Fail-closed on missing/invalid disclosed data.
  if (!cur || !periodLabel || !minOk) return null;

  // Case 1: no max disclosed (sentinel) -> open-ended "[Min]+".
  if (max === NO_MAX_SENTINEL) {
    return `${cur} ${formatThousands(min)}+ ${periodLabel}`;
  }

  // Case 2: a real max -> range. A malformed max (non-integer or below min) fails closed.
  if (!Number.isInteger(max) || max < min) return null;
  return `${cur} ${formatThousands(min)} - ${formatThousands(max)} ${periodLabel}`;
}
