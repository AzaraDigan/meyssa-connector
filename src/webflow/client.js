// Webflow Data API v2 client.
//
// STATUS: stub. Not implemented in session 1. No live calls have been made.
// Session 2 fills these in against the real API, after a CMS read+write token is
// issued and pasted into Vercel env vars.
//
// Phase 1 only needs: create a collection item as a DRAFT. Per the hard rules,
// items are created with isDraft: true and are never published by the connector.
// A human reviews and publishes.
//
// Data API v2 reference to confirm in session 2:
//   POST https://api.webflow.com/v2/collections/{collection_id}/items
//   Header: Authorization: Bearer <token>, accept-version 2.0.0
//   Body:   { isArchived: false, isDraft: true, fieldData: { ...slugs } }
//   A duplicate-detection read (list items, match on job-id) belongs in Phase 2.

import { WEBFLOW } from "../config/webflow.js";

export class WebflowClient {
  constructor({ token, collectionId } = {}) {
    if (!token) throw new Error("WEBFLOW_API_TOKEN is required");
    this.token = token;
    this.collectionId = collectionId ?? WEBFLOW.opportunitiesCollectionId;
    this.baseUrl = "https://api.webflow.com/v2";
  }

  /**
   * Create a single collection item as a draft.
   * @param {Record<string, unknown>} fieldData  Webflow fieldData keyed by field slug.
   * @returns {Promise<{ id: string }>}
   */
  async createDraftItem(fieldData) {
    throw new Error("WebflowClient.createDraftItem not implemented (session 2)");
  }

  /**
   * List existing items so we can detect duplicates by job-id. Phase 2.
   */
  async listItems() {
    throw new Error("WebflowClient.listItems not implemented (Phase 2)");
  }
}
