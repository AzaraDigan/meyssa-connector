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
import { mapJob, diffUpdateable, pickUpdateableFields, UPDATEABLE_FIELDS, unadvertisedClosure } from "../src/mapping/mapJob.js";
import { STATUS } from "../src/config/options.js";

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

test("parseSections extracts the Listing Snippet separately from Role overview", () => {
  const raw =
    "Listing Snippet\nInternational firm with a growing funds practice in the Middle East. Hands-on fund formation work across DIFC and ADGM structures for an expanding GCC client base.\n" +
    "Role overview\nThe full opening paragraph of the role detail page.\n" +
    "Key responsibilities\nDo a thing\nDo another\n" +
    "Candidate profile\n5 years\nCommon law";
  const s = parseSections(raw);
  assert.match(s.listingSnippet, /growing funds practice/);
  assert.match(s.overview, /full opening paragraph/);
  assert.ok(!/full opening paragraph/.test(s.listingSnippet), "snippet must not absorb the role overview");
  assert.ok(s.complete);
});

test("mapJob maps the Listing Snippet to Overview, leaving Role overview for the detail page", () => {
  const job = {
    ...sampleJob,
    description:
      "<h3>Listing Snippet</h3><p>International firm with a growing funds practice in the Middle East. Hands-on fund formation work across DIFC and ADGM structures for an expanding GCC client base.</p>" +
      "<h3>Role overview</h3><p>The detail-page opening paragraph, which is longer and different from the snippet.</p>" +
      "<h3>Key responsibilities</h3><ul><li>Fund formation</li><li>Structuring</li></ul>" +
      "<h3>Candidate profile</h3><ul><li>5 PQE</li><li>Funds experience</li></ul>",
  };
  const { fieldData, unmapped } = mapJob(job);
  assert.match(fieldData["overview"], /growing funds practice/);
  assert.ok(!/detail-page opening paragraph/.test(fieldData["overview"]), "Overview must be the snippet, not the role overview");
  // Role overview still drives the detail-page body.
  assert.match(fieldData["full-description"], /detail-page opening paragraph/);
  assert.equal(unmapped.length, 0);
});

test("mapJob: missing Listing Snippet leaves Overview unwritten + warns (fail-closed, not held)", () => {
  const job = {
    ...sampleJob,
    description:
      "<h3>Role overview</h3><p>Only the role overview, no listing snippet.</p>" +
      "<h3>Key responsibilities</h3><ul><li>A</li><li>B</li></ul>" +
      "<h3>Candidate profile</h3><ul><li>X</li><li>Y</li></ul>",
  };
  const { fieldData, unmapped, findings } = mapJob(job);
  assert.ok(!("overview" in fieldData), "Overview is omitted (not guessed) when the snippet is missing");
  assert.ok(findings.some((f) => f.field === "overview" && f.severity === "warn"), "a warning is logged");
  assert.ok(!unmapped.some((u) => u.field === "overview"), "missing snippet does not hold the whole role");
});

test("diffUpdateable leaves Overview untouched when the mapper omits it (missing snippet)", () => {
  const changes = diffUpdateable({ name: "Same" }, { overview: "Existing overview", name: "Same" });
  assert.ok(!("overview" in changes), "omitted overview is not flagged as a change");
});

test("diffUpdateable returns only changed updateable fields and ignores excluded ones", () => {
  const existing = {
    name: "Old Title",
    slug: "23-old-title",                       // excluded from updates
    "job-id": "23",                              // excluded
    status: "b070ef1c5ee3565f064d7262560133bc",  // excluded
    "client-name": "Manually edited descriptor", // excluded
    "posted-date": "2026-05-20T09:00:00.000Z",   // excluded
    "valid-through": "2026-07-19T09:00:00.000Z", // excluded
    confidential: true,                           // excluded
    location: "9ec3180b705e7db6b38475fe3605bdd4",
    "pqe-min": 5,
    "pqe-max": 7,
    overview: "old overview",
  };
  const next = {
    ...existing,
    name: "New Title",        // changed: should appear
    slug: "different-slug",    // excluded: should NOT appear
    "client-name": "Generated",// excluded: should NOT appear
    "pqe-max": 10,             // changed: should appear (numeric)
    overview: "old overview",  // unchanged
  };
  const changes = diffUpdateable(next, existing);
  assert.deepEqual(Object.keys(changes).sort(), ["name", "pqe-max"].sort());
  assert.equal(changes["name"], "New Title");
  assert.equal(changes["pqe-max"], 10);
});

