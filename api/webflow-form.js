// Vercel serverless function: /api/webflow-form
//
// Receives Webflow "form_submission" webhooks from meyssalegal.com (the shared
// "Email Form" that the salary survey and contact pages post into), then:
//
//   1. Re-reads the submission from Webflow with OUR token. The webhook body is never
//      trusted on its own; a forged POST cannot get past this step.
//   2. Routes on the form's "Enquiry Type" field: "I am hiring" becomes a RecruitCRM
//      CONTACT (plus company); "I am looking for a role" becomes a CANDIDATE. Matching
//      is by email so nobody is created twice.
//   3. Writes a note on the record (source, date, Webflow submission id, message).
//   4. For salary survey requests only, emails the right guide FROM the info box with
//      Azara in CC, via Microsoft Graph (application permission, restricted to info@).
//      The PDFs live in /assets, which Vercel does not serve, so the gated document is
//      never reachable at a URL. Contact enquiries get the CRM record only.
//
// Security: the webhook URL carries ?secret=<WEBHOOK_SECRET>, same pattern as
// /api/recruitcrm-hook, and the submission is re-fetched from Webflow before anything
// is written. Personal data never appears in a URL or a log line.

import fs from "node:fs";
import path from "node:path";
import { log } from "../src/lib/logger.js";

const SITE_ID = process.env.WEBFLOW_SITE_ID || "698d64462e86f6fa77372348";
const RCRM_BASE = process.env.RECRUITCRM_API_BASE || "https://api.recruitcrm.io/v1";
const INFO_MAILBOX = process.env.INFO_MAILBOX || "info@meyssalegal.com";
const CC_ADDRESS = process.env.CC_ADDRESS || "azaradigan@meyssalegal.com";

// Which guide goes to whom. Decided by Azara, 10 Sept 2026.
const GUIDES = {
  candidate: "Meyssa_Salary_Market_Guide_Candidates_2026.pdf",
  client_uae: "Meyssa_Salary_Guide_InHouse_2026.pdf",
  client_ksa: "Meyssa_Salary_Guide_InHouse_KSA_2026.pdf",
};

