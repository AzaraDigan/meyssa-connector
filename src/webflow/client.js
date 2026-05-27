// Webflow Data API v2 client.
//
// Confirmed against the live collection schema (verified 2026-05-26 via MCP): the
// field slugs in src/config/webflow.js all exist. Phase 1 creates items as DRAFTS
// only (isDraft: true). The connector never publishes.
//
// Data API v2:
//   POST   https://api.webflow.com/v2/collections/{id}/items      -> create staged item
//   GET    https://api.webflow.com/v2/collections/{id}/items      -> list items (paginated)
//   Header: Authorization: Bearer <token>, Content-Type: application/json
//
// listExistingJobIds supports create-once idempotency: the scheduled run skips a
// job whose job-id already exists in the CMS, so polling does not create duplicates.
// Full update/closure detection is Phase 2.

import { WEBFLOW, FIELD_SLUGS } from "../config/webflow.js";

export class WebflowClient {
  constructor({ token, collectionId } = {}) {
    if (!token) throw new Error("WEBFLOW_API_TOKEN is required");
    this.token = token;
    this.collectionId = collectionId ?? WEBFLOW.opportunitiesCollectionId;
    this.baseUrl = "https://api.webflow.com/v2";
  }

  async #request(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Webflow ${res.status} ${res.statusText} for ${method} ${path}: ${text.slice(0, 400)}`);
    }
    return res.json();
  }

  /**
   * Create one collection item as a draft.
   * @param {Record<string, unknown>} fieldData  keyed by field slug
   * @returns {Promise<{ id: string }>}
   */
  async createDraftItem(fieldData) {
    const item = await this.#request("POST", `/collections/${this.collectionId}/items`, {
      isArchived: false,
      isDraft: true,
      fieldData,
    });
    return { id: item.id };
  }

  /**
   * Read every item's job-id (paginated) so the sync can skip jobs already present.
   * @returns {Promise<Set<string>>}
   */
  async listExistingJobIds() {
    const ids = new Set();
    const limit = 100;
    let offset = 0;

    for (;;) {
      const page = await this.#request(
        "GET",
        `/collections/${this.collectionId}/items?limit=${limit}&offset=${offset}`,
      );
      const items = Array.isArray(page?.items) ? page.items : [];
      for (const item of items) {
        const jobId = item?.fieldData?.[FIELD_SLUGS.jobId];
        if (jobId != null) ids.add(String(jobId));
      }
      const total = page?.pagination?.total ?? items.length;
      offset += items.length;
      if (items.length === 0 || offset >= total) break;
    }
    return ids;
  }
}
