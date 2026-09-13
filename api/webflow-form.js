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
// Security: the webhook URL carries ?secret=<FORM_WEBHOOK_SECRET>, same pattern as
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
  candidate: "Meyssa_Salary_Guide_Lawyers_2026.pdf",
  client_uae: "Meyssa_Salary_Guide_InHouse_2026.pdf",
  client_ksa: "Meyssa_Salary_Guide_InHouse_KSA_2026.pdf",
  client_pp: "Meyssa_Salary_Guide_PrivatePractice_2026.pdf",
};

// The info box signature, matching the one set up in Outlook (12 Sept 2026). The logo
// travels as an inline image attachment (cid:), which every mail client renders; a
// pasted data: URL or a hosted image would be stripped or blocked by Outlook and Gmail.
const SIGNATURE_HTML =
  `<div style="margin-top:18px;font-family:Calibri,Arial,sans-serif;color:#0f1e2d">` +
  `<div style="font-size:13px"><b>Meyssa Legal</b></div>` +
  `<div style="margin-top:10px"><img src="cid:meyssa-logo" width="240" height="14" alt="Meyssa Legal" style="display:block;width:240px;height:14px;border:0"></div>` +
  `<div style="margin-top:8px;font-size:9px;color:#6f7782"><i>Meyssa Legal is a trading name of Meyssa Group L.L.C-FZ.</i></div>` +
  `</div>`;

// assets/meyssa-logo.png (720x42), embedded so the function has no file dependency for it.
const LOGO_PNG_BASE64 =
  "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";

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
    log.error("webflow-form: no FORM_WEBHOOK_SECRET configured, refusing");
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
    const isLawFirm = /law firm|private practice/i.test(enquiryType);
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
      const key = !isClient ? "candidate" : isLawFirm ? "client_pp" : /saudi/i.test(market) ? "client_ksa" : "client_uae";
      const file = GUIDES[key];
      const bytes = fs.readFileSync(path.join(process.cwd(), "assets", file));
      const isKsa = key === "client_ksa";
      const docName = key === "candidate" ? "UAE Salary Guide for Lawyers 2026"
        : key === "client_pp" ? "UAE Private Practice Salary Guide 2026"
        : isKsa ? "Saudi Arabia In-House Legal Salary Guide 2026" : "UAE In-House Legal Salary Guide 2026";
      const html =
        `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#000000">` +
        `<p>Dear ${escapeHtml(firstName)}</p>` +
        `<p>As requested via our website, please find attached our latest copy of the ${docName}. I have CC'd our founder, Azara Digan. Please feel free to reach out should you require further assistance.</p>` +
        `<p>Kind regards</p>` +
        SIGNATURE_HTML +
        `</div>`;

      await graphSendMail({
        from: INFO_MAILBOX,
        to: email,
        cc: CC_ADDRESS,
        subject: `Your copy of the Meyssa Legal ${docName}`,
        html,
        attachment: { name: file, bytes },
        inlineImages: [{ name: "meyssa-logo.png", contentId: "meyssa-logo", bytes: Buffer.from(LOGO_PNG_BASE64, "base64") }],
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

async function graphSendMail({ from, to, cc, subject, html, attachment, inlineImages = [] }) {
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
          ...inlineImages.map((img) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: img.name,
            contentType: "image/png",
            contentId: img.contentId,
            isInline: true,
            contentBytes: img.bytes.toString("base64"),
          })),
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