test("pickUpdateableFields drops excluded keys", () => {
  const fd = {
    name: "X", slug: "y", "job-id": "1", status: "s",
    "client-name": "c", "posted-date": "p", confidential: true,
    location: "loc", "pqe-min": 5,
  };
  const picked = pickUpdateableFields(fd);
  assert.ok(!("slug" in picked));
  assert.ok(!("job-id" in picked));
  assert.ok(!("status" in picked));
  assert.ok(!("client-name" in picked));
  assert.ok(!("posted-date" in picked));
  assert.ok(!("confidential" in picked));
  assert.equal(picked.name, "X");
  assert.equal(picked.location, "loc");
  assert.equal(picked["pqe-min"], 5);
});

test("UPDATEABLE_FIELDS list is the conservative set we expect", () => {
  assert.deepEqual([...UPDATEABLE_FIELDS].sort(), [
    "apply-url", "employment-type", "full-description", "location", "name",
    "overview", "pqe-max", "pqe-min", "practice-area", "practice-setting", "salary", "seniority",
  ]);
});

test("mapJob writes the formatted Salary for a disclosed band", () => {
  const { fieldData } = mapJob({
    ...sampleJob,
    salaryDisclosed: true, salaryMin: 50000, salaryMax: 70000,
    salaryCurrency: "AED", salaryPeriod: "Monthly",
  });
  assert.equal(fieldData["salary"], "AED 50,000 - 70,000 per month");
});

test("mapJob writes the negotiable line for an undisclosed role", () => {
  const { fieldData } = mapJob({ ...sampleJob, salaryDisclosed: false });
  assert.equal(fieldData["salary"], "Salary / package negotiable");
});

test("mapJob: disclosed-but-invalid salary leaves Salary empty + warns (fail-closed)", () => {
  const { fieldData, findings } = mapJob({
    ...sampleJob,
    salaryDisclosed: true, salaryMin: null, salaryCurrency: null, salaryPeriod: "Monthly",
  });
  assert.ok(!("salary" in fieldData), "no guessed salary written");
  assert.ok(findings.some((f) => f.field === "salary" && f.severity === "warn"));
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

  // practice-setting comes from the explicit PP/In-House dropdown on the fixture
  // ("Private Practice"); it is no longer inferred from the company name.
  assert.equal(fieldData["practice-setting"], "646b1b61343f6fc9bc06fb725e6476b6");
  assert.equal(unmapped.length, 0, `expected no unmapped fields, got ${JSON.stringify(unmapped)}`);
});

test("practice-setting: explicit valid values pass through, never inferred", () => {
  const pp = mapJob({ ...sampleJob, practiceSetting: "Private Practice" });
  assert.equal(pp.fieldData["practice-setting"], "646b1b61343f6fc9bc06fb725e6476b6");
  assert.ok(!pp.unmapped.some((u) => u.field === "practice-setting"));

  const inhouse = mapJob({ ...sampleJob, practiceSetting: "In-House" });
  assert.equal(inhouse.fieldData["practice-setting"], "7f3830ba550d51aeec7bb7125d3f83ad");
  assert.ok(!inhouse.unmapped.some((u) => u.field === "practice-setting"));
});

test("practice-setting: casing/whitespace is tolerated on an explicit value", () => {
  const { fieldData, unmapped } = mapJob({ ...sampleJob, practiceSetting: "  private practice  " });
  assert.equal(fieldData["practice-setting"], "646b1b61343f6fc9bc06fb725e6476b6");
  assert.ok(!unmapped.some((u) => u.field === "practice-setting"));
});

test("unadvertisedClosure: stage Closed only for a live item, leave others alone", () => {
  // Already live (Active) → pull it off by staging Closed.
  assert.deepEqual(
    unadvertisedClosure({ itemId: "i1", fieldData: { status: STATUS.Active } }),
    { itemId: "i1", status: STATUS.Closed },
  );
  // Never published → nothing to do.
  assert.equal(unadvertisedClosure(undefined), null);
  // Already Closed → idempotent, nothing to do (no repeated writes/alerts).
  assert.equal(unadvertisedClosure({ itemId: "i2", fieldData: { status: STATUS.Closed } }), null);
  // Already Archived → leave as-is.
  assert.equal(unadvertisedClosure({ itemId: "i3", fieldData: { status: STATUS.Archived } }), null);
});

test("practice-setting: missing/empty/unrecognised is HELD, never defaulted to In-House", () => {
  const IN_HOUSE = "7f3830ba550d51aeec7bb7125d3f83ad";
  const cases = [undefined, null, "", "   ", "Law Firm", "PP"];
  for (const value of cases) {
    const job = { ...sampleJob };
    if (value === undefined) delete job.practiceSetting;
    else job.practiceSetting = value;
    const { fieldData, unmapped } = mapJob(job);
    assert.notEqual(
      fieldData["practice-setting"], IN_HOUSE,
      `value ${JSON.stringify(value)} must not silently default to In-House`,
    );
    assert.ok(
      unmapped.some((u) => u.field === "practice-setting"),
      `value ${JSON.stringify(value)} must be recorded as an unmapped/held field`,
    );
  }
});
