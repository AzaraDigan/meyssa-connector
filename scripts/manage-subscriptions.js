// Ops CLI for RecruitCRM webhook ("Subscription") management.
//
// Subscribes the job lifecycle events that drive near-instant Webflow sync to our
// /api/recruitcrm-hook receiver. RecruitCRM posts directly to us — no third party.
//
// Usage (run from the connector dir; .env must hold RECRUITCRM_API_TOKEN):
//   node --env-file=.env scripts/manage-subscriptions.js list
//   node --env-file=.env scripts/manage-subscriptions.js register "https://<deployment>/api/recruitcrm-hook?secret=YOUR_SECRET"
//   node --env-file=.env scripts/manage-subscriptions.js delete-all
//
// `register` is idempotent-ish: it deletes any existing subscriptions for the same
// events first, then creates fresh ones, so re-running repoints them at a new URL.
// `delete-all` clears every subscription (use to reset, or to point at a new deploy).

const token = process.env.RECRUITCRM_API_TOKEN;
const base = (process.env.RECRUITCRM_API_BASE || "https://api.recruitcrm.io/v1").replace(/\/$/, "");

// The job lifecycle events: create, edit, close (status change) and hard delete.
const JOB_EVENTS = ["job.created", "job.updated", "job.status.updated", "job.deleted"];

if (!token) {
  console.error("No RECRUITCRM_API_TOKEN in env. Add it to .env.");
  process.exit(1);
}

const H = { Authorization: "Bearer " + token, Accept: "application/json", "Content-Type": "application/json" };

async function req(method, path, body) {
  const r = await fetch(base + path, { method, headers: H, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, ok: r.ok, json, text };
}

async function listAll() {
  const rows = [];
  let url = "/subscriptions";
  while (url) {
    const r = await req("GET", url);
    if (!r.ok) throw new Error(`list failed: ${r.status} ${r.text.slice(0, 200)}`);
    const data = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : [];
    rows.push(...data);
    const next = r.json?.next_page_url;
    url = next ? next.replace(base, "") : null;
  }
  return rows;
}

async function cmdList() {
  const rows = await listAll();
  console.log(`subscriptions: ${rows.length}`);
  for (const s of rows) {
    console.log(`  id=${s.id ?? s.slug}  event=${s.event}  ->  ${s.target_url}`);
  }
}

async function cmdDeleteAll() {
  const rows = await listAll();
  console.log(`deleting ${rows.length} subscription(s)...`);
  for (const s of rows) {
    const id = s.id ?? s.slug;
    const d = await req("DELETE", "/subscriptions/" + id);
    console.log(`  delete id=${id} -> ${d.status}`);
  }
}

async function cmdRegister(targetUrl) {
  if (!targetUrl || !/^https:\/\//.test(targetUrl)) {
    console.error('register needs an https target URL, e.g. "https://<deployment>/api/recruitcrm-hook?secret=YOUR_SECRET"');
    process.exit(1);
  }
  // Remove existing subscriptions for these events first (so re-running repoints them).
  const existing = await listAll();
  for (const s of existing) {
    if (JOB_EVENTS.includes(s.event)) {
      const id = s.id ?? s.slug;
      await req("DELETE", "/subscriptions/" + id);
      console.log(`  removed old ${s.event} (id=${id})`);
    }
  }
  for (const event of JOB_EVENTS) {
    const r = await req("POST", "/subscriptions", { event, target_url: targetUrl });
    const obj = r.json?.data ?? r.json;
    console.log(`  ${r.ok ? "OK   " : "FAIL "} ${event} -> id=${obj?.id ?? obj?.slug ?? "?"} (${r.status})` + (r.ok ? "" : "  " + r.text.slice(0, 160)));
  }
  console.log("done. Verify with: node --env-file=.env scripts/manage-subscriptions.js list");
}

const [, , command, arg] = process.argv;
(async () => {
  try {
    if (command === "list") await cmdList();
    else if (command === "delete-all") await cmdDeleteAll();
    else if (command === "register") await cmdRegister(arg);
    else {
      console.log("Usage: manage-subscriptions.js <list|register <url>|delete-all>");
      process.exit(1);
    }
  } catch (e) {
    console.error("error:", String(e));
    process.exit(1);
  }
})();
