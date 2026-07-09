// Vercel serverless function: /api/recruitcrm-hook
//
// Receives RecruitCRM webhook ("Subscription") POSTs for job lifecycle events and
// triggers a sync, so new / edited / closed roles reach the Webflow CMS within seconds
// instead of waiting for the daily cron. Subscribe via scripts/manage-subscriptions.js.
//
// Events driven here (see the manage-subscriptions script): job.created, job.updated,
// job.deleted, job.status.updated.
//
// Security & scope (satisfies the "no data leaves the tenant / no paid connector"
// constraint): RecruitCRM posts DIRECTLY to this endpoint on our own Vercel project —
// no third-party middleman. Only JOB events are subscribed, so no candidate data is
// involved. The subscription's target_url carries ?secret=<WEBHOOK_SECRET|SYNC_SECRET>;
// a request without the matching secret is rejected (fail closed). The connector still
// only ever STAGES Webflow drafts — it never publishes.
//
// Design (MVP): any accepted job event runs the full, idempotent runSync(), which already
// handles create / update / reopen / close correctly and safely. That avoids depending on
// the exact webhook payload shape. The raw event is logged so we can later optimise to a
// targeted single-job sync once the live payload is confirmed. The daily cron remains the
// backstop if an event is ever missed.

import { RecruitCrmClient } from "../src/recruitcrm/client.js";
import { WebflowClient } from "../src/webflow/client.js";
import { runSync } from "../src/sync/runSync.js";
import { log } from "../src/lib/logger.js";

export default async function handler(req, res) {
  // Health check / connectivity probe.
  if (req.method === "GET") {
    res.status(200).json({ ok: true, endpoint: "recruitcrm-hook" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // Auth: shared secret in the query string (RecruitCRM stores the full target_url).
  // Fail closed if no secret is configured at all.
  const secret = process.env.WEBHOOK_SECRET || process.env.SYNC_SECRET;
  if (!secret) {
    log.error("recruitcrm-hook: no WEBHOOK_SECRET/SYNC_SECRET configured — refusing");
    res.status(503).json({ error: "receiver not configured" });
    return;
  }
  if (req.query?.secret !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // Log the event shape so we can learn the payload for a future targeted sync.
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const eventName = body.event ?? body.type ?? "(unknown)";
  log.info("recruitcrm-hook received", {
    event: eventName,
    keys: req.body && typeof req.body === "object" ? Object.keys(req.body) : typeof req.body,
  });

  try {
    const recruitcrm = new RecruitCrmClient({
      token: process.env.RECRUITCRM_API_TOKEN,
      baseUrl: process.env.RECRUITCRM_API_BASE,
    });
    const webflow = new WebflowClient({
      token: process.env.WEBFLOW_API_TOKEN,
      collectionId: process.env.WEBFLOW_OPPORTUNITIES_COLLECTION_ID,
    });

    const summary = await runSync({ recruitcrm, webflow });
    log.info("recruitcrm-hook sync complete", { event: eventName, ...summary });
    res.status(200).json({ ok: true, event: eventName, summary });
  } catch (err) {
    // Return 200 even on a transient failure so RecruitCRM does not enter a retry storm;
    // the daily cron is the backstop. Switch to 500 if RecruitCRM-side retries are wanted.
    log.error("recruitcrm-hook sync failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(200).json({ ok: false, event: eventName, error: String(err) });
  }
}
