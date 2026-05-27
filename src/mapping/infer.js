// Heuristic inference for the three Option fields RecruitCRM does not give us
// cleanly: practice-setting, practice-area, seniority.
//
// These are FIRST-PASS keyword heuristics. The PM plan and the brief both say
// inference will not be 100% accurate early on, which is exactly why items are
// created as drafts for human review. Each function returns a canonical label
// (matching the keys in src/config/options.js) or null when it cannot decide.
// null means "leave unset, flag for review" rather than a wrong guess.
//
// Tuning these tables is expected ongoing work in Phase 2.

// practice-setting: In-House if the hiring company is not a law firm, Private
// Practice if it is. We only know the real company name from RecruitCRM (which we
// never write to Webflow); we use it here purely to classify, then discard it.
const LAW_FIRM_HINTS = [
  "llp", "law firm", "solicitors", "advocates", "& partners", "legal consultants",
  "attorneys", "chambers",
];

export function inferPracticeSetting(companyName) {
  const c = typeof companyName === "string" ? companyName.toLowerCase() : "";
  if (LAW_FIRM_HINTS.some((h) => c.includes(h))) return "Private Practice";
  // Per the field mapping spec: anything not detected as a law firm defaults to
  // In-House. This is a best-effort binary. The human reviews each draft and can
  // flip practice-setting if a private-practice firm was not recognised by name.
  return "In-House";
}

// practice-area: keyword scan over title + description. First strong match wins.
const PRACTICE_AREA_KEYWORDS = {
  "Banking & Finance": ["banking", "finance", "lending", "debt finance", "leveraged"],
  "Capital Markets & Funds": ["capital markets", "funds", "ecm", "dcm", "securities", "ipo"],
  "Corporate / M&A": ["m&a", "mergers", "acquisitions", "corporate", "private equity", "joint venture"],
  "Disputes": ["disputes", "litigation", "arbitration", "contentious"],
  "Employment": ["employment", "labour", "labor", "hr law"],
  "Intellectual Property": ["intellectual property", "ip ", "trademark", "patent", "copyright"],
  "Projects & Infrastructure": ["projects", "infrastructure", "construction", "epc", "energy"],
  "Real Estate": ["real estate", "property", "leasing", "development"],
  "Regulatory & Compliance": ["regulatory", "compliance", "aml", "sanctions"],
  "Restructuring & Insolvency": ["restructuring", "insolvency", "bankruptcy", "distressed"],
  "Tax": ["tax", "vat", "transfer pricing"],
  "TMT": ["tmt", "technology", "media", "telecom", "data protection", "fintech"],
  "Hospitality": ["hospitality", "hotels", "leisure", "f&b"],
};

export function inferPracticeArea(title, description) {
  const hay = `${title ?? ""} ${description ?? ""}`.toLowerCase();
  for (const [label, keywords] of Object.entries(PRACTICE_AREA_KEYWORDS)) {
    if (keywords.some((k) => hay.includes(k))) return label;
  }
  return null;
}

// seniority: title-driven. Order matters; more specific titles checked first.
const SENIORITY_RULES = [
  { label: "General Counsel", test: (t) => /\bgeneral counsel\b|\bgc\b/.test(t) },
  { label: "Head of Legal", test: (t) => /\bhead of legal\b/.test(t) },
  { label: "Senior Legal Counsel", test: (t) => /\bsenior legal counsel\b/.test(t) },
  { label: "Legal Counsel", test: (t) => /\blegal counsel\b/.test(t) },
  { label: "Partner", test: (t) => /\bpartner\b/.test(t) },
  { label: "Counsel", test: (t) => /\bcounsel\b/.test(t) },
  { label: "Managing Associate", test: (t) => /\bmanaging associate\b/.test(t) },
  { label: "Senior Associate", test: (t) => /\bsenior associate\b/.test(t) },
  { label: "Associate", test: (t) => /\bassociate\b/.test(t) },
];

export function inferSeniority(title, pqe) {
  const t = String(title ?? "").toLowerCase();
  for (const rule of SENIORITY_RULES) {
    if (rule.test(t)) return rule.label;
  }
  // Fall back to a PQE band heuristic for private-practice ladders.
  if (pqe && Number.isFinite(pqe.min)) {
    if (pqe.min >= 8) return "Counsel";
    if (pqe.min >= 5) return "Senior Associate";
    if (pqe.min >= 0) return "Associate";
  }
  return null;
}
