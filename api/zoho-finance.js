// Vercel serverless function: /api/zoho-finance
//
// Recruit CRM deals -> Zoho Books draft invoices, so won business shows up in the
// books (receivables, aging, cash flow forecast) without anyone re-keying it.
//
// What it does, in order, on every call:
//   1. Reads every deal in Recruit CRM (a handful of records; cheap and safe).
//   2. For each deal whose stage is "Won", finds the client in Zoho Books by company
//      name (creating the customer if absent) and creates ONE draft invoice for the
//      deal value. An interim deal (name or job says interim, contract, temp, FTC or
//      locum) gets a MONTHLY RECURRING invoice profile instead, because that is what
//      Zoho's cash flow forecast reads; the deal value is the monthly amount.
//      Idempotent: everything carries the marker RCRM-D<deal id>; if Zoho already has
//      it nothing is created again. A deal invoiced by hand before this existed is
//      also left alone: if the customer already has a Zoho invoice for the same
//      amount, that is taken as the hand-raised one (BlueFive, Sept 2026).
//   3. Writes a note on the Recruit CRM deal with the Zoho invoice number so the
//      audit trail is visible in the CRM.
//   Drafts only. Nobody at Meyssa or any client receives anything until Azara or
//   Maria opens the draft in Zoho Books, checks it and sends it.
//
// How it is triggered:
//   - Recruit CRM webhooks (deal.stage.updated, deal.updated, placement.created)
//     POST here within seconds of a deal being marked Won. The payload itself is not
//     trusted or parsed; any event simply runs the reconcile above.
//   - A daily Vercel cron GET (vercel.json) is the backstop if an event is missed.
//   - GET ...?secret=X&action=subscribe registers those webhooks in Recruit CRM
//     (one-off, run once after deploy). GET ...?secret=X&action=status lists them.
//
// Security: ?secret=<FORM_WEBHOOK_SECRET> on every request (same pattern as the
// other receivers). Fails closed if no secret is configured. No personal data in
// URLs or logs.
//
// Environment (Vercel): RECRUITCRM_API_TOKEN, FORM_WEBHOOK_SECRET, ZOHO_CLIENT_ID,
// ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN, ZOHO_ORG_ID, ZOHO_DC (com|eu|in|au|sa|jp|ca),
// ZOHO_SYNC_SINCE (optional, YYYY-MM-DD; deals won before it were invoiced by hand).
// Zoho Books > Settings > Preferences > Recurring Invoices should be set to create
// invoices as DRAFTS, so an interim profile never sends anything by itself.

import { log } from "../src/lib/logger.js";

const RCRM_BASE = process.env.RECRUITCRM_API_BASE || "https://api.recruitcrm.io/v1";
const EVENTS = ["deal.stage.updated", "deal.updated", "placement.created"];

export default async function handler(req, res) {
  const secret = process.env.FORM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || process.env.SYNC_SECRET;
  if (!secret) {
    res.status(503).json({ error: "receiver not configured" });
    return;
  }
  // Vercel cron calls carry no query string but do carry this header.
  const isCron = req.headers["x-vercel-cron"] === "1" || Boolean(req.headers["x-vercel-cron"]);
  if (req.query?.secret !== secret && !isCron) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const action = req.query?.action || "";
    if (req.method === "GET" && action === "status") {
      res.status(200).json({ ok: true, subscriptions: await listSubscriptions(), config: configSummary() });
      return;
    }
    if (req.method === "GET" && action === "subscribe") {
      const base = `https://${req.headers.host}/api/zoho-finance?secret=${encodeURIComponent(secret)}`;
      res.status(200).json({ ok: true, ...(await subscribe(base)) });
      return;
    }
    if (req.method === "GET" && action === "preview") {
      // Dry run: says what a real run would create, without writing to Zoho or Recruit CRM.
      res.status(200).json({ ok: true, preview: true, ...(await reconcile({ dryRun: true })) });
      return;
    }
    if (req.method === "GET" && action === "check") {
      // Connectivity probe: proves the Zoho credentials work without writing anything.
      const org = await zohoGet("/organizations");
      res.status(200).json({ ok: true, organizations: (org.organizations || []).map((o) => ({ id: o.organization_id, name: o.name, currency: o.currency_code })) });
      return;
    }
    if (req.method !== "GET" && req.method !== "POST") {
      res.status(405).json({ error: "method not allowed" });
      return;
    }

    const eventName = req.method === "POST" ? (req.body?.event ?? req.body?.type ?? "(webhook)") : (isCron ? "cron" : "manual");
    log.info("zoho-finance run", { trigger: eventName });
    const summary = await reconcile();
    res.status(200).json({ ok: true, trigger: eventName, ...summary });
  } catch (err) {
    log.error("zoho-finance failed", { error: err instanceof Error ? err.message : String(err) });
    // 200 so Recruit CRM does not retry-storm; the daily cron is the backstop.
    res.status(200).json({ ok: false, error: String(err) });
  }
}

