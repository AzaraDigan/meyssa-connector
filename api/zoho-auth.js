// Vercel serverless function: /api/zoho-auth
//
// One-off helper to turn a Zoho "Self Client" grant code into the refresh token the
// finance sync needs. Zoho's grant codes expire in a few minutes and can only be
// exchanged with the client secret, which lives in Vercel and nowhere else, so the
// exchange happens here rather than on Azara's machine or in chat.
//
// Use once:
//   1. ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET are already set in Vercel.
//   2. In api-console.zoho.<dc> > Self Client > Generate Code, scope
//      ZohoBooks.fullaccess.all, copy the code.
//   3. Open  https://<host>/api/zoho-auth?secret=<FORM_WEBHOOK_SECRET>&dc=<com|eu|in|au|sa>&code=<the code>
//   4. Copy refresh_token into Vercel as ZOHO_REFRESH_TOKEN, note organization_id for
//      ZOHO_ORG_ID and the dc for ZOHO_DC, redeploy. Then this endpoint is never needed
//      again (it can be deleted).
//
// The refresh token is shown once to the person holding the secret and is never logged.

export default async function handler(req, res) {
  const secret = process.env.FORM_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || process.env.SYNC_SECRET;
  if (!secret || req.query?.secret !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const code = String(req.query?.code || "").trim();
  const dc = String(req.query?.dc || process.env.ZOHO_DC || "com").trim();
  if (!code) {
    res.status(400).json({ error: "add &code=<grant code from the Zoho API console>" });
    return;
  }
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    res.status(503).json({ error: "ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in Vercel first" });
    return;
  }
  try {
    const r = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: "authorization_code",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j.refresh_token) {
      res.status(400).json({ ok: false, error: j.error || `Zoho returned ${r.status}`, hint: "Codes expire quickly and can be used once. Generate a fresh one and try again. If the error is invalid_client, the dc is wrong: try eu, in, au or sa." });
      return;
    }
    let organizations = [];
    try {
      const o = await fetch(`https://www.zohoapis.${dc}/books/v3/organizations`, { headers: { Authorization: `Zoho-oauthtoken ${j.access_token}` } });
      const oj = await o.json();
      organizations = (oj.organizations || []).map((x) => ({ organization_id: x.organization_id, name: x.name, currency: x.currency_code }));
    } catch { /* optional */ }
    res.status(200).json({
      ok: true,
      next: "Paste refresh_token into Vercel as ZOHO_REFRESH_TOKEN, the organization_id as ZOHO_ORG_ID, and this dc as ZOHO_DC, then redeploy.",
      dc,
      refresh_token: j.refresh_token,
      organizations,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
