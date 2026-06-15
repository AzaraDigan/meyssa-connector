// full-description builder.
//
// The Webflow detail page splitter expects this exact HTML structure and these
// exact H3 headings (the listing/detail cards are built from them):
//
//   <h3>Role overview</h3><p>...</p>
//   <h3>Key responsibilities</h3><ul><li>...</li></ul>
//   <h3>Candidate profile</h3><ul><li>...</li></ul>
//
// buildFullDescriptionHtml assembles that structure from already-separated parts.
// It is deterministic and tested. parseSections is a heuristic splitter over a raw
// RecruitCRM description; it relies on the consultant SOP of writing jobs under the
// three headings (per the PM plan). Where it cannot find a section it returns empty,
// and mapJob flags the job for human review rather than shipping a half-built body.

import { scrubDashes } from "../brand/scrub.js";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * @param {{ overview: string, responsibilities: string[], profile: string[] }} sections
 * @returns {string} HTML
 */
export function buildFullDescriptionHtml({ overview = "", responsibilities = [], profile = [] }) {
  const ov = scrubDashes(overview).text;
  const resp = responsibilities.map((r) => scrubDashes(r).text);
  const prof = profile.map((p) => scrubDashes(p).text);

  const respItems = resp.map((r) => `<li>${esc(r)}</li>`).join("");
  const profItems = prof.map((p) => `<li>${esc(p)}</li>`).join("");

  return (
    `<h3>Role overview</h3><p>${esc(ov)}</p>` +
    `<h3>Key responsibilities</h3><ul>${respItems}</ul>` +
    `<h3>Candidate profile</h3><ul>${profItems}</ul>`
  );
}

// Heuristic split of a raw description into sections, keyed on the expected headings.
// Returns { listingSnippet, overview, responsibilities[], profile[], complete }.
// `listingSnippet` is a short 2-line summary for the website listing card — separate from
// `overview` (the Role Overview that opens the detail page). It is NOT part of `complete`:
// its absence is handled by mapJob (fail-closed), not by blocking the detail body.
// `complete` is true only when the three detail sections were found.
const HEADINGS = {
  listingSnippet: /listing snippet/i,
  overview: /role overview/i,
  responsibilities: /key responsibilities/i,
  profile: /candidate profile/i,
};

export function parseSections(raw) {
  const text = String(raw ?? "");
  const result = { listingSnippet: "", overview: "", responsibilities: [], profile: [], complete: false };
  if (!text.trim()) return result;

  // Work on plain-ish lines. Strip simple HTML tags so this works whether the
  // RecruitCRM description is HTML or plain text.
  const lines = text
    .replace(/<\/(p|li|ul|h[1-6]|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let current = null;
  for (const line of lines) {
    if (HEADINGS.listingSnippet.test(line)) { current = "listingSnippet"; continue; }
    if (HEADINGS.overview.test(line)) { current = "overview"; continue; }
    if (HEADINGS.responsibilities.test(line)) { current = "responsibilities"; continue; }
    if (HEADINGS.profile.test(line)) { current = "profile"; continue; }
    if (current === "listingSnippet") {
      result.listingSnippet = result.listingSnippet ? `${result.listingSnippet} ${line}` : line;
    } else if (current === "overview") {
      result.overview = result.overview ? `${result.overview} ${line}` : line;
    } else if (current === "responsibilities") {
      // Drop a lead-in line that ends in a colon (e.g. "You will:") sitting just
      // above the bullets, so it does not become its own list item.
      if (result.responsibilities.length === 0 && /:\s*$/.test(line)) continue;
      result.responsibilities.push(line.replace(/^[-•*]\s*/, ""));
    } else if (current === "profile") {
      if (result.profile.length === 0 && /:\s*$/.test(line)) continue;
      result.profile.push(line.replace(/^[-•*]\s*/, ""));
    }
  }

  result.complete = Boolean(result.overview) && result.responsibilities.length > 0 && result.profile.length > 0;
  return result;
}