export default async function handler(req, res) {
  if (req.method === "GET") {
    res.status(200).json({ ok: true, endpoint: "webflow-form" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  const secret = process.env.FORM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || process.env.SYNC_SECRET;
  if (!secret) {
    log.error("webflow-form: no WEBHOOK_SECRET/SYNC_SECRET configured, refusing");
    res.status(503).json({ error: "receiver not configured" });
    return;
  }
  if (req.query?.secret !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const p = body.payload && typeof body.payload === "object" ? body.payload : body;
    if (!p.id) {
      res.status(400).json({ error: "no submission id" });
      return;
    }

    // 1. Re-read from Webflow. Trust nothing in the webhook body itself.
    const sub = await webflowGet(`/sites/${SITE_ID}/form_submissions/${p.id}`)
      .catch(() => webflowGet(`/form_submissions/${p.id}`));
    const f = sub?.formResponse;
    if (!f) {
      res.status(404).json({ error: "submission not found" });
      return;
    }

    const name = (f["Name"] || "").trim();
    const email = (f["Email"] || "").trim().toLowerCase();
    const company = (f["Company"] || "").trim();
    const jobTitle = (f["Job Title"] || "").trim();
    const message = (f["Message"] || "").trim();
    const enquiryType = (f["Enquiry Type"] || "").trim();
    const market = (f["Market"] || "UAE").trim();
    const isSurvey = /^\[Requesting Salary Survey\]/i.test(message);

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || /test/i.test(name) || /@meyssalegal\.com$/i.test(email)) {
      log.info("webflow-form: skipped submission", { id: sub.id, reason: "no usable name/email or internal" });
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    const isClient = /hiring/i.test(enquiryType);
    const [firstName, ...rest] = name.split(/\s+/);
    const lastName = rest.join(" ") || "-";

    // 2. RecruitCRM: find or create, never duplicate.
    const record = isClient
      ? await findOrCreateContact({ firstName, lastName, email, company, jobTitle })
      : await findOrCreateCandidate({ firstName, lastName, email, company, jobTitle });

    // 3. Note on the record.
    await rcrm("POST", "/notes", {
      related_to: record.slug,
      related_to_type: isClient ? "contact" : "candidate",
      description:
        `<p><b>Website enquiry (meyssalegal.com ${isSurvey ? "salary survey form" : "contact form"})</b><br>` +
        `Submitted: ${fmtDate(sub.dateSubmitted)}<br>` +
        `Webflow submission id: ${sub.id}<br>` +
        `Type: ${isSurvey ? "Salary survey request" : "Contact enquiry"} (${isClient ? "client contact" : "candidate"}, routing ${enquiryType ? "stated" : "inferred"}), Market: ${escapeHtml(market)}<br>` +
        `Message: ${escapeHtml(message.replace(/^\[[^\]]+\]\s*/, "") || "N/A")}<br>` +
        `Status: ${isSurvey ? "Survey emailed automatically from the info box with Azara in CC" : "Logged; reply from Azara pending"}.</p>`,
    });

    // 4. Salary survey: email the guide from the info box, Azara in CC.
    let emailed = false;
    if (isSurvey) {
      const key = !isClient ? "candidate" : /saudi/i.test(market) ? "client_ksa" : "client_uae";
      const file = GUIDES[key];
      const bytes = fs.readFileSync(path.join(process.cwd(), "assets", file));
      const isKsa = key === "client_ksa";
      const docName = isKsa ? "Saudi Legal Salary Guide" : "UAE Legal Salary Survey";
      const html =
        `<p>Dear ${escapeHtml(firstName)}</p>` +
        `<p>Thank you for requesting our most recent ${docName}. Please find it attached.</p>` +
        `<p>Should you require any further detail, our founder Azara Digan, in copy, would be happy to assist.</p>` +
        `<p>Kind regards</p>` +
        (process.env.INFO_SIGNATURE_HTML || `<p>Meyssa Legal<br>info@meyssalegal.com | meyssalegal.com</p>`);

      await graphSendMail({
        from: INFO_MAILBOX,
        to: email,
        cc: CC_ADDRESS,
        subject: `Your copy of the Meyssa Legal ${docName} 2026`,
        html,
        attachment: { name: file, bytes },
      });
      emailed = true;
    }

    log.info("webflow-form processed", { id: sub.id, type: isSurvey ? "survey" : "enquiry", route: isClient ? "contact" : "candidate", existed: record.existed, emailed });
    res.status(200).json({ ok: true, record: record.slug, existed: record.existed, emailed });
  } catch (err) {
    // 500 makes Webflow retry, which is what we want for a transient failure.
    log.error("webflow-form failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ ok: false, error: String(err) });
  }
}

// ---------- Webflow (Data API v2) ----------
async function webflowGet(p) {
  const r = await fetch("https://api.webflow.com/v2" + p, {
    headers: { Authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`, accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Webflow ${r.status} on ${p}`);
  return r.json();
}

// ---------- RecruitCRM ----------
async function rcrm(method, p, body) {
  const r = await fetch(RCRM_BASE + p, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.RECRUITCRM_API_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch { /* non-JSON body */ }
  if (!r.ok) throw new Error(`RecruitCRM ${r.status} on ${p}`);
  return data;
}

function firstHit(resp) {
  if (!resp) return null;
  const list = Array.isArray(resp) ? resp : resp.data || resp.results || [];
  return list.length ? list[0] : null;
}

async function findOrCreateCandidate({ firstName, lastName, email, company, jobTitle }) {
  const found = await rcrm("GET", `/candidates/search?email=${encodeURIComponent(email)}`).catch(() => null);
  const hit = firstHit(found);
  if (hit) return { slug: hit.slug, existed: true };
  const created = await rcrm("POST", "/candidates", {
    first_name: firstName,
    last_name: lastName,
    email,
    position: jobTitle,
    current_organization: company,
    source: "Website enquiry (meyssalegal.com)",
  });
  return { slug: created.slug ?? created.data?.slug, existed: false };
}

async function findOrCreateContact({ firstName, lastName, email, company, jobTitle }) {
  const found = await rcrm("GET", `/contacts/search?email=${encodeURIComponent(email)}`).catch(() => null);
  const hit = firstHit(found);
  if (hit) return { slug: hit.slug, existed: true };
  let companySlug;
  if (company) {
    const co = await rcrm("GET", `/companies/search?company_name=${encodeURIComponent(company)}`).catch(() => null);
    const coHit = firstHit(co);
    companySlug = coHit ? coHit.slug : (await rcrm("POST", "/companies", { company_name: company })).slug;
  }
  const created = await rcrm("POST", "/contacts", {
    first_name: firstName,
    last_name: lastName,
    email,
    designation: jobTitle,
    company_slug: companySlug,
  });
  return { slug: created.slug ?? created.data?.slug, existed: false };
}

// ---------- Microsoft Graph: the info box sends (application permission) ----------
async function graphToken() {
  const r = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!r.ok) throw new Error(`Graph token ${r.status}`);
  return (await r.json()).access_token;
}

async function graphSendMail({ from, to, cc, subject, html, attachment }) {
  const token = await graphToken();
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      saveToSentItems: true,
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: to } }],
        ccRecipients: cc ? [{ emailAddress: { address: cc } }] : [],
        attachments: [
          {
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: attachment.name,
            contentType: "application/pdf",
            contentBytes: attachment.bytes.toString("base64"),
          },
        ],
      },
    }),
  });
  if (!r.ok) throw new Error(`Graph sendMail ${r.status}`);
}

function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
