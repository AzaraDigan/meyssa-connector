// Vercel serverless function and cron target: /api/sync
//
// Thin wrapper around the shared runSync() core (see src/sync/runSync.js). Handles
// auth + client construction; the daily Vercel cron and any external scheduler hit
// this endpoint. The webhook receiver (/api/recruitcrm-hook) calls the same core.
//
// Controls:
//   - ?limit=N or env SYNC_MAX_JOBS caps how many jobs are fetched.
//   - SYNC_SECRET, if set, gates the endpoint (Bearer header or ?secret=). Vercel Cron
//     requests are allowed via the x-vercel-cron header.

import { RecruitCrmClient } from "../src/recruitcrm/client.js";
import { WebflowClient } from "../src/webflow/client.js";
import { runSync } from "../src/sync/runSync.js";
import { log } from "../src/lib/logger.js";

export default async function handler(req, res) {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const presented = req.headers["authorization"]?.replace(/^Bearer\s+/i, "") || req.query?.secret;
    const isVercelCron = Boolean(req.headers["x-vercel-cron"]);
    if (!isVercelCron && presented !== secret) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

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

    const summary = await runSync({ recruitcrm, webflow, limit });
    res.status(200).json(summary);
  } catch (err) {
    // Whole-run failure (e.g. auth, network). Surface loudly.
    log.error("sync run failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "sync run failed", detail: String(err) });
  }
}
