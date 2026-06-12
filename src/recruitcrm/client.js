// RecruitCRM REST API client.
//
// Confirmed from RecruitCRM docs (help.recruitcrm.io, docs.recruitcrm.io):
//   - Base URL: https://api.recruitcrm.io/v1
//   - Auth: header "Authorization: Bearer <token>"
//   - Open jobs only: GET /v1/jobs/search?job_status=1
//   - Pagination is Laravel-style: response has data[] plus current_page, per_page,
//     next_page_url (null on the last page).
//   - Job fields used here: id, slug, name, job_description_text, city, country,
//     job_status {id,label}, created_on (ISO), minimum_experience, maximum_experience.
//
// Field names that the docs did not pin down precisely (job type / employment, and
// the company name) are read defensively from a few likely shapes. These, plus the
// exact apply-URL form, are the things to eyeball against a real job on the first
// sync. normalizeJob is exported so it can be unit-tested offline against a fixture.

/**
 * @typedef {Object} RecruitCrmJob
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} locationText
 * @property {string} jobType
 * @property {string} createdDate
 * @property {number|null} pqeMin
 * @property {number|null} pqeMax
 * @property {string} companyName  Used only to infer practice-setting; never written to Webflow.
 * @property {string} applySlug
 */

// RecruitCRM job-type labels do not always match the Webflow Employment type
// options. Map the common ones; anything unknown falls back to Permanent in mapJob.
const JOB_TYPE_ALIASES = {
  "permanent": "Permanent",
  "full time": "Permanent",
  "full-time": "Permanent",
  "contract": "Fixed-Term Contract",
  "fixed term": "Fixed-Term Contract",
  "fixed-term contract": "Fixed-Term Contract",
  "part time": "Part-Time",
  "part-time": "Part-Time",
  "temporary": "Temporary / Locum",
  "locum": "Temporary / Locum",
  "internship": "Internship",
  "intern": "Internship",
};

export function normalizeJobType(raw) {
  if (!raw) return "Permanent";
  const label = typeof raw === "object" ? (raw.label ?? raw.name ?? "") : String(raw);
  return JOB_TYPE_ALIASES[label.trim().toLowerCase()] ?? label.trim() ?? "Permanent";
}

// Read a custom field value by name from a RecruitCRM job. Custom fields arrive as
// an array: custom_fields: [{ field_name, field_type, value }]. Matching is
// case-insensitive and trimmed. Accepts several aliases for the same concept.
// Returns the trimmed string value, or null if absent/empty.
export function getCustomField(raw, ...names) {
  const fields = Array.isArray(raw?.custom_fields) ? raw.custom_fields : [];
  const wanted = names.map((n) => n.trim().toLowerCase());
  for (const f of fields) {
    const fn = String(f?.field_name ?? "").trim().toLowerCase();
    if (wanted.includes(fn)) {
      const v = f?.value;
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return null;
}

// Turn a raw RecruitCRM job into the shape mapJob expects.
export function normalizeJob(raw) {
  const city = raw.city ?? "";
  const country = raw.country ?? "";
  const locationText = [city, country].filter(Boolean).join(", ");

  // Company name may arrive as a string, or nested on a company object.
  const companyName =
    raw.company_name ??
    raw.company?.company_name ??
    raw.company?.name ??
    "";

  const toNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

  // Explicit values the recruiter records in RecruitCRM custom fields. When present
  // these are authoritative; mapJob falls back to inference only when they are absent.
  const explicitJobType =
    getCustomField(raw, "Employment Type", "Type") ?? raw.job_type ?? raw.employment_type;

  return {
    id: String(raw.id ?? raw.slug ?? ""),
    title: raw.name ?? "",
    description: raw.job_description_text ?? raw.job_description ?? "",
    locationText,
    jobType: normalizeJobType(explicitJobType),
    createdDate: raw.created_on ?? raw.created_at ?? "",
    pqeMin: toNum(raw.minimum_experience),
    pqeMax: toNum(raw.maximum_experience),
    companyName,
    // RecruitCRM apply links are slug-based. Verified on job 32 (long alphanumeric slug).
    applySlug: raw.slug ?? String(raw.id ?? ""),
    // Explicit Option values from custom fields (null when not set).
    practiceArea: getCustomField(raw, "Practice Area"),
    seniority: getCustomField(raw, "Seniority", "Job Level"),
    // Read from the hardwired "PP/In-House" dropdown (the authoritative source).
    // "Practice Setting" kept as a fallback alias in case the field is renamed.
    practiceSetting: getCustomField(raw, "PP/In-House", "Practice Setting"),
    clientDescriptor: getCustomField(raw, "Client Descriptor", "Client Name"),
    // The "Enable Job Application Form" toggle is the advertise gate: the recruiter ticks
    // it on every job they want on the website. RecruitCRM exposes it as
    // enable_job_application_form (1 = ticked). Strict opt-in — only an explicit 1
    // advertises, so an untick (or a job that never had it) stays off the site.
    advertise: Number(raw.enable_job_application_form) === 1,
  };
}

export class RecruitCrmClient {
  constructor({ token, baseUrl } = {}) {
    if (!token) throw new Error("RECRUITCRM_API_TOKEN is required");
    this.token = token;
    this.baseUrl = (baseUrl ?? "https://api.recruitcrm.io/v1").replace(/\/$/, "");
  }

  async #get(url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`RecruitCRM ${res.status} ${res.statusText} for ${url}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  /**
   * Fetch open jobs, normalised. Stops once `limit` jobs are collected (if given),
   * otherwise follows pagination to the end.
   * @param {{ limit?: number }} [opts]
   * @returns {Promise<RecruitCrmJob[]>}
   */
  async listJobs({ limit } = {}) {
    const collected = [];
    let url = `${this.baseUrl}/jobs/search?job_status=1`;

    while (url) {
      const page = await this.#get(url);
      const rows = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];
      for (const row of rows) {
        collected.push(normalizeJob(row));
        if (limit && collected.length >= limit) return collected;
      }
      url = page?.next_page_url ?? null;
    }
    return collected;
  }
}
