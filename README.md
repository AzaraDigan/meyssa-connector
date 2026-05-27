# Meyssa connector

Reads jobs from RecruitCRM, maps them into the Webflow Opportunities collection,
and creates new roles as **drafts** for a human to review and publish. It runs on a
schedule. RecruitCRM does not expose job-level webhooks, so the connector polls.

This repo is owned by Meyssa Legal (Azara Digan). It is built and maintained in
short, verified Claude Code sessions. Each session ends with a note in the team
folder so the next session picks up cleanly.

## Status

**Phase 1, session 2 (clients implemented). The first live sync is pending a
manual trigger; see "First sync".**

Tested offline (run `npm test`, 19 tests):

- Option-field ID tables and resolver (`src/config/options.js`). Verified against
  the live collection schema on 2026-05-26.
- Brand-voice scrubber: dash removal and banned-word linting (`src/brand/scrub.js`).
- Deterministic transforms: slug, title strip, PQE parse, dates, location
  normalisation, overview (`src/mapping/transforms.js`).
- full-description HTML builder and section parser (`src/mapping/description.js`).
- Job mapping orchestrator with the hard rules enforced (`src/mapping/mapJob.js`).
- RecruitCRM job normaliser (`src/recruitcrm/client.js`), tested with a fixture.

Implemented; exercised live only once the sync runs on Vercel (no tokens are held
locally, by rule):

- RecruitCRM client `listJobs` (open jobs, `/jobs/search?job_status=1`, paginated).
- Webflow client `createDraftItem` and `listExistingJobIds` (Data API v2).
- `/api/sync` orchestration with create-once idempotency and a job limit.
- GitHub Actions schedule (`.github/workflows/sync.yml`), every 30 minutes.

## Architecture

```
RecruitCRM REST API  ->  /api/sync (Vercel)  ->  Webflow Data API (draft items)
                              |
                         mapJob() turns a RecruitCRM job into Webflow fieldData
```

- Hosting: Vercel. Language: Node.js (ESM, Node 20+, native fetch, zero runtime deps).
- Scheduler: see "Scheduling" below.
- Items are created with `isDraft: true`. The connector never publishes.

## Layout

```
api/sync.js              Vercel function and cron target. Orchestrates a run.
src/config/webflow.js    Site, collection, page IDs and field slugs (public).
src/config/options.js    Webflow Option-field ID tables + resolveOption().
src/brand/scrub.js       Dash removal + banned-word linter.
src/lib/logger.js        JSON-line logger + per-run RunReport (surfaces failures).
src/recruitcrm/client.js RecruitCRM client (stub, session 2).
src/webflow/client.js    Webflow Data API v2 client (stub, session 2).
src/mapping/transforms.js Deterministic transforms (tested).
src/mapping/infer.js     Heuristic inference: practice-setting, area, seniority.
src/mapping/description.js full-description builder + section parser.
src/mapping/mapJob.js    Orchestrator: RecruitCRM job -> Webflow fieldData.
scripts/run-sync-local.js Offline dry run over the fixture. No API.
test/                    Node test runner suite + fixtures.
```

## Local use

```
npm test          # run the offline test suite
npm run sync:local # map the sample fixture and print the fieldData, no API
```

There are no secrets to set for the offline tools above.

## Environment variables (production, Vercel only)

Copy `.env.example` for reference. Real values are pasted into Vercel Project
Settings, never committed and never shared in chat.

| Variable | Secret | Purpose |
|---|---|---|
| `RECRUITCRM_API_TOKEN` | yes | RecruitCRM REST auth. Rotate the key shared in chat on 2026-04-20 before use. |
| `WEBFLOW_API_TOKEN` | yes | Webflow Data API v2, scope CMS read + write. |
| `SYNC_SECRET` | yes | Optional. If set, `/api/sync` rejects requests without it (lets an external scheduler trigger it safely). |
| `RECRUITCRM_API_BASE` | no | RecruitCRM base URL. |
| `WEBFLOW_SITE_ID` | no | `698d64462e86f6fa77372348`. |
| `WEBFLOW_OPPORTUNITIES_COLLECTION_ID` | no | `69e7715df59318dbed8e9b8c`. |

## Scheduling

Decided: **free Vercel plus a GitHub Actions scheduled workflow** that POSTs to
`/api/sync` every 30 minutes, authenticated with `SYNC_SECRET`. No Vercel Pro.

The workflow is `.github/workflows/sync.yml`. It also keeps `workflow_dispatch`, so
a run can be triggered by hand from the Actions tab (used for the first test sync).

`vercel.json` still declares a once-daily Vercel cron as a harmless fallback;
create-once idempotency means a double run never creates duplicates.

Why 30 minutes: GitHub bills each scheduled run as at least one minute, so `*/30`
(about 1440 runs per month) stays inside a private repo's 2000 free minutes, while
`*/15` would not. 30 minutes is within the brief's 15 to 30 minute window.

### Repo settings Azara sets once (GitHub repo > Settings)

- Actions **variable** `SYNC_URL` = the deployed endpoint, for example
  `https://<project>.vercel.app/api/sync`.
- Actions **secret** `SYNC_SECRET` = the same value stored in Vercel env vars
  (from Bitwarden, search "meyssa").

## First sync

The first run is deliberately small and manual:

1. Confirm the three secrets are in Vercel env vars: `RECRUITCRM_API_TOKEN`,
   `WEBFLOW_API_TOKEN`, `SYNC_SECRET`.
2. Set the GitHub Actions `SYNC_URL` variable and `SYNC_SECRET` secret (above).
3. In the repo Actions tab, run the `sync` workflow via "Run workflow", with
   `limit` set to `3`.
4. The connector fetches up to 3 open jobs, skips any already in the CMS, and
   creates the rest as **drafts**. Check the Actions log for the JSON summary
   (`created` / `skipped` / `failed`).
5. Review the new draft items in the Webflow CMS. Nothing is published.

## Hard rules (do not change without founder sign-off)

1. No real API tokens in chat, in code, or in the repo. Vercel env vars only.
2. Items are created as drafts. The connector never publishes.
3. Brand voice on any generated text: no em dashes, no en dashes (hyphens fine).
   Banned words enforced in `src/brand/scrub.js`.
4. `confidential` is always `true`. `client-name` is always a generic descriptor,
   never the real RecruitCRM company name.
5. No fabrication. Claim "done" only when verifiable (a test run, a deployed URL).
