import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { normalizeJob, normalizeJobType } from "../src/recruitcrm/client.js";
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

test("normalized RecruitCRM job 2 (Riyadh, In-House) flags practice-setting for review", () => {
  const { fieldData, unmapped } = mapJob(normalizeJob(page.data[1]));
  assert.equal(fieldData["location"], "5af353f826842399e65336d133c5eb95"); // Riyadh
  assert.equal(fieldData["pqe-min"], 8);
  assert.equal(fieldData["pqe-max"], 40); // 8+ unbounded
  // Company is not obviously a law firm, so practice-setting is left for a human.
  const fields = unmapped.map((u) => u.field);
  assert.ok(fields.includes("practice-setting"), `expected practice-setting unmapped, got ${JSON.stringify(fields)}`);
});
