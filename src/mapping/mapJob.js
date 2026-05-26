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
  DEFAULTS, resolveOption,
} from "../config/options.js";
import {
  normaliseLocation, buildSlug, stripTitle, parsePqe, validThroughFrom, buildOverview,
} from "./transforms.js";
import { inferPracticeSetting, inferPracticeArea, inferSeniority } from "./infer.js";
import { parseSections, buildFullDescriptionHtml } from "./description.js";

const DEFAULT_CLIENT_DESCRIPTOR = "A leading international law firm";

export function mapJob(job, { clientDescriptor = DEFAULT_CLIENT_DESCRIPTOR } = {}) {
  const unmapped = [];
  const findings = [];

  const roleTitle = stripTitle(job.title);
  const pqe = parsePqe(job.title) ?? { min: job.pqeMin ?? null, max: job.pqeMax ?? null };

  // Option resolutions. Each unresolved required Option is recorded in `unmapped`.
  const locationLabel = normaliseLocation(job.locationText);
  const locationId = resolveOption(LOCATION, locationLabel);
  if (!locationId) unmapped.push({ field: "location", raw: job.locationText });

  const practiceSettingLabel = inferPracticeSetting(job.companyName);
  const practiceSettingId = resolveOption(PRACTICE_SETTING, practiceSettingLabel);
  if (!practiceSettingId) unmapped.push({ field: "practice-setting", raw: "(inferred from company; needs confirmation)" });

  const practiceAreaLabel = inferPracticeArea(job.title, job.description);
  const practiceAreaId = resolveOption(PRACTICE_AREA, practiceAreaLabel);
  if (!practiceAreaId) unmapped.push({ field: "practice-area", raw: "(inferred from description; needs confirmation)" });

  const seniorityLabel = inferSeniority(job.title, pqe);
  const seniorityId = resolveOption(SENIORITY, seniorityLabel);
  if (!seniorityId) unmapped.push({ field: "seniority", raw: job.title });

  const employmentLabel = job.jobType && EMPLOYMENT_TYPE[job.jobType] ? job.jobType : DEFAULTS.employmentType;
  const employmentId = resolveOption(EMPLOYMENT_TYPE, employmentLabel);

  const statusId = resolveOption(STATUS, DEFAULTS.status);

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
