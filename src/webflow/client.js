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
   * Read every existing item indexed by its job-id, with enough data for the
   * Phase 2 update and closure passes to compare and patch.
   * @returns {Promise<Map<string, {itemId: string, fieldData: Record<string, unknown>, isDraft: boolean, isArchived: boolean}>>}
   */
  async listExistingByJobId() {
    const map = new Map();
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
        if (jobId != null) {
          map.set(String(jobId), {
            itemId: item.id,
            fieldData: item.fieldData ?? {},
            isDraft: Boolean(item.isDraft),
            isArchived: Boolean(item.isArchived),
          });
        }
      }
      const total = page?.pagination?.total ?? items.length;
      offset += items.length;
      if (items.length === 0 || offset >= total) break;
    }
    return map;
  }

  /**
   * Update a CMS item's STAGED fieldData. Webflow PATCH /items/{id} does not touch
   * the live version; a human still publishes the change. This is how Phase 2
   * updates and closures land without the connector ever publishing.
   * @param {string} itemId
   * @param {Record<string, unknown>} fieldData  partial fieldData, keyed by slug
   * @returns {Promise<{ id: string, fieldData: Record<string, unknown> }>}
   */
  async updateItem(itemId, fieldData) {
    const item = await this.#request(
      "PATCH",
      `/collections/${this.collectionId}/items/${itemId}`,
      { fieldData },
    );
    return { id: item.id, fieldData: item.fieldData };
  }
}
