// Orchestrator: turn one RecruitCrmJob into Webflow fieldData (keyed by field slug),
// plus a list of review flags. Pure function, no API calls, so it is testable.
//
// Returns { fieldData, unmapped, findings }:
//   - fieldData: the object to send to Webflow as fieldData on a draft item.
//   - unmapped:  required Option fields that could not be resolved (human must set).
//   - findings:  brand-voice findings to surface in review.
//
// Hard rules enforced here:
//   - confidential is always true.
//   - client-name is always a generic descriptor, never the real company name.
//   - status is always Active on first sync.

import { FIELD_SLUGS } from "../config/webflow.js";
import {
  LOCATION, PRACTICE_SETTING, PRACTICE_AREA, SENIORITY, EMPLOYMENT_TYPE, STATUS,
  DEFAULTS, resolveOption, resolveOptionLoose,
} from "../config/options.js";
import {
  normaliseLocation, buildSlug, stripTitle, parsePqe, validThroughFrom, buildOverview,
} from "./transforms.js";
import { inferPracticeArea, inferSeniority } from "./infer.js";
import { parseSections, buildFullDescriptionHtml } from "./description.js";

// Generic, anonymised client descriptor by practice setting, used only when the
// recruiter has not supplied an explicit "Client Descriptor" custom field. Never
// the real client name (hard rule). Wording is a brand decision; refine with Yusra.
function descriptorForSetting(setting) {
  if (setting === "Private Practice") return "A leading international law firm";
  if (setting === "In-House") return "A leading regional business";
  return "A leading international law firm";
}

export function mapJob(job, opts = {}) {
  const unmapped = [];
  const findings = [];

  const roleTitle = stripTitle(job.title);
  const pqe = parsePqe(job.title) ?? { min: job.pqeMin ?? null, max: job.pqeMax ?? null };

  // For each Option we prefer an explicit value the recruiter recorded in RecruitCRM
  // (job.practiceArea / job.seniority / job.practiceSetting), and fall back to
  // inference only when it is absent. resolveOptionLoose tolerates casing.
  const locationLabel = normaliseLocation(job.locationText);
  const locationId = resolveOption(LOCATION, locationLabel);
  if (!locationId) unmapped.push({ field: "location", raw: job.locationText });

  // Option A (no-default): practice-setting comes ONLY from the explicit RecruitCRM
  // "PP/In-House" dropdown. We never infer it. An absent or unrecognised value is held
  // (added to unmapped) so the sync skips and flags the job rather than guessing
  // In-House — the old default silently overwrote manual corrections on re-sync.
  const practiceSettingLabel = job.practiceSetting;
  const practiceSettingId = resolveOptionLoose(PRACTICE_SETTING, practiceSettingLabel);
  if (!practiceSettingId) unmapped.push({ field: "practice-setting", raw: job.practiceSetting ?? "(not set in RecruitCRM)" });

  const practiceAreaLabel = job.practiceArea ?? inferPracticeArea(job.title, job.description);
  const practiceAreaId = resolveOptionLoose(PRACTICE_AREA, practiceAreaLabel);
  if (!practiceAreaId) unmapped.push({ field: "practice-area", raw: job.practiceArea ?? "(could not infer from description)" });

  const seniorityLabel = job.seniority ?? inferSeniority(job.title, pqe);
  const seniorityId = resolveOptionLoose(SENIORITY, seniorityLabel);
  if (!seniorityId) unmapped.push({ field: "seniority", raw: job.seniority ?? job.title });

  const employmentId = resolveOptionLoose(EMPLOYMENT_TYPE, job.jobType) ?? resolveOption(EMPLOYMENT_TYPE, DEFAULTS.employmentType);

  const statusId = resolveOption(STATUS, DEFAULTS.status);

  // Client descriptor: explicit field wins, else a generic per-setting default.
  const clientDescriptor = opts.clientDescriptor ?? job.clientDescriptor ?? descriptorForSetting(practiceSettingLabel);

  // Description: parse into sections, then assemble the exact required HTML.
  const sections = parseSections(job.description);
  if (!sections.complete) {
    unmapped.push({ field: "full-description", raw: "description did not contain all three required headings" });
  }
  const fullDescription = buildFullDescriptionHtml(sections);

  const postedDate = job.createdDate ? new Date(job.createdDate).toISOString() : null;
  const validThrough = postedDate ? validThroughFrom(postedDate) : null;

  const fieldData = {
    [FIELD_SLUGS.name]: roleTitle,
    [FIELD_SLUGS.slug]: buildSlug(job.id, roleTitle),
    [FIELD_SLUGS.jobId]: String(job.id),
    [FIELD_SLUGS.applyUrl]: job.applySlug ? `https://recruitcrm.io/apply/${job.applySlug}` : "",
    [FIELD_SLUGS.location]: locationId,
    [FIELD_SLUGS.practiceSetting]: practiceSettingId,
    [FIELD_SLUGS.practiceArea]: practiceAreaId,
    [FIELD_SLUGS.seniority]: seniorityId,
    [FIELD_SLUGS.employmentType]: employmentId,
    [FIELD_SLUGS.status]: statusId,
    [FIELD_SLUGS.pqeMin]: pqe.min,
    [FIELD_SLUGS.pqeMax]: pqe.max,
    [FIELD_SLUGS.postedDate]: postedDate,
    [FIELD_SLUGS.validThrough]: validThrough,
    [FIELD_SLUGS.confidential]: true, // hard rule: always true
    [FIELD_SLUGS.clientName]: clientDescriptor, // hard rule: never the real client name
    [FIELD_SLUGS.fullDescription]: fullDescription,
  };

  // Overview (the listing-card subtitle) comes from the dedicated "Listing Snippet" section,
  // NOT the Role Overview (which remains the opening of the detail page via full-description).
  // Fail-closed (founder rule #5): if the snippet is missing, do NOT guess from the role
  // overview or raw description. Omit Overview — so on update an existing value is preserved
  // (not blanked) — and log a warning. Overview is a required Webflow field, so a brand-new
  // role with no snippet will fail to create until one is added; existing roles are untouched.
  if (sections.listingSnippet && sections.listingSnippet.trim()) {
    const overviewResult = buildOverview(sections.listingSnippet);
    findings.push(...overviewResult.findings);
    fieldData[FIELD_SLUGS.overview] = overviewResult.text;
  } else {
    findings.push({
      field: "overview",
      severity: "warn",
      note: "Listing Snippet section missing from Job Description — Overview left unchanged (not guessed). Add a 'Listing Snippet' heading + 2-line summary to the role.",
    });
  }

  return { fieldData, unmapped, findings };
}

