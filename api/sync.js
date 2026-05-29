// Vercel serverless function and cron target: /api/sync
//
// Flow:
//   1. List open RecruitCRM jobs (paginated, optional limit).
//   2. Read all existing CMS items keyed by job-id.
//   3. For each open job:
//      - if no CMS item: create a draft (Phase 1).
//      - if a CMS item exists: PATCH only the changed updateable fields (Phase 2);
//        if the existing item is in Closed status, also flip status back to Active
//        (the role is open again).
//   4. Closures (Phase 2): any CMS item whose job-id is not in the open list and
//      whose current status is Active gets status set to Closed.
//
// Hard rule preserved: the connector never publishes. Updates and closures go
// through Webflow's STAGED PATCH endpoint, so a human still publishes the change.
//
// Safety:
//   - Closure detection only runs on full-list syncs (no ?limit) and only when
//     RecruitCRM returned at least one open job (a 0-length response is treated
//     as suspicious, not real).
//   - Mapping failures (an unmapped required Option) skip the job entirely rather
//     than overwrite a clean existing item with a bad payload.
//
// Controls:
//   - ?limit=N or env SYNC_MAX_JOBS caps how many jobs are fetched.
//   - SYNC_SECRET, if set, gates the endpoint (see below).

import { RecruitCrmClient } from "../src/recruitcrm/client.js";
import { WebflowClient } from "../src/webflow/client.js";
import { mapJob, diffUpdateable } from "../src/mapping/mapJob.js";
import { STATUS } from "../src/config/options.js";
import { FIELD_SLUGS } from "../src/config/webflow.js";
import { log, RunReport } from "../src/lib/logger.js";

export default async function handler(req, res) {
  // Protect the endpoint when a shared secret is configured, so an external
  // scheduler can trigger it but the public cannot. Vercel Cron requests are
  // also distinguishable via the x-vercel-cron header.
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const presented = req.headers["authorization"]?.replace(/^Bearer\s+/i, "") || req.query?.secret;
    const isVercelCron = Boolean(req.headers["x-vercel-cron"]);
    if (!isVercelCron && presented !== secret) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const report = new RunReport();

  try {
    const recruitcrm = new RecruitCrmClient({
      token: process.env.RECRUITCRM_API_TOKEN,
      baseUrl: process.env.RECRUITCRM_API_BASE,
    });
    const webflow = new WebflowClient({
      token: process.env.WEBFLOW_API_TOKEN,
      collectionId: process.env.WEBFLOW_OPPORTUNITIES_COLLECTION_ID,
    });

    const limit = Number(req.query?.limit ?? process.env.SYNC_MAX_JOBS) || undefined;

    const jobs = await recruitcrm.listJobs({ limit });
    log.info("fetched jobs", { count: jobs.length, limit: limit ?? "none" });

    const existingByJobId = await webflow.listExistingByJobId();
    log.info("existing CMS items with job-id", { count: existingByJobId.size });

    const openJobIds = new Set();
    for (const job of jobs) {
      openJobIds.add(String(job.id));
      try {
        const { fieldData, unmapped, findings } = mapJob(job);
        if (unmapped.length > 0) {
          // A missing required Option would be a bad payload. Skip and flag so a
          // human fixes the mapping or the source rather than corrupting an
          // existing clean item.
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

    // Closures: items whose job-id is no longer in RecruitCRM's open list.
    // Only run when we have an UNBOUNDED view of open jobs (no limit) and at
    // least one open job came back. A 0-length response is treated as suspicious
    // (likely an API or pagination glitch), not as "everyone closed today".
    if (!limit && jobs.length > 0) {
      for (const [jobId, existing] of existingByJobId) {
        if (openJobIds.has(jobId)) continue;
        const currentStatus = existing.fieldData?.[FIELD_SLUGS.status];
        if (currentStatus !== STATUS.Active) continue;
        try {
          await webflow.updateItem(existing.itemId, { [FIELD_SLUGS.status]: STATUS.Closed });
          report.recordClosed(jobId, existing.itemId);
        } catch (err) {
          report.recordFailed(jobId, err);
        }
      }
    }

    const summary = report.summary();
    log.info("sync complete", summary);
    res.status(200).json(summary);
  } catch (err) {
    // Whole-run failure (e.g. auth, network). Surface loudly.
    log.error("sync run failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "sync run failed", detail: String(err) });
  }
}
