// RecruitCRM REST API client.
//
// STATUS: stub. Not implemented in session 1. No live calls have been made.
// Session 2 fills these in against the real API, after the token is rotated and
// pasted into Vercel env vars.
//
// What session 2 must confirm against the RecruitCRM docs / a live probe:
//   - exact base URL and auth header shape (Bearer token vs custom header),
//   - the "list jobs" endpoint, its pagination, and how to filter to open jobs,
//   - the field names on a job object (title, description, location text, job
//     type, created date, PQE/experience field, apply link / slug),
//   - rate limits.
//
// The shape below is the contract the rest of the connector codes against. If the
// real API differs, adapt here so the mapping layer does not need to change.

/**
 * @typedef {Object} RecruitCrmJob
 * @property {string} id            RecruitCRM job id (used as the Webflow job-id and URL prefix)
 * @property {string} title         Raw job title (may include PQE and city)
 * @property {string} description   Raw job description (HTML or plain text)
 * @property {string} locationText  Free-text location from RecruitCRM
 * @property {string} jobType       RecruitCRM job type (maps to employment-type)
 * @property {string} createdDate   ISO date the job was created (maps to posted-date)
 * @property {number|null} pqeMin   Years of experience, lower bound, if available
 * @property {number|null} pqeMax   Years of experience, upper bound, if available
 * @property {string} companyName   Real client name. NEVER written to Webflow; used only to infer practice-setting.
 * @property {string} applySlug     RecruitCRM apply id/slug for the apply URL
 */

export class RecruitCrmClient {
  constructor({ token, baseUrl } = {}) {
    if (!token) throw new Error("RECRUITCRM_API_TOKEN is required");
    this.token = token;
    this.baseUrl = baseUrl ?? "https://api.recruitcrm.io/v1";
  }

  /**
   * Fetch jobs to consider for sync.
   * @returns {Promise<RecruitCrmJob[]>}
   */
  async listJobs() {
    throw new Error("RecruitCrmClient.listJobs not implemented (session 2)");
  }
}
