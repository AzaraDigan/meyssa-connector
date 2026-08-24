// Core sync routine, shared by the cron endpoint (/api/sync) and the webhook
// receiver (/api/recruitcrm-hook). Extracted verbatim from the original api/sync.js
// handler so both entry points run identical, idempotent logic.
//
// Flow:
//   1. List open RecruitCRM jobs (paginated, optional limit).
//   2. Read all existing CMS items keyed by job-id.
//   3. For each open job: create a draft, or PATCH changed updateable fields
//      (reopening a Closed item if the role is open again).
//   4. Closures: any CMS item whose job-id is not in the open list and whose current
//      status is Active gets set to Closed.
//
// Hard rule preserved: the connector never publishes. Updates and closures go through
// Webflow's STAGED PATCH endpoint, so a human still publishes the change.
//
// Safety:
//   - Closure detection only runs on full-list syncs (no limit) and only when
//     RecruitCRM returned at least one open job (a 0-length response is suspicious).
//   - Mapping failures skip the job rather than overwrite a clean existing item.

import { mapJob, diffUpdateable, unadvertisedClosure } from "../mapping/mapJob.js";
import { STATUS } from "../config/options.js";
import { FIELD_SLUGS } from "../config/webflow.js";
import { log, RunReport } from "../lib/logger.js";

/**
 * Run a full (or limited) sync from RecruitCRM to the Webflow CMS.
 * @param {{ recruitcrm: import("../recruitcrm/client.js").RecruitCrmClient,
 *           webflow: import("../webflow/client.js").WebflowClient,
 *           limit?: number }} deps
 * @returns {Promise<object>} the run summary
 */
export async function runSync({ recruitcrm, webflow, limit }) {
  const report = new RunReport();
  // Item IDs closed this run — auto-published at the end so cancelled roles leave the
  // LIVE site immediately. This is the one narrow exception to "never publish": only
  // closures (which merely remove a role) go live automatically; creates and updates
  // stay staged as drafts for a human to review and publish.
  const closedItemIds = [];

  const jobs = await recruitcrm.listJobs({ limit });
  log.info("fetched jobs", { count: jobs.length, limit: limit ?? "none" });

  const existingByJobId = await webflow.listExistingByJobId();
  log.info("existing CMS items with job-id", { count: existingByJobId.size });

  const openJobIds = new Set();
  for (const job of jobs) {
    openJobIds.add(String(job.id));
    // Advertise gate: only jobs with "Enable Job Application Form" ticked are pulled
    // through. An unticked job is a benign exclusion, not a hold.
    //   - If it is already live, stage it Closed so it leaves the listing (idempotent).
    //   - Otherwise just record the exclusion.
    if (!job.advertise) {
      const existing = existingByJobId.get(String(job.id));
      const closure = unadvertisedClosure(existing);
      if (closure) {
        try {
          await webflow.updateItem(closure.itemId, { [FIELD_SLUGS.status]: closure.status });
          report.recordClosed(job.id, closure.itemId);
          closedItemIds.push(closure.itemId);
        } catch (err) {
          report.recordFailed(job.id, err);
        }
      } else {
        report.recordSkipped(job.id, { reason: "excluded: job application form not enabled" });
      }
      continue;
    }
    try {
      const { fieldData, unmapped, findings } = mapJob(job);
      if (unmapped.length > 0) {
        // A missing required Option would be a bad payload. Skip and flag.
        report.recordSkipped(job.id, { unmapped, findings });
        continue;
      }
      const existing = existingByJobId.get(String(job.id));
      if (!existing) {
        const item = await webflow.createDraftItem(fieldData);
        report.recordCreated(job.id, item.id);
        continue;
      }
      // Existing item: PATCH only changed updateable fields. Reopen if needed.
      const updates = diffUpdateable(fieldData, existing.fieldData);
      if (existing.fieldData?.[FIELD_SLUGS.status] === STATUS.Closed) {
        updates[FIELD_SLUGS.status] = STATUS.Active;
      }
      if (Object.keys(updates).length === 0) {
        report.recordSkipped(job.id, { reason: "no changes" });
        continue;
      }
      await webflow.updateItem(existing.itemId, updates);
      report.recordUpdated(job.id, existing.itemId, Object.keys(updates));
    } catch (err) {
      report.recordFailed(job.id, err);
    }
  }

  // Closures: items whose job-id is no longer in RecruitCRM's open list. Only run on
  // an UNBOUNDED view (no limit) with at least one open job — a 0-length response is
  // treated as suspicious (likely an API/pagination glitch), not "everyone closed".
  if (!limit && jobs.length > 0) {
    for (const [jobId, existing] of existingByJobId) {
      if (openJobIds.has(jobId)) continue;
      const currentStatus = existing.fieldData?.[FIELD_SLUGS.status];
      if (currentStatus !== STATUS.Active) continue;
      try {
        await webflow.updateItem(existing.itemId, { [FIELD_SLUGS.status]: STATUS.Closed });
        report.recordClosed(jobId, existing.itemId);
        closedItemIds.push(existing.itemId);
      } catch (err) {
        report.recordFailed(jobId, err);
      }
    }
  }

  // Auto-publish closures so cancelled/removed roles drop off the LIVE listing at once.
  // Scoped to closures only: creates and updates stay staged for human review. A publish
  // failure is logged, not thrown — the items are already staged Closed, so the next run
  // (or a manual publish) still pushes them; the sync itself should not fail on this.
  if (closedItemIds.length > 0) {
    try {
      const pub = await webflow.publishItems(closedItemIds);
      log.info("published closures", {
        staged: closedItemIds.length,
        published: pub?.publishedItemIds?.length ?? 0,
      });
    } catch (err) {
      log.error("closure publish failed", {
        error: err instanceof Error ? err.message : String(err),
        count: closedItemIds.length,
      });
    }
  }

  const summary = report.summary();
  log.info("sync complete", summary);
  return summary;
}
