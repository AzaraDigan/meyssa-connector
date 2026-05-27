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
import { inferPracticeSetting, inferPracticeArea, inferSeniority } from "./infer.js";
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

  const practiceSettingLabel = job.practiceSetting ?? inferPracticeSetting(job.companyName);
  const practiceSettingId = resolveOptionLoose(PRACTICE_SETTING, practiceSettingLabel);
  if (!practiceSettingId) unmapped.push({ field: "practice-setting", raw: job.practiceSetting ?? "(could not infer from company)" });

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

  // Overview from the parsed overview text (or the raw description as fallback).
  const overviewResult = buildOverview(sections.overview || job.description);
  findings.push(...overviewResult.findings);

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
    [FIELD_SLUGS.overview]: overviewResult.text,
    [FIELD_SLUGS.fullDescription]: fullDescription,
  };

  return { fieldData, unmapped, findings };
}
