import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { scrubDashes, lintBannedWords, applyBrandRules } from "../src/brand/scrub.js";
import { resolveOption, LOCATION, EMPLOYMENT_TYPE } from "../src/config/options.js";
import {
  normaliseLocation, buildSlug, slugify, stripTitle, parsePqe, validThroughFrom, buildOverview,
} from "../src/mapping/transforms.js";
import { buildFullDescriptionHtml, parseSections } from "../src/mapping/description.js";
import { mapJob } from "../src/mapping/mapJob.js";

const sampleJob = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/sample-job.json", import.meta.url)), "utf8"),
);

test("scrubDashes removes em and en dashes, keeps hyphens", () => {
  assert.equal(scrubDashes("a — b").text, "a - b");
  assert.equal(scrubDashes("5–7 PQE").text, "5-7 PQE");
  assert.equal(scrubDashes("fixed-term").text, "fixed-term");
  assert.equal(scrubDashes("a — b").changed, true);
  assert.equal(scrubDashes("no dashes here").changed, false);
});

test("lintBannedWords flags hard-banned words as errors", () => {
  const findings = lintBannedWords("We will delve into a robust, seamless solution.");
  const words = findings.filter((f) => f.severity === "error").map((f) => f.word);
  assert.ok(words.includes("delve"));
  assert.ok(words.includes("robust"));
  assert.ok(words.includes("seamless"));
});

test("lintBannedWords treats contextual words as warnings, not errors", () => {
  const findings = lintBannedWords("A leading international law firm.");
  const errors = findings.filter((f) => f.severity === "error");
  assert.equal(errors.length, 0, "“leading” as adjective must not be a hard error");
});

test("applyBrandRules scrubs and lints together", () => {
  const { text, findings } = applyBrandRules("A cutting-edge — and robust — offering.");
  assert.ok(!text.includes("—"));
  assert.ok(findings.some((f) => f.word === "cutting-edge"));
});

test("resolveOption returns id for known label, null for unknown", () => {
  assert.equal(resolveOption(LOCATION, "Dubai, UAE"), "9ec3180b705e7db6b38475fe3605bdd4");
  assert.equal(resolveOption(EMPLOYMENT_TYPE, "Permanent"), "677faca490f624778acac60e68a0f2d9");
  assert.equal(resolveOption(LOCATION, "Mars"), null);
});

test("normaliseLocation maps free text to canonical labels", () => {
  assert.equal(normaliseLocation("Dubai, United Arab Emirates"), "Dubai, UAE");
  assert.equal(normaliseLocation("riyadh"), "Riyadh, KSA");
  assert.equal(normaliseLocation("Kuwait"), "Kuwait City, Kuwait");
  assert.equal(normaliseLocation("London"), null);
});

test("slugify and buildSlug", () => {
  assert.equal(slugify("Corporate / M&A"), "corporate-m-and-a");
  assert.equal(buildSlug("23", "Senior Associate"), "23-senior-associate");
});

test("stripTitle removes PQE band and city", () => {
  const out = stripTitle("Senior Associate, Banking & Finance (5-7 PQE) - Dubai");
  assert.ok(!/pqe/i.test(out));
  assert.ok(!/dubai/i.test(out));
  assert.ok(/Senior Associate/.test(out));
});

test("parsePqe handles ranges, plus, and single", () => {
  assert.deepEqual(parsePqe("5-7 PQE"), { min: 5, max: 7 });
  assert.deepEqual(parsePqe("8+ PQE"), { min: 8, max: 40 });
  assert.deepEqual(parsePqe("3 PQE"), { min: 3, max: 3 });
  assert.equal(parsePqe("no band"), null);
});

test("validThroughFrom adds 60 days", () => {
  assert.equal(validThroughFrom("2026-05-20T00:00:00.000Z"), "2026-07-19T00:00:00.000Z");
});

test("buildOverview caps at 280 chars and scrubs dashes", () => {
  const long = "First sentence — with a dash. Second sentence here. Third sentence ignored.";
  const { text } = buildOverview(long);
  assert.ok(!text.includes("—"));
  assert.ok(text.length <= 280);
  assert.ok(!/Third sentence/.test(text));
});

test("buildFullDescriptionHtml produces the exact required structure", () => {
  const html = buildFullDescriptionHtml({
    overview: "An overview.",
    responsibilities: ["Do a thing", "Do another"],
    profile: ["5 years", "Common law"],
  });
  assert.equal(
    html,
    "<h3>Role overview</h3><p>An overview.</p>" +
      "<h3>Key responsibilities</h3><ul><li>Do a thing</li><li>Do another</li></ul>" +
      "<h3>Candidate profile</h3><ul><li>5 years</li><li>Common law</li></ul>",
  );
});

test("parseSections splits the sample HTML description into three complete sections", () => {
  const s = parseSections(sampleJob.description);
  assert.ok(s.complete);
  assert.ok(s.overview.length > 0);
  assert.ok(s.responsibilities.length >= 2);
  assert.ok(s.profile.length >= 2);
});

test("parseSections drops a lead-in line ending in a colon before the bullets", () => {
  const raw =
    "Role overview\nAn overview.\n" +
    "Key responsibilities\nYou will:\nDo a thing\nDo another\n" +
    "Candidate profile\nThe candidate will be:\n5 years";
  const s = parseSections(raw);
  assert.ok(s.complete);
  assert.deepEqual(s.responsibilities, ["Do a thing", "Do another"]);
  assert.deepEqual(s.profile, ["5 years"]);
});

test("mapJob enforces hard rules and maps the sample job cleanly", () => {
  const { fieldData, unmapped } = mapJob(sampleJob);

  // Hard rules.
  assert.equal(fieldData["confidential"], true);
  assert.equal(fieldData["client-name"], "A leading international law firm");
  assert.notEqual(fieldData["client-name"], sampleJob.companyName);
  assert.equal(fieldData["status"], "b070ef1c5ee3565f064d7262560133bc"); // Active

  // Resolved options.
  assert.equal(fieldData["location"], "9ec3180b705e7db6b38475fe3605bdd4"); // Dubai
  assert.equal(fieldData["practice-area"], "27d5eb3f8f5a68def65d3248c9c7e790"); // Banking & Finance
  assert.equal(fieldData["seniority"], "4b80dc1a59e8f264d993c3d11ca769a6"); // Senior Associate
  assert.equal(fieldData["employment-type"], "677faca490f624778acac60e68a0f2d9"); // Permanent

  // Computed fields.
  assert.equal(fieldData["pqe-min"], 5);
  assert.equal(fieldData["pqe-max"], 7);
  assert.equal(fieldData["job-id"], "23");
  assert.equal(fieldData["apply-url"], "https://recruitcrm.io/apply/abc123");
  assert.equal(fieldData["valid-through"], "2026-07-19T09:00:00.000Z");

  // practice-setting is the only field we expect unresolved here: the company name
  // ("...LLP") is a law firm, so it should actually resolve to Private Practice.
  assert.equal(fieldData["practice-setting"], "646b1b61343f6fc9bc06fb725e6476b6");
  assert.equal(unmapped.length, 0, `expected no unmapped fields, got ${JSON.stringify(unmapped)}`);
});
