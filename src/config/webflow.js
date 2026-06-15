// Webflow site and CMS identifiers. These are public, not secret.
// Source: redeployment brief, 2026-05-26.

export const WEBFLOW = {
  siteId: "698d64462e86f6fa77372348",
  opportunitiesCollectionId: "69e7715df59318dbed8e9b8c",
  opportunityTemplatePageId: "69e7715ef59318dbed8e9bc2",
  listingPageId: "698f12fae9f633ce2c3d07a7",
  customDomains: ["meyssalegal.com", "www.meyssalegal.com"],
  stagingSubdomain: "meyssa-legal.webflow.io",
};

// Webflow CMS field slugs the connector writes to.
// Kept as a single list so the mapping layer and the Webflow client agree on names.
// VERIFY against the live collection schema in session 2 before the first write.
export const FIELD_SLUGS = {
  name: "name",
  slug: "slug",
  jobId: "job-id",
  applyUrl: "apply-url",
  location: "location",
  practiceSetting: "practice-setting",
  practiceArea: "practice-area",
  seniority: "seniority",
  employmentType: "employment-type",
  status: "status",
  pqeMin: "pqe-min",
  pqeMax: "pqe-max",
  postedDate: "posted-date",
  validThrough: "valid-through",
  confidential: "confidential",
  clientName: "client-name",
  overview: "overview",
  fullDescription: "full-description",
  // Salary pipeline (v1: a single plain-text field per Yusra's brief). The connector only
  // writes this once formatSalary() is un-stubbed AND the field exists in the Opportunities
  // collection. VERIFY the slug against the live schema before enabling.
  salary: "salary",
};
