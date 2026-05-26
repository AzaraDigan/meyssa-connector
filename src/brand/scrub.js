// Brand-voice enforcement for any text the connector generates or passes through
// to Webflow (overview, full-description, client-name).
//
// Two jobs:
//   1. scrubDashes: mechanically remove em dashes and en dashes. Hyphens are fine.
//   2. lintBannedWords: flag banned vocabulary for human review.
//
// Hard rule (redeployment brief): no em dashes, no en dashes. Banned words:
// delve, empower, robust, seamless, cutting-edge, "navigate" as an abstract verb,
// "in today's X", tricolon openings, rhetorical-question openings, "talent" as a
// noun for people, "leading" as a verb, "mandate", "wheelhouse".
//
// Some of those are contextual (a parser cannot reliably tell "leading" the verb
// from "leading" the adjective, and "A leading international law firm" is itself the
// suggested anonymised client descriptor). So we split the list:
//   - HARD_BANNED: always wrong, flagged with high confidence.
//   - CONTEXTUAL: needs a human eye; flagged as a warning, never auto-changed.

const EM_DASH = "—"; // —
const EN_DASH = "–"; // –

// Words that are wrong in any context. Matched case-insensitively on word boundaries.
const HARD_BANNED = [
  "delve",
  "empower",
  "robust",
  "seamless",
  "cutting-edge",
  "wheelhouse",
  "mandate",
];

// Words/patterns that are only wrong in some uses. Flag, do not block.
const CONTEXTUAL = [
  { word: "navigate", note: '"navigate" is banned as an abstract verb; fine for literal navigation.' },
  { word: "talent", note: '"talent" is banned as a noun for people.' },
  { word: "leading", note: '"leading" is banned as a verb; fine as an adjective (e.g. "a leading firm").' },
];

// Replace em and en dashes with a hyphen. A spaced clause dash (" - ") can read
// oddly, so we also surface a warning for any dash we changed, letting a human
// rephrase if a comma would read better.
export function scrubDashes(text) {
  if (typeof text !== "string") return { text, changed: false };
  const had = text.includes(EM_DASH) || text.includes(EN_DASH);
  const out = text.replaceAll(EM_DASH, "-").replaceAll(EN_DASH, "-");
  return { text: out, changed: had };
}

// Returns an array of findings: { word, severity, note }.
// severity: "error" for hard-banned, "warning" for contextual.
export function lintBannedWords(text) {
  if (typeof text !== "string") return [];
  const findings = [];
  const lower = text.toLowerCase();

  for (const word of HARD_BANNED) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
    if (re.test(lower)) {
      findings.push({ word, severity: "error", note: `Banned word "${word}".` });
    }
  }

  for (const { word, note } of CONTEXTUAL) {
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
    if (re.test(lower)) {
      findings.push({ word, severity: "warning", note });
    }
  }

  // Rhetorical-question opening (first sentence ends in "?").
  if (/^\s*[^.!?]*\?/.test(text)) {
    findings.push({ word: "(opening)", severity: "warning", note: "Possible rhetorical-question opening." });
  }

  // "In today's X" opening.
  if (/^\s*in today'?s\b/i.test(text)) {
    findings.push({ word: "in today's", severity: "error", note: 'Banned "in today\'s X" opening.' });
  }

  return findings;
}

// Convenience: scrub dashes and lint in one pass. Does not auto-change banned
// words; that needs a human. Returns the dash-scrubbed text plus all findings.
export function applyBrandRules(text) {
  const { text: scrubbed, changed } = scrubDashes(text);
  const findings = lintBannedWords(scrubbed);
  if (changed) {
    findings.push({ word: "(dash)", severity: "info", note: "Em or en dash replaced with a hyphen; check it still reads well." });
  }
  return { text: scrubbed, findings };
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
