// Meyssa Legal - website form intake (Phase 2)
// Vercel serverless function. Receives Webflow form_submission webhooks,
// writes the person to Recruit CRM (routed by "Enquiry Type"), and for salary
// survey requests emails the right guide from the info box with Azara in CC.
//
// Deploy into the existing meyssa-legal-jobs Vercel project as /api/webflow-form.
// Nothing here is reachable without the environment variables listed in README.md.

const fs = require("fs");
const path = require("path");

const SITE_ID = process.env.WEBFLOW_SITE_ID || "698d64462e86f6fa77372348";
const INFO_MAILBOX = process.env.INFO_MAILBOX || "info@meyssalegal.com";
const CC_ADDRESS = process.env.CC_ADDRESS || "azaradigan@meyssalegal.com";
const RCRM = "https://api.recruitcrm.io/v1";

// Which guide goes to whom. Files live in /assets (NOT /public), so they are
// never served at a URL. The only way out is as an email attachment.
const GUIDES = {
  candidate: "Meyssa_Salary_Market_Guide_Candidates_2026.pdf",
  client_uae: "Meyssa_Salary_Market_Guide_Clients_2026.pdf",
  client_ksa: "Meyssa_Salary_Guide_InHouse_KSA_2026.pdf",
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const p = body && body.payload ? body.payload : body;
    if (!p || !p.id) return res.status(400).json({ error: "no submission id" });

    // 1. Trust nothing in the webhook body: re-read the submission from Webflow
    //    with our own token. A forged POST cannot pass this step.
    const sub = await webflowGet(`/sites/${SITE_ID}/form_submissions/${p.id}`)
      .catch(() => webflowGet(`/form_submissions/${p.id}`));
    if (!sub || !sub.formResponse) return res.status(404).json({ error: "submission not found" });

    const f = sub.formResponse;
    const name = (f["Name"] || "").trim();
    const email = (f["Email"] || "").trim().toLowerCase();
    const company = (f["Company"] || "").trim();
    const jobTitle = (f["Job Title"] || "").trim();
    const message = (f["Message"] || "").trim();
    const enquiryType = (f["Enquiry Type"] || "").trim(); // "I am hiring" | "I am looking for a role"
    const market = (f["Market"] || "UAE").trim(); // "UAE" | "Saudi Arabia"
    const isSurvey = /^\[Requesting Salary Survey\]/i.test(message);

    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || /test/i.test(name)) {
      return res.status(200).json({ skipped: "no usable name/email" });
    }

    const isClient = /hiring/i.test(enquiryType);
    const [firstName, ...rest] = name.split(/\s+/);
    const lastName = rest.join(" ") || "-";

    // 2. Recruit CRM: find or create, never duplicate.
    let record;
    if (isClient) {
      record = await findOrCreateContact({ firstName, lastName, email, company, jobTitle });
    } else {
      record = await findOrCreateCandidate({ firstName, lastName, email, company, jobTitle });
    }

    await rcrm("POST", "/notes", {
      related_to: record.slug,
      related_to_type: isClient ? "contact" : "candidate",
      description:
        `<p><b>Website enquiry (meyssalegal.com ${isSurvey ? "salary survey form" : "contact form"})</b><br>` +
        `Submitted: ${new Date(sub.dateSubmitted).toUTCString()}<br>` +
        `Webflow submission id: ${sub.id}<br>` +
        `Type: ${isSurvey ? "Salary survey request" : "Contact enquiry"} (${isClient ? "client contact" : "candidate"}, routing ${enquiryType ? "stated" : "inferred"}), Market: ${market}<br>` +
        `Message: ${escapeHtml(message.replace(/^\[[^\]]+\]\s*/, "") || "N/A")}<br>` +
        `Status: ${isSurvey ? "Survey emailed automatically from the info box with Azara in CC" : "Logged; reply from Azara pending"}.</p>`,
    });

    // 3. Salary survey: email the guide from the info box, Azara in CC.
    if (isSurvey) {
      const key = !isClient ? "candidate" : /saudi/i.test(market) ? "client_ksa" : "client_uae";
      const file = GUIDES[key];
      const bytes = fs.readFileSync(path.join(process.cwd(), "assets", file));
      const isKsa = key === "client_ksa";
      const subject = isKsa ? "Your copy of the Meyssa Legal Saudi Legal Salary Guide 2026" : "Your copy of the Meyssa Legal UAE Legal Salary Survey 2026";
      const html =
        `<p>Dear ${escapeHtml(firstName)}</p>` +
        `<p>Thank you for requesting our most recent ${isKsa ? "Saudi Legal Salary Guide" : "UAE Legal Salary Survey"}. Please find it attached.</p>` +
        `<p>Should you require any further detail, our founder Azara Digan, in copy, would be happy to assist.</p>` +
        `<p>Kind regards</p>` +
        (process.env.INFO_SIGNATURE_HTML || `<p>Meyssa Legal<br>info@meyssalegal.com | meyssalegal.com</p>`);

      await graphSendMail({
        from: INFO_MAILBOX,
        to: email,
        cc: CC_ADDRESS,
        subject,
        html,
        attachment: { name: file, bytes },
      });
    }

    return res.status(200).json({ ok: true, record: record.slug, emailed: isSurvey });
  } catch (err) {
    console.error("webflow-form error", err);
    // 500 makes Webflow retry; only do that for transient failures.
    return res.status(500).json({ error: String(err.message || err) });
  }
};

// ---------- Webflow ----------
async function webflowGet(p) {
  const r = await fetch("https://api.webflow.com/v2" + p, {
    headers: { Authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`, accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Webflow ${r.status} on ${p}`);
  return r.json();
}

// ---------- Recruit CRM ----------
async function rcrm(method, p, body) {
  const r = await fetch(RCRM + p, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.RECRUITCRM_API_KEY}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  if (!r.ok) throw new Error(`Recruit CRM ${r.status} on ${p}: ${text.slice(0, 200)}`);
  return data;
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
  return { slug: created.slug || (created.data && created.data.slug), existed: false };
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
  return { slug: created.slug || (created.data && created.data.slug), existed: false };
}

function firstHit(resp) {
  if (!resp) return null;
  const list = Array.isArray(resp) ? resp : resp.data || resp.results || [];
  return list.length ? list[0] : null;
}

// ---------- Microsoft Graph (info box sends, application permission) ----------
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
  if (!r.ok) throw new Error(`Graph sendMail ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
