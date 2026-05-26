// Vercel serverless function and cron target: /api/sync
//
// Flow (Phase 1): list RecruitCRM jobs -> map each -> create a Webflow DRAFT item.
// Updates and closures are Phase 2.
//
// STATUS: orchestration is wired, but the RecruitCRM and Webflow clients are stubs
// (they throw "not implemented"). No live sync runs until session 2 fills them in.
// This is intentional: nothing here has touched the real API yet.

import { RecruitCrmClient } from "../src/recruitcrm/client.js";
import { WebflowClient } from "../src/webflow/client.js";
import { mapJob } from "../src/mapping/mapJob.js";
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

    const jobs = await recruitcrm.listJobs();
    log.info("fetched jobs", { count: jobs.length });

    for (const job of jobs) {
      try {
        const { fieldData, unmapped, findings } = mapJob(job);
        if (unmapped.length > 0) {
          // A missing required Option would be a bad draft. Skip and flag so a
          // human can fix the mapping or the source data, rather than ship junk.
          report.recordSkipped(job.id, { unmapped, findings });
          continue;
        }
        const item = await webflow.createDraftItem(fieldData);
        report.recordCreated(job.id, item.id);
      } catch (err) {
        report.recordFailed(job.id, err);
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
