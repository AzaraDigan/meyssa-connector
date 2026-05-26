// Deterministic transforms used by the mapping layer. These touch no API and are
// fully unit-testable, so they are implemented and tested in session 1.

import { applyBrandRules } from "../brand/scrub.js";

const KNOWN_CITIES = [
  "Dubai", "Abu Dhabi", "Riyadh", "Doha", "Manama", "Kuwait City", "Muscat",
];

// Normalise free-text RecruitCRM location into one of the seven canonical labels
// used by the Webflow Location Option table. Returns the canonical label, or null
// if it cannot be matched confidently (null routes to human review).
const LOCATION_ALIASES = {
  "dubai": "Dubai, UAE",
  "abu dhabi": "Abu Dhabi, UAE",
  "riyadh": "Riyadh, KSA",
  "doha": "Doha, Qatar",
  "manama": "Manama, Bahrain",
  "kuwait": "Kuwait City, Kuwait",
  "kuwait city": "Kuwait City, Kuwait",
  "muscat": "Muscat, Oman",
};

export function normaliseLocation(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  // Exact alias first, then substring match on the city name.
  if (LOCATION_ALIASES[text]) return LOCATION_ALIASES[text];
  for (const [alias, label] of Object.entries(LOCATION_ALIASES)) {
    if (text.includes(alias)) return label;
  }
  return null;
}

// Build the URL slug: {job-id}-{role-slug}.
export function buildSlug(jobId, roleTitle) {
  return `${slugify(String(jobId))}-${slugify(roleTitle)}`;
}

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Strip PQE band and trailing/leading city from a raw title, leaving the role name.
export function stripTitle(rawTitle) {
  if (typeof rawTitle !== "string") return "";
  let t = rawTitle;
  // Remove PQE bands like "5+ PQE", "5-7 PQE", "(3 PQE)", "3 to 5 years PQE".
  t = t.replace(/\(?\s*\d+\s*(?:\+|-|–|to)?\s*\d*\s*(?:years?|yrs?)?\s*pqe\s*\)?/gi, " ");
  // Remove a trailing or leading known city, with surrounding separators.
  for (const city of KNOWN_CITIES) {
    const re = new RegExp(`[\\s,\\-|]*\\b${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[\\s,\\-|]*`, "gi");
    t = t.replace(re, " ");
  }
  // Tidy separators and whitespace.
  return t.replace(/\s*[|,\-–]\s*$/g, "").replace(/^\s*[|,\-–]\s*/g, "").replace(/\s{2,}/g, " ").trim();
}

// Parse a PQE band from a title. Returns { min, max }. Unbounded "+" maps max to 40
// per the spec. Returns null when no band is found (caller decides the fallback).
export function parsePqe(rawTitle) {
  if (typeof rawTitle !== "string") return null;
  const t = rawTitle.toLowerCase();
  // Range: "5-7 pqe", "5 to 7 pqe", "5–7 years".
  const range = t.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:years?|yrs?)?\s*(?:pqe)?/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  // Unbounded: "5+ pqe".
  const plus = t.match(/(\d+)\s*\+\s*(?:years?|yrs?)?\s*(?:pqe)?/);
  if (plus) return { min: Number(plus[1]), max: 40 };
  // Single value: "5 pqe".
  const single = t.match(/(\d+)\s*(?:years?|yrs?)?\s*pqe/);
  if (single) return { min: Number(single[1]), max: Number(single[1]) };
  return null;
}

// valid-through = posted-date + 60 days, both ISO 8601.
export function validThroughFrom(postedIso, days = 60) {
  const d = new Date(postedIso);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// Two-sentence overview from a description, brand-scrubbed, capped at 280 chars.
export function buildOverview(descriptionPlainText, maxLen = 280) {
  const text = String(descriptionPlainText ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { text: "", findings: [] };
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let overview = sentences.slice(0, 2).join(" ").replace(/\s{2,}/g, " ").trim();
  if (overview.length > maxLen) overview = overview.slice(0, maxLen - 1).trimEnd() + "…";
  return applyBrandRules(overview);
}
