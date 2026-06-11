import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { normalizeJob, normalizeJobType, getCustomField } from "../src/recruitcrm/client.js";
import { mapJob } from "../src/mapping/mapJob.js";

const page = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/recruitcrm-jobs-page.json", import.meta.url)), "utf8"),
);

test("normalizeJobType maps known aliases and falls back to Permanent", () => {
  assert.equal(normalizeJobType({ label: "Permanent" }), "Permanent");
  assert.equal(normalizeJobType("Contract"), "Fixed-Term Contract");
  assert.equal(normalizeJobType("part time"), "Part-Time");
  assert.equal(normalizeJobType(null), "Permanent");
});

test("normalizeJob builds the RecruitCrmJob shape from a raw job", () => {
  const job = normalizeJob(page.data[0]);
  assert.equal(job.id, "4821");
  assert.equal(job.title, "Senior Associate, Banking & Finance (5-7 PQE) - Dubai");
  assert.equal(job.locationText, "Dubai, United Arab Emirates");
  assert.equal(job.jobType, "Permanent");
  assert.equal(job.pqeMin, 5);
  assert.equal(job.pqeMax, 7);
  assert.equal(job.companyName, "Confidential Magic Circle LLP");
  assert.equal(job.applySlug, "4821-senior-associate-banking-finance");
});

test("normalizeJob reads company name from a nested company object", () => {
  const job = normalizeJob(page.data[1]);
  assert.equal(job.companyName, "A regional industrial group");
  assert.equal(job.jobType, "Fixed-Term Contract");
  assert.equal(job.pqeMax, null);
});

test("normalized RecruitCRM job 1 maps to a clean, draft-ready Webflow item", () => {
  const { fieldData, unmapped } = mapJob(normalizeJob(page.data[0]));
  assert.equal(unmapped.length, 0, `unexpected unmapped: ${JSON.stringify(unmapped)}`);
  assert.equal(fieldData["location"], "9ec3180b705e7db6b38475fe3605bdd4"); // Dubai
  assert.equal(fieldData["practice-area"], "27d5eb3f8f5a68def65d3248c9c7e790"); // Banking & Finance
  assert.equal(fieldData["seniority"], "4b80dc1a59e8f264d993c3d11ca769a6"); // Senior Associate
  assert.equal(fieldData["confidential"], true);
  assert.equal(fieldData["client-name"], "A leading international law firm");
  assert.equal(fieldData["job-id"], "4821");
});

test("getCustomField reads custom fields by name, case-insensitively", () => {
  const raw = {
    custom_fields: [
      { field_name: "Practice Area", field_type: "dropdown", value: "Corporate / M&A" },
      { field_name: "Seniority", field_type: "dropdown", value: "Senior Legal Counsel" },
      { field_name: "Empty", value: "" },
    ],
  };
  assert.equal(getCustomField(raw, "practice area"), "Corporate / M&A");
  assert.equal(getCustomField(raw, "Seniority", "Job Level"), "Senior Legal Counsel");
  assert.equal(getCustomField(raw, "Empty"), null);
  assert.equal(getCustomField(raw, "Nope"), null);
  assert.equal(getCustomField({}, "Anything"), null);
});

test("explicit custom fields override keyword inference", () => {
  const raw = {
    id: 99,
    slug: "99-corporate-lawyer-xyz",
    name: "Corporate Lawyer",
    job_description_text:
      "<h3>Role overview</h3><p>Banking and finance heavy fintech role.</p>" +
      "<h3>Key responsibilities</h3><ul><li>Advise</li></ul>" +
      "<h3>Candidate profile</h3><ul><li>5 years</li></ul>",
    city: "Abu Dhabi",
    country: "United Arab Emirates",
    created_on: "2026-05-27T00:00:00.000Z",
    minimum_experience: 5,
    maximum_experience: 10,
    company_name: "A fintech group",
    custom_fields: [
      { field_name: "Practice Area", value: "Corporate / M&A" },
      { field_name: "Seniority", value: "Senior Legal Counsel" },
      { field_name: "Practice Setting", value: "In-House" },
      { field_name: "Client Descriptor", value: "A well-funded regional fintech" },
    ],
  };
  const job = normalizeJob(raw);
  assert.equal(job.practiceArea, "Corporate / M&A");
  assert.equal(job.seniority, "Senior Legal Counsel");

  const { fieldData, unmapped } = mapJob(job);
  assert.equal(unmapped.length, 0, JSON.stringify(unmapped));
  // Explicit values win even though the description keywords would infer
  // Banking & Finance and the title would infer a private-practice tier.
  assert.equal(fieldData["practice-area"], "ed090f6b8be2f98c4a7add3624f8deb5"); // Corporate / M&A
  assert.equal(fieldData["seniority"], "278cdd8fcfbfdbb12b42865fad8f157d"); // Senior Legal Counsel
  assert.equal(fieldData["practice-setting"], "7f3830ba550d51aeec7bb7125d3f83ad"); // In-House
  assert.equal(fieldData["client-name"], "A well-funded regional fintech");
});

test("normalized RecruitCRM job 2 (Riyadh) maps cleanly with explicit In-House from the PP/In-House dropdown", () => {
  const { fieldData, unmapped } = mapJob(normalizeJob(page.data[1]));
  assert.equal(fieldData["location"], "5af353f826842399e65336d133c5eb95"); // Riyadh
  assert.equal(fieldData["pqe-min"], 8);
  assert.equal(fieldData["pqe-max"], 40); // 8+ unbounded
  // practice-setting comes from the explicit PP/In-House dropdown ("In-House");
  // it is no longer inferred from the company name.
  assert.equal(fieldData["practice-setting"], "7f3830ba550d51aeec7bb7125d3f83ad"); // In-House
  assert.equal(unmapped.length, 0, `expected no unmapped fields, got ${JSON.stringify(unmapped)}`);
});
