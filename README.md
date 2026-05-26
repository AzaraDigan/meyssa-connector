# Meyssa connector

Reads jobs from RecruitCRM, maps them into the Webflow Opportunities collection,
and creates new roles as **drafts** for a human to review and publish. It runs on a
schedule. RecruitCRM does not expose job-level webhooks, so the connector polls.

This repo is owned by Meyssa Legal (Azara Digan). It is built and maintained in
short, verified Claude Code sessions. Each session ends with a note in the team
folder so the next session picks up cleanly.

## Status

**Phase 1, session 1 (scaffolding). No live API calls have been made.**

What works and is tested offline (run `npm test`):

- Option-field ID tables and resolver (`src/config/options.js`).
- Brand-voice scrubber: dash removal and banned-word linting (`src/brand/scrub.js`).
- Deterministic transforms: slug, title strip, PQE parse, dates, location
  normalisation, overview (`src/mapping/transforms.js`).
- full-description HTML builder and section parser (`src/mapping/description.js`).
- Job mapping orchestrator with the hard rules enforced (`src/mapping/mapJob.js`).

What is stubbed for session 2 (throws "not implemented"):

- RecruitCRM client (`src/recruitcrm/client.js`).
- Webflow client (`src/webflow/client.js`).
- The `/api/sync` function runs the orchestration but cannot complete until the
  two clients are implemented.

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

`vercel.json` declares a cron at `0 6 * * *` (once daily). This is deliberate:
**Vercel's free Hobby tier only allows once-per-day cron**, fired anytime within the
hour. Sub-daily polling on the free tier is not possible. Three options to poll
every 15 to 30 minutes:

1. Upgrade to Vercel Pro (about 20 USD per month) for true sub-daily cron.
2. Stay on the free tier and trigger `/api/sync` from a free external scheduler
   (for example cron-job.org, or a GitHub Actions scheduled workflow). Set
   `SYNC_SECRET` and pass it so only the scheduler can call the endpoint.
3. Accept once-daily for now.

This decision is open and does not change the code. See the session note in the
team folder.

## Hard rules (do not change without founder sign-off)

1. No real API tokens in chat, in code, or in the repo. Vercel env vars only.
2. Items are created as drafts. The connector never publishes.
3. Brand voice on any generated text: no em dashes, no en dashes (hyphens fine).
   Banned words enforced in `src/brand/scrub.js`.
4. `confidential` is always `true`. `client-name` is always a generic descriptor,
   never the real RecruitCRM company name.
5. No fabrication. Claim "done" only when verifiable (a test run, a deployed URL).