// ---------- The reconcile ----------
async function reconcile({ dryRun = false } = {}) {
  const deals = await listDeals();
  const out = { deals: deals.length, won: 0, created: [], existing: [], skipped: [], failed: [] };

  for (const deal of deals) {
    try {
      await reconcileDeal(deal, out, dryRun);
    } catch (err) {
      // One bad deal must not stop the others.
      out.failed.push({ ref: `RCRM-D${deal.id}`, deal: deal.name, error: err instanceof Error ? err.message : String(err) });
    }
  }

  log.info("zoho-finance reconcile", { dryRun, deals: out.deals, won: out.won, created: out.created.length, existing: out.existing.length, skipped: out.skipped.length, failed: out.failed.length });
  return out;
}

async function reconcileDeal(deal, out, dryRun) {
  {
    const stage = String(deal.deal_stage?.label ?? deal.deal_stage ?? "").trim();
    if (!/^won$/i.test(stage)) return;
    out.won++;
    const ref = `RCRM-D${deal.id}`;
    const closeDate = (deal.close_date || "").slice(0, 10);
    const amount = Number(String(deal.deal_value ?? "0").replace(/[^0-9.]/g, "")) || 0;
    if (!amount) {
      out.skipped.push({ ref, reason: "deal value is empty" });
      return;
    }

    const company = deal.company_slug ? await rcrm("GET", `/companies/${deal.company_slug}`).catch(() => null) : null;
    const companyName = (company?.company_name || company?.name || "").trim();
    if (!companyName) {
      out.skipped.push({ ref, reason: "no company on the deal" });
      return;
    }
    const jobSlug = String(deal.additional_job_slugs || "").split(",")[0].trim();
    const candSlug = String(deal.additional_candidate_slugs || "").split(",")[0].trim();
    const job = jobSlug ? await rcrm("GET", `/jobs/${jobSlug}`).catch(() => null) : null;
    const cand = candSlug ? await rcrm("GET", `/candidates/${candSlug}`).catch(() => null) : null;
    const jobName = (job?.name || deal.name || "").trim();
    const candName = cand ? `${cand.first_name || ""} ${cand.last_name || ""}`.trim() : "";
    const interim = /interim|contract|temp|ftc|locum/i.test(`${deal.name} ${jobName}`);

    // Already there under our marker?
    const marked = interim
      ? (await zohoGet(`/recurringinvoices?recurrence_name_contains=${encodeURIComponent(ref)}`)).recurring_invoices?.find((r) => String(r.recurrence_name).includes(ref))
      : (await zohoGet(`/invoices?reference_number=${encodeURIComponent(ref)}`)).invoices?.find((i) => i.reference_number === ref);
    if (marked) {
      out.existing.push({ ref, zoho: marked.invoice_number || marked.recurrence_name, status: marked.status });
      return;
    }

    // Won before the sync went live: invoiced by hand, leave it alone.
    const since = process.env.ZOHO_SYNC_SINCE || "2026-09-13";
    if (closeDate && closeDate < since) {
      out.skipped.push({ ref, reason: `won ${fmtDate(closeDate)}, before the sync went live on ${fmtDate(since)}; invoiced by hand` });
      return;
    }

    const customer = await findOrCreateCustomer(companyName, dryRun);
    if (!customer) {
      out.created.push({ ref, preview: true, wouldCreateCustomer: companyName, [interim ? "monthly" : "amount"]: amount, interim });
      return;
    }

    // Raised by hand before this sync existed? Same customer, same amount: leave it.
    const byHand = interim
      ? (await zohoGet(`/recurringinvoices?customer_id=${customer.contact_id}`)).recurring_invoices?.find((r) => sameAmount(r, amount))
      : (await zohoGet(`/invoices?customer_id=${customer.contact_id}`)).invoices?.find((i) => i.status !== "void" && sameAmount(i, amount));
    if (byHand) {
      out.skipped.push({ ref, reason: `${customer.contact_name} already has ${byHand.invoice_number || byHand.recurrence_name} for this amount (raised by hand)` });
      return;
    }

    const line = {
      name: `${interim ? "Interim support" : "Recruitment fee"}${jobName ? ` - ${jobName}` : ""}`.slice(0, 100),
      description: [
        candName ? `${interim ? "Interim placement of" : "Placement of"} ${candName}` : (interim ? "Interim placement" : "Placement"),
        jobName ? `Role: ${jobName}` : "",
        closeDate ? `${interim ? "Assignment agreed" : "Deal closed"}: ${fmtDate(closeDate)}` : "",
        interim ? "Estimated month. Adjust the amount to days actually worked before sending." : "",
      ].filter(Boolean).join("\n"),
      rate: amount,
      quantity: 1,
    };

    if (dryRun) {
      out.created.push({ ref, preview: true, customer: customer.contact_name, customerExisted: true, [interim ? "monthly" : "amount"]: amount, interim, job: jobName });
      return;
    }

    if (interim) {
      // Interim assignments are billed on days actually worked, so the profile only
      // pre-fills a draft at month end with the estimated amount; Azara adjusts the
      // figure to the timesheet before sending. Zoho repeats a month-end start date
      // on the last day of every following month.
      const start = endOfMonth(closeDate && closeDate > today() ? closeDate : today());
      const rec = await zohoPost("/recurringinvoices", {
        recurrence_name: `${customer.contact_name} - ${jobName || deal.name} (${ref})`.slice(0, 100),
        customer_id: customer.contact_id,
        start_date: start,
        recurrence_frequency: "months",
        repeat_every: 1,
        line_items: [line],
        notes: `Created automatically from Recruit CRM deal "${deal.name}" (${ref}). The monthly amount is an estimate taken from the deal value; each month's draft is adjusted to days worked before it is sent. Set the end date in Zoho when the assignment end is known.`,
      });
      const r = rec.recurring_invoice;
      out.created.push({ ref, recurring: r.recurrence_name, customer: customer.contact_name, monthly: amount, starts: r.start_date || start });
      await dealNote(deal.slug, `<p><b>Zoho Books monthly recurring invoice created</b><br>Profile "${escapeHtml(r.recurrence_name)}" for ${escapeHtml(r.currency_code || "AED")} ${amount.toLocaleString("en-GB")} a month (estimate) against ${escapeHtml(customer.contact_name)}, first draft on ${escapeHtml(fmtDate(r.start_date || start))} and then every month end. Reference ${ref}. Each month's draft is adjusted to days worked in Zoho Books before sending. End date to be set in Zoho when known.</p>`);
    } else {
      const inv = await zohoPost("/invoices", {
        customer_id: customer.contact_id,
        reference_number: ref,
        date: today(),
        line_items: [line],
        notes: `Created automatically from Recruit CRM deal "${deal.name}" (${ref}). Draft: review before sending.`,
      });
      const invoice = inv.invoice;
      out.created.push({ ref, invoice: invoice.invoice_number, customer: customer.contact_name, amount });
      await dealNote(deal.slug, `<p><b>Zoho Books draft invoice created</b><br>Invoice ${escapeHtml(invoice.invoice_number)} for ${escapeHtml(invoice.currency_code || "AED")} ${amount.toLocaleString("en-GB")} against ${escapeHtml(customer.contact_name)}. Reference ${ref}. Sitting as a draft in Zoho Books for review.</p>`);
    }
  }
}

