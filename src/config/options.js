// Webflow CMS Option field IDs.
// Source: redeployment brief, 2026-05-26. These are the canonical IDs the
// Webflow collection expects for each Option field. The mapping layer resolves
// a RecruitCRM value (or an inferred value) to one of these IDs.
//
// Each table maps a human-readable label to its Webflow Option ID. The label is
// what we infer or read from RecruitCRM; the ID is what we send to Webflow.

export const LOCATION = {
  "Dubai, UAE": "9ec3180b705e7db6b38475fe3605bdd4",
  "Abu Dhabi, UAE": "5dbad45a0d96fe2bf95161f525ecc695",
  "Riyadh, KSA": "5af353f826842399e65336d133c5eb95",
  "Doha, Qatar": "d766a4d5021fadaeacfb3d6f768df7a1",
  "Manama, Bahrain": "2e662732a35556fdcf88410d9e57b0af",
  "Kuwait City, Kuwait": "bf764aab31442ce857dabf656c9caf95",
  "Muscat, Oman": "ff9826fd34a0fc9a4fba5e9f560ab9ed",
};

export const PRACTICE_SETTING = {
  "In-House": "7f3830ba550d51aeec7bb7125d3f83ad",
  "Private Practice": "646b1b61343f6fc9bc06fb725e6476b6",
};

export const PRACTICE_AREA = {
  "Banking & Finance": "27d5eb3f8f5a68def65d3248c9c7e790",
  "Capital Markets & Funds": "29bc2f900611b5e4efcbd3ecf6de4284",
  "Corporate / M&A": "ed090f6b8be2f98c4a7add3624f8deb5",
  "Disputes": "d2031399d1c3581077ae73d129251003",
  "Employment": "0101fab3c4d89307b07b2bd56c17f742",
  "Intellectual Property": "e00cb64dce307ff9c564ebba9e89a6f0",
  "Projects & Infrastructure": "512de9ef377b76600a7993c42a020780",
  "Real Estate": "498156d6ca902e96ae8702b9b0a7349a",
  "Regulatory & Compliance": "78686e54ef27f465279311e2fb8ae60d",
  "Restructuring & Insolvency": "cca808e94952b6402a99c1aaabeeb637",
  "Tax": "a873a2e3a0fdb022751cd852332e0843",
  "TMT": "69eff363aa50ea5997d8d24b39aa7a0b",
  "Hospitality": "261b64c874629eb6f99f0c5613e49014",
};

export const SENIORITY = {
  "Partner": "88f687faa7e4bf9e73d284badc798775",
  "Counsel": "b50e4b8ca0c17171958f6438535ecc21",
  "Managing Associate": "f94250a1cb67961b568c9cc2ffa9f62b",
  "Senior Associate": "4b80dc1a59e8f264d993c3d11ca769a6",
  "Associate": "c9bde63cb5d49bec1b9ba867cd113893",
  "General Counsel": "4f0398b7089c9e0968329d70f345d636",
  "Head of Legal": "b89677db9f645ae2992f7a637f7e5821",
  "Senior Legal Counsel": "278cdd8fcfbfdbb12b42865fad8f157d",
  "Legal Counsel": "c864756ed7310c397f5948b470135190",
};

export const EMPLOYMENT_TYPE = {
  "Permanent": "677faca490f624778acac60e68a0f2d9",
  "Fixed-Term Contract": "eeb3567cf436af3bfb81f128486626f8",
  "Part-Time": "5428423655cb0a67cee7af450b2901de",
  "Temporary / Locum": "32c007d59603eee0930ea5be1e9c9f57",
  "Internship": "e8e32b010ec2fe8413874ae515fae2ef",
};

export const STATUS = {
  "Active": "b070ef1c5ee3565f064d7262560133bc",
  "Closed": "8b9d5b8b645236eb45a4632dff6b36f5",
  "Archived": "1d26f33a7d1a8bd0f1fcf420cb3282c1",
};

// Defaults defined by the field mapping spec.
export const DEFAULTS = {
  employmentType: "Permanent",
  status: "Active",
};

// Resolve a label to its Option ID. Returns the ID, or null if the label is not
// a known Option for that field. Returning null (rather than guessing) is
// deliberate: an unmapped value is a flag for human review, not a silent default.
export function resolveOption(table, label) {
  if (label == null) return null;
  const id = table[label];
  return id ?? null;
}

// All tables in one object so callers can look up by field name.
export const OPTION_TABLES = {
  location: LOCATION,
  practiceSetting: PRACTICE_SETTING,
  practiceArea: PRACTICE_AREA,
  seniority: SENIORITY,
  employmentType: EMPLOYMENT_TYPE,
  status: STATUS,
};