// Phase 2 helpers --------------------------------------------------------------
//
// On a re-sync of an existing role, we update only this conservative field set.
// Excluded on purpose:
//   - slug, job-id    : changing these breaks URLs and inbound links.
//   - posted-date     : the role's original go-live date; should not move.
//   - valid-through   : tied to posted-date by spec; a human re-posts if stale.
//   - status          : preserved so manual Active/Closed/Archived edits stick.
//                       Status transitions are handled explicitly by the sync
//                       orchestrator (closure detection, and reopening a Closed
//                       item if it shows up open again in RecruitCRM).
//   - confidential    : hard rule, always true; nothing to update.
//   - client-name     : may have been hand-edited; the connector does not overwrite.

export const UPDATEABLE_FIELDS = [
  FIELD_SLUGS.name,
  FIELD_SLUGS.location,
  FIELD_SLUGS.practiceSetting,
  FIELD_SLUGS.practiceArea,
  FIELD_SLUGS.seniority,
  FIELD_SLUGS.employmentType,
  FIELD_SLUGS.pqeMin,
  FIELD_SLUGS.pqeMax,
  FIELD_SLUGS.applyUrl,
  FIELD_SLUGS.overview,
  FIELD_SLUGS.fullDescription,
];

// For a job whose advertise gate is OFF (Enable Job Application Form unticked): if it is
// already live on the site — an existing item that is not already Closed/Archived — it
// should be pulled off by staging a Closed status, regardless of the RecruitCRM job status.
// Returns the itemId + the status to stage, or null when there is nothing to do (never
// published, or already off). Pure + testable; the sync orchestrator performs the write.
export function unadvertisedClosure(existing) {
  const current = existing?.fieldData?.[FIELD_SLUGS.status];
  if (existing?.itemId && current !== STATUS.Closed && current !== STATUS.Archived) {
    return { itemId: existing.itemId, status: STATUS.Closed };
  }
  return null;
}

export function pickUpdateableFields(fieldData) {
  const out = {};
  for (const k of UPDATEABLE_FIELDS) {
    if (k in fieldData) out[k] = fieldData[k];
  }
  return out;
}

// Returns just the changed updateable fields. Comparison is permissive (numbers
// and strings compared via String()) so a number stored as "5" matches 5.
export function diffUpdateable(newFieldData, existingFieldData) {
  const changes = {};
  for (const k of UPDATEABLE_FIELDS) {
    // A field the mapper did not produce this run (e.g. overview when the Listing Snippet
    // is missing) is left as-is — never treated as a change to be cleared/overwritten.
    if (!(k in (newFieldData ?? {}))) continue;
    if (!shallowEqual(newFieldData[k], existingFieldData?.[k])) {
      changes[k] = newFieldData[k];
    }
  }
  return changes;
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return String(a) === String(b);
}