function sameAmount(doc, amount) {
  // Zoho list rows carry the VAT-inclusive total, so a 40,000 fee shows as 42,000
  // in the UAE. Match either the net or the 5% gross figure.
  const vals = [doc.total, doc.sub_total].map((v) => Number(v)).filter((v) => !isNaN(v) && v > 0);
  return vals.some((v) => Math.abs(v - amount) < 1 || Math.abs(v - amount * 1.05) < 1);
}

async function dealNote(slug, description) {
  await rcrm("POST", "/notes", { related_to: slug, related_to_type: "deal", description })
    .catch((e) => log.error("zoho-finance note failed", { error: String(e) }));
}

// ---------- Recruit CRM ----------
async function rcrm(method, p, body) {
  const r = await fetch(RCRM_BASE + p, {
    method,
    headers: { Authorization: `Bearer ${process.env.RECRUITCRM_API_TOKEN}`, "Content-Type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  if (!r.ok) throw new Error(`RecruitCRM ${r.status} on ${p}`);
  return data;
}

async function listDeals() {
  const all = [];
  let p = "/deals?limit=100&page=1";
  while (p) {
    const d = await rcrm("GET", p);
    const rows = Array.isArray(d) ? d : d.data || [];
    all.push(...rows);
    const next = d.next_page_url;
    p = next ? next.replace(RCRM_BASE, "") : null;
    if (all.length > 2000) break;
  }
  return all;
}

async function listSubscriptions() {
  const out = [];
  let p = "/subscriptions";
  while (p) {
    const d = await rcrm("GET", p);
    const rows = Array.isArray(d) ? d : d.data || [];
    out.push(...rows.map((s) => ({ id: s.id ?? s.slug, event: s.event, target: String(s.target_url || "").replace(/secret=[^&]+/, "secret=***") })));
    const next = d.next_page_url;
    p = next ? next.replace(RCRM_BASE, "") : null;
  }
  return out;
}

async function subscribe(targetUrl) {
  const existing = await listSubscriptions();
  const removed = [];
  for (const s of existing) {
    if (EVENTS.includes(s.event) && /zoho-finance/.test(s.target)) {
      await rcrm("DELETE", `/subscriptions/${s.id}`).catch(() => null);
      removed.push(s.event);
    }
  }
  const added = [];
  for (const event of EVENTS) {
    await rcrm("POST", "/subscriptions", { event, target_url: targetUrl });
    added.push(event);
  }
  return { removed, added };
}

// ---------- Zoho Books ----------
let tokenCache = { value: null, exp: 0 };
async function zohoToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const dc = process.env.ZOHO_DC || "com";
  const r = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_REFRESH_TOKEN || "",
      client_id: process.env.ZOHO_CLIENT_ID || "",
      client_secret: process.env.ZOHO_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Zoho token failed: ${j.error || r.status}`);
  tokenCache = { value: j.access_token, exp: Date.now() + 50 * 60 * 1000 };
  return j.access_token;
}

async function zoho(method, p, body) {
  const dc = process.env.ZOHO_DC || "com";
  const org = process.env.ZOHO_ORG_ID || "";
  const sep = p.includes("?") ? "&" : "?";
  const url = `https://www.zohoapis.${dc}/books/v3${p}${org ? `${sep}organization_id=${org}` : ""}`;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Zoho-oauthtoken ${await zohoToken()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (typeof j.code === "number" && j.code !== 0)) {
    const msg = j.message || "unknown";
    const hint = /Invoice Number field is blank/i.test(msg)
      ? " (Zoho is not auto-numbering invoices. In Zoho Books open New Invoice, click the gear next to Invoice#, choose 'Continue auto-generating invoice numbers', set the prefix and next number to follow your sequence, Save.)"
      : "";
    throw new Error(`Zoho ${r.status} on ${p}: ${msg}${hint}`);
  }
  return j;
}
const zohoGet = (p) => zoho("GET", p);
const zohoPost = (p, b) => zoho("POST", p, b);

async function findOrCreateCustomer(name, dryRun = false) {
  const found = await zohoGet(`/contacts?contact_type=customer&contact_name_contains=${encodeURIComponent(name)}`);
  const list = found.contacts || [];
  const exact = list.find((c) => norm(c.contact_name) === norm(name) || norm(c.company_name) === norm(name));
  if (exact) return exact;
  if (list.length === 1) return list[0];
  if (dryRun) return null;
  const created = await zohoPost("/contacts", { contact_name: name, company_name: name, contact_type: "customer" });
  return created.contact;
}

// ---------- helpers ----------
function configSummary() {
  return {
    zoho_dc: process.env.ZOHO_DC || "com",
    zoho_org_set: Boolean(process.env.ZOHO_ORG_ID),
    zoho_credentials_set: Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN),
    sync_since: process.env.ZOHO_SYNC_SINCE || "2026-09-13",
  };
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const today = () => new Date().toISOString().slice(0, 10);
function endOfMonth(iso) {
  const d = new Date(iso + "T00:00:00Z");
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.toISOString().slice(0, 10);
}
function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
